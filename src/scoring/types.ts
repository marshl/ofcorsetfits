/**
 * Type definitions for the corset fit scoring engine.
 *
 * `Catalog` types mirror the JSON schema in `catalog/mystic-city.json`.
 * `Body` types describe the user's measurements. `ScoringConfig` bundles
 * the tunable parameters that drive the ranking (weights, penalty slopes,
 * stretch-slack table, variant filter).
 */

export type StretchClass = 'low' | 'medium' | 'high';

export type SilhouetteCategory =
  | 'hourglass'
  | 'pipestem'
  | 'cupped-rib'
  | 'conical'
  | 'waspie'
  | 'longline'
  | 'overbust';

export interface CorsetMeasurement {
  position_from_waist_in: number; // negative = above waist, positive = below
  spring_in: number;
  label: string | null;
}

export interface CorsetVariant {
  name: string;
  url: string;
  materials: string[];
  stretch_class: StretchClass;
}

export interface Corset {
  id: string;
  name: string;
  url: string;
  silhouette_category: SilhouetteCategory;
  silhouette_words: string[];
  grading: string;
  body_length_in: number | null;
  above_waist_length_in: number | null;
  below_waist_length_in: number | null;
  measurements: CorsetMeasurement[];
  waist_sizes_in: number[];
  materials_summary: string[];
  stretch_class_options: string[];
  variants: CorsetVariant[];
  notes: string | null;
  // Provenance and other extension fields are ignored by the scoring engine.
  [key: string]: unknown;
}

export interface Catalog {
  brand: string;
  brand_url: string;
  brand_waist_slack_by_stretch_class_in: Record<StretchClass, number>;
  generated_at_iso: string;
  sources: Record<string, string>;
  corsets: Corset[];
}

/** A single anatomical landmark on the user's body. */
export interface BodyLandmark {
  circumference_in: number;
  /** Signed position relative to natural waist. Negative = above; positive = below. */
  position_in: number;
}

export interface Body {
  natural_waist_in: number;
  underbust?: BodyLandmark;
  upper_hip?: BodyLandmark;
  iliac?: BodyLandmark;
}

/** Weight labels correspond to the measurement label prefixes in the catalog. */
export interface PositionWeights {
  waist: number;
  underbust: number;
  upper_hip: number;
  low_hip: number;
}

export interface ScoringConfig {
  weights: PositionWeights;
  /**
   * Slopes applied to non-waist landmark diffs (underbust, upper hip, low hip).
   * Positive diff = corset > body (loose). Negative diff = corset < body (tight).
   * Tightness is typically harsher because a corset can't compress the ribs
   * or hip bones, whereas a loose corset is at worst a shrug.
   */
  tightness_slope: number;
  looseness_slope: number;
  /**
   * Target waist reduction in inches. The algorithm ranks corsets by how well
   * they achieve `natural_waist_in - desired_reduction_in` when worn, NOT how
   * well they fit at natural waist. Corsets are almost always worn cinched;
   * a 0-reduction fit is a rare use case.
   */
  desired_reduction_in: number;
  /**
   * Waist-specific asymmetry — INVERTED relative to the other landmarks.
   * `waist_over_target_slope` (typically HIGHER) applies when the corset's
   * effective waist is LARGER than the target — meaning the corset physically
   * can't reach the target reduction (fully closed is already looser than
   * target). This is bad; corset is unusable for that target.
   * `waist_under_target_slope` (typically LOWER) applies when the corset's
   * effective waist is SMALLER than the target — the wearer gap-laces it
   * open to reach target. Perfectly workable; only mild penalty for
   * corsets that close way below target (why buy a size 18 to wear at 24?).
   */
  waist_over_target_slope: number;
  waist_under_target_slope: number;
  /** Effective-waist correction per material class (inches added to nominal waist size). */
  waist_slack_by_stretch_class_in: Record<StretchClass, number>;
  /** Only consider variants whose stretch_class matches; `any` disables the filter. */
  stretch_preference: StretchClass | 'any';
}

export interface PositionResult {
  position_from_waist_in: number;
  label: string | null;
  corset_circumference_in: number;
  user_circumference_in: number | null;
  diff_in: number | null;
  penalty: number;
  weight: number;
}

export interface CorsetScoreResult {
  waist_size_in: number;
  variant: CorsetVariant;
  waist_penalty: number;
  position_results: PositionResult[];
  total: number;
}

export interface RankedResult {
  corset: Corset;
  best: CorsetScoreResult;
}
