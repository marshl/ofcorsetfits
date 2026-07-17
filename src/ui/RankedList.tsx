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
  showAdvanced: boolean;
  onShowAdvancedChange: (value: boolean) => void;
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

/**
 * Build a product-page URL with WooCommerce's `attribute_pa_size` query
 * parameter set so the size dropdown is pre-selected when the user clicks
 * through. Only appends the param if the variant actually offers that size —
 * pre-selecting an unavailable size would show "invalid selection" on MCC's
 * page.
 */
function buyUrlWithSize(
  url: string,
  size: number,
  variantSizes: number[],
): string {
  if (!variantSizes.includes(size)) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}attribute_pa_size=${size}`;
}

export function RankedList({
  results,
  topN = 30,
  showAdvanced,
  onShowAdvancedChange,
}: RankedListProps) {
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
      <div className="ranked-list-header">
        <h2>
          Best fits{' '}
          <span className="count">
            ({shown.length} of {results.length} shown — variants with the
            same stretch class are grouped)
          </span>
        </h2>
        <label className="advanced-toggle">
          <input
            type="checkbox"
            checked={showAdvanced}
            onChange={(e) => onShowAdvancedChange(e.target.checked)}
          />
          <span>Show algorithm details (weight, penalty)</span>
        </label>
      </div>
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
                    <span className="group-count"> +{memberCount - 1} variants</span>
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
                      {memberCount === 1 ? 'option' : 'variants — same fit'})
                    </strong>
                    <ul className="variant-rows">
                      {group.variants.map((v) => {
                        const offersBestSize = v.waist_sizes_in.includes(
                          r.best.waist_size_in,
                        );
                        const isUnbuyable = v.waist_sizes_in.length === 0;
                        const href = buyUrlWithSize(
                          v.url,
                          r.best.waist_size_in,
                          v.waist_sizes_in,
                        );
                        return (
                          <li key={v.url} className="variant-row variant-row-grouped">
                            <span className="variant-name">
                              {v.name}
                              {!offersBestSize && !isUnbuyable && (
                                <span className="size-note">
                                  {' '}(no size {r.best.waist_size_in}" —
                                  offers {v.waist_sizes_in.join(', ')})
                                </span>
                              )}
                              {isUnbuyable && (
                                <span className="size-note unbuyable">
                                  {' '}(no sizes currently listed — may be out of stock)
                                </span>
                              )}
                            </span>
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              buy on mysticcitycorsets.com
                              {offersBestSize && (
                                <> (size {r.best.waist_size_in}")</>
                              )}
                              {' '}↗
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <table className="score-breakdown">
                    <thead>
                      <tr>
                        <th>Position</th>
                        <th>Corset</th>
                        <th>Body</th>
                        <th>Gap</th>
                        {showAdvanced && <th>Weight</th>}
                        {showAdvanced && <th>Penalty</th>}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          waist{' '}
                          <span className="waist-size-hint">
                            (size {r.best.waist_size_in}")
                          </span>
                        </td>
                        <td>{r.best.effective_waist_in.toFixed(1)}"</td>
                        <td>{r.best.target_waist_in.toFixed(1)}"</td>
                        <td>{formatDiff(r.best.waist_gap_in)}</td>
                        {showAdvanced && <td>—</td>}
                        {showAdvanced && <td>{r.best.waist_penalty.toFixed(3)}</td>}
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
                          <td>{formatDiff(p.actual_gap_in)}</td>
                          {showAdvanced && <td>{p.weight.toFixed(1)}</td>}
                          {showAdvanced && <td>{p.penalty.toFixed(3)}</td>}
                        </tr>
                      ))}
                      {r.best.hourglass_penalty > 0 && (
                        <tr className="hourglass-row">
                          <td>hourglass gap</td>
                          <td colSpan={showAdvanced ? 4 : 3}>
                            <em>
                              Waist gap is wider than one or more non-waist gaps
                              — reverse-gap shape. Penalized.
                            </em>
                          </td>
                          {showAdvanced && (
                            <td>{r.best.hourglass_penalty.toFixed(3)}</td>
                          )}
                        </tr>
                      )}
                    </tbody>
                  </table>

                  {otherGroups.length > 0 && (
                    <div className="variant-list">
                      <strong>
                        Other stretch options for {r.corset.id}
                        <span className="count"> ({otherGroups.length})</span>
                      </strong>
                      <ul className="variant-rows">
                        {otherGroups.map((g) => {
                          const rep = g.variants[0];
                          const href = buyUrlWithSize(
                            rep.url,
                            g.best_size_in,
                            rep.waist_sizes_in,
                          );
                          return (
                            <li key={groupSignatureKey(g)} className="variant-row">
                              <span
                                className={`stretch stretch-${rep.stretch_class}`}
                              >
                                {rep.stretch_class}
                              </span>
                              <span className="variant-name">
                                {rep.name}
                                {g.variants.length > 1 && (
                                  <span className="group-count">
                                    {' '}+{g.variants.length - 1} colors
                                  </span>
                                )}
                              </span>
                              <span className="variant-materials">
                                {rep.materials.join(', ') || '—'}
                              </span>
                              <span className="best-size">
                                size {g.best_size_in}"
                              </span>
                              <span className="score">
                                score {g.total.toFixed(2)}
                              </span>
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                buy ↗
                              </a>
                            </li>
                          );
                        })}
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
