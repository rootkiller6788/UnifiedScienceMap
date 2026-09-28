// 变异测试：把 knowledge-coral.js 逐条改坏，确认 check-coral.mjs 真的会红。
// 全绿的测试套件什么都没证明，直到你见过它变红。
//
//     node mut-coral.mjs
//
// 每条变异体的锚点必须**恰好命中一次**，否则算 SKIP（锚点烂了 = 这条变异体没被真正试过）。
// 退出码非 0 表示有 missed / crash-only / skipped。
//
// 覆盖的是这张图**唯一会骗人**的那几处：粗度不来自权重、平方和守恒被换成线性、
// 颜色不看子树、聚合漏簇、自己那份没清空（权重两头都算）、生长退化成毛虫或糊块、
// 缓存不失效、缓存路径与直画回退不一致、倒过来的朝向、以及契约层说谎。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WEB = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(WEB, 'knowledge-coral.js');
const CHECK = path.join(WEB, 'check-coral.mjs');
const TMP = path.join(process.env.TEMP || '/tmp', 'coral-mutant.js');

const RAD = 'const radOf = (i) => Math.max(RMIN, R0 * Math.sqrt(t.W[i] / totalArticles));';

const MUTANTS = [
  // ---- 粗度：节点数量（权重）决定枝干粗度，这是用户的原话，也是这张图的读数通道
  ['thickness stops depending on the weight (every branch the same width)', RAD,
   'const radOf = () => R0;'],
  ['square-sum conservation replaced by linear addition (r ∝ w instead of √w)', RAD,
   'const radOf = (i) => Math.max(RMIN, R0 * (t.W[i] / totalArticles));'],
  ['thickness taken from the first child instead of the node itself (a direction error)', RAD,
   'const radOf = (i) => Math.max(RMIN, R0 * Math.sqrt(t.W[t.KIDS[i].length ? t.KIDS[i][0] : i] / totalArticles));'],
  ['the RMIN floor removed (sub-pixel capillaries come back)', 'const RMIN = 1.2;', 'const RMIN = 0;'],

  // ---- 聚合：一个簇都不能丢，也不能两头都算
  ['aggregate drops every 7th cluster (coverage silently drops)',
   '  for (const i of idxs) {\n    const k = Math.floor(cl.x[i] / cell) + \':\' + Math.floor(cl.y[i] / cell);',
   '  for (const i of idxs) {\n    if (i % 7 === 3) continue;\n    const k = Math.floor(cl.x[i] / cell) + \':\' + Math.floor(cl.y[i] / cell);'],
  ['the node keeps its own clusters after handing them to its tuft (weight counted twice)',
   '        OWN[g] = [];                    // 交给自己长出来的那一丛，权重不会两头都算',
   '        OWN[g] = OWN[g];'],

  // ---- 生长：树 / 毛虫 / 糊块的分界
  ['recursion flattened to a single level (the tufts never grow)', 'const MAXLEVEL = 3;', 'const MAXLEVEL = 0;'],
  ['SHRINK back to 3.2 — the resolution artefact that makes it a caterpillar', 'const SHRINK = 1.6;', 'const SHRINK = 3.2;'],
  ['the angle gate removed (a fan exploding from the root, not a tree)',
   '      if (covered) continue;', '      if (false) continue;'],
  ['the angle gate always closed (every node stops after one child — a snake)',
   'const ANGLE = 60;', 'const ANGLE = 180;'],
  ['attractors retired at INF instead of KILL (clears the neighbourhood every round)',
   '      const near = kg.within(atts[a].x, atts[a].y, P.KILL);',
   '      const near = kg.within(atts[a].x, atts[a].y, P.INF);'],
  ['NODE_CAP turns the growth budget into a hard stop at 200 nodes',
   'const NODE_CAP = 120000;', 'const NODE_CAP = 200;'],

  // ---- 颜色：来自数据，而且是**子树**的多数
  ['colour taken from the node\'s own clusters instead of its whole subtree',
   '        if (cm) for (const [d, w] of cm) m.set(d, (m.get(d) || 0) + w);',
   '        if (cm) void cm;'],

  // ---- 朝向：单根基部 ⟹ 从底部长上去
  ['the y flip dropped (the whole coral hangs upside down)',
   '    gy[i] = oy - t.Y[i] * ky;', '    gy[i] = oy + t.Y[i] * ky;'],

  // ---- 链分解
  ['chains no longer cut at a colour change (one chain, several colours)',
   '      while (t.KIDS[cur].length === 1 && t.DOM[t.KIDS[cur][0]] === col) { cur = t.KIDS[cur][0]; idx.push(cur); }',
   '      while (t.KIDS[cur].length === 1) { cur = t.KIDS[cur][0]; idx.push(cur); }'],

  // ---- 统计 / 契约层说谎
  ['forks stop being counted (the fork ratio silently reads 0)',
   '      if (!t.KIDS[i].length) tips++; else if (t.KIDS[i].length > 1) forks++;',
   '      if (!t.KIDS[i].length) tips++;'],
  // 注意：把 der.covered 直接换成 der.N 在这里**不是**变异 —— 真实覆盖率就是满的，
  // 换成一个正确的数什么都不改变（试过，MISSED）。要测的是「harness 到底信不信模块自报的数」，
  // 所以用**看起来很像的算法错误**：把「服务了多少个簇」数成「有多少个节点身上带着簇」。
  ['coverage counted as nodes-that-own-something instead of clusters owned',
   '      covered += t.OWN[i].length;', '      covered += t.OWN[i].length ? 1 : 0;'],
  ['describe reports the depth as if it were the article count',
   '    const w = t.W[i];', '    const w = t.DEPTH[i];'],
  ['leaf and fork swapped in describe',
   "    const kind = t.KIDS[i].length === 0 ? '叶端' : (t.KIDS[i].length > 1 ? `分叉点（${t.KIDS[i].length} 支）` : '枝条');",
   "    const kind = t.KIDS[i].length > 0 ? '叶端' : '枝条';"],
  ['the legend hard-codes the limb count it prints',
   '一株，单根基部，<b>${fmt(der.limbs.length)}</b> 条主枝',
   '一株，单根基部，<b>11</b> 条主枝'],
  ['focus change forgets to call onChange (the host never repaints)',
   '    layer = null; litLayer = null;\n    onChange();',
   '    layer = null; litLayer = null;'],
  ['pick always hits the root (blank canvas reports a branch)',
   '    return best < 0 ? null : { type: \'node\', i: best };',
   '    return best < 0 ? { type: \'node\', i: 0 } : { type: \'node\', i: best };'],

  // ---- 离屏缓存（不是优化，是可用性：珊瑚有 1.8 千条锥形链）
  ['cache never invalidates (focus or zoom change keeps the stale layer)',
   '    if (layer && layer.key === key) return layer.canvas;',
   '    if (layer) return layer.canvas;'],
  ['the cache key drops the sampling ratio (a zoom change reuses the wrong resolution)',
   '    const key = `${W}x${H}|${s.toFixed(4)}|${dim ? 1 : 0}|${der.chains.length}|${der.t.count}`;',
   '    const key = `${W}x${H}|${dim ? 1 : 0}|${der.chains.length}|${der.t.count}`;'],
  ['oversampling ratio not clamped (blurry below 1×, wasteful above 2×)',
   '    const s = Math.min(2, Math.max(1, dev));', '    const s = dev;'],
  ['the cache is built but never drawn (painting goes back to the main canvas every frame)',
   '    if (cv) ctx.drawImage(cv, 0, 0, W, H);', '    if (cv && false) ctx.drawImage(cv, 0, 0, W, H);'],
  ['the cached layer is painted dimmed while the direct fallback is not (two different pictures)',
   '    paintBase(lc, dim);', '    paintBase(lc, true);'],
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
      env: { ...process.env, CORAL: TMP }, encoding: 'utf8', stdio: 'pipe',
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
