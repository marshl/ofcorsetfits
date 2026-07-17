/**
 * Per-corset scoring: given a body, a corset, a chosen variant, a
 * chosen waist size, and a scoring config, compute a total penalty
 * plus a per-position breakdown.
 *
 * Lower total is better (perfect fit approaches 0). Waist penalty and
 * hourglass-gap penalty are accumulated separately from the per-landmark
 * position penalties so the UI can display them independently.
 *
 * Three gap_shape modes route through different penalty formulas:
 *   - `curved`: asymmetric per-position penalties (current default).
 *     Adds an hourglass-gap penalty if the waist gap exceeds any
 *     non-waist gap (reverse gap shape — bad).
 *   - `straight`: symmetric penalties on how far each position's actual
 *     gap deviates from a uniform target G (= desired_reduction_in).
 *     Rewards corsets whose spring profile matches the wearer's silhouette.
 *   - `closed`: symmetric penalties on how far each position's actual
 *     gap deviates from zero. Rewards corsets that close fully at every
 *     landmark (very restrictive — mostly bespoke).
 */

import type {
  Body,
  Corset,
  CorsetMeasurement,
  CorsetScoreResult,
  CorsetVariant,
  PositionResult,
  PositionWeights,
  ScoringConfig,
} from './types.ts';
import { bodyCircumferenceAt } from './body.ts';

/**
 * Asymmetric linear penalty for a landmark (non-waist) fit difference.
 * diff = corset_circumference - body_circumference.
 *   diff > 0 → corset is loose (weighted by looseness_slope)
 *   diff < 0 → corset is tight (weighted by tightness_slope — usually higher)
 */
export function penaltyForDiff(
  diff: number,
  weight: number,
  tightness_slope: number,
  looseness_slope: number,
): number {
  if (diff >= 0) return weight * diff * looseness_slope;
  return weight * Math.abs(diff) * tightness_slope;
}

/**
 * Waist penalty (curved-mode) — asymmetry INVERTED relative to `penaltyForDiff`.
 * diff = effective_corset_waist - target_waist.
 *   diff > 0 → corset can't reach target (over_target_slope — usually HIGH)
 *   diff < 0 → corset closes smaller than target; user gap-laces
 *              (under_target_slope — usually LOW)
 */
export function waistPenalty(
  diff: number,
  weight: number,
  over_target_slope: number,
  under_target_slope: number,
): number {
  if (diff >= 0) return weight * diff * over_target_slope;
  return weight * Math.abs(diff) * under_target_slope;
}

/** Extract the weight key from a corset measurement's label. */
function weightKeyForLabel(label: string | null): keyof Omit<PositionWeights, 'waist'> {
  const l = (label ?? '').toLowerCase();
  if (l.startsWith('under-bust') || l.startsWith('underbust')) return 'underbust';
  if (l.startsWith('low-hip')) return 'low_hip';
  return 'upper_hip'; // catch-all for "upper-hip …" or unlabeled hip points
}

