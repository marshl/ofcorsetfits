/**
 * Tiny localStorage helpers for persisting the user's body measurements
 * and stretch preference between sessions. Values are JSON-encoded under
 * versioned keys so a schema change in the future can bump the key
 * rather than reading stale data with a new shape.
 */

import type { Body, GapShape, StretchClass } from '../scoring/types.ts';

const BODY_KEY = 'ofcorsetfits:body:v1';
const STRETCH_KEY = 'ofcorsetfits:stretch_preference:v1';
const REDUCTION_KEY = 'ofcorsetfits:desired_reduction_in:v1';
const GAP_SHAPE_KEY = 'ofcorsetfits:gap_shape:v1';
const ACCEPTABLE_GAP_SHAPES_KEY = 'ofcorsetfits:acceptable_gap_shapes:v1';
const ADVANCED_KEY = 'ofcorsetfits:show_advanced:v1';
const TOUR_SHOWN_KEY = 'ofcorsetfits:tour_shown:v1';
const RESULTS_TOUR_SHOWN_KEY = 'ofcorsetfits:results_tour_shown:v1';

export function loadBody(): Body | null {
  try {
    const raw = localStorage.getItem(BODY_KEY);
    return raw ? (JSON.parse(raw) as Body) : null;
  } catch {
    return null;
  }
}

export function saveBody(body: Body): void {
  try {
    localStorage.setItem(BODY_KEY, JSON.stringify(body));
  } catch {
    // Storage may be unavailable (private mode, quota) — silently ignore.
  }
}

export function loadStretchPreference(): StretchClass | 'any' | null {
  try {
    const raw = localStorage.getItem(STRETCH_KEY);
    if (raw === 'any' || raw === 'low' || raw === 'medium' || raw === 'high') {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveStretchPreference(pref: StretchClass | 'any'): void {
  try {
    localStorage.setItem(STRETCH_KEY, pref);
  } catch {
    // ignore
  }
}

export function loadReduction(): number | null {
  try {
    const raw = localStorage.getItem(REDUCTION_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function saveReduction(reduction: number): void {
  try {
    localStorage.setItem(REDUCTION_KEY, String(reduction));
  } catch {
    // ignore
  }
}

function isGapShape(v: unknown): v is GapShape {
  return (
    v === 'curved' ||
    v === 'straight' ||
    v === 'slant-hip' ||
    v === 'slant-rib' ||
    v === 'closed'
  );
}

/**
 * Load the acceptable-shapes checkbox set. Falls back to migrating the
 * legacy single-value `gap_shape` key ({single shape} → singleton array)
 * so users who saved a preference under the old dropdown UI don't lose it.
 * Returns null if nothing is stored or the stored value is corrupt — the
 * caller is expected to substitute a default set.
 */
export function loadAcceptableGapShapes(): GapShape[] | null {
  try {
    const raw = localStorage.getItem(ACCEPTABLE_GAP_SHAPES_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const filtered = parsed.filter(isGapShape);
        return filtered.length > 0 ? filtered : null;
      }
      return null;
    }
    // Migration path: legacy single-value dropdown → singleton array.
    const legacy = localStorage.getItem(GAP_SHAPE_KEY);
    if (isGapShape(legacy)) return [legacy];
    return null;
  } catch {
    return null;
  }
}

export function saveAcceptableGapShapes(shapes: GapShape[]): void {
  try {
    localStorage.setItem(ACCEPTABLE_GAP_SHAPES_KEY, JSON.stringify(shapes));
  } catch {
    // ignore
  }
}

export function loadShowAdvanced(): boolean | null {
  try {
    const raw = localStorage.getItem(ADVANCED_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

export function saveShowAdvanced(value: boolean): void {
  try {
    localStorage.setItem(ADVANCED_KEY, value ? 'true' : 'false');
  } catch {
    // ignore
  }
}

export function loadTourShown(): boolean {
  try {
    return localStorage.getItem(TOUR_SHOWN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveTourShown(shown: boolean): void {
  try {
    localStorage.setItem(TOUR_SHOWN_KEY, shown ? 'true' : 'false');
  } catch {
    // ignore
  }
}

export function loadResultsTourShown(): boolean {
  try {
    return localStorage.getItem(RESULTS_TOUR_SHOWN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveResultsTourShown(shown: boolean): void {
  try {
    localStorage.setItem(RESULTS_TOUR_SHOWN_KEY, shown ? 'true' : 'false');
  } catch {
    // ignore
  }
}
