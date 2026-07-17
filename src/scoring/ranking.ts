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
  CorsetVariant,
  RankedResult,
  ScoringConfig,
  VariantGroup,
} from './types.ts';
import { scoreCorset } from './scoring.ts';

/**
 * Fit signature: two variants sharing this key have identical fit math and
 * therefore identical scores. Used to group variants into ranking rows so
 * multiple SKUs with the same material composition don't clutter the list
 * as pseudo-duplicates.
 */
function fitSignature(v: CorsetVariant): string {
  const materials = [...v.materials].sort().join(',');
  return `${v.stretch_class}::${materials}`;
}

/**
 * For a single corset, group its variants by fit signature and compute one
 * `VariantGroup` per group (best waist size + total across all group members —
 * they're identical, so one score representing the group). Returns null if
 * no variant passes the stretch_preference filter.
 */
export function bestForCorset(
  body: Body,
  corset: Corset,
  config: ScoringConfig,
): { best: CorsetScoreResult; groups: VariantGroup[] } | null {
  const candidateVariants = config.stretch_preference === 'any'
    ? corset.variants
    : corset.variants.filter((v) => v.stretch_class === config.stretch_preference);
  if (candidateVariants.length === 0) return null;

  // Bucket variants by fit signature.
  const buckets = new Map<string, CorsetVariant[]>();
  for (const v of candidateVariants) {
    const key = fitSignature(v);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(v);
    else buckets.set(key, [v]);
  }

  // Score each bucket once (using the first variant — all members are identical
  // for scoring purposes).
  const groups: VariantGroup[] = [];
  let overallBest: CorsetScoreResult | null = null;

  for (const bucket of buckets.values()) {
    // Sort members deterministically by name so UI display is stable.
    bucket.sort((a, b) => a.name.localeCompare(b.name));
    const rep = bucket[0];
    let bestForBucket: CorsetScoreResult | null = null;
    for (const size of corset.waist_sizes_in) {
      const result = scoreCorset(body, corset, rep, size, config);
      if (bestForBucket === null || result.total < bestForBucket.total) {
        bestForBucket = result;
      }
    }
    if (bestForBucket === null) continue;
    groups.push({
      variants: bucket,
      best_size_in: bestForBucket.waist_size_in,
      total: bestForBucket.total,
    });
    if (overallBest === null || bestForBucket.total < overallBest.total) {
      overallBest = bestForBucket;
    }
  }

  if (overallBest === null) return null;
  groups.sort((a, b) => a.total - b.total);
  return { best: overallBest, groups };
}

/**
 * Rank every VARIANT GROUP in the catalog by best-fit score (ascending).
 *
 * A variant group is one or more SKUs of a single silhouette that share the
 * same fit signature (stretch_class + materials). Different fabric colors or
 * decorative elements — the algorithm-invisible axes — collapse into one row
 * rather than producing pseudo-duplicates.
 *
 * `all_groups` on each row carries every variant group of the row's
 * silhouette so the UI can cross-reference siblings (e.g., MCC110's
 * `low + [brocade, velveteen]` group visible from the `medium + [mesh, satin]`
 * row without scrolling).
 */
export function rank(
  body: Body,
  catalog: Catalog,
  config: ScoringConfig,
): RankedResult[] {
  const results: RankedResult[] = [];
  for (const corset of catalog.corsets) {
    const summary = bestForCorset(body, corset, config);
    if (summary === null) continue;
    const { groups } = summary;

    // Emit one row per variant group. To find the CorsetScoreResult for each
    // group's canonical variant (variants[0]), we re-score the size that
    // groups[i].best_size_in indicates. Cheaper than storing the full result
    // per group inside bestForCorset.
    for (const group of groups) {
      const rep = group.variants[0];
      const scoreResult = scoreCorset(body, corset, rep, group.best_size_in, config);
      results.push({
        corset,
        best: scoreResult,
        variant_group: group,
        all_groups: groups,
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
