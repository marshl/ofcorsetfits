/**
 * Post-measurement-tour spotlight walkthrough of the results panel.
 * Dims the whole page and highlights one element at a time with a
 * popup pointing to it. Auto-fires after the main tour is COMPLETED
 * on first visit (not on skip); also re-openable from the header link.
 *
 * The tour programmatically expands the first row for the breakdown
 * step, which is why `expandedKey` lives on App now, not RankedList.
 *
 * Target elements are found via `[data-tour="…"]` selectors in the
 * DOM rather than refs — avoids threading refs through several
 * intermediate components.
 */

import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

interface Step {
  slug: string;
  target: string;
  title: string;
  body: ReactNode;
  expandFirstRow: boolean;
}

const STEPS: Step[] = [
  {
    slug: 'panel',
    target: '[data-tour="results-panel"]',
    title: 'The results panel',
    body: (
      <p>
        Corsets are ranked from best fit to worst as you change
        measurements on the left. The best pick sits at the top.
      </p>
    ),
    expandFirstRow: false,
  },
  {
    slug: 'row',
    target: '[data-tour="first-row"]',
    title: 'What each row means',
    body: (
      <>
        <p>
          Each row is one corset the tool thinks could fit you — its
          name, its size, and how good the fit is likely to be. Best
          matches sit at the top; the further down the list you go,
          the worse the fit.
        </p>
        <p>
          When several corsets are close enough to be practically tied,
          they share a rank number — pick whichever you like best.
        </p>
      </>
    ),
    expandFirstRow: false,
  },
  {
    slug: 'breakdown',
    target: '[data-tour="row-breakdown"]',
    title: 'Per-landmark breakdown',
    body: (
      <p>
        Click any row (already done for you here) to see this breakdown:
        what the corset measures at each landmark, what your body
        measures, and the resulting lacing gap.
      </p>
    ),
    expandFirstRow: true,
  },
  {
    slug: 'buy',
    target: '[data-tour="row-buy-link"]',
    title: 'Buy links',
    body: (
      <p>
        Each row lists a link per color variant, straight to the
        vendor's product page.
      </p>
    ),
    expandFirstRow: true,
  },
  {
    slug: 'advanced-help',
    target: '[data-tour="advanced-help-row"]',
    title: 'Deeper options',
    body: (
      <p>
        Toggle <strong>Show algorithm details</strong> for per-position
        weight and penalty numbers. The <strong>?</strong> opens a full
        explanation of how the score is computed.
      </p>
    ),
    expandFirstRow: false,
  },
];

interface ResultsTourProps {
  open: boolean;
  onClose: () => void;
  firstRowKey: string | null;
  onExpandedKeyChange: (key: string | null) => void;
}

type Placement = 'below' | 'above' | 'center';

export function ResultsTour({
  open,
  onClose,
  firstRowKey,
  onExpandedKeyChange,
}: ResultsTourProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [popupPos, setPopupPos] = useState<{
    top: number;
    left: number;
    placement: Placement;
  }>({ top: -9999, left: -9999, placement: 'below' });
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setStepIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Collapse the tour-driven row expansion when the tour closes.
  useEffect(() => {
    if (!open) onExpandedKeyChange(null);
  }, [open, onExpandedKeyChange]);

  const step = STEPS[stepIndex];

  // Expand or collapse the first row per step, then locate the target
  // element and remember its rect. rAF gives React one frame to
  // re-render after any expand/collapse before we query the DOM.
  useEffect(() => {
    if (!open) return;
    onExpandedKeyChange(step.expandFirstRow ? firstRowKey : null);
    const rafId = requestAnimationFrame(() => {
      const target = document.querySelector(step.target);
      if (!target) {
        setTargetRect(null);
        return;
      }
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
      requestAnimationFrame(() => {
        setTargetRect(target.getBoundingClientRect());
      });
    });
    return () => cancelAnimationFrame(rafId);
    // firstRowKey / onExpandedKeyChange are stable-enough props from
    // App; re-running on their change is fine.
  }, [open, stepIndex, step.target, step.expandFirstRow, firstRowKey, onExpandedKeyChange]);

  // Remeasure on scroll and resize so the spotlight tracks reflows.
  useEffect(() => {
    if (!open) return;
    const remeasure = () => {
      const target = document.querySelector(step.target);
      if (target) setTargetRect(target.getBoundingClientRect());
    };
    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, true);
    return () => {
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, true);
    };
  }, [open, step.target]);

  // Position the popup relative to the target — below if it fits,
  // above if not, otherwise center in the viewport as a fallback.
  useLayoutEffect(() => {
    if (!open || !targetRect || !popupRef.current) return;
    const popupRect = popupRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 14;
    const margin = 8;

    const spaceBelow = vh - targetRect.bottom;
    const spaceAbove = targetRect.top;
    const fitsBelow = spaceBelow >= popupRect.height + gap + margin;
    const fitsAbove = spaceAbove >= popupRect.height + gap + margin;

    let top: number;
    let placement: Placement;
    if (fitsBelow) {
      top = targetRect.bottom + gap;
      placement = 'below';
    } else if (fitsAbove) {
      top = targetRect.top - popupRect.height - gap;
      placement = 'above';
    } else {
      top = Math.max(margin, (vh - popupRect.height) / 2);
      placement = 'center';
    }
    const desiredLeft =
      targetRect.left + targetRect.width / 2 - popupRect.width / 2;
    const left = Math.max(
      margin,
      Math.min(vw - popupRect.width - margin, desiredLeft),
    );
    setPopupPos({ top, left, placement });
  }, [open, targetRect, stepIndex]);

  if (!open) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const next = () => {
    if (isLast) onClose();
    else setStepIndex((i) => i + 1);
  };
  const back = () => {
    if (!isFirst) setStepIndex((i) => i - 1);
  };

  return (
    <>
      <div className="results-tour-blocker" aria-hidden="true" />
      {targetRect && (
        <div
          className="results-tour-spotlight"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
          aria-hidden="true"
        />
      )}
      <div
        ref={popupRef}
        className={`results-tour-popup results-tour-popup-${popupPos.placement}`}
        style={{ top: popupPos.top, left: popupPos.left }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="results-tour-title"
      >
        <button
          type="button"
          className="help-modal-close"
          aria-label="Close tour"
          onClick={onClose}
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
        <h3 id="results-tour-title">{step.title}</h3>
        <div className="results-tour-body">{step.body}</div>
        <div className="tour-buttons">
          <button
            type="button"
            className="tour-btn tour-btn-skip"
            onClick={onClose}
          >
            Skip
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
              autoFocus
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
