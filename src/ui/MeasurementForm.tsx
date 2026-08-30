/**
 * Measurement form. Collects the user's anatomical landmarks and a
 * stretch preference. Every field is a number input; positions are
 * signed relative to the natural waist (positive = below).
 *
 * Natural waist is the only required field. All other landmarks are
 * optional — the scoring engine handles missing anchors by returning
 * `null` for that position's user circumference (excluded from the
 * penalty rather than treated as a perfect match).
 */

import type { Body, GapShape, StretchClass } from '../scoring/types.ts';

interface MeasurementFormProps {
  body: Body;
  onBodyChange: (body: Body) => void;
  stretchPreference: StretchClass | 'any';
  onStretchPreferenceChange: (pref: StretchClass | 'any') => void;
  desiredReduction: number;
  onDesiredReductionChange: (reduction: number) => void;
  acceptableGapShapes: GapShape[];
  onAcceptableGapShapesChange: (shapes: GapShape[]) => void;
  centreLengthRange: [number, number];
  onCentreLengthRangeChange: (range: [number, number]) => void;
  centreLengthMin: number;
  centreLengthMax: number;
  onlyAvailableSizes: boolean;
  onOnlyAvailableSizesChange: (value: boolean) => void;
}

const GAP_SHAPE_OPTIONS: {
  value: GapShape;
  glyph: string;
  label: string;
  helper: string;
}[] = [
  {
    value: 'curved',
    glyph: ')(',
    label: 'Curved',
    helper:
      'Smoothly curving gap that pinches at the waist and opens toward the rib & hip. The natural corsetry default.',
  },
  {
    value: 'straight',
    glyph: '||',
    label: 'Parallel',
    helper:
      'Uniform ~2" gap top to bottom. Needs a corset whose spring profile matches your silhouette.',
  },
  {
    value: 'slant-hip',
    glyph: '/\\',
    label: 'Slanted — wider at hip',
    helper:
      'Straight-line gap that grows toward the hip. Closer (or closed) at the rib, wider at the hip.',
  },
  {
    value: 'slant-rib',
    glyph: '\\/',
    label: 'Slanted — wider at rib',
    helper:
      'Straight-line gap that grows toward the rib. Wider at the rib, closer (or closed) at the hip.',
  },
  {
    value: 'closed',
    glyph: '|',
    label: 'Fully closed',
    helper:
      'No gap at any position. Most restrictive — typically only bespoke corsets qualify.',
  },
];

type LandmarkKey = 'underbust' | 'upper_hip' | 'iliac';
type Direction = 'above' | 'below';

const LANDMARK_LABELS: Record<LandmarkKey, { display: string; helper: string; direction: Direction }> = {
  underbust: {
    display: 'Underbust',
    direction: 'above',
    helper: 'Just under the ribcage.',
  },
  upper_hip: {
    display: 'Upper hip',
    direction: 'below',
    helper: 'Where the hip curve starts (~2" below waist).',
  },
  iliac: {
    display: 'Iliac',
    direction: 'below',
    helper: 'Top of the hip bones (widest of the lower torso).',
  },
};

/**
 * Underbust positions are stored INTERNALLY as negative (position -5 = 5"
 * above waist), matching the corset schema's signed convention. But the UI
 * shows positive numbers per user request — the "above/below waist" text on
 * the label carries the direction instead of the sign. These helpers
 * translate between the internal signed value and the displayed unsigned one.
 */
function toDisplayPosition(direction: Direction, signedPosition: number): number {
  return direction === 'above' ? -signedPosition : signedPosition;
}

function toSignedPosition(direction: Direction, displayPosition: number): number {
  return direction === 'above' ? -displayPosition : displayPosition;
}

function toNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function MeasurementForm({
  body,
  onBodyChange,
  stretchPreference,
  onStretchPreferenceChange,
  desiredReduction,
  onDesiredReductionChange,
  acceptableGapShapes,
  onAcceptableGapShapesChange,
  centreLengthRange,
  onCentreLengthRangeChange,
  centreLengthMin,
  centreLengthMax,
  onlyAvailableSizes,
  onOnlyAvailableSizesChange,
}: MeasurementFormProps) {
  const [minLen, maxLen] = centreLengthRange;
  const setMinLen = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onCentreLengthRangeChange([Math.min(n, maxLen), maxLen]);
  };
  const setMaxLen = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    onCentreLengthRangeChange([minLen, Math.max(n, minLen)]);
  };
  const lengthFilterActive =
    minLen > centreLengthMin || maxLen < centreLengthMax;
  const resetLengthFilter = () =>
    onCentreLengthRangeChange([centreLengthMin, centreLengthMax]);
  const acceptableSet = new Set(acceptableGapShapes);
  const toggleGapShape = (shape: GapShape, checked: boolean) => {
    if (checked) {
      if (acceptableSet.has(shape)) return;
      // Preserve the canonical order (curved, straight, closed) regardless
      // of the order the user checks the boxes in.
      const next = GAP_SHAPE_OPTIONS
        .map((o) => o.value)
        .filter((s) => acceptableSet.has(s) || s === shape);
      onAcceptableGapShapesChange(next);
    } else {
      // Never let the user leave zero shapes checked — an empty set would
      // wipe out the ranking. The last checked box acts as a floor.
      if (acceptableGapShapes.length <= 1) return;
      onAcceptableGapShapesChange(acceptableGapShapes.filter((s) => s !== shape));
    }
  };
  const onlyOneChecked = acceptableGapShapes.length === 1;
  const setWaist = (raw: string) => {
    const n = toNumber(raw);
    if (n !== null) onBodyChange({ ...body, natural_waist_in: n });
  };

  const setReduction = (raw: string) => {
    const n = toNumber(raw);
    if (n !== null && n >= 0) onDesiredReductionChange(n);
  };
  const targetWaist = body.natural_waist_in - desiredReduction;

  const setLandmarkField = (
    key: LandmarkKey,
    field: 'circumference_in' | 'position_in',
    raw: string,
  ) => {
    const n = toNumber(raw);
    const current = body[key];
    if (n === null) {
      // Empty — if the OTHER field also empty, clear the whole landmark.
      const other = field === 'circumference_in' ? current?.position_in : current?.circumference_in;
      if (other === undefined) {
        const next = { ...body };
        delete next[key];
        onBodyChange(next);
      } else {
        // Partial data — keep what's set, drop this one field.
        const partial = { ...(current ?? {}) } as { circumference_in?: number; position_in?: number };
        delete partial[field];
        // We can't leave a landmark half-set in the strict Body type, so remove it.
        const next = { ...body };
        delete next[key];
        onBodyChange(next);
      }
      return;
    }
    // Fill the value; if the other field is missing, use a reasonable default
    // rather than dropping the input.
    const other = field === 'circumference_in' ? current?.position_in : current?.circumference_in;
    const defaultPosition: Record<LandmarkKey, number> = {
      underbust: -5,
      upper_hip: 4,
      iliac: 7,
    };
    const nextLandmark = field === 'circumference_in'
      ? { circumference_in: n, position_in: other ?? defaultPosition[key] }
      : { circumference_in: other ?? 32, position_in: n };
    onBodyChange({ ...body, [key]: nextLandmark });
  };

  return (
    <form className="measurement-form" onSubmit={(e) => e.preventDefault()}>
      <h2>Your measurements</h2>

      <label className="field field-required">
        <span>Natural waist (inches) *</span>
        <input
          type="number"
          step="0.5"
          min="10"
          max="80"
          value={body.natural_waist_in}
          onChange={(e) => setWaist(e.target.value)}
          required
        />
        <span className="helper">The narrowest circumference of your torso.</span>
      </label>

      <label className="field">
        <span>Desired reduction (inches)</span>
        <input
          type="number"
          step="0.5"
          min="0"
          max="12"
          value={desiredReduction}
          onChange={(e) => setReduction(e.target.value)}
        />
        <span className="helper">
          How much smaller you want your waist to look when the corset is worn.
          Comfortable daily wear ≈ 2". Tightlacing ≈ 4-6".
          Target waist = <strong>{targetWaist.toFixed(1)}"</strong>.
        </span>
      </label>

      {(['underbust', 'upper_hip', 'iliac'] as const).map((key) => {
        const current = body[key];
        const info = LANDMARK_LABELS[key];
        const displayPosition =
          current?.position_in !== undefined
            ? toDisplayPosition(info.direction, current.position_in)
            : '';
        const positionLabel = `Position (${info.direction} waist)`;
        return (
          <fieldset key={key} className="landmark">
            <legend>{info.display}</legend>
            <label className="field">
              <span>Circumference (in)</span>
              <input
                type="number"
                step="0.5"
                min="10"
                max="80"
                value={current?.circumference_in ?? ''}
                onChange={(e) => setLandmarkField(key, 'circumference_in', e.target.value)}
              />
            </label>
            <label className="field">
              <span>{positionLabel}</span>
              <input
                type="number"
                step="0.5"
                min="0"
                max="15"
                value={displayPosition}
                onChange={(e) => {
                  const n = toNumber(e.target.value);
                  if (n === null) {
                    setLandmarkField(key, 'position_in', '');
                  } else {
                    setLandmarkField(
                      key,
                      'position_in',
                      String(toSignedPosition(info.direction, n)),
                    );
                  }
                }}
              />
            </label>
            <span className="helper">{info.helper}</span>
          </fieldset>
        );
      })}

      <label className="field">
        <span>Stretch preference</span>
        <select
          value={stretchPreference}
          onChange={(e) => onStretchPreferenceChange(e.target.value as StretchClass | 'any')}
        >
          <option value="any">Any (all variants)</option>
          <option value="low">Firm — cotton, satin, brocade, PVC</option>
          <option value="medium">Semi-stretch — hybrid mesh + fabric</option>
          <option value="high">Stretchy — mesh-dominant</option>
        </select>
        <span className="helper">Filter corsets by the material's stretch behavior.</span>
      </label>

      <label className="field field-checkbox availability-checkbox">
        <input
          type="checkbox"
          checked={onlyAvailableSizes}
          onChange={(e) => onOnlyAvailableSizesChange(e.target.checked)}
        />
        <span>
          <strong>Only show available sizes</strong>
          {' — '}
          hides rows and color variants where the row's size isn't
          currently offered.
        </span>
      </label>

      <fieldset className="landmark centre-length-fieldset">
        <legend>
          Centre length
          {lengthFilterActive && (
            <button
              type="button"
              className="reset-length-btn"
              onClick={resetLengthFilter}
            >
              reset
            </button>
          )}
        </legend>
        <span className="helper">
          Front length of the corset (top of busk to bottom). Filter to
          lengths that suit your torso — corsets with unknown length are
          always shown.
        </span>
        <div className="dual-range-summary">
          <strong>{minLen}"</strong> – <strong>{maxLen}"</strong>
        </div>
        <div
          className="dual-range"
          style={{
            // CSS custom properties drive the .dual-range-fill position
            // (the coloured segment between the two thumbs) so it moves
            // in lockstep with the thumbs without extra JS.
            ['--low-pct' as string]:
              `${((minLen - centreLengthMin) / (centreLengthMax - centreLengthMin)) * 100}%`,
            ['--high-pct' as string]:
              `${((maxLen - centreLengthMin) / (centreLengthMax - centreLengthMin)) * 100}%`,
          }}
        >
          <div className="dual-range-track" aria-hidden="true" />
          <div className="dual-range-fill" aria-hidden="true" />
          <input
            type="range"
            className="dual-range-input dual-range-input-min"
            aria-label="Minimum centre length in inches"
            min={centreLengthMin}
            max={centreLengthMax}
            step="0.5"
            value={minLen}
            onChange={(e) => setMinLen(e.target.value)}
          />
          <input
            type="range"
            className="dual-range-input dual-range-input-max"
            aria-label="Maximum centre length in inches"
            min={centreLengthMin}
            max={centreLengthMax}
            step="0.5"
            value={maxLen}
            onChange={(e) => setMaxLen(e.target.value)}
          />
        </div>
        <div className="dual-range-bounds">
          <span>{centreLengthMin}"</span>
          <span>{centreLengthMax}"</span>
        </div>
      </fieldset>

      <fieldset className="landmark gap-shape-fieldset">
        <legend>Acceptable lacing gap shapes</legend>
        <span className="helper">
          Check every gap shape you'd be happy wearing. Each corset gets
          scored under all of them and ranked by whichever produces its best
          fit — so leaving all three checked ranks the widest set of
          candidates; unchecking a shape hides fits that only work under it.
          Reverse gaps <em>()</em> (waist wider than rib/hip) are always
          penalized regardless.
        </span>
        {GAP_SHAPE_OPTIONS.map((opt) => {
          const checked = acceptableSet.has(opt.value);
          // Disable unchecking the last remaining box: an empty set would
          // produce an empty ranking with no user feedback about why.
          const disabled = checked && onlyOneChecked;
          return (
            <label key={opt.value} className="field field-checkbox">
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(e) => toggleGapShape(opt.value, e.target.checked)}
              />
              <span>
                <strong>
                  {opt.glyph} {opt.label}
                </strong>
                {' — '}
                {opt.helper}
              </span>
            </label>
          );
        })}
      </fieldset>
    </form>
  );
}
