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
  VariantBest,
} from './types.ts';
import { scoreCorset } from './scoring.ts';

/**
 * For a single corset, try every (variant × waist size) combination and
 * return the lowest-total result overall PLUS per-variant best results.
 * Returns null if no variant survives the stretch_preference filter.
 */
export function bestForCorset(
  body: Body,
  corset: Corset,
  config: ScoringConfig,
): { best: CorsetScoreResult; variantBests: VariantBest[] } | null {
  const candidateVariants = config.stretch_preference === 'any'
    ? corset.variants
    : corset.variants.filter((v) => v.stretch_class === config.stretch_preference);
  if (candidateVariants.length === 0) return null;

  const variantBests: VariantBest[] = [];
  let overallBest: CorsetScoreResult | null = null;

  for (const variant of candidateVariants) {
    let variantBest: CorsetScoreResult | null = null;
    for (const size of corset.waist_sizes_in) {
      const result = scoreCorset(body, corset, variant, size, config);
      if (variantBest === null || result.total < variantBest.total) {
        variantBest = result;
      }
    }
    if (variantBest === null) continue;
    variantBests.push({
      variant,
      best_size_in: variantBest.waist_size_in,
      total: variantBest.total,
    });
    if (overallBest === null || variantBest.total < overallBest.total) {
      overallBest = variantBest;
    }
  }

  if (overallBest === null) return null;
  variantBests.sort((a, b) => a.total - b.total);
  return { best: overallBest, variantBests };
}

/**
 * Rank every VARIANT in the catalog by best-fit score (ascending).
 *
 * Each entry represents a single SKU (silhouette × material variant), scored
 * at its own best waist size. Same silhouette in multiple materials produces
 * multiple rows because they have different stretch classes → different slack
 * → different effective-waist math → different scores.
 *
 * `variant_bests` on each entry still carries all variants of that silhouette
 * for cross-reference in the UI (users can see the current variant's siblings
 * without scrolling). The first entry in `variant_bests` matches this row's
 * variant only when the row's variant is the best for its silhouette.
 */
export function rank(
  body: Body,
  catalog: Catalog,
  config: ScoringConfig,
): RankedResult[] {
  const results: RankedResult[] = [];
  for (const corset of catalog.corsets) {
    const candidateVariants = config.stretch_preference === 'any'
      ? corset.variants
      : corset.variants.filter((v) => v.stretch_class === config.stretch_preference);
    if (candidateVariants.length === 0) continue;

    // Best CorsetScoreResult per variant of this silhouette.
    const perVariantScores: CorsetScoreResult[] = [];
    for (const variant of candidateVariants) {
      let best: CorsetScoreResult | null = null;
      for (const size of corset.waist_sizes_in) {
        const result = scoreCorset(body, corset, variant, size, config);
        if (best === null || result.total < best.total) {
          best = result;
        }
      }
      if (best !== null) perVariantScores.push(best);
    }
    if (perVariantScores.length === 0) continue;

    // Precompute the shared variant_bests list (used by all rows of this silhouette).
    const variantBests = perVariantScores
      .map((s) => ({
        variant: s.variant,
        best_size_in: s.waist_size_in,
        total: s.total,
      }))
      .sort((a, b) => a.total - b.total);

    // Emit one row per variant.
    for (const scoreResult of perVariantScores) {
      results.push({
        corset,
        best: scoreResult,
        variant_bests: variantBests,
      });
    }
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
