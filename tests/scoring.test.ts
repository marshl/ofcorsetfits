import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rank, defaultScoringConfig, penaltyForDiff } from '../src/scoring/index.ts';
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

describe('penaltyForDiff', () => {
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

  it("top-ranked corset's effective waist matches the body's waist within tolerance", () => {
    const config = defaultScoringConfig(catalog);
    const results = rank(mediumBody, catalog, config);
    const top = results[0];
    const slack = config.waist_slack_by_stretch_class_in[top.best.variant.stretch_class];
    const effectiveWaist = top.best.waist_size_in + slack;
    // A well-fitting corset should be within ~2" of body waist.
    expect(Math.abs(effectiveWaist - mediumBody.natural_waist_in)).toBeLessThan(2);
  });

  it('rankings differ between body profiles', () => {
    const config = defaultScoringConfig(catalog);
    const medium = rank(mediumBody, catalog, config);
    const highSpring = rank(highSpringBody, catalog, config);
    // Same catalog, different bodies → the top result should not always match.
    expect(medium[0].corset.id).not.toBe(highSpring[0].corset.id);
  });
});
