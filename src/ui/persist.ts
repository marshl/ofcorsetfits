/**
 * Tiny localStorage helpers for persisting the user's body measurements
 * and stretch preference between sessions. Values are JSON-encoded under
 * versioned keys so a schema change in the future can bump the key
 * rather than reading stale data with a new shape.
 */

import type { Body, StretchClass } from '../scoring/types.ts';

const BODY_KEY = 'ofcorsetfits:body:v1';
const STRETCH_KEY = 'ofcorsetfits:stretch_preference:v1';
const REDUCTION_KEY = 'ofcorsetfits:desired_reduction_in:v1';

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
