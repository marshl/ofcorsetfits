/**
 * First-visit guided tour — a wizard that walks new users through
 * filling in the measurement form one field at a time. Each step edits
 * the same state that MeasurementForm binds to, so whatever the user
 * enters or leaves is what shows up on the form when the tour closes.
 *
 * Shown automatically the first time the app loads (see App.tsx —
 * `loadTourShown` gates this), and re-openable from the header link.
 */

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { Body, GapShape, StretchClass } from '../scoring/types.ts';

interface TourProps {
  open: boolean;
  onClose: (completed: boolean) => void;
  body: Body;
  onBodyChange: (body: Body) => void;
  stretchPreference: StretchClass | 'any';
  onStretchPreferenceChange: (pref: StretchClass | 'any') => void;
  desiredReduction: number;
  onDesiredReductionChange: (reduction: number) => void;
  acceptableGapShapes: GapShape[];
  onAcceptableGapShapesChange: (shapes: GapShape[]) => void;
}

type LandmarkKey = 'underbust' | 'upper_hip' | 'iliac';
type Direction = 'above' | 'below';

interface LandmarkMeta {
  display: string;
  direction: Direction;
  intro: string;
  positionHelper: string;
  defaultCircumference: number;
  defaultSignedPosition: number;
}

const LANDMARK_META: Record<LandmarkKey, LandmarkMeta> = {
  underbust: {
    display: 'Underbust',
    direction: 'above',
    intro:
      'Just under the ribcage, snug against the base of the ribs. Measure with arms relaxed at your sides.',
    positionHelper: 'Typical: 4–6" above the waist.',
    defaultCircumference: 32,
    defaultSignedPosition: -5,
  },
  upper_hip: {
    display: 'Upper hip',
    direction: 'below',
    intro:
      'Where the hip curve starts to swell out from the waist — not the widest point of the hip (that comes next).',
    positionHelper: 'Typical: 3–5" below the waist.',
    defaultCircumference: 34,
    defaultSignedPosition: 4,
  },
  iliac: {
    display: 'Iliac',
    direction: 'below',
    intro:
      'The widest part of your lower torso, usually at the top of the hip bones (iliac crest).',
    positionHelper: 'Typical: 6–8" below the waist.',
    defaultCircumference: 38,
    defaultSignedPosition: 7,
  },
};

function toDisplayPosition(direction: Direction, signed: number): number {
  return direction === 'above' ? -signed : signed;
}
function toSignedPosition(direction: Direction, display: number): number {
  return direction === 'above' ? -display : display;
}
function toNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const GAP_SHAPE_OPTIONS: {
  value: GapShape;
  glyph: string;
  label: string;
}[] = [
  { value: 'curved', glyph: ')(', label: 'Curved (pinched at waist)' },
  { value: 'straight', glyph: '||', label: 'Parallel' },
  { value: 'slant-hip', glyph: '/\\', label: 'Slanted — wider at hip' },
  { value: 'slant-rib', glyph: '\\/', label: 'Slanted — wider at rib' },
  { value: 'closed', glyph: '|', label: 'Fully closed' },
];

type Step =
  | { kind: 'welcome' }
  | { kind: 'waist' }
  | { kind: 'landmark'; key: LandmarkKey }
  | { kind: 'stretch' }
  | { kind: 'gap-shapes' }
  | { kind: 'results' };

const STEPS: Step[] = [
  { kind: 'welcome' },
  { kind: 'waist' },
  { kind: 'landmark', key: 'underbust' },
  { kind: 'landmark', key: 'upper_hip' },
  { kind: 'landmark', key: 'iliac' },
  { kind: 'stretch' },
  { kind: 'gap-shapes' },
  { kind: 'results' },
];

