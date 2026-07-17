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
  /** Multiplier for negative diffs (corset < body → tight). Typically > 1. */
  tightness_slope: number;
  /** Multiplier for positive diffs (corset > body → loose). Typically ≤ 1. */
  looseness_slope: number;
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
