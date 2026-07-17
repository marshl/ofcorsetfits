/**
 * Per-corset scoring: given a body, a corset, a chosen variant, a
 * chosen waist size, and a scoring config, compute a total penalty
 * plus a per-position breakdown.
 *
 * Lower total is better (perfect fit approaches 0). Waist penalty is
 * accumulated separately from the per-landmark position penalties so
 * the UI can display them independently.
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
 * Waist penalty — asymmetry INVERTED relative to `penaltyForDiff`.
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
  const waistDiff = effectiveWaist - targetWaist;
  const waistPenaltyValue = waistPenalty(
    waistDiff,
    config.weights.waist,
    config.waist_over_target_slope,
    config.waist_under_target_slope,
  );

  const positionResults: PositionResult[] = corset.measurements.map(
    (m: CorsetMeasurement): PositionResult => {
      const corsetC = waistSize + m.spring_in;
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
          penalty: 0,
          weight: 0,
        };
      }
      const diff = corsetC - userC;
      const weightKey = weightKeyForLabel(m.label);
      const weight = config.weights[weightKey];
      const penalty = penaltyForDiff(diff, weight, config.tightness_slope, config.looseness_slope);
      return {
        position_from_waist_in: m.position_from_waist_in,
        label: m.label,
        corset_circumference_in: corsetC,
        user_circumference_in: userC,
        diff_in: diff,
        penalty,
        weight,
      };
    },
  );

  const total = waistPenaltyValue + positionResults.reduce((sum, r) => sum + r.penalty, 0);
  return {
    waist_size_in: waistSize,
    variant,
    waist_penalty: waistPenaltyValue,
    position_results: positionResults,
    total,
  };
}
