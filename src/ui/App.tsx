/**
 * Top-level app: loads the catalog (statically imported), holds the body
 * + stretch preference state, computes the ranking on every state change,
 * renders the measurement form on the left and the ranked list on the
 * right.
 *
 * MVP scope: no scoring-config sliders yet — that's the playground layer,
 * coming after the basic ranking works in-browser. Default scoring config
 * is used for all rankings.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import mysticCityJson from '../../catalog/mystic-city.json';
import timelessTrendsJson from '../../catalog/timeless-trends.json';
import type { Body, Catalog, Corset, GapShape, StretchClass } from '../scoring/types.ts';
import { defaultScoringConfig, rank } from '../scoring/index.ts';
import { MeasurementForm } from './MeasurementForm.tsx';
import { RankedList } from './RankedList.tsx';
import { Tour } from './Tour.tsx';
import {
  loadAcceptableGapShapes,
  loadBody,
  loadReduction,
  loadShowAdvanced,
  loadStretchPreference,
  loadTourShown,
  saveAcceptableGapShapes,
  saveBody,
  saveReduction,
  saveShowAdvanced,
  saveStretchPreference,
  saveTourShown,
} from './persist.ts';

const ALL_GAP_SHAPES: GapShape[] = [
  'curved',
  'straight',
  'slant-hip',
  'slant-rib',
  'closed',
];

/**
 * Merge two vendor catalogs into one combined catalog that the ranker
 * consumes. Stamps each corset with the source `brand` + `brand_url` so
 * the UI can label rows and generate per-vendor buy links (already carried
 * on each variant's `url`).
 *
 * `brand_waist_slack_by_stretch_class_in` is taken from the FIRST catalog
 * (MCC's). This is a small correctness hazard — TT's mesh behaviour may
 * differ from MCC's — but the values are close and both vendors' catalogs
 * are structural-fabric-heavy, so the drift is small. If it starts to
 * matter, the fix is to move slack from catalog-level to corset-level.
 */
function mergeCatalogs(mystic: Catalog, tt: Catalog): Catalog {
  const stampBrand = (source: Catalog): Corset[] =>
    source.corsets.map((c) => ({
      ...c,
      brand: source.brand,
      brand_url: source.brand_url,
    }));
  return {
    ...mystic,
    brand: `${mystic.brand} + ${tt.brand}`,
    brand_url: mystic.brand_url,
    generated_at_iso: mystic.generated_at_iso >= tt.generated_at_iso
      ? mystic.generated_at_iso
      : tt.generated_at_iso,
    sources: { ...mystic.sources, ...tt.sources },
    corsets: [...stampBrand(mystic), ...stampBrand(tt)],
  };
}

const catalog = mergeCatalogs(
  mysticCityJson as unknown as Catalog,
  timelessTrendsJson as unknown as Catalog,
);

const DEFAULT_BODY: Body = {
  natural_waist_in: 28,
  underbust: { circumference_in: 32, position_in: -5 },
  upper_hip: { circumference_in: 34, position_in: 4 },
  iliac: { circumference_in: 38, position_in: 7 },
};

/**
 * First-visit body: just a waist. The tour is going to walk the user
 * through filling in every other landmark, so we don't want the form
 * pre-populated with example numbers they'd have to overwrite. Anyone
 * skipping the tour without entering landmarks is opting into a
 * waist-only ranking — which is still meaningful.
 */
const FIRST_VISIT_BODY: Body = {
  natural_waist_in: 28,
};

