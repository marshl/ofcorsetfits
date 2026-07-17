/**
 * Ranked corset list — shows the top N results with a per-corset
 * expandable breakdown of how the score was assembled.
 *
 * Each row has: rank number, corset ID + name, best variant, best size,
 * total score, silhouette category. Clicking a row reveals a table of
 * per-position penalties (waist + each landmark), which is how you
 * understand WHY a corset ranked where it did.
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

export function RankedList({ results, topN = 20 }: RankedListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
        Best fits <span className="count">({shown.length} of {results.length} shown)</span>
      </h2>
      <ol className="ranked-rows">
        {shown.map((r, i) => {
          const isExpanded = expandedId === r.corset.id;
          const stretch = r.best.variant.stretch_class;
          return (
            <li key={r.corset.id} className={`ranked-row ranked-row-${stretch}`}>
              <button
                type="button"
                className="ranked-row-header"
                onClick={() => setExpandedId(isExpanded ? null : r.corset.id)}
                aria-expanded={isExpanded}
              >
                <span className="rank">{i + 1}</span>
                <span className="corset-id">{r.corset.id}</span>
                <span className="corset-name">{r.corset.name}</span>
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
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
