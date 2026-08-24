import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rank, defaultScoringConfig, penaltyForDiff, waistPenalty } from '../src/scoring/index.ts';
import type { Body, Catalog, StretchClass } from '../src/scoring/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = resolve(__dirname, '../catalog/mystic-city.json');

function loadCatalog(): Catalog {
  return JSON.parse(readFileSync(CATALOG_PATH, 'utf-8')) as Catalog;
}

// Synthetic body profiles for testing. All measurements in inches.
const mediumBody: Body = {
  natural_waist_in: 28,
  underbust: { circumference_in: 32, position_in: -5 },
  upper_hip: { circumference_in: 34, position_in: 4 },
  iliac: { circumference_in: 38, position_in: 7 },
};

const highSpringBody: Body = {
  // Someone with dramatic rib-to-hip differences — wide ribs AND wide hips
  // relative to waist. Should favor high-spring corsets.
  natural_waist_in: 26,
  underbust: { circumference_in: 36, position_in: -5 },
  upper_hip: { circumference_in: 36, position_in: 4 },
  iliac: { circumference_in: 44, position_in: 7 },
};

describe('penaltyForDiff (non-waist landmarks)', () => {
  it('applies looseness slope to positive diffs', () => {
    expect(penaltyForDiff(2, 1, 3, 1)).toBe(2); // 1 * 2 * 1
  });
  it('applies tightness slope to negative diffs', () => {
    expect(penaltyForDiff(-2, 1, 3, 1)).toBe(6); // 1 * 2 * 3
  });
  it('is zero at a perfect fit', () => {
    expect(penaltyForDiff(0, 1, 3, 1)).toBe(0);
  });
  it('scales by weight', () => {
    expect(penaltyForDiff(2, 2, 3, 1)).toBe(4);
  });
});

describe('waistPenalty (target-based, inverted asymmetry)', () => {
  it('applies over_target_slope to positive diffs (corset too big to reach target)', () => {
    // diff=2 means corset is 2" larger than target — can't reach.
    expect(waistPenalty(2, 1, 3, 0.5)).toBe(6); // 1 * 2 * 3
  });
  it('applies under_target_slope to negative diffs (corset closes smaller — gap-lace)', () => {
    // diff=-2 means corset closes 2" smaller than target — gap-lace up.
    expect(waistPenalty(-2, 1, 3, 0.5)).toBe(1); // 1 * 2 * 0.5
  });
  it('is zero at a perfect target match', () => {
    expect(waistPenalty(0, 1, 3, 0.5)).toBe(0);
  });
  it('inverts the asymmetry of penaltyForDiff', () => {
    // For the same |diff| = 2, over-target should be HARSHER than under-target,
    // whereas for landmarks it's the reverse (tight is harsher than loose).
    const overTarget = waistPenalty(2, 1, 3, 0.5);
    const underTarget = waistPenalty(-2, 1, 3, 0.5);
    expect(overTarget).toBeGreaterThan(underTarget);
    // And the inverted-slope penalty function for a landmark would score
    // negative diffs harsher (tight is bad on ribs), which is the opposite.
    const landmarkNeg = penaltyForDiff(-2, 1, 3, 1);
    const landmarkPos = penaltyForDiff(2, 1, 3, 1);
    expect(landmarkNeg).toBeGreaterThan(landmarkPos);
  });
});

