/**
 * Ranked list — one row per VARIANT (silhouette × material variant). Same
 * silhouette in multiple materials appears as multiple rows because the
 * different stretch classes produce different scores. Expanding a row
 * reveals the per-position penalty breakdown for THAT specific variant,
 * plus a compact cross-reference of the same silhouette's other variants
 * so you can compare siblings without scrolling.
 */

import { useState } from 'react';
import type { RankedResult } from '../scoring/types.ts';

interface RankedListProps {
  results: RankedResult[];
  topN?: number;
}

function formatDiff(diff: number | null): string {
  if (diff === null) return 'n/a';
  if (diff === 0) return '0.00"';
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(2)}"`;
}

/** Unique key per row: same silhouette in different variants → different keys. */
function rowKey(r: RankedResult): string {
  return `${r.corset.id}::${r.best.variant.url}`;
}

export function RankedList({ results, topN = 30 }: RankedListProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const shown = results.slice(0, topN);

  if (results.length === 0) {
    return (
      <section className="ranked-list ranked-list-empty">
        <h2>No matching corsets</h2>
        <p>
          Try changing your stretch preference to <strong>Any</strong>, or check
          that you have at least a natural waist entered.
        </p>
      </section>
    );
  }

  return (
    <section className="ranked-list">
      <h2>
        Best fits{' '}
        <span className="count">
          ({shown.length} of {results.length} shown — variants ranked separately)
        </span>
      </h2>
      <ol className="ranked-rows">
        {shown.map((r, i) => {
          const key = rowKey(r);
          const isExpanded = expandedKey === key;
          const stretch = r.best.variant.stretch_class;
          const otherVariants = r.variant_bests.filter(
            (vb) => vb.variant.url !== r.best.variant.url,
          );
          return (
            <li key={key} className={`ranked-row ranked-row-${stretch}`}>
              <button
                type="button"
                className="ranked-row-header"
                onClick={() => setExpandedKey(isExpanded ? null : key)}
                aria-expanded={isExpanded}
              >
                <span className="rank">{i + 1}</span>
                <span className="corset-id">{r.corset.id}</span>
                <span className="corset-name">{r.best.variant.name}</span>
                <span className={`stretch stretch-${stretch}`}>{stretch}</span>
                <span className="best-size">size {r.best.waist_size_in}"</span>
                <span className="silhouette">{r.corset.silhouette_category}</span>
                <span className="score">score {r.best.total.toFixed(2)}</span>
                <span className="expand">{isExpanded ? '▼' : '▶'}</span>
              </button>

              {isExpanded && (
                <div className="ranked-row-details">
                  <div className="detail-meta">
                    <div>
                      <strong>Variant:</strong> {r.best.variant.name} —{' '}
                      <a
                        href={r.best.variant.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        buy on mysticcitycorsets.com ↗
                      </a>
                    </div>
                    <div>
                      <strong>Materials:</strong>{' '}
                      {r.best.variant.materials.join(', ') || '(unspecified)'}
                    </div>
                    <div>
                      <strong>Silhouette words:</strong>{' '}
                      {r.corset.silhouette_words.join(', ') || '(none)'}
                    </div>
                    <div>
                      <strong>Torso length:</strong>{' '}
                      {r.corset.body_length_in ?? 'unknown'}"
                    </div>
                  </div>

                  <table className="score-breakdown">
                    <thead>
                      <tr>
                        <th>Position</th>
                        <th>Corset</th>
                        <th>Body</th>
                        <th>Diff</th>
                        <th>Gap</th>
                        <th>Weight</th>
                        <th>Penalty</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>waist (effective)</td>
                        <td>{(r.best.waist_size_in).toFixed(1)}" + slack</td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                        <td>—</td>
                        <td>{r.best.waist_penalty.toFixed(3)}</td>
                      </tr>
                      {r.best.position_results.map((p, idx) => (
                        <tr key={idx}>
                          <td>{p.label ?? `pos ${p.position_from_waist_in}`}</td>
                          <td>{p.corset_circumference_in.toFixed(1)}"</td>
                          <td>
                            {p.user_circumference_in === null
                              ? '—'
                              : `${p.user_circumference_in.toFixed(1)}"`}
                          </td>
                          <td>{formatDiff(p.diff_in)}</td>
                          <td>{formatDiff(p.actual_gap_in)}</td>
                          <td>{p.weight.toFixed(1)}</td>
                          <td>{p.penalty.toFixed(3)}</td>
                        </tr>
                      ))}
                      {r.best.hourglass_penalty > 0 && (
                        <tr className="hourglass-row">
                          <td>hourglass gap</td>
                          <td colSpan={5}>
                            <em>
                              Waist gap is wider than one or more non-waist gaps
                              — reverse-gap shape. Penalized.
                            </em>
                          </td>
                          <td>{r.best.hourglass_penalty.toFixed(3)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>

                  {otherVariants.length > 0 && (
                    <div className="variant-list">
                      <strong>
                        Other variants of {r.corset.id}
                        <span className="count"> ({otherVariants.length})</span>
                      </strong>
                      <ul className="variant-rows">
                        {otherVariants.map((vb) => (
                          <li key={vb.variant.url} className="variant-row">
                            <span
                              className={`stretch stretch-${vb.variant.stretch_class}`}
                            >
                              {vb.variant.stretch_class}
                            </span>
                            <span className="variant-name">
                              {vb.variant.name}
                            </span>
                            <span className="variant-materials">
                              {vb.variant.materials.join(', ') || '—'}
                            </span>
                            <span className="best-size">
                              size {vb.best_size_in}"
                            </span>
                            <span className="score">
                              score {vb.total.toFixed(2)}
                            </span>
                            <a
                              href={vb.variant.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              buy ↗
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
