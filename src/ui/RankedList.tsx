/**
 * Ranked list — one row per (variant group × waist size). A variant group
 * collapses SKUs that share stretch class (same fit math, different color /
 * decorative flourishes); each size the group is offered in produces its
 * own row so a silhouette can show up multiple times at different sizes if
 * multiple sizes score competitively.
 *
 * Expanding a row shows the per-position penalty breakdown at that specific
 * size, all group members' buy links pre-selected to that size, and a
 * cross-reference to sibling fit-signature groups of the same silhouette
 * (typically different stretch classes).
 */

import { useEffect, useState } from 'react';
import type { GapShape, RankedResult, VariantGroup } from '../scoring/types.ts';

const GAP_SHAPE_LABELS: Record<GapShape, { glyph: string; name: string }> = {
  curved: { glyph: ')(', name: 'curved (pinched at waist)' },
  straight: { glyph: '||', name: 'parallel' },
  'slant-hip': { glyph: '/\\', name: 'slanted, wider at hip' },
  'slant-rib': { glyph: '\\/', name: 'slanted, wider at rib' },
  closed: { glyph: '|', name: 'fully closed' },
};

/**
 * Short vendor code for the brand pill on each row header. Falls back
 * to the first three letters of the brand name when we haven't seen
 * this vendor before — better than nothing, and prompts an update here.
 */
function brandShortCode(brand: string | undefined): string {
  if (!brand) return '';
  if (brand.startsWith('Mystic City')) return 'MCC';
  if (brand.startsWith('Timeless Trends')) return 'TT';
  return brand.slice(0, 3).toUpperCase();
}