describe('rank', () => {
  const catalog = loadCatalog();

  it('returns a non-empty sorted list', () => {
    const config = defaultScoringConfig(catalog);
    const results = rank(mediumBody, catalog, config);
    expect(results.length).toBeGreaterThan(0);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].best.total).toBeGreaterThanOrEqual(results[i - 1].best.total);
    }
  });

  it('every ranked result has a variant matching the stretch_preference', () => {
    const config = defaultScoringConfig(catalog);
    for (const pref of ['low', 'medium', 'high'] as StretchClass[]) {
      const results = rank(mediumBody, catalog, { ...config, stretch_preference: pref });
      for (const r of results) {
        expect(r.best.variant.stretch_class).toBe(pref);
      }
    }
  });

  it('drops corsets with no matching variant when stretch_preference is set', () => {
    const config = defaultScoringConfig(catalog);
    const all = rank(mediumBody, catalog, config);
    const highOnly = rank(mediumBody, catalog, { ...config, stretch_preference: 'high' });
    // Should be a strict subset (unless every corset happens to have a high variant).
    expect(highOnly.length).toBeLessThanOrEqual(all.length);
    // Every "high only" result exists in the "any" ranking.
    const allIds = new Set(all.map((r) => r.corset.id));
    for (const r of highOnly) expect(allIds.has(r.corset.id)).toBe(true);
  });

  it("top-ranked corset's effective waist matches the TARGET waist within tolerance", () => {
    const config = defaultScoringConfig(catalog);
    const results = rank(mediumBody, catalog, config);
    const top = results[0];
    const slack = config.waist_slack_by_stretch_class_in[top.best.variant.stretch_class];
    const effectiveWaist = top.best.waist_size_in + slack;
    const targetWaist = mediumBody.natural_waist_in - config.desired_reduction_in;
    // Under the new asymmetry: over-target is harshly penalized, so top result
    // should be AT or BELOW target. Allow a small over-target tolerance because
    // discrete waist sizes may not hit exactly.
    expect(effectiveWaist - targetWaist).toBeLessThan(1.5);
  });

  it('top-ranked corset changes when desired_reduction_in changes', () => {
    const baseConfig = defaultScoringConfig(catalog);
    const gentle = rank(mediumBody, catalog, { ...baseConfig, desired_reduction_in: 1 });
    const aggressive = rank(mediumBody, catalog, { ...baseConfig, desired_reduction_in: 5 });
    // With a 1" reduction (target 27) vs 5" reduction (target 23), the
    // recommended size will differ. Effective waists should differ meaningfully.
    const gentleTop = gentle[0];
    const aggressiveTop = aggressive[0];
    const gentleSlack = baseConfig.waist_slack_by_stretch_class_in[gentleTop.best.variant.stretch_class];
    const aggressiveSlack = baseConfig.waist_slack_by_stretch_class_in[aggressiveTop.best.variant.stretch_class];
    const gentleEff = gentleTop.best.waist_size_in + gentleSlack;
    const aggressiveEff = aggressiveTop.best.waist_size_in + aggressiveSlack;
    expect(gentleEff).toBeGreaterThan(aggressiveEff);
  });

  it('rankings differ between body profiles', () => {
    const config = defaultScoringConfig(catalog);
    const medium = rank(mediumBody, catalog, config);
    const highSpring = rank(highSpringBody, catalog, config);
    // Same catalog, different bodies → the top result should not always match.
    expect(medium[0].corset.id).not.toBe(highSpring[0].corset.id);
  });
});

describe('cupped-rib silhouette-specific scoring', () => {
  const catalog = loadCatalog();

  it('penalizes underbust looseness symmetrically for cupped-rib silhouettes (loose ≈ as bad as tight)', () => {
    // Body with small rib produces positive diff (loose) at underbust for
    // most corsets. Compare same corset's rib penalty when its
    // silhouette_category is 'cupped-rib' vs when it's not.
    const config = defaultScoringConfig(catalog);
    const narrowRibBody: Body = {
      natural_waist_in: 28,
      underbust: { circumference_in: 30, position_in: -5 },
      upper_hip: { circumference_in: 34, position_in: 4 },
      iliac: { circumference_in: 38, position_in: 7 },
    };
    // Find a cupped-rib silhouette in the catalog with a variant to test.
    const cuppedRib = catalog.corsets.find(
      (c) => c.silhouette_category === 'cupped-rib' && c.variants.length > 0
        && c.variants.some((v) => v.waist_sizes_in.length > 0),
    );
    if (!cuppedRib) return; // Skip if none available in fixture data.
    // Run ranking with cupped-rib label as-is, then again with the label
    // temporarily switched to 'hourglass' to compare.
    const asCupped = rank(narrowRibBody, catalog, config);
    const cuppedRow = asCupped.find((r) => r.corset.id === cuppedRib.id);
    if (!cuppedRow) return;
    // Find the underbust position penalty in this ranking.
    const cuppedUnderbust = cuppedRow.best.position_results.find(
      (p) => (p.label ?? '').startsWith('under-bust'),
    );
    if (!cuppedUnderbust || cuppedUnderbust.diff_in === null) return;
    // Skip if diff is not positive (this test only exercises the loose case).
    if (cuppedUnderbust.diff_in <= 0.1) return;

    // Manually score the same corset+variant+size but with silhouette
    // temporarily marked as 'hourglass' (which uses the normal loose slope).
    const modifiedCatalog: Catalog = {
      ...catalog,
      corsets: catalog.corsets.map((c) =>
        c.id === cuppedRib.id ? { ...c, silhouette_category: 'hourglass' } : c,
      ),
    };
    const asHourglass = rank(narrowRibBody, modifiedCatalog, config);
    const hourglassRow = asHourglass.find((r) => r.corset.id === cuppedRib.id);
    if (!hourglassRow) return;
    const hourglassUnderbust = hourglassRow.best.position_results.find(
      (p) => (p.label ?? '').startsWith('under-bust'),
    );
    if (!hourglassUnderbust) return;

    // The cupped-rib version should have a STRICTLY GREATER underbust penalty
    // than the hourglass version, because looseness at rib is symmetrized
    // to the tightness slope (3x vs 2x).
    expect(cuppedUnderbust.penalty).toBeGreaterThan(hourglassUnderbust.penalty);
    // Sanity: ratio should be roughly tightness_slope / looseness_slope = 1.5.
    expect(cuppedUnderbust.penalty / hourglassUnderbust.penalty).toBeCloseTo(1.5, 1);
  });
});

