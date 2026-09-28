// 变异测试：把 evolution-river.js 逐条改坏，确认 check-river.mjs 真的会红。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WEB = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(WEB, 'evolution-river.js');
const CHECK = path.join(WEB, 'check-river.mjs');
const TMP = path.join(process.env.TEMP || '/tmp', 'river-mutant.js');

const MUTANTS = [
  ['drop the largest discipline band',
   'top8.forEach((id, i) => {', 'top8.slice(1).forEach((id, i) => {'],
  ['normalise by classified works instead of total',
   'const total = totals[t] || 1;', 'const total = data.sumFieldsByYear[T0 + t] || 1;'],
  ['fold unclassified into the stack as zero',
   'values: Float64Array.from({ length: T }, (_, t) => data.unclassifiedByYear[T0 + t] || 0) });',
   'values: Float64Array.from({ length: T }, () => 0) });'],
  ['draw the excluded (unclassified) years too',
   'const T0 = data.years.indexOf(meta.riverFirstYear);\n    const T1 = data.years.indexOf(meta.riverLastYear);',
   'const T0 = data.years.indexOf(meta.riverFirstYear);\n    const T1 = data.years.indexOf(meta.lastYear);'],
  ['expanded Other double-counts its span',
   "bands.push({ key: '__unclassified__'",
   "bands.push({ key: '__other-group__', kind: 'other', name: 'Other', short: 'Other', color: AGGREGATE.other, values: otherValues });\n    bands.push({ key: '__unclassified__'"],
  ['thickness from raw counts, not shares',
   'const share = b.values[t] / total;', 'const share = b.values[t] / 1e7;'],
  ['legend hedges on splitting and merging',
   '<b>Splitting and merging, no</b>', '<b>Splitting and merging</b>'],
  ['legend drops the excluded-year note',
   'Also excluded: ', 'Also: '],
  ['sameTarget ignores the year',
   "if (a.type === 'band') return a.key === b.key && a.year === b.year;",
   "if (a.type === 'band') return a.key === b.key;"],
  ['bands leave a gap in the stack',
   'b.bot[t] = acc;', 'b.bot[t] = acc - 0.5;'],
  ['stack order reversed internally',
   'let acc = yBottom;\n      for (const b of bands) {',
   'let acc = yBottom;\n      for (const b of [...bands].reverse()) {'],
  ['no year axis',
   'for (let year = Math.ceil(g.years[0] / 25) * 25;', 'for (let year = 1e9;'],
  ['no direct band labels',
   'if (hgt < LABEL_MIN_H) continue;', 'continue;'],
  ['describe reports an unknown band anyway',
   'if (!geo.bands.some((b) => b.key === f.key)) return \'\';', ''],
];

let caught = 0, missed = 0, crash = 0, skipped = 0;
const src = fs.readFileSync(SRC, 'utf8');

for (const [name, from, to] of MUTANTS) {
  const n = src.split(from).length - 1;
  if (n !== 1) { skipped++; console.log(`SKIP   ${name}  (anchor matched ${n} times, need exactly 1)`); continue; }
  fs.writeFileSync(TMP, src.replace(from, to));
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [CHECK], {
      env: { ...process.env, RIVER_CHART: TMP }, encoding: 'utf8', stdio: 'pipe',
    });
  } catch (e) { code = e.status; out = (e.stdout || '') + (e.stderr || ''); }
  const failLines = out.split('\n').filter((l) => l.trim().startsWith('FAIL ')).length;
  const m = out.match(/(\d+) checks passed, (\d+) FAILED/);
  if (code === 0) { missed++; console.log(`MISSED ${name}`); }
  else if (failLines === 0) { crash++; console.log(`CRASH  ${name}  (exit ${code}, 0 parsed failures)`); }
  else { caught++; console.log(`caught ${name}  -> ${m ? m[2] : '?'} failures`); }
}

console.log(`\n${caught} caught, ${missed} missed, ${crash} crash-only, ${skipped} skipped`);
process.exit(missed || crash || skipped ? 1 : 0);