export function Tour(props: TourProps) {
  const {
    open,
    onClose,
    body,
    onBodyChange,
    stretchPreference,
    onStretchPreferenceChange,
    desiredReduction,
    onDesiredReductionChange,
    acceptableGapShapes,
    onAcceptableGapShapesChange,
  } = props;

  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const next = () => {
    if (isLast) onClose(true);
    else setStepIndex((i) => i + 1);
  };
  const back = () => {
    if (!isFirst) setStepIndex((i) => i - 1);
  };

  const rendered = renderStep(step, {
    body,
    onBodyChange,
    stretchPreference,
    onStretchPreferenceChange,
    desiredReduction,
    onDesiredReductionChange,
    acceptableGapShapes,
    onAcceptableGapShapesChange,
  });

  return (
    <div
      className="help-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(false);
      }}
    >
      <div className="tour-modal">
        <button
          type="button"
          className="help-modal-close"
          aria-label="Close tour"
          onClick={() => onClose(false)}
        >
          ×
        </button>
        <div
          className="tour-progress"
          aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`}
        >
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={
                'tour-progress-dot' +
                (i === stepIndex ? ' active' : i < stepIndex ? ' past' : '')
              }
            />
          ))}
        </div>
        <h3 id="tour-modal-title">{rendered.title}</h3>
        <div className="tour-content">{rendered.body}</div>
        <div className="tour-buttons">
          <button
            type="button"
            className="tour-btn tour-btn-skip"
            onClick={() => onClose(false)}
          >
            Skip tour
          </button>
          <div className="tour-buttons-right">
            <button
              type="button"
              className="tour-btn tour-btn-back"
              onClick={back}
              disabled={isFirst}
            >
              Back
            </button>
            <button
              type="button"
              className="tour-btn tour-btn-next"
              onClick={next}
            >
              {isLast ? 'Get started' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface Ctx {
  body: Body;
  onBodyChange: (body: Body) => void;
  stretchPreference: StretchClass | 'any';
  onStretchPreferenceChange: (pref: StretchClass | 'any') => void;
  desiredReduction: number;
  onDesiredReductionChange: (reduction: number) => void;
  acceptableGapShapes: GapShape[];
  onAcceptableGapShapesChange: (shapes: GapShape[]) => void;
}

function renderStep(step: Step, ctx: Ctx): { title: string; body: ReactNode } {
  switch (step.kind) {
    case 'welcome':
      return {
        title: 'Welcome to OfCorsetFits',
        body: (
          <>
            <p>
              This tool ranks corsets from Mystic City and Timeless Trends
              by how well each one is likely to fit <em>your</em> body.
            </p>
            <p>
              We'll walk through the form together — one measurement at a
              time. Anything you enter here fills in the form on the left,
              and the results panel on the right updates as you go. You
              can skip at any point.
            </p>
          </>
        ),
      };
    case 'waist':
      return renderWaist(ctx);
    case 'landmark':
      return renderLandmark(step.key, ctx);
    case 'stretch':
      return renderStretch(ctx);
    case 'gap-shapes':
      return renderGapShapes(ctx);
    case 'results':
      return {
        title: 'Reading the results',
        body: (
          <>
            <p>
              The panel on the right lists corsets from best fit to worst.
              Rows within 0.3 points of the tier leader share a tier
              number — a signal that they're practically equivalent
              picks.
            </p>
            <p>
              Click any row to expand its per-landmark breakdown: what
              the corset measures at each anchor, what your body
              measures, and the resulting lacing gap. Buy links jump
              straight to the vendor's product page.
            </p>
            <p>
              The <strong>?</strong> button in the results header opens a
              deeper explanation of how the score is computed.
            </p>
          </>
        ),
      };
  }
}

function renderWaist(ctx: Ctx): { title: string; body: ReactNode } {
  const setWaist = (raw: string) => {
    const n = toNumber(raw);
    if (n !== null) ctx.onBodyChange({ ...ctx.body, natural_waist_in: n });
  };
  const setReduction = (raw: string) => {
    const n = toNumber(raw);
    if (n !== null && n >= 0) ctx.onDesiredReductionChange(n);
  };
  const targetWaist = ctx.body.natural_waist_in - ctx.desiredReduction;

  return {
    title: 'Your natural waist',
    body: (
      <>
        <p>
          Measure the narrowest part of your torso, standing relaxed,
          with the tape snug but not compressing.
        </p>
        <label className="tour-field">
          <span>Natural waist (inches)</span>
          <input
            type="number"
            step="0.5"
            min="10"
            max="80"
            autoFocus
            value={ctx.body.natural_waist_in}
            onChange={(e) => setWaist(e.target.value)}
          />
        </label>
        <p>
          How much smaller do you want your waist to look when the corset
          is on? Comfortable daily wear is around 2"; tightlacers aim for
          4–6".
        </p>
        <label className="tour-field">
          <span>Desired reduction (inches)</span>
          <input
            type="number"
            step="0.5"
            min="0"
            max="12"
            value={ctx.desiredReduction}
            onChange={(e) => setReduction(e.target.value)}
          />
          <span className="tour-helper">
            Target waist: <strong>{targetWaist.toFixed(1)}"</strong>
          </span>
        </label>
      </>
    ),
  };
}

function renderLandmark(
  key: LandmarkKey,
  ctx: Ctx,
): { title: string; body: ReactNode } {
  const meta = LANDMARK_META[key];
  const current = ctx.body[key];
  const displayPosition =
    current?.position_in !== undefined
      ? toDisplayPosition(meta.direction, current.position_in)
      : '';
  const circumference = current?.circumference_in ?? '';

  const setField = (
    field: 'circumference_in' | 'position_in',
    raw: string,
  ) => {
    const n = toNumber(raw);
    if (n === null) {
      const other =
        field === 'circumference_in'
          ? current?.position_in
          : current?.circumference_in;
      if (other === undefined) {
        const nextBody = { ...ctx.body };
        delete nextBody[key];
        ctx.onBodyChange(nextBody);
      } else {
        // Half-set isn't allowed by the Body type — clear the whole
        // landmark rather than leaving it in an invalid state.
        const nextBody = { ...ctx.body };
        delete nextBody[key];
        ctx.onBodyChange(nextBody);
      }
      return;
    }
    const other =
      field === 'circumference_in'
        ? current?.position_in
        : current?.circumference_in;
    const nextLandmark =
      field === 'circumference_in'
        ? {
            circumference_in: n,
            position_in: other ?? meta.defaultSignedPosition,
          }
        : {
            circumference_in: other ?? meta.defaultCircumference,
            position_in: n,
          };
    ctx.onBodyChange({ ...ctx.body, [key]: nextLandmark });
  };

  const clearLandmark = () => {
    const nextBody = { ...ctx.body };
    delete nextBody[key];
    ctx.onBodyChange(nextBody);
  };

  const isSet = current !== undefined;

  return {
    title: `${meta.display} (optional)`,
    body: (
      <>
        <p>{meta.intro}</p>
        <label className="tour-field">
          <span>Circumference (inches)</span>
          <input
            type="number"
            step="0.5"
            min="10"
            max="80"
            autoFocus
            value={circumference}
            onChange={(e) => setField('circumference_in', e.target.value)}
          />
        </label>
        <label className="tour-field">
          <span>Position ({meta.direction} waist, inches)</span>
          <input
            type="number"
            step="0.5"
            min="0"
            max="15"
            value={displayPosition}
            onChange={(e) => {
              const n = toNumber(e.target.value);
              if (n === null) {
                setField('position_in', '');
              } else {
                setField(
                  'position_in',
                  String(toSignedPosition(meta.direction, n)),
                );
              }
            }}
          />
          <span className="tour-helper">{meta.positionHelper}</span>
        </label>
        <p className="tour-optional-note">
          Optional — this landmark sharpens the ranking but isn't
          required.{' '}
          {isSet ? (
            <button
              type="button"
              className="tour-inline-btn"
              onClick={clearLandmark}
            >
              Clear this landmark and skip
            </button>
          ) : (
            <em>Leave both fields blank to skip.</em>
          )}
        </p>
      </>
    ),
  };
}

function renderStretch(ctx: Ctx): { title: string; body: ReactNode } {
  return {
    title: 'Stretch preference',
    body: (
      <>
        <p>
          Corsets come in firm (cotton, brocade, PVC), semi-stretch
          (hybrid mesh + fabric), and stretchy (mesh-dominant) fabrics.
          More stretch closes to a larger effective waist than the size
          on the label.
        </p>
        <label className="tour-field">
          <span>Stretch preference</span>
          <select
            autoFocus
            value={ctx.stretchPreference}
            onChange={(e) =>
              ctx.onStretchPreferenceChange(e.target.value as StretchClass | 'any')
            }
          >
            <option value="any">Any (all variants)</option>
            <option value="low">Firm — cotton, satin, brocade, PVC</option>
            <option value="medium">Semi-stretch — hybrid mesh + fabric</option>
            <option value="high">Stretchy — mesh-dominant</option>
          </select>
          <span className="tour-helper">
            Leave on <strong>Any</strong> to see everything.
          </span>
        </label>
      </>
    ),
  };
}

function renderGapShapes(ctx: Ctx): { title: string; body: ReactNode } {
  const acceptableSet = new Set(ctx.acceptableGapShapes);
  const onlyOneChecked = ctx.acceptableGapShapes.length === 1;
  const toggle = (shape: GapShape, checked: boolean) => {
    if (checked) {
      if (acceptableSet.has(shape)) return;
      const next = GAP_SHAPE_OPTIONS.map((o) => o.value).filter(
        (s) => acceptableSet.has(s) || s === shape,
      );
      ctx.onAcceptableGapShapesChange(next);
    } else {
      if (ctx.acceptableGapShapes.length <= 1) return;
      ctx.onAcceptableGapShapesChange(
        ctx.acceptableGapShapes.filter((s) => s !== shape),
      );
    }
  };

  return {
    title: 'Acceptable gap shapes',
    body: (
      <>
        <p>
          When a corset is laced closed, the gap at the back forms a
          shape. Check every shape you'd be happy wearing — each corset
          is scored under every accepted shape and reported at its
          best.
        </p>
        <div className="tour-gap-shapes">
          {GAP_SHAPE_OPTIONS.map((opt) => {
            const checked = acceptableSet.has(opt.value);
            const disabled = checked && onlyOneChecked;
            return (
              <label key={opt.value} className="tour-checkbox">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(e) => toggle(opt.value, e.target.checked)}
                />
                <span>
                  <span className="tour-glyph">{opt.glyph}</span>{' '}
                  {opt.label}
                </span>
              </label>
            );
          })}
        </div>
      </>
    ),
  };
}
