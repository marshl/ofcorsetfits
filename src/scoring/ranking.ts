/**
 * Ranking layer: given a body and the full catalog, emit one ranked row per
 * (silhouette × fit signature × available waist size) combination and sort
 * globally by score.
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
  GapShape,
  RankedResult,
  ScoringConfig,
  VariantGroup,
} from './types.ts';
import { scoreCorset } from './scoring.ts';

/**
 * Resolve the list of gap shapes `rank()` should score each candidate row
 * against. When the user has set `acceptable_gap_shapes` (checkbox mode),
 * use that list; otherwise fall back to `[config.gap_shape]` (single-mode
 * behavior — what tests and legacy callers expect).
 */
function shapesToTry(config: ScoringConfig): GapShape[] {
  if (config.acceptable_gap_shapes && config.acceptable_gap_shapes.length > 0) {
    return config.acceptable_gap_shapes;
  }
  return [config.gap_shape];
}

/**
 * Score a single (corset, variant, size) combination under every acceptable
 * gap shape and return the minimum-penalty result — semantically "any of
 * these gaps is fine, pick whichever this corset does best." The returned
 * result carries `gap_shape` set to the winning shape.
 */
function bestScoreAcrossShapes(
  body: Body,
  corset: Corset,
  variant: CorsetVariant,
  waistSize: number,
  config: ScoringConfig,
): CorsetScoreResult {
  const shapes = shapesToTry(config);
  let best: CorsetScoreResult | null = null;
  for (const shape of shapes) {
    const result = scoreCorset(body, corset, variant, waistSize, {
      ...config,
      gap_shape: shape,
    });
    if (best === null || result.total < best.total) best = result;
  }
  return best!;
}

/**
 * Fit signature: two variants sharing this key have identical fit math and
 * therefore identical scores. In the current model, the ONLY input to
 * scoring that varies per variant is `stretch_class` (which drives slack).
 * Materials are informative to the user but don't change the score — a
 * "satin" and a "brocade" variant with the same stretch_class produce
 * identical rankings, so they collapse into one row. Individual material
 * differences remain visible in the "Buy this fit" list inside the row.
 */
function fitSignature(v: CorsetVariant): string {
  return v.stretch_class;
}

/**
 * For a single corset, bucket its variants by fit signature and compute a
 * `VariantGroup` per bucket that summarizes the group's best-fitting size.
 * Returns [] if no variant passes the stretch_preference filter or every
 * matching group is currently unbuyable.
 *
 * The returned groups carry the group's `best_size_in`/`total` for use in
 * cross-references — NOT as the per-row row ranking. Row-level scoring
 * (one row per size) happens in `rank()`.
 */
function groupsForCorset(
  body: Body,
  corset: Corset,
  config: ScoringConfig,
): VariantGroup[] {
  const candidateVariants = config.stretch_preference === 'any'
    ? corset.variants
    : corset.variants.filter((v) => v.stretch_class === config.stretch_preference);
  if (candidateVariants.length === 0) return [];

  const buckets = new Map<string, CorsetVariant[]>();
  for (const v of candidateVariants) {
    const key = fitSignature(v);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(v);
    else buckets.set(key, [v]);
  }

  const groups: VariantGroup[] = [];
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
    const rep = bucket[0];
    const sizeUnion = new Set<number>();
    for (const v of bucket) {
      for (const s of v.waist_sizes_in) sizeUnion.add(s);
    }
    if (sizeUnion.size === 0) continue;

    let bestSize: number | null = null;
    let bestTotal = Infinity;
    for (const size of sizeUnion) {
      const result = bestScoreAcrossShapes(body, corset, rep, size, config);
      if (result.total < bestTotal) {
        bestTotal = result.total;
        bestSize = size;
      }
    }
    if (bestSize === null) continue;
    groups.push({
      variants: bucket,
      best_size_in: bestSize,
      total: bestTotal,
    });
  }
  groups.sort((a, b) => a.total - b.total);
  return groups;
}

/**
 * Rank every (variant group × available waist size) combination in the
 * catalog by score (ascending).
 *
 * A variant group is one or more SKUs of a single silhouette that share the
 * same fit signature (stretch class). Different fabric colors / decorative
 * elements — the algorithm-invisible axes — collapse into a single group;
 * each *size* offered by the group is then a separate ranked row. So a
 * silhouette offered in medium stretch at sizes 20–28 emits ~5 rows;
 * add a low-stretch variant with sizes 22–26 and you get 3 more.
 *
 * `all_groups` on each row carries every variant group of the row's
 * silhouette (with each group's best-fitting size) so the UI can point at
 * sibling stretch classes without hunting through the main list.
 */
export function rank(
  body: Body,
  catalog: Catalog,
  config: ScoringConfig,
): RankedResult[] {
  const results: RankedResult[] = [];
  for (const corset of catalog.corsets) {
    const groups = groupsForCorset(body, corset, config);
    if (groups.length === 0) continue;

    for (const group of groups) {
      const rep = group.variants[0];
      // Union of sizes across all group members — same union used to pick
      // the group's best_size_in above.
      const sizeUnion = new Set<number>();
      for (const v of group.variants) {
        for (const s of v.waist_sizes_in) sizeUnion.add(s);
      }
      for (const size of sizeUnion) {
        const scoreResult = bestScoreAcrossShapes(body, corset, rep, size, config);
        results.push({
          corset,
          best: scoreResult,
          variant_group: group,
          all_groups: groups,
        });
      }
    }
  }
  results.sort((a, b) => a.best.total - b.best.total);
  return results;
}

/**
 * Sensible starting scoring config, informed by the design doc.
 *
 * Weights: waist matters most (2×), low hip least (0.7× — most people
 * don't emphasize it).
 *
 * Non-waist landmark slopes: looseness (3.0) > tightness (2.0). A corset
 * that FLOATS LOOSE at a rib/hip landmark (corset > body → negative gap
 * in the display convention) fails at contouring — the silhouette gapes
 * and no amount of gap-lacing fixes it. A corset that runs a bit TIGHT
 * (corset < body → positive gap) closes smaller than the landmark and
 * simply leaves a wider lacing gap there, which is largely cosmetic. So
 * looseness is now the harsher penalty.
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
    tightness_slope: 2.0,
    looseness_slope: 3.0,
    desired_reduction_in: 2.0,
    straight_gap_size_in: 2.0,
    slant_slope_in_per_in: 0.5,
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
