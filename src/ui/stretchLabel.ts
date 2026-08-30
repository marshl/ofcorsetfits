/**
 * Human-facing labels for the stretch-class taxonomy. The underlying
 * values (`low` / `medium` / `high`) are kept in the catalog data and
 * scoring engine — this map is the display-only translation.
 *
 * "Low / medium / high" reads as quality on a red-to-green scale.
 * "Firm / semi-stretch / stretchy" describes what the fabric does.
 */

import type { StretchClass } from '../scoring/types.ts';

export const STRETCH_LABELS: Record<StretchClass, string> = {
  low: 'Firm',
  medium: 'Semi-stretch',
  high: 'Stretchy',
};

export function stretchLabel(cls: StretchClass): string {
  return STRETCH_LABELS[cls];
}
