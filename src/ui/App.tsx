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

import { useEffect, useMemo, useState } from 'react';
import catalogJson from '../../catalog/mystic-city.json';
import type { Body, Catalog, GapShape, StretchClass } from '../scoring/types.ts';
import { defaultScoringConfig, rank } from '../scoring/index.ts';
import { MeasurementForm } from './MeasurementForm.tsx';
import { RankedList } from './RankedList.tsx';
import {
  loadAcceptableGapShapes,
  loadBody,
  loadReduction,
  loadShowAdvanced,
  loadStretchPreference,
  saveAcceptableGapShapes,
  saveBody,
  saveReduction,
  saveShowAdvanced,
  saveStretchPreference,
} from './persist.ts';

const ALL_GAP_SHAPES: GapShape[] = [
  'curved',
  'straight',
  'slant-hip',
  'slant-rib',
  'closed',
];

const catalog = catalogJson as unknown as Catalog;

const DEFAULT_BODY: Body = {
  natural_waist_in: 28,
  underbust: { circumference_in: 32, position_in: -5 },
  upper_hip: { circumference_in: 34, position_in: 4 },
  iliac: { circumference_in: 38, position_in: 7 },
};

export function App() {
  const [body, setBody] = useState<Body>(() => loadBody() ?? DEFAULT_BODY);
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
    config.stretch_preference = stretchPreference;
    config.desired_reduction_in = desiredReduction;
    config.acceptable_gap_shapes = acceptableGapShapes;
    return rank(body, catalog, config);
  }, [body, stretchPreference, desiredReduction, acceptableGapShapes]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>ofcorsetfits</h1>
        <p className="tagline">
          Ranked Mystic City corsets by fit against your anatomical measurements.
          Enter your body on the left; results update live.
        </p>
        <p className="meta">
          Catalog: {catalog.corsets.length} silhouettes ·{' '}
          {catalog.corsets.reduce((n, c) => n + c.variants.length, 0)} variants ·
          generated {catalog.generated_at_iso.slice(0, 10)}
        </p>
      </header>
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
          Data from mysticcitycorsets.com. Fit rankings are computed
          from published spring/geometry values plus your inputs — always
          check the product page for stock, exact color, and MCC's own
          fitting notes before buying.
        </small>
      </footer>
    </div>
  );
}
