// 变异测试：把 mycelium.js 逐条改坏，确认 check-mycelium.mjs 真的会红。
// 全绿的测试套件什么都没证明，直到你见过它变红。
//
//     node mut-mycelium.mjs
//
// 每条变异体的锚点必须**恰好命中一次**，否则算 SKIP（锚点烂了 = 这条变异体没被真正试过）。
// 退出码非 0 表示有 missed / crash-only / skipped。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WEB = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(WEB, 'mycelium.js');
const CHECK = path.join(WEB, 'check-mycelium.mjs');
const TMP = path.join(process.env.TEMP || '/tmp', 'mycelium-mutant.js');

const MUTANTS = [
  // ---- 纤维从哪来
  ['each shared topic emits k fibres instead of C(k,2) (double-counts the pairs)',
   '      if (k >= 2) { nF += (k * (k - 1)) / 2; bridging++; }',
   '      if (k >= 2) { nF += k; bridging++; }'],
  ['a fibre\'s endpoints are not disciplines the topic actually belongs to',
   '          fibT[f] = t; fibA[f] = ds[x]; fibB[f] = ds[y];',
   '          fibT[f] = t; fibA[f] = ds[y]; fibB[f] = ds[x];'],

  // ---- 布局
  ['spring target length stops depending on Jaccard (layout no longer from the data)',
   '    const Lt = (i, j) => LMIN + (LMAX - LMIN) * (1 - J[i * D + j] / maxJ);',
   '    const Lt = (i, j) => (LMIN + LMAX) / 2;'],
  ['the module hard-codes the Spearman it prints in the legend',
   '        maxJ: der.maxJ, scale: der.scale, aniso: der.aniso, rho: der.rho,',
   '        maxJ: der.maxJ, scale: der.scale, aniso: der.aniso, rho: -0.73,'],
  ['legend prints a literal Spearman instead of the computed one',
   '弹簧松弛推出（Spearman ${der.rho.toFixed(2)}）—— 共享词汇越多的两个学科`',
   '弹簧松弛推出（Spearman −0.73）—— 共享词汇越多的两个学科`'],

  // ---- 源场 / 端点
  ['fibre origins all collapse to the field centre (a field becomes a point)',
   '      const rr = R[d] * 0.82 * Math.sqrt(unit(h, 16));',
   '      const rr = 0;'],
  ['fibre origins pushed outside the field boundary',
   '      const rr = R[d] * 0.82 * Math.sqrt(unit(h, 16));',
   '      const rr = R[d] * 0.95 * Math.sqrt(unit(h, 16));'],
  ['origins no longer depend on the discipline (every field picks the same spot)',
   '      const h = hash32(Math.imul(t + 1, 0x9e3779b1) ^ Math.imul(d + 1, 0x85ebca6b));',
   '      const h = hash32(Math.imul(t + 1, 0x9e3779b1));'],

  // ---- 走廊
  ['corridor drops the repulsion term (straight lines through whatever is in the way)',
   'const KAPPA = 6;                               // 流场里排斥项的权重',
   'const KAPPA = 0;                               // 流场里排斥项的权重'],
  ['corridor(b,a) is no longer the reverse of corridor(a,b) (two paths for one pair)',
   '  const corridorOf = (C, a, b) => (a < b ? C[a * D + b] : C[b * D + a].slice().reverse());',
   '  const corridorOf = (C, a, b) => (a < b ? C[a * D + b] : C[b * D + a]);'],

  // ---- 束化
  ['beta forced to 0: fibres run straight, nothing bundles',
   '        const beta = Math.sin(Math.PI * u) ** 2 * BUNDLE;',
   '        const beta = 0;'],

  // ---- 渲染
  ['all fibres merged into a single stroke (geometry is right, the density is gone)',
   'const BATCHES = 64;                            // 分批 stroke 的批数（= 累积级数）',
   'const BATCHES = 1;                             // 分批 stroke 的批数（= 累积级数）'],
  ['fibre batches stop using lighter (overlap no longer accumulates)',
   "    c.globalCompositeOperation = 'lighter';",
   "    c.globalCompositeOperation = 'source-over';"],

  // ---- 离屏缓存（不是优化，是可用性：不缓存就是每帧 56 万段）
  ['cache never invalidates (focus or zoom change keeps the stale layer)',
   '    if (layer && layer.key === key) return layer.canvas;',
   '    if (layer) return layer.canvas;'],
  ['oversampling ratio not clamped (blurry below 1×, wasteful above 2×)',
   '    const s = Math.min(2, Math.max(1, dev));',
   '    const s = dev;'],
  ['cache key drops the sampling ratio (a zoom change reuses the wrong resolution)',
   '    const key = `${g.key}|${s.toFixed(4)}|${lw.toFixed(4)}|${W}x${H}`;',
   '    const key = `${g.key}`;'],
  ['focus overlay drawn at a wrong strength (the two passes lose their contrast)',
   '      c.globalAlpha = fp.alpha;',
   '      c.globalAlpha = fp.alpha * 0.4;'],

  // ---- 状态机 / 契约
  ['focus change forgets to call onChange (the host never repaints)',
   '    geo = null;                                  // 聚焦变了 → 批次 path 要重建\n    onChange();',
   '    geo = null;                                  // 聚焦变了 → 批次 path 要重建'],
  ['getCounts stops reporting the fibre count',
   '      disciplineCount: der.nD,\n      fibreCount: der.fibreCount,',
   '      disciplineCount: der.nD,\n      fibreCount: 0,'],
  ['pick always returns the nearest fibre (blank canvas reports a term)',
   '    if (best < 0 || bestD > 12) return null;',
   '    if (best < 0) return null;'],
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
      env: { ...process.env, MYCELIUM: TMP }, encoding: 'utf8', stdio: 'pipe',
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
