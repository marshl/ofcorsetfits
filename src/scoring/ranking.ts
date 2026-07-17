/**
 * Ranking layer: given a body and the full catalog, find the best
 * (variant, waist size) combination per corset, then sort by score.
 *
 * The variant filter honors `config.stretch_preference`. When set to a
 * specific class, corsets with no matching variant drop out of the
 * ranking entirely — behavior explained in the design doc's "Variant
 * awareness" section.
 */

import type {
  Body,
  Catalog,
  Corset,
  CorsetScoreResult,
  RankedResult,
  ScoringConfig,
} from './types.ts';
import { scoreCorset } from './scoring.ts';

/**
 * For a single corset, try every (variant × waist size) combination and
 * return the lowest-total result. Returns null if no variant survives
 * the stretch_preference filter.
 */
export function bestForCorset(
  body: Body,
  corset: Corset,
  config: ScoringConfig,
): CorsetScoreResult | null {
  const candidateVariants = config.stretch_preference === 'any'
    ? corset.variants
    : corset.variants.filter((v) => v.stretch_class === config.stretch_preference);
  if (candidateVariants.length === 0) return null;

  let best: CorsetScoreResult | null = null;
  for (const variant of candidateVariants) {
    for (const size of corset.waist_sizes_in) {
      const result = scoreCorset(body, corset, variant, size, config);
      if (best === null || result.total < best.total) {
        best = result;
      }
    }
  }
  return best;
}

/** Rank every corset in the catalog by best-fit score (ascending — lower is better). */
export function rank(
  body: Body,
  catalog: Catalog,
  config: ScoringConfig,
): RankedResult[] {
  const results: RankedResult[] = [];
  for (const corset of catalog.corsets) {
    const best = bestForCorset(body, corset, config);
    if (best === null) continue;
    results.push({ corset, best });
  }
  results.sort((a, b) => a.best.total - b.best.total);
  return results;
}

/**
 * Sensible starting scoring config, informed by the design doc.
 *
 * Weights: waist matters most (2×), low hip least (0.7× — most people
 * don't emphasize it). Non-waist landmark slopes: tightness is 3× looseness
 * because a too-tight corset compressing the ribcage is unwearable while
 * a slightly loose one is a shrug.
 *
 * Waist target math: 2" reduction default (comfortable daily wear;
 * tightlacing pushes toward 4-6"). Over-target slope is HARSH (3.0)
 * because a corset that can't reach the target is unusable for its
 * intended reduction. Under-target slope is MILD (0.5) because a corset
 * that closes smaller than target is fine — user gap-laces it up to
 * target. The mild penalty still discourages picking a size 18 corset
 * when you want to wear a 24" waist, though.
 */
export function defaultScoringConfig(catalog: Catalog): ScoringConfig {
  return {
    weights: {
      waist: 2.0,
      underbust: 1.0,
      upper_hip: 1.0,
      low_hip: 0.7,
    },
    tightness_slope: 3.0,
    looseness_slope: 1.0,
    desired_reduction_in: 2.0,
    waist_over_target_slope: 3.0,
    waist_under_target_slope: 0.5,
    waist_slack_by_stretch_class_in: catalog.brand_waist_slack_by_stretch_class_in ?? {
      low: 0.5,
      medium: 1.0,
      high: 1.75,
    },
    stretch_preference: 'any',
    gap_shape: 'curved',
    // High default — hourglass gap is a distinct failure mode that should
    // dominate scoring when it appears. A 1" hourglass excess at each of two
    // positions produces a 6-point penalty, larger than most position penalties.
    hourglass_gap_slope: 3.0,
  };
}
