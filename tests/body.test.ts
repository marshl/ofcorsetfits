import { describe, it, expect } from 'vitest';
import { bodyCircumferenceAt } from '../src/scoring/body.ts';
import type { Body } from '../src/scoring/types.ts';

// A synthetic "medium torso" body — 6" from waist to underbust,
// 4" waist to upper_hip, 7" waist to iliac. Numbers chosen to make
// interpolation math trivial to eyeball.
const body: Body = {
  natural_waist_in: 28,
  underbust: { circumference_in: 34, position_in: -6 },
  upper_hip: { circumference_in: 36, position_in: 4 },
  iliac: { circumference_in: 40, position_in: 7 },
};

describe('bodyCircumferenceAt', () => {
  it('returns exact anchor values at anchor positions', () => {
    expect(bodyCircumferenceAt(body, 0)).toBe(28);
    expect(bodyCircumferenceAt(body, -6)).toBe(34);
    expect(bodyCircumferenceAt(body, 4)).toBe(36);
    expect(bodyCircumferenceAt(body, 7)).toBe(40);
  });

  it('interpolates linearly between adjacent anchors', () => {
    // Midway between underbust(-6, 34) and waist(0, 28) is (-3, 31).
    expect(bodyCircumferenceAt(body, -3)).toBe(31);
    // Midway between upper_hip(4, 36) and iliac(7, 40) is (5.5, 38).
    expect(bodyCircumferenceAt(body, 5.5)).toBe(38);
    // Midway between waist(0, 28) and upper_hip(4, 36) is (2, 32).
    expect(bodyCircumferenceAt(body, 2)).toBe(32);
  });

  it('extrapolates linearly beyond the outermost anchors', () => {
    // Above underbust: slope from underbust(-6, 34) to waist(0, 28) is
    // -1 in/in. At -8: 34 + (-8 - -6) * -1 = 34 + 2 = 36.
    expect(bodyCircumferenceAt(body, -8)).toBe(36);
    // Below iliac: slope from upper_hip(4, 36) to iliac(7, 40) is 4/3.
    // At 10: 36 + (10 - 4) * 4/3 = 36 + 8 = 44.
    expect(bodyCircumferenceAt(body, 10)).toBe(44);
  });

  it('returns null when only the natural waist is provided', () => {
    expect(bodyCircumferenceAt({ natural_waist_in: 28 }, 5)).toBe(null);
  });

  it('handles a body with just one landmark plus waist', () => {
    const partial: Body = {
      natural_waist_in: 28,
      iliac: { circumference_in: 40, position_in: 7 },
    };
    // Two anchors: waist(0, 28) and iliac(7, 40). Slope = 12/7 per in.
    expect(bodyCircumferenceAt(partial, 0)).toBe(28);
    expect(bodyCircumferenceAt(partial, 7)).toBe(40);
    // At 3.5: 28 + 3.5 * (12/7) = 28 + 6 = 34.
    expect(bodyCircumferenceAt(partial, 3.5)).toBe(34);
  });
});
