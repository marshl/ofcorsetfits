/**
 * Body silhouette anchoring and interpolation.
 *
 * The user provides sparse anatomical landmarks (natural waist,
 * optional underbust / upper-hip / iliac, each with a circumference and
 * a signed position relative to the natural waist). We treat those as
 * anchor points on a piecewise-linear silhouette curve, then interpolate
 * to sample circumference at any vertical position along the torso.
 *
 * Beyond the outermost anchor, we extrapolate linearly using the two
 * nearest anchor points. That's an approximation, but it lets the scorer
 * handle corsets whose measurement points sit outside the user's
 * measured range without dropping them entirely.
 */

import type { Body } from './types.ts';

interface Anchor {
  position_in: number;
  circumference_in: number;
}

/** Collect anchor points from the body model, sorted by position (ascending). */
function collectAnchors(body: Body): Anchor[] {
  const anchors: Anchor[] = [
    { position_in: 0, circumference_in: body.natural_waist_in },
  ];
  if (body.underbust) {
    anchors.push({
      position_in: body.underbust.position_in,
      circumference_in: body.underbust.circumference_in,
    });
  }
  if (body.upper_hip) {
    anchors.push({
      position_in: body.upper_hip.position_in,
      circumference_in: body.upper_hip.circumference_in,
    });
  }
  if (body.iliac) {
    anchors.push({
      position_in: body.iliac.position_in,
      circumference_in: body.iliac.circumference_in,
    });
  }
  return anchors.sort((a, b) => a.position_in - b.position_in);
}

/**
 * Interpolate the body's circumference at a given position from waist.
 * Returns null when we have fewer than 2 anchors (can't build a segment).
 */
export function bodyCircumferenceAt(
  body: Body,
  position_from_waist_in: number,
): number | null {
  const anchors = collectAnchors(body);
  if (anchors.length < 2) return null;

  // Exact hit on any anchor.
  for (const a of anchors) {
    if (a.position_in === position_from_waist_in) return a.circumference_in;
  }

  // Find the two surrounding anchors, or the two nearest for extrapolation.
  let lower: Anchor;
  let upper: Anchor;
  if (position_from_waist_in < anchors[0].position_in) {
    // Extrapolate below (i.e. further above waist) using the first two anchors.
    lower = anchors[0];
    upper = anchors[1];
  } else if (position_from_waist_in > anchors[anchors.length - 1].position_in) {
    // Extrapolate above (i.e. further below waist) using the last two anchors.
    lower = anchors[anchors.length - 2];
    upper = anchors[anchors.length - 1];
  } else {
    // Interpolate between two adjacent anchors that bracket the position.
    lower = anchors[0];
    upper = anchors[anchors.length - 1];
    for (let i = 0; i < anchors.length - 1; i++) {
      if (
        anchors[i].position_in <= position_from_waist_in &&
        anchors[i + 1].position_in >= position_from_waist_in
      ) {
        lower = anchors[i];
        upper = anchors[i + 1];
        break;
      }
    }
  }

  const span = upper.position_in - lower.position_in;
  if (span === 0) return lower.circumference_in;
  const t = (position_from_waist_in - lower.position_in) / span;
  return lower.circumference_in + t * (upper.circumference_in - lower.circumference_in);
}
