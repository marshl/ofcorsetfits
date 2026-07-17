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
  gapShape: GapShape;
  onGapShapeChange: (shape: GapShape) => void;
}

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
  gapShape,
  onGapShapeChange,
}: MeasurementFormProps) {
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
          <option value="low">Low stretch (cotton, satin, brocade, PVC)</option>
          <option value="medium">Medium stretch (hybrid — mesh + fabric)</option>
          <option value="high">High stretch (mesh-dominant)</option>
        </select>
        <span className="helper">Filter corsets by the material's stretch behavior.</span>
      </label>

      <label className="field">
        <span>Lacing gap shape</span>
        <select
          value={gapShape}
          onChange={(e) => onGapShapeChange(e.target.value as GapShape)}
        >
          <option value="curved">
            )( &nbsp; V-shape / teardrop — wider at rib &amp; hip, tighter at waist
          </option>
          <option value="straight">
            || &nbsp; Parallel — uniform gap top to bottom
          </option>
          <option value="closed">
            | &nbsp; Fully closed — no gap at any position
          </option>
        </select>
        <span className="helper">
          The visual shape of the laced gap at the back of the corset.{' '}
          <strong>)( V-shape / teardrop</strong> is the natural default: the
          corset cinches at the waist and opens gradually toward the rib and
          hip. Reverse gaps <em>()</em> (hourglass / X-shape), where the
          waist billows wider than the rib and hip, are heavily penalized.{' '}
          <strong>|| Parallel</strong> targets a uniform 2" gap at every
          position (the standard corsetry convention, independent of your
          reduction goal) — only corsets whose spring profile matches your
          body's silhouette can achieve this.{' '}
          <strong>| Fully closed</strong> is the most restrictive: the corset
          must close on you at every landmark, not just the waist.
        </span>
      </label>
    </form>
  );
}