/** Compute the score for a corset at a specific variant + waist size. */
export function scoreCorset(
  body: Body,
  corset: Corset,
  variant: CorsetVariant,
  waistSize: number,
  config: ScoringConfig,
): CorsetScoreResult {
  const slack = config.waist_slack_by_stretch_class_in[variant.stretch_class] ?? 0;
  const effectiveWaist = waistSize + slack;
  const targetWaist = body.natural_waist_in - config.desired_reduction_in;
  // Target uniform gap size for straight mode. Independent of reduction —
  // corsetry convention: ~2" parallel gap regardless of how much you're
  // reducing to. If reduction is 4", the corset closes 2" below target and
  // is gap-laced 2" up to target.
  const G = config.straight_gap_size_in;

  // ----- Waist penalty (branches on gap_shape) -----
  let waistPenaltyValue: number;
  if (config.gap_shape === 'straight') {
    // Want gap_at_waist = G, i.e. targetWaist - effectiveWaist = G,
    // i.e. effectiveWaist = targetWaist - G. Symmetric penalty on deviation.
    const idealEff = targetWaist - G;
    waistPenaltyValue =
      config.weights.waist * Math.abs(effectiveWaist - idealEff) * config.tightness_slope;
  } else if (config.gap_shape === 'closed') {
    // Want gap_at_waist = 0, i.e. effectiveWaist = targetWaist. Symmetric.
    waistPenaltyValue =
      config.weights.waist * Math.abs(effectiveWaist - targetWaist) * config.tightness_slope;
  } else {
    // curved (default): asymmetric — over-target harsh, under-target mild.
    const waistDiff = effectiveWaist - targetWaist;
    waistPenaltyValue = waistPenalty(
      waistDiff,
      config.weights.waist,
      config.waist_over_target_slope,
      config.waist_under_target_slope,
    );
  }

  // ----- Per-position results (branches on gap_shape) -----
  const positionResults: PositionResult[] = corset.measurements.map(
    (m: CorsetMeasurement): PositionResult => {
      const corsetC = waistSize + m.spring_in;
      const effectiveC = corsetC + slack;
      const userC = bodyCircumferenceAt(body, m.position_from_waist_in);
      if (userC === null) {
        // Can't compare — user hasn't provided enough anchors to place this
        // corset position on their silhouette. Skip the penalty (weight 0)
        // rather than treating as a perfect fit.
        return {
          position_from_waist_in: m.position_from_waist_in,
          label: m.label,
          corset_circumference_in: corsetC,
          user_circumference_in: null,
          diff_in: null,
          actual_gap_in: null,
          penalty: 0,
          weight: 0,
        };
      }
      const diff = corsetC - userC;
      const actualGap = userC - effectiveC;
      const weightKey = weightKeyForLabel(m.label);
      const weight = config.weights[weightKey];

      let penalty: number;
      if (config.gap_shape === 'straight') {
        // Want actualGap = G everywhere. Symmetric deviation penalty.
        penalty = weight * Math.abs(actualGap - G) * config.tightness_slope;
      } else if (config.gap_shape === 'closed') {
        // Want actualGap = 0 everywhere. Symmetric deviation penalty.
        penalty = weight * Math.abs(actualGap) * config.tightness_slope;
      } else {
        // curved: asymmetric on diff — EXCEPT at the underbust of a cupped-rib
        // silhouette, where the design intent is to CUP the rib (accommodate,
        // don't compress or flare away from it). Both directions of misfit
        // are equally bad there, so we symmetrize by using tightness_slope
        // for looseness too.
        const isCuppedRibUnderbust =
          corset.silhouette_category === 'cupped-rib' && weightKey === 'underbust';
        const loosenessSlope = isCuppedRibUnderbust
          ? config.tightness_slope
          : config.looseness_slope;
        penalty = penaltyForDiff(diff, weight, config.tightness_slope, loosenessSlope);
      }

      return {
        position_from_waist_in: m.position_from_waist_in,
        label: m.label,
        corset_circumference_in: corsetC,
        user_circumference_in: userC,
        diff_in: diff,
        actual_gap_in: actualGap,
        penalty,
        weight,
      };
    },
  );

  // ----- Hourglass-gap penalty (curved mode only) -----
  // Fires when any non-waist position's actual gap is SMALLER than the waist's
  // gap. Excess = max(0, gap_at_waist - clamped_gap_at_pos). Sum across
  // positions, scale by hourglass_gap_slope. In straight/closed modes the
  // per-position penalty already enforces gap uniformity, so we skip this.
  //
  // Both gaps are clamped to non-negative before comparison:
  //   - gap_at_waist < 0 (corset can't reach target) → different failure,
  //     caught by the waist penalty. Clamped to 0.
  //   - gap_at_position < 0 (corset floats loose at that position — body
  //     smaller than corset there) → visually a gap of 0 at that position
  //     (lace edges touch), not a "negative gap." The looseness is caught
  //     by the per-position penalty; double-counting via a negative-gap
  //     hourglass excess would over-penalize. Clamped to 0.
  //
  // Net: hourglass penalty is purely about "waist gap > rib/hip gap" SHAPE,
  // not compounded with loose-corset penalties.
  let hourglassPenalty = 0;
  if (config.gap_shape === 'curved') {
    const gapAtWaist = Math.max(0, targetWaist - effectiveWaist);
    for (const pos of positionResults) {
      if (pos.actual_gap_in === null) continue;
      const clampedGap = Math.max(0, pos.actual_gap_in);
      const excess = Math.max(0, gapAtWaist - clampedGap);
      hourglassPenalty += excess * config.hourglass_gap_slope;
    }
  }

  const total =
    waistPenaltyValue +
    positionResults.reduce((sum, r) => sum + r.penalty, 0) +
    hourglassPenalty;

  return {
    waist_size_in: waistSize,
    variant,
    waist_penalty: waistPenaltyValue,
    position_results: positionResults,
    hourglass_penalty: hourglassPenalty,
    total,
  };
}