export function App() {
  const [body, setBody] = useState<Body>(() => {
    const saved = loadBody();
    if (saved) return saved;
    return loadTourShown() ? DEFAULT_BODY : FIRST_VISIT_BODY;
  });
  const [stretchPreference, setStretchPreference] = useState<StretchClass | 'any'>(
    () => loadStretchPreference() ?? 'any',
  );
  const [desiredReduction, setDesiredReduction] = useState<number>(
    () => loadReduction() ?? 2,
  );
  const [acceptableGapShapes, setAcceptableGapShapes] = useState<GapShape[]>(
    () => loadAcceptableGapShapes() ?? ALL_GAP_SHAPES,
  );
  const [showAdvanced, setShowAdvanced] = useState<boolean>(
    () => loadShowAdvanced() ?? false,
  );
  const [tourOpen, setTourOpen] = useState<boolean>(() => !loadTourShown());

  const closeTour = () => {
    setTourOpen(false);
    saveTourShown(true);
  };

  /**
   * Freeze the ranking inputs while the tour is open, so the results
   * panel behind the modal doesn't flicker on every keystroke. When the
   * tour opens we take a snapshot of the current inputs; the ranker
   * uses that snapshot until the tour closes, at which point the
   * snapshot is cleared and ranking resumes on live values.
   *
   * A ref carries the live values into the open-transition effect
   * without listing them as effect deps — we deliberately DON'T want
   * mid-tour edits to re-snapshot.
   */
  interface RankInputs {
    body: Body;
    stretchPreference: StretchClass | 'any';
    desiredReduction: number;
    acceptableGapShapes: GapShape[];
  }
  const liveInputsRef = useRef<RankInputs>({
    body,
    stretchPreference,
    desiredReduction,
    acceptableGapShapes,
  });
  liveInputsRef.current = {
    body,
    stretchPreference,
    desiredReduction,
    acceptableGapShapes,
  };
  const [frozenInputs, setFrozenInputs] = useState<RankInputs | null>(null);
  useEffect(() => {
    if (tourOpen) {
      setFrozenInputs(liveInputsRef.current);
    } else {
      setFrozenInputs(null);
    }
  }, [tourOpen]);

  const rankBody = frozenInputs?.body ?? body;
  const rankStretch = frozenInputs?.stretchPreference ?? stretchPreference;
  const rankReduction = frozenInputs?.desiredReduction ?? desiredReduction;
  const rankShapes = frozenInputs?.acceptableGapShapes ?? acceptableGapShapes;

  useEffect(() => {
    saveBody(body);
  }, [body]);

  useEffect(() => {
    saveStretchPreference(stretchPreference);
  }, [stretchPreference]);

  useEffect(() => {
    saveReduction(desiredReduction);
  }, [desiredReduction]);

  useEffect(() => {
    saveAcceptableGapShapes(acceptableGapShapes);
  }, [acceptableGapShapes]);

  useEffect(() => {
    saveShowAdvanced(showAdvanced);
  }, [showAdvanced]);

  const results = useMemo(() => {
    const config = defaultScoringConfig(catalog);
    config.stretch_preference = rankStretch;
    config.desired_reduction_in = rankReduction;
    config.acceptable_gap_shapes = rankShapes;
    return rank(rankBody, catalog, config);
  }, [rankBody, rankStretch, rankReduction, rankShapes]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>OfCorsetFits</h1>
        <p className="tagline">
          Ranked Mystic City and Timeless Trends corsets by fit against your
          anatomical measurements. Enter your body on the left; results
          update live.
        </p>
        <p className="meta">
          Catalog: {catalog.corsets.length} silhouettes ·{' '}
          {catalog.corsets.reduce((n, c) => n + c.variants.length, 0)} variants ·
          generated {catalog.generated_at_iso.slice(0, 10)}
          {' · '}
          <button
            type="button"
            className="tour-link-btn"
            onClick={() => setTourOpen(true)}
          >
            Take the tour
          </button>
        </p>
      </header>
      <Tour
        open={tourOpen}
        onClose={closeTour}
        body={body}
        onBodyChange={setBody}
        stretchPreference={stretchPreference}
        onStretchPreferenceChange={setStretchPreference}
        desiredReduction={desiredReduction}
        onDesiredReductionChange={setDesiredReduction}
        acceptableGapShapes={acceptableGapShapes}
        onAcceptableGapShapesChange={setAcceptableGapShapes}
      />
      <main className="app-main">
        <aside className="app-sidebar">
          <MeasurementForm
            body={body}
            onBodyChange={setBody}
            stretchPreference={stretchPreference}
            onStretchPreferenceChange={setStretchPreference}
            desiredReduction={desiredReduction}
            onDesiredReductionChange={setDesiredReduction}
            acceptableGapShapes={acceptableGapShapes}
            onAcceptableGapShapesChange={setAcceptableGapShapes}
          />
        </aside>
        <section className="app-content">
          <RankedList
            results={results}
            showAdvanced={showAdvanced}
            onShowAdvancedChange={setShowAdvanced}
          />
        </section>
      </main>
      <footer className="app-footer">
        <small>
          Data from mysticcitycorsets.com and timeless-trends.com. Fit
          rankings are computed from each vendor's published
          spring/geometry values plus your inputs — always check the
          product page for stock, exact color, and the vendor's own
          fitting notes before buying.
        </small>
      </footer>
    </div>
  );
}
