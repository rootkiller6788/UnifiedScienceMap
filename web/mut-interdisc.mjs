// 变异测试：把 interdisc-matrix.js 逐条改坏，确认 check-interdisc.mjs 真的会红。
// 全绿的测试套件什么都没证明，直到你见过它变红。
//
//     node mut-interdisc.mjs
//
// 每条变异体的锚点必须**恰好命中一次**，否则算 SKIP（锚点烂了 = 这条变异体没被真正试过）。
// 退出码非 0 表示有 missed / crash-only / skipped。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WEB = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(WEB, 'interdisc-matrix.js');
const CHECK = path.join(WEB, 'check-interdisc.mjs');
const TMP = path.join(process.env.TEMP || '/tmp', 'interdisc-matrix-mutant.js');

const MUTANTS = [
  // ---- 矩阵本体（对称性 / 双通道编码）
  ['matrix not mirrored (rows after the first under-count in the marginals)',
   '      for (let j = i + 1; j < D; j++) shared[j * D + i] = shared[i * D + j];\n',
   ''],
  ['shared itself fudged (not what the arcs say)',
   'const s = shared[i * D + j];\n        sumShared += s;',
   'const s = shared[i * D + j] + (i === 0 ? 1 : 0);\n        sumShared += s;'],
  ['inset square area linear in shared instead of sqrt (area no longer ∝ shared)',
   'const side = CELL * 0.66 * Math.sqrt(der.maxShared ? s / der.maxShared : 0);',
   'const side = CELL * 0.66 * (der.maxShared ? s / der.maxShared : 0);'],
  ['inset square constant (the second channel goes dead)',
   'const side = CELL * 0.66 * Math.sqrt(der.maxShared ? s / der.maxShared : 0);',
   'const side = CELL * 0.5;'],
  ['cell fill stops encoding jaccard (constant alpha)',
   'return `rgba(${SEQ_RGB},${(0.05 + 0.42 * t).toFixed(4)})`;',
   'return `rgba(${SEQ_RGB},0.30)`;'],
  ['cell fill rescales to the current data (range not fixed)',
   'const t = Math.min(1, j / (der ? der.maxJ : 1));',
   'const t = Math.min(1, j / (der ? der.maxJ * 1.02 : 1));'],
  ['diagonal drawn as if it were a pair (uses shared instead of own topic count)',
   'g.cells.push({ r, c, i, j, x, y, diag: true, value: der.topics[i] });',
   'g.cells.push({ r, c, i, j, x, y, diag: false, value: der.topics[i], shared: 0, jacc: 0, side: 0, inx: x, iny: y });'],

  // ---- 两条边际
  ['INWARD denominator collapses to topics_i (the two marginals become one number)',
   'inward[i] = rest ? rowSum[i] / rest : 0;',
   'inward[i] = topics[i] ? rowSum[i] / topics[i] : 0;'],
  ['OUTWARD drops the 10 × (off by a factor of the discipline count)',
   'outward[i] = topics[i] ? rowSum[i] / ((D - 1) * topics[i]) : 0;',
   'outward[i] = topics[i] ? rowSum[i] / topics[i] : 0;'],
  ['marginal bars stop being proportional (constant length)',
   'const bh = Math.max(1, OUTBAR * Math.min(1, v));',
   'const bh = OUTBAR * 0.5;'],

  // ---- 聚类
  ['clustering order replaced by the identity (rows no longer derived from the data)',
   'return { order, merges, root };',
   'return { order: Array.from({ length: n }, (_, i) => i), merges, root };'],
  ['clustering distance flipped (farthest pairs merge first)',
   'const dist = (i, j) => 1 - jacc[i * D + j];',
   'const dist = (i, j) => jacc[i * D + j];'],
  ['merge heights no longer monotone (dendrogram geometry breaks)',
   'seg.push({ a: cl, b: cr, h, ah: heightOf(m.left), bh: heightOf(m.right),',
   'seg.push({ a: cl, b: cr, h: 1 - h, ah: heightOf(m.left), bh: heightOf(m.right),'],

  // ---- L1 铺满
  ['run merging disabled (one rect per row: still tiles, but the count explodes)',
   'while (k2 + 1 < end && bucketOf(f.rows[k2 + 1], f) === bucket) k2++;',
   ''],
  ['run off by one row (a gap opens in every column)',
   'y: oy + headH + (k - start), w: CELL1, h: (k2 - k + 1),',
   'y: oy + headH + (k - start), w: CELL1, h: (k2 - k + 1) - 1,'],
  ['runs shifted by one column (every run lands in the wrong discipline)',
   'c, x: gridX + c * CELL1, y: oy + headH + (k - start),',
   'c, x: gridX + (c + 1) * CELL1, y: oy + headH + (k - start),'],
  ['L1 row count no longer the pair\'s shared count (drops the last row)',
   'const end = Math.min(f.rows.length, start + perPage);',
   'const end = Math.min(f.rows.length - 1, start + perPage);'],

  // ---- 状态机
  ['back key jumps straight to L0 (skips a level)',
   'if (level === 2) { level = 1; termIdx = -1; }',
   'if (level === 2) { level = 0; termIdx = -1; pair = null; }'],
  ['back key does nothing at all',
   'function back() {\n    // 逐级退回',
   'function back() {\n    if (1) return;\n    // 逐级退回'],
  ['drill-down forgets to call onChange (the host never repaints)',
   'function after() { geo = null; onChange(); }',
   'function after() { geo = null; }'],
  ['cell click drops the pair orientation (L1 opens the wrong pair)',
   'else { pair = [h.i, h.j]; level = 1; page = 0; termIdx = -1; }',
   'else { pair = [h.j, h.i]; level = 1; page = 0; termIdx = -1; }'],
  ['pixel pick off by one row (hover names the neighbour)',
   'const k = Math.floor((wy - p.y) / PIX) + p.start;',
   'const k = Math.floor((wy - p.y) / PIX) + p.start + 1;'],

  // ---- 契约
  ['getCounts stops reporting the discipline count',
   'disciplineCount: der.nD,',
   'disciplineCount: 0,'],
  ['legend row click stops calling onChange',
   'pinned = sameTarget(pinned, h) ? null : h;\n        renderLegend(el);\n        after();',
   'pinned = sameTarget(pinned, h) ? null : h;\n        renderLegend(el);'],
  ['legend no longer names the OUTWARD denominator',
   '<b>OUTWARD</b> (top) = Σ shared / (10 × topics)',
   '<b>OUTWARD</b> (top) = a share of everything'],
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
      env: { ...process.env, INTERDISC_MATRIX: TMP }, encoding: 'utf8', stdio: 'pipe',
    });
  } catch (e) {
    code = e.status; out = (e.stdout || '') + (e.stderr || '');
  }
  const failLines = out.split('\n').filter((l) => l.trim().startsWith('FAIL ')).length;
  const m = out.match(/(\d+) checks passed, (\d+) FAILED/);
  if (code === 0) { missed++; console.log(`MISSED ${name}`); }
  else if (failLines === 0) { crash++; console.log(`CRASH  ${name}  (exit ${code}, 0 parsed failures) ${out.split('\n').filter((l) => l.includes('Error')).slice(0, 1)}`); }
  else { caught++; console.log(`caught ${name}  -> ${m ? m[2] : '?'} failures`); }
}

console.log(`\n${caught} caught, ${missed} missed, ${crash} crash-only, ${skipped} skipped`);
process.exit(missed || crash || skipped ? 1 : 0);
