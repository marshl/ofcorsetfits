/**
 * Ranked list — one row per VARIANT GROUP (silhouette + fit signature).
 * A group is 1+ SKUs sharing the same stretch class + material composition:
 * they differ only by fabric color / decorative flourishes, which don't
 * affect fit, so they get one shared row with multiple buy links.
 *
 * Expanding a row shows the per-position penalty breakdown for the group's
 * canonical variant, all group members' buy links, and a cross-reference
 * to any OTHER fit-signature groups of the same silhouette.
 */

import { useState } from 'react';
import type { RankedResult, VariantGroup } from '../scoring/types.ts';

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

function groupSignatureKey(g: VariantGroup): string {
  return g.variants[0].url;
}

/** Unique key per row: silhouette + group's canonical URL. */
function rowKey(r: RankedResult): string {
  return `${r.corset.id}::${groupSignatureKey(r.variant_group)}`;
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
          ({shown.length} of {results.length} shown — variants with the same
          material are grouped)
        </span>
      </h2>
      <ol className="ranked-rows">
        {shown.map((r, i) => {
          const key = rowKey(r);
          const isExpanded = expandedKey === key;
          const stretch = r.best.variant.stretch_class;
          const group = r.variant_group;
          const otherGroups = r.all_groups.filter(
            (g) => groupSignatureKey(g) !== groupSignatureKey(group),
          );
          const memberCount = group.variants.length;
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
                <span className="corset-name">
                  {r.best.variant.name}
                  {memberCount > 1 && (
                    <span className="group-count"> +{memberCount - 1} colors</span>
                  )}
                </span>
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
                      <strong>Materials:</strong>{' '}
                      {r.best.variant.materials.join(', ') || '(unspecified)'}
                      {' — '}
                      <em>stretch class: {stretch}</em>
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

                  <div className="variant-list">
                    <strong>
                      Buy this fit ({memberCount}{' '}
                      {memberCount === 1 ? 'option' : 'color options — same fit'})
                    </strong>
                    <ul className="variant-rows">
                      {group.variants.map((v) => (
                        <li key={v.url} className="variant-row variant-row-grouped">
                          <span className="variant-name">{v.name}</span>
                          <a
                            href={v.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            buy on mysticcitycorsets.com ↗
                          </a>
                        </li>
                      ))}
                    </ul>
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

                  {otherGroups.length > 0 && (
                    <div className="variant-list">
                      <strong>
                        Other materials of {r.corset.id}
                        <span className="count"> ({otherGroups.length})</span>
                      </strong>
                      <ul className="variant-rows">
                        {otherGroups.map((g) => (
                          <li key={groupSignatureKey(g)} className="variant-row">
                            <span
                              className={`stretch stretch-${g.variants[0].stretch_class}`}
                            >
                              {g.variants[0].stretch_class}
                            </span>
                            <span className="variant-name">
                              {g.variants[0].name}
                              {g.variants.length > 1 && (
                                <span className="group-count">
                                  {' '}+{g.variants.length - 1} colors
                                </span>
                              )}
                            </span>
                            <span className="variant-materials">
                              {g.variants[0].materials.join(', ') || '—'}
                            </span>
                            <span className="best-size">
                              size {g.best_size_in}"
                            </span>
                            <span className="score">
                              score {g.total.toFixed(2)}
                            </span>
                            <a
                              href={g.variants[0].url}
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