/** Kebab-case slug for the CSS modifier class on the brand pill. */
function brandSlug(brand: string | undefined): string {
  if (!brand) return 'unknown';
  return brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

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

/** Unique key per row: silhouette + group's canonical URL + row size. */
function rowKey(r: RankedResult): string {
  return `${r.corset.id}::${groupSignatureKey(r.variant_group)}::${r.best.waist_size_in}`;
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
  // WooCommerce (MCC): `?attribute_pa_size=N` pre-selects the dropdown.
  // Shopify (TT): pre-selecting a variant needs `?variant=<numeric-id>`,
  // which we don't carry in the catalog — bare URL is the honest link,
  // and the size dropdown is right at the top of the product page anyway.
  // Any other host: leave alone.
  const isWooCommerce = /mysticcitycorsets\.com$/.test(hostnameOf(url));
  if (!isWooCommerce) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}attribute_pa_size=${size}`;
}

/**
 * Return "mysticcitycorsets.com" from any product URL on that host so the
 * "buy on X" link text reflects the actual vendor. Falls back to the raw
 * URL string if parsing fails (bad URL / non-http scheme).
 */
function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Max score difference within a tier. Rows whose scores are within this
 * much of the tier's anchor row share a tier. Set small enough that a
 * tier really means "practically equivalent picks"; larger and the top-N
 * would collapse into one huge first tier.
 */
const TIER_THRESHOLD = 0.3;

/**
 * Assign a 1-based tier index to each row so consecutive rows within
 * `TIER_THRESHOLD` of the tier's anchor score share a tier. Tier numbers
 * are dense (1, 2, 3, …), not competition-ranked — the tier IS the "rank"
 * shown in the UI, and only the tier's first row displays it.
 *
 * The anchor is the tier's first row, NOT the previous row, so transitive
 * drift can't string together an unbounded tier via 0.29-pt hops.
 */
function assignTiers(rows: { best: { total: number } }[]): number[] {
  const tiers: number[] = new Array(rows.length);
  if (rows.length === 0) return tiers;
  let anchorScore = rows[0].best.total;
  let currentTier = 1;
  tiers[0] = 1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].best.total - anchorScore <= TIER_THRESHOLD) {
      tiers[i] = currentTier;
    } else {
      currentTier += 1;
      anchorScore = rows[i].best.total;
      tiers[i] = currentTier;
    }
  }
  return tiers;
}

export function RankedList({
  results,
  topN = 30,
  showAdvanced,
  onShowAdvancedChange,
}: RankedListProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const shown = results.slice(0, topN);
  const tiers = assignTiers(shown);

  // Close the algorithm-details modal on Escape. Registered globally so
  // the user doesn't have to click into the modal to make the key work.
  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHelpOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [helpOpen]);

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
            ({shown.length} of {results.length} shown — one row per
            available size; color variants with the same stretch class
            are grouped)
          </span>
        </h2>
        <div className="advanced-toggle-row">
          <label className="advanced-toggle">
            <input
              type="checkbox"
              checked={showAdvanced}
              onChange={(e) => onShowAdvancedChange(e.target.checked)}
            />
            <span>Show algorithm details (weight, penalty)</span>
          </label>
          <button
            type="button"
            className="help-button"
            aria-label="How does the algorithm work?"
            title="How does the algorithm work?"
            onClick={() => setHelpOpen(true)}
          >
            ?
          </button>
        </div>
      </div>

      {helpOpen && (
        <div
          className="help-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-modal-title"
          onClick={(e) => {
            // Click on the backdrop itself (not the modal content) closes.
            if (e.target === e.currentTarget) setHelpOpen(false);
          }}
        >
          <div className="help-modal">
            <button
              type="button"
              className="help-modal-close"
              aria-label="Close"
              onClick={() => setHelpOpen(false)}
            >
              ×
            </button>
            <h3 id="help-modal-title">How the fit score is computed</h3>

            <p>
              Every corset in the catalog is a set of circumferences at
              landmarks along the torso — waist, underbust (rib), upper hip,
              and sometimes low hip — plus how far above or below the waist
              each landmark sits. Your body is described the same way. For
              every <em>(silhouette × stretch class × available size)</em>{' '}
              combination, the algorithm scores how well the corset would
              contour to your body. <strong>Lower total = better fit</strong>.
            </p>

            <h4>Waist</h4>
            <p>
              The corset is compared against your{' '}
              <em>target waist</em> — your natural waist minus the reduction
              you've asked for. A corset that <strong>can't close small
              enough</strong> to reach that target is penalized harshly
              (unusable for its intended reduction). A corset that closes
              smaller than the target gets only a mild penalty — you just
              gap-lace it open to hit the target.
            </p>

            <h4>Non-waist landmarks (rib, hip)</h4>
            <p>
              Each landmark's penalty is asymmetric: a corset that runs{' '}
              <strong>loose</strong> at rib or hip (floats over the body,
              doesn't contour → negative gap in the display) is penalized{' '}
              <strong>more heavily</strong> than one that runs a bit tight
              (closes a bit small there → wider lacing gap at that landmark).
              Rationale: a floating corset can't be fixed by gap-lacing;
              running tight just means a slightly wider gap where the corset
              closes short of the body.
            </p>
            <p className="help-aside">
              Exception: for <strong>cupped-rib</strong> silhouettes, both
              directions of underbust misfit are penalized equally — the
              design intent is to cup the rib, not compress or flare away
              from it.
            </p>

            <h4>Lacing gap shape</h4>
            <p>
              You check off which gap shapes you'd wear:{' '}
              <span className="glyph">)(</span> curved (pinched at waist),{' '}
              <span className="glyph">||</span> parallel,{' '}
              <span className="glyph">/\</span> slanted-wider-at-hip,{' '}
              <span className="glyph">\/</span> slanted-wider-at-rib, or{' '}
              <span className="glyph">|</span> fully closed. Each corset is
              scored under <em>every</em> shape you accept and takes its
              best score. The winning shape shows on each row's badge.
            </p>
            <p className="help-aside">
              In curved mode only, an additional penalty fires if the corset
              would leave a wider gap at the <em>waist</em> than at rib or
              hip — the "hourglass gap" reverse shape, which corsets are
              built to prevent.
            </p>

            <h4>Stretch class</h4>
            <p>
              Every variant is classified <em>low</em>, <em>medium</em>, or{' '}
              <em>high</em> stretch based on materials. Higher stretch means
              the corset closes to a larger effective waist than its nominal
              size — a slack allowance the algorithm folds into the waist
              math. Use the sidebar's stretch filter to hide classes you're
              not interested in.
            </p>

            <h4>Rows, tiers, and grouping</h4>
            <p>
              Every distinct <em>(silhouette, stretch class, size)</em>{' '}
              combination gets its own row. Color variants that share the
              same stretch class collapse into a single row (identical fit
              math — different fabric, same numbers). Rows are grouped into{' '}
              <strong>tiers</strong>: consecutive rows within 0.3 points of
              the tier's leader share a tier number, so you can see at a
              glance which picks are practically equivalent.
            </p>

            <h4>Buying</h4>
            <p>
              Each row shows a buy link per color variant, pointing at the
              vendor's product page. For Mystic City the size is pre-selected
              via URL; Timeless Trends uses a different variant-URL scheme,
              so its links land on the product page and you pick the size
              from the dropdown yourself.
            </p>
          </div>
        </div>
      )}
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
          const isTierLeader = i === 0 || tiers[i] !== tiers[i - 1];
          return (
            <li
              key={key}
              className={
                `ranked-row ranked-row-${stretch}` +
                (isTierLeader ? ' tier-leader' : ' tier-follower')
              }
            >
              <button
                type="button"
                className="ranked-row-header"
                onClick={() => setExpandedKey(isExpanded ? null : key)}
                aria-expanded={isExpanded}
              >
                <span className="rank">{isTierLeader ? tiers[i] : ''}</span>
                <span className="corset-id">
                  {r.corset.brand && (
                    <span
                      className={`brand-tag brand-tag-${brandSlug(r.corset.brand)}`}
                      title={r.corset.brand}
                    >
                      {brandShortCode(r.corset.brand)}
                    </span>
                  )}
                  {r.corset.id}
                </span>
                <span className="corset-name">
                  {r.best.variant.name}
                  {memberCount > 1 && (
                    <span className="group-count"> +{memberCount - 1} variants</span>
                  )}
                </span>
                <span className={`stretch stretch-${stretch}`}>{stretch}</span>
                <span className="best-size">size {r.best.waist_size_in}"</span>
                <span className="silhouette">{r.corset.silhouette_category}</span>
                <span
                  className={`gap-shape gap-shape-${r.best.gap_shape}`}
                  title={`Scored best as ${GAP_SHAPE_LABELS[r.best.gap_shape].name}`}
                >
                  {GAP_SHAPE_LABELS[r.best.gap_shape].glyph}
                </span>
                <span className="score">score {r.best.total.toFixed(2)}</span>
                <span className="expand">{isExpanded ? '▼' : '▶'}</span>
              </button>

              {isExpanded && (
                <div className="ranked-row-details">
                  <div className="detail-meta">
                    {r.corset.brand && (
                      <div>
                        <strong>Brand:</strong>{' '}
                        {r.corset.brand_url ? (
                          <a
                            href={r.corset.brand_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {r.corset.brand}
                          </a>
                        ) : (
                          r.corset.brand
                        )}
                      </div>
                    )}
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
                      {r.corset.body_length_in !== null
                        ? `${r.corset.body_length_in}"`
                        : 'unknown'}
                    </div>
                    <div>
                      <strong>Best gap shape:</strong>{' '}
                      {GAP_SHAPE_LABELS[r.best.gap_shape].glyph}{' '}
                      {GAP_SHAPE_LABELS[r.best.gap_shape].name}
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
                              buy on {hostnameOf(v.url)}
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
