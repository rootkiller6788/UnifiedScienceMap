// mut-evolution.mjs — 变异测试：把 knowledge-strata 的几何一条条改坏，看 check-evolution.mjs 抓不抓得住。
//
//     node mut-evolution.mjs
//
// 每个变异是一个 [名字, 原文, 改后] 三元组。**原文必须精确命中一次**，否则 SKIP ——
// 命中不到就说明这份代码已经漂移，那条变异其实什么都没测。
//
// 判据：harness 的 stdout 里出现 `FAIL ` 行 = caught；退出码非 0 但没有 FAIL 行 = crash
// （坏得太厉害，连报错的路都走不到，不算抓住）；退出码 0 = missed（测试是瞎的）。
// 任何 missed / crash / skipped 都会让本脚本非 0 退出。
//
// 这里每一条都对应一个"看起来能跑、图也画得出来，但读数全错"的改法 ——
// 那种 bug 不会崩，只会安静地说谎。

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SRC = new URL('./evolution-strata.js', import.meta.url);
const CHART = readFileSync(SRC, 'utf8');
const HARNESS = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'check-evolution.mjs');
const TMP = path.join(tmpdir(), 'evolution-mutant.js');

const MUTANTS = [
  ['linear width instead of √',
   'half[t] = maxHalf * Math.sqrt(maxTotal ? totals[t] / maxTotal : 0);',
   'half[t] = maxHalf * (maxTotal ? totals[t] / maxTotal : 0);'],

  ['normalise by the classified sum, not the total',
   'const total = totals[t] || 1;',
   'const total = (totals[t] - (data.unclassifiedByYear[st.T0 + t] || 0)) || 1;'],

  ['Unclassified loses its own band',
   "kind: 'unclassified', color: AGGREGATE.unclassified,",
   "kind: 'other', color: AGGREGATE.unclassified,"],

  ['Unclassified is added into Other as well (counted twice)',
   'const otherValues = new Float64Array(T);',
   'const otherValues = new Float64Array(T);\n    for (let t = 0; t < T; t++) otherValues[t] += data.unclassifiedByYear[st.T0 + t] || 0;'],

  ['draw 2025 and 2026 anyway',
   'const T1 = data.years.indexOf(meta.riverLastYear);\n    if (T0 < 0 || T1 < T0) return null;',
   'const T1 = data.years.length - 1;\n    if (T0 < 0 || T1 < T0) return null;'],

  ['fault threshold 0 — every year is a fault',
   'const FAULT_Q = 0.90;',
   'const FAULT_Q = 0;'],

  ['fault threshold 1 — nothing is ever a fault',
   'const FAULT_Q = 0.90;',
   'const FAULT_Q = 1;'],

  ['band width from the absolute count, not the share',
   'x += (b.values[t] / total) * 2 * half[t];',
   'x += b.values[t];'],

  ['pick relabels an absolute count as a share',
   'share: total ? count / total : 0,',
   'share: count,'],

  ['pick forgets the year (two years compare equal)',
   "if (a.type === 'band') return a.key === b.key && a.year === b.year;",
   "if (a.type === 'band') return a.key === b.key;"],

  // 注意这条必须落在 draw 里，不能落在 layout 里 —— layout 按尺寸缓存，
  // 放在那里的抖动一辈子只算一次，测出来仍然是"确定"的（这一条最初就因此漏网）。
  ['vertices jitter between draws',
   '      p.moveTo(b.xl[0], g.yOfBot(0));',
   '      p.moveTo(b.xl[0], g.yOfBot(0) + Math.random() * 0.5);'],

  ['fault runs are never merged into segments',
   'if (last && last.t1 === t - 1) last.t1 = t;',
   'if (last && false) last.t1 = t;'],

  ['low-n floor disabled — noise sold as history',
   'const LOW_N_VOL = 100000;',
   'const LOW_N_VOL = 0;'],

  ['bands re-sorted by size inside each year (uplift becomes invisible)',
   '      for (let i = 0; i < bands.length; i++) {',
   '      for (const i of bands.map((b, j) => j).sort((p, q) => bands[q].values[t] - bands[p].values[t])) {'],

  ['legend hard-codes the linear-scale width instead of computing it',
   '      + `<b>${firstLinPx} px</b> wide — a hairline; measured against this window, `',
   "      + '<b>0.84 px</b> wide — a hairline; measured against this window, '"],

  // 下面三条是带名字的落位。这类 bug 画得出图、读数也全对，只有"名字跑到画面外"
  // 或者"叠成一团"看得见 —— 起初就是靠截图才发现的（1280 宽时 Unclassified 被切掉）。
  ['band labels are never pulled back inside the world box',
   '      if (!fits(at)) {',
   '      if (false) {'],

  ['band labels shrink the font to fit — removed, so the row drops names instead',
   '      const next = Math.max(FONT_LABEL * 0.72, size * span / rowWidth(items));',
   '      const next = size;'],

  ['band labels are placed without keeping neighbours apart',
   '          c = l + items[i].w + gap;',
   '          c = l + items[i].w * 0.4 + gap;'],
];

let caught = 0, missed = 0, crashed = 0, skipped = 0;

for (const [name, from, to] of MUTANTS) {
  const hits = CHART.split(from).length - 1;
  if (hits !== 1) {
    skipped++;
    console.log(`SKIP     ${name}  (anchor matches ${hits} times, expected 1)`);
    continue;
  }
  writeFileSync(TMP, CHART.replace(from, to), 'utf8');

  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, [HARNESS], {
      env: { ...process.env, EVOLUTION_CHART: TMP },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    out = `${e.stdout || ''}${e.stderr || ''}`;
    code = e.status === undefined || e.status === null ? 1 : e.status;
  }

  const failed = out.split('\n').filter((l) => l.includes('FAIL ')).length;
  if (failed > 0) {
    caught++;
    console.log(`caught   ${name}  (${failed} ${failed === 1 ? 'check' : 'checks'})`);
  } else if (code !== 0) {
    crashed++;
    console.log(`CRASH    ${name}  (exit ${code}, no FAIL line — the harness died instead of judging)`);
  } else {
    missed++;
    console.log(`MISSED   ${name}  (harness still reports success)`);
  }
}

console.log('');
console.log(`SUMMARY  caught=${caught}  missed=${missed}  crash-only=${crashed}  skipped=${skipped}`);
process.exit(missed || crashed || skipped ? 1 : 0);
