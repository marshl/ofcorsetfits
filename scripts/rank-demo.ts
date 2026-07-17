/**
 * Demo: rank the Mystic City catalog for a synthetic body profile
 * and print the top 10 results, plus one detailed breakdown.
 *
 * Run: `npm run demo`
 * Edit the `body` and `config` below to try different scenarios.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { rank, defaultScoringConfig } from '../src/scoring/index.ts';
import type { Body, Catalog } from '../src/scoring/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = resolve(__dirname, '../catalog/mystic-city.json');

const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf-8')) as Catalog;

const body: Body = {
  natural_waist_in: 28,
  underbust: { circumference_in: 32, position_in: -5 },
  upper_hip: { circumference_in: 34, position_in: 4 },
  iliac: { circumference_in: 38, position_in: 7 },
};

const config = defaultScoringConfig(catalog);
// Uncomment to filter by stretch preference:
// config.stretch_preference = 'low';

const results = rank(body, catalog, config);

console.log(`Body: ${JSON.stringify(body)}`);
console.log(`Ranked ${results.length} corsets. Top 10:\n`);

const pad = (s: string, w: number) => s.padEnd(w);
console.log(pad('rank', 5), pad('id', 12), pad('score', 8), pad('variant (stretch)', 30), pad('best size', 10), pad('silhouette', 14));
console.log('-'.repeat(90));
for (let i = 0; i < Math.min(10, results.length); i++) {
  const r = results[i];
  const variantLabel = `${r.best.variant.name} (${r.best.variant.stretch_class})`;
  console.log(
    pad(String(i + 1), 5),
    pad(r.corset.id, 12),
    pad(r.best.total.toFixed(3), 8),
    pad(variantLabel.slice(0, 28), 30),
    pad(String(r.best.waist_size_in) + '"', 10),
    pad(r.corset.silhouette_category, 14),
  );
}

console.log('\n--- Top result — position-by-position breakdown ---');
const top = results[0];
console.log(`${top.corset.id} — ${top.corset.name}`);
console.log(`  size ${top.best.waist_size_in}", variant: ${top.best.variant.name} (${top.best.variant.stretch_class})`);
console.log(`  waist penalty: ${top.best.waist_penalty.toFixed(3)}`);
for (const p of top.best.position_results) {
  const diff = p.diff_in === null ? 'n/a' : `${p.diff_in > 0 ? '+' : ''}${p.diff_in.toFixed(2)}`;
  const userC = p.user_circumference_in === null ? 'n/a' : p.user_circumference_in.toFixed(2);
  console.log(
    `  ${pad(p.label ?? '(no label)', 30)}  ` +
    `corset ${p.corset_circumference_in.toFixed(1)}"  ` +
    `body ${pad(userC + '"', 8)}  ` +
    `diff ${pad(diff, 8)}  ` +
    `penalty ${p.penalty.toFixed(3)}`,
  );
}
