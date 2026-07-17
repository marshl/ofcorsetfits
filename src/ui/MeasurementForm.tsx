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

import type { Body, StretchClass } from '../scoring/types.ts';

interface MeasurementFormProps {
  body: Body;
  onBodyChange: (body: Body) => void;
  stretchPreference: StretchClass | 'any';
  onStretchPreferenceChange: (pref: StretchClass | 'any') => void;
}

type LandmarkKey = 'underbust' | 'upper_hip' | 'iliac';

const LANDMARK_LABELS: Record<LandmarkKey, { display: string; helper: string }> = {
  underbust: {
    display: 'Underbust',
    helper: 'Just under the ribcage. Position is inches ABOVE natural waist.',
  },
  upper_hip: {
    display: 'Upper hip',
    helper: 'Where the hip curve starts (~2" below waist). Position is inches BELOW.',
  },
  iliac: {
    display: 'Iliac',
    helper: 'Top of the hip bones (widest of the lower torso). Inches BELOW waist.',
  },
};

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
}: MeasurementFormProps) {
  const setWaist = (raw: string) => {
    const n = toNumber(raw);
    if (n !== null) onBodyChange({ ...body, natural_waist_in: n });
  };

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

      {(['underbust', 'upper_hip', 'iliac'] as const).map((key) => {
        const current = body[key];
        const info = LANDMARK_LABELS[key];
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
              <span>Position (in from waist)</span>
              <input
                type="number"
                step="0.5"
                min="-15"
                max="15"
                value={current?.position_in ?? ''}
                onChange={(e) => setLandmarkField(key, 'position_in', e.target.value)}
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
    </form>
  );
}