describe('looseness at non-waist positions (negative gap)', () => {
  const catalog = loadCatalog();

  it('a corset with a negative gap at a landmark contributes a meaningful position penalty', () => {
    // Body with a narrow rib so many corsets will have closed underbust >
    // body underbust → negative actual_gap → "loose" per the diff formula.
    const config = defaultScoringConfig(catalog);
    const narrowRibBody: Body = {
      natural_waist_in: 28,
      underbust: { circumference_in: 26, position_in: -5 },
      upper_hip: { circumference_in: 34, position_in: 4 },
      iliac: { circumference_in: 38, position_in: 7 },
    };
    const results = rank(narrowRibBody, catalog, config);
    // Find at least one ranked result where the underbust position has a
    // negative actual_gap AND a non-trivial penalty (per the bumped slope).
    let matched = false;
    for (const r of results.slice(0, 20)) {
      for (const p of r.best.position_results) {
        if (p.label?.startsWith('under-bust') && p.actual_gap_in !== null && p.actual_gap_in < -0.5) {
          // With the bumped looseness_slope, a 1"+ negative gap should
          // yield a penalty of at least 2.0 (weight × diff × 2.0 slope).
          expect(p.penalty).toBeGreaterThan(1.5);
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    expect(matched).toBe(true);
  });
});

describe('gap_shape modes', () => {
  const catalog = loadCatalog();

  it('curved (default) allows corsets that would produce a curved gap', () => {
    const config = defaultScoringConfig(catalog);
    expect(config.gap_shape).toBe('curved');
    const results = rank(mediumBody, catalog, config);
    // Sanity: top result exists in curved mode.
    expect(results.length).toBeGreaterThan(0);
  });

  it('closed rejects most corsets — top results have small gaps at every position', () => {
    const config = defaultScoringConfig(catalog);
    const closed = rank(mediumBody, catalog, { ...config, gap_shape: 'closed' });
    const curved = rank(mediumBody, catalog, { ...config, gap_shape: 'curved' });
    // Closed mode's top result should have small |actual_gap| at every non-waist
    // position, since gap != 0 is penalized symmetrically.
    const closedTop = closed[0];
    for (const p of closedTop.best.position_results) {
      if (p.actual_gap_in === null) continue;
      expect(Math.abs(p.actual_gap_in)).toBeLessThan(4);
    }
    // Curved and closed produce different ranking orders for the same body.
    // At least one of the top 5 should differ between the two modes.
    const curvedTop5 = curved.slice(0, 5).map((r) => r.corset.id);
    const closedTop5 = closed.slice(0, 5).map((r) => r.corset.id);
    expect(closedTop5).not.toEqual(curvedTop5);
  });

  it('straight rewards corsets whose spring profile matches the body silhouette', () => {
    const config = defaultScoringConfig(catalog);
    const straight = rank(mediumBody, catalog, { ...config, gap_shape: 'straight' });
    const curved = rank(mediumBody, catalog, { ...config, gap_shape: 'curved' });
    // Sanity: still produces a ranking.
    expect(straight.length).toBeGreaterThan(0);
    // Top result in straight mode has approximately uniform gaps across
    // non-waist positions — the whole point of the mode.
    const top = straight[0];
    const gaps = top.best.position_results
      .map((p) => p.actual_gap_in)
      .filter((g): g is number => g !== null);
    if (gaps.length >= 2) {
      const spread = Math.max(...gaps) - Math.min(...gaps);
      // A curved-mode top result might have gap spread > 3"; straight-mode
      // should be tighter than that.
      expect(spread).toBeLessThan(3);
    }
    // Straight mode reorders vs curved.
    expect(straight[0].corset.id !== curved[0].corset.id ||
      straight[1]?.corset.id !== curved[1]?.corset.id).toBe(true);
  });

  it('curved mode applies hourglass_penalty when waist gap > non-waist gaps', () => {
    // Construct a body where a corset with small rib and hip spring and large
    // waist gap would produce an hourglass shape. We use highSpringBody
    // (wide rib + wide iliac) — this body's non-waist gaps will be TIGHTER
    // than the waist gap for many corsets that don't have enough spring.
    const config = defaultScoringConfig(catalog);
    const results = rank(highSpringBody, catalog, config);
    // At least SOME result should exhibit the hourglass penalty for this body.
    const anyHourglass = results.some((r) => r.best.hourglass_penalty > 0);
    expect(anyHourglass).toBe(true);
  });

  it('hourglass_penalty is 0 in every non-curved mode', () => {
    const config = defaultScoringConfig(catalog);
    for (const mode of ['straight', 'slant-hip', 'slant-rib', 'closed'] as const) {
      const results = rank(highSpringBody, catalog, { ...config, gap_shape: mode });
      for (const r of results) {
        expect(r.best.hourglass_penalty).toBe(0);
      }
    }
  });

  it('slant-hip top result has non-waist gaps that grow toward the hip', () => {
    const config = defaultScoringConfig(catalog);
    const results = rank(mediumBody, catalog, { ...config, gap_shape: 'slant-hip' });
    expect(results.length).toBeGreaterThan(0);
    const top = results[0];
    // Compare rib gap vs the largest hip gap. Slant-hip's target grows with
    // position, so the top-ribbed and top-hipped positions should reflect
    // that ordering — hip gap should be strictly larger than rib gap.
    const rib = top.best.position_results.find(
      (p) => p.label?.startsWith('under-bust') && p.actual_gap_in !== null,
    );
    const hip = top.best.position_results
      .filter((p) => p.position_from_waist_in > 0 && p.actual_gap_in !== null)
      .sort((a, b) => b.position_from_waist_in - a.position_from_waist_in)[0];
    if (rib && hip && rib.actual_gap_in !== null && hip.actual_gap_in !== null) {
      expect(hip.actual_gap_in).toBeGreaterThan(rib.actual_gap_in);
    }
  });

  it('slant-rib top result has non-waist gaps that grow toward the rib', () => {
    const config = defaultScoringConfig(catalog);
    const results = rank(mediumBody, catalog, { ...config, gap_shape: 'slant-rib' });
    expect(results.length).toBeGreaterThan(0);
    const top = results[0];
    const rib = top.best.position_results.find(
      (p) => p.label?.startsWith('under-bust') && p.actual_gap_in !== null,
    );
    const hip = top.best.position_results
      .filter((p) => p.position_from_waist_in > 0 && p.actual_gap_in !== null)
      .sort((a, b) => b.position_from_waist_in - a.position_from_waist_in)[0];
    if (rib && hip && rib.actual_gap_in !== null && hip.actual_gap_in !== null) {
      expect(rib.actual_gap_in).toBeGreaterThan(hip.actual_gap_in);
    }
  });

  it('hourglass_penalty is not inflated by a negative gap at a position (corset floats loose)', () => {
    // Body with very NARROW rib so many corsets are loose there (corset closed
    // dimension > body dimension → negative actual_gap). The clamp-to-0 fix
    // ensures the hourglass penalty at that position tops out at gap_at_waist,
    // not gap_at_waist + |negative_gap|.
    const config = defaultScoringConfig(catalog);
    const narrowRibBody: Body = {
      natural_waist_in: 28,
      underbust: { circumference_in: 26, position_in: -5 }, // narrower than waist
      upper_hip: { circumference_in: 30, position_in: 4 },
      iliac: { circumference_in: 34, position_in: 7 },
    };
    const results = rank(narrowRibBody, catalog, config);
    // For each ranked result, verify the hourglass penalty is bounded by
    // the number of positions * gap_at_waist * hourglass_gap_slope. If the
    // clamp were missing, a negative gap at rib could push individual
    // excesses above gap_at_waist.
    for (const r of results.slice(0, 20)) {
      const eff = r.best.waist_size_in + config.waist_slack_by_stretch_class_in[r.best.variant.stretch_class];
      const gapAtWaist = Math.max(0, (narrowRibBody.natural_waist_in - config.desired_reduction_in) - eff);
      const positionCount = r.best.position_results.length;
      const upperBound = positionCount * gapAtWaist * config.hourglass_gap_slope;
      // Small floating-point tolerance.
      expect(r.best.hourglass_penalty).toBeLessThanOrEqual(upperBound + 1e-6);
    }
  });
});
