// check-interdisc.mjs — 学科矩阵（Clustered Adjacency Matrix + Pixel Heatmap + Marginals）的不变量测试。
//
//     node check-interdisc.mjs                              # 用同目录的 sunburst-data.json
//     node check-interdisc.mjs path/to/sunburst.json  path/to/interdisc.json
//
// 这张图有三层通道，验法各不相同：
//
//   **几何**（格、内嵌方块、像素行）—— 直接从发出的绘图调用去量，不看模块自己记的数。
//   内嵌方块的边长是从 `fillRect` 的宽度反推的，所以「面积 ∝ shared」测的是**画出来的面积**，
//   不是模块声称的面积。像素区同理：每列发出的矩形必须**不留缝、不重叠**地铺满，
//   这条「铺满」不变量比数 op 数量强得多 —— 数 op 数发现不了双重覆盖。
//
//   **统计**（Jaccard 色阶、两条边际）—— 每条都按公式独立重算一遍，而且色阶要验
//   「值域固定」：最高的那对（Jaccard 3.81%）不许被拉伸到最浅一档，否则换个数据集
//   同一对格就会换颜色，颜色就不再是数据的函数。
//
//   **第二来源**（interdisc-data.json 里预算的 55 个 shared）—— 逐格比对。
//   模块是从 arcs 现场推导的，那个文件是构建脚本自己的循环，两条互不相干的路径给出同一个数，
//   比任何自洽断言都强。
//
// 状态机那一段是踩过坑的：alluvial / phil-chord 都出过「点了图例不重画」，
// 所以每一步下钻都断言 onChange 真的被调了。

import { readFileSync } from 'node:fs';

const EPS = 1e-9;
const D = 11;

class Path2D {
  constructor() { this.ops = []; }
  moveTo(...a) { this.ops.push(['moveTo', ...a]); }
  lineTo(...a) { this.ops.push(['lineTo', ...a]); }
  bezierCurveTo(...a) { this.ops.push(['c', ...a]); }
  quadraticCurveTo(...a) { this.ops.push(['q', ...a]); }
  arc(...a) { this.ops.push(['arc', ...a]); }
  closePath() { this.ops.push(['close']); }
}

// 假 ctx。这一版比别的 harness 多记一样东西：**fillRect 的全部参数 + 当时的 fillStyle/alpha**。
// 因为矩阵的每一个数都落在矩形上（格底、内嵌方块、边缘条、像素行），不记矩形就什么也验不了。
function makeCtx() {
  const noop = () => {};
  const texts = [];
  const rects = [];
  const paths = [];                      // 每次 beginPath..stroke 之间的折线（树是描边画出来的）
  let cur = null;
  const ctx = {
    save: noop, restore: noop, setTransform: noop,
    arc: noop, quadraticCurveTo: noop, bezierCurveTo: noop, closePath: noop,
    translate: noop, rotate: noop, strokeText: noop, strokeRect: noop, clearRect: noop,
    isPointInPath: () => false,
    measureText: (t) => ({ width: String(t).length * 6.5 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    textBaseline: '', globalAlpha: 1, lineJoin: '', globalCompositeOperation: '',
    texts, rects, paths,
    beginPath() { cur = []; },
    moveTo(x, y) { if (cur) cur.push([x, y]); },
    lineTo(x, y) { if (cur) cur.push([x, y]); },
    stroke() { if (cur && cur.length) paths.push(cur); cur = null; },
    fill(p) { if (p instanceof Path2D) rects.push({ path: p }); },
    fillRect(x, y, w, h) { rects.push({ x, y, w, h, fill: ctx.fillStyle, alpha: ctx.globalAlpha }); },
    fillText: (t, x, y) => {
      texts.push({ text: String(t), x, y, align: ctx.textAlign, font: ctx.font,
                   width: ctx.measureText(t).width });
    },
  };
  return ctx;
}

// INTERDISC_MATRIX 让变异测试把一份**故意改坏**的副本喂进来，确认这些断言不是空的。
const src = readFileSync(
  process.env.INTERDISC_MATRIX || new URL('./interdisc-matrix.js', import.meta.url), 'utf8');
const { createInterdiscView } = new Function('Path2D',
  src.replace(/^export\s+/gm, '')
    + '\nreturn { createInterdiscView };')(Path2D);

const sbPath = process.argv[2] || new URL('./sunburst-data.json', import.meta.url);
const prePath = process.argv[3] || new URL('./interdisc-data.json', import.meta.url);
const sb = JSON.parse(readFileSync(sbPath, 'utf8'));
let pre = null;
try { pre = JSON.parse(readFileSync(prePath, 'utf8')); } catch { pre = null; }

let pass = 0;
const fails = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fails.push(detail ? `${label}\n      ${detail}` : label);
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
function report() {
  if (fails.length) {
    console.log(`\n${pass} checks passed, ${fails.length} FAILED:\n`);
    for (const f of fails) console.log(`  FAIL  ${f}`);
    console.log('');
    process.exit(1);
  }
  console.log(`${pass} checks passed.`);
}

const W = 1600, H = 900;
const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));

// ================================================================= 独立重算
// 全部从 sb.arcs 出发，不碰模块的任何中间量。
const nT = sb.meta.topicCount;
const names = sb.topics.split('\n');
const cnt = new Int32Array(nT);
for (let i = 0; i < sb.arcs.length; i += 3) cnt[sb.arcs[i + 1]]++;
const off = new Int32Array(nT + 1);
for (let t = 0; t < nT; t++) off[t + 1] = off[t] + cnt[t];
const domOf = new Uint8Array(off[nT]);
const wOf = new Float64Array(off[nT]);
const cur = Int32Array.from(off.subarray(0, nT));
for (let i = 0; i < sb.arcs.length; i += 3) {
  const d = sb.arcs[i], t = sb.arcs[i + 1];
  if (d < 0 || d >= D) continue;
  const k = cur[t]++;
  domOf[k] = d; wOf[k] = sb.arcs[i + 2];
}
const SH = new Int32Array(D * D);
let bridging = 0;
for (let t = 0; t < nT; t++) {
  const a = off[t], b = off[t + 1];
  if (b - a < 2) continue;
  bridging++;
  for (let x = a; x < b; x++) for (let y = x + 1; y < b; y++) {
    const p = domOf[x], q = domOf[y];
    SH[Math.min(p, q) * D + Math.max(p, q)]++;
  }
}
const TOP = new Int32Array(D);
for (let i = 0; i < off[nT]; i++) TOP[domOf[i]]++;
let maxShared = 0, sumShared = 0, maxJ = 0;
const JAC = new Float64Array(D * D);
for (let i = 0; i < D; i++) for (let j = i + 1; j < D; j++) {
  const s = SH[i * D + j];
  sumShared += s;
  if (s > maxShared) maxShared = s;
  const jv = s / (TOP[i] + TOP[j] - s);
  JAC[i * D + j] = JAC[j * D + i] = jv;
  if (jv > maxJ) maxJ = jv;
}
// Σ_{j≠i} shared(i,j) —— 从**成对表**累加，而不是从矩阵的行去加。
// 为什么不从行加：如果模块只填了上三角，从行加会漏掉下半，而且复制这个错误的话
// 两边会一起错、断言照样通过。从成对表累加就与三角约定无关了。
const rowSum = new Float64Array(D);
for (let i = 0; i < D; i++) for (let j = i + 1; j < D; j++) { rowSum[i] += SH[i * D + j]; rowSum[j] += SH[i * D + j]; }
{
  let t = 0;
  for (let i = 0; i < D; i++) t += rowSum[i];
  if (t !== 2 * sumShared) {
    console.log(`  !! 成对累加自检失败: ${t} != ${2 * sumShared}（harness 自己的 bug）`);
  }
}
const GRAND = TOP.reduce((a, b) => a + b, 0);
const OUT = new Float64Array(D), IN = new Float64Array(D);
for (let i = 0; i < D; i++) {
  OUT[i] = rowSum[i] / (10 * TOP[i]);
  IN[i] = rowSum[i] / (GRAND - TOP[i]);
}

// 一对 (i,j) 的共享术语，按权重降序 —— 和模块同序，但这里是从 arcs 独立算的
function bruteFocus(i, j) {
  const rows = [];
  for (let t = 0; t < nT; t++) {
    let wi = 0, wj = 0;
    for (let k = off[t]; k < off[t + 1]; k++) {
      if (domOf[k] === i) wi = wOf[k];
      else if (domOf[k] === j) wj = wOf[k];
    }
    if (wi && wj) rows.push({ t, wi, wj, sum: wi + wj, min: Math.min(wi, wj) });
  }
  rows.sort((a, b) => (b.sum - a.sum) || (b.min - a.min) || (a.t - b.t));
  return rows;
}

// ================================================================= 0. 输入的账
{
  ok(names.length === nT, 'topics 块和 topicCount 条数一致 —— 否则第 t 个名字不是第 t 行',
     `names ${names.length} vs topicCount ${nT}`);
  ok(sb.arcs.length % 3 === 0, 'arcs 是整齐的三元组', `${sb.arcs.length} 不是 3 的倍数`);
  ok(sb.arcs.length / 3 === sumArcTriples(), 'arcs 的条数与 domains 的弧数之和一致',
     `${sb.arcs.length / 3} vs ${sumArcTriples()}`);
  ok(sumShared > 0 && maxShared > 0, 'shared 矩阵非空', `sum ${sumShared} max ${maxShared}`);
  ok(bridging > 0 && bridging <= nT, '存在跨学科术语', `bridging ${bridging}`);
  console.log(`matrix: 11×11 · Σshared ${sumShared.toLocaleString('en-US')} · bridging ${bridging.toLocaleString('en-US')} · maxJ ${(maxJ * 100).toFixed(2)}% · maxShared ${maxShared}`);
}
function sumArcTriples() {
  return sb.domains.reduce((s, d) => s + (d.arcCount || 0), 0);
}

// ================================================================= 1. 视图与几何
const calls = { onChange: 0 };
const view = createInterdiscView({ onChange: () => { calls.onChange++; } });
let ctx = makeCtx();
const onChangeBefore = () => calls.onChange;

// ---- API 契约枚举（phil-chord 出过「定义了但忘了导出」的白屏，所以逐个点名）
for (const name of ['setData', 'getData', 'getModel', 'draw', 'pick', 'describe',
                    'renderLegend', 'setHover', 'getHover', 'togglePinned', 'getPinned',
                    'sameTarget', 'rampColor', 'getCounts']) {
  ok(typeof view[name] === 'function', `view exports ${name}()`, `typeof = ${typeof view[name]}`);
}
// main.js 真的会调的就是下面这 5 个（grep 过），pick/describe/togglePinned 从 worldPickView 那条路进来。
// 不点名 layout —— 那是模块内部量，宿主从来没调过它。
for (const name of ['setData', 'draw', 'renderLegend', 'getCounts', 'setHover',
                    'pick', 'describe', 'togglePinned', 'getPinned', 'sameTarget']) {
  ok(typeof view[name] === 'function', `main.js 要用的 ${name}() 确实导出了`);
}
ok('nodes' in view && 'matrix' in view, 'view 暴露 nodes / matrix（只读，供自检）');

ok(view.getCounts() === null, 'setData 之前 getCounts() 是 null（宿主靠这个画"缺数据"）');

view.setData(sb, pre);
const counts = view.getCounts();
ok(counts && counts.disciplineCount === D, 'getCounts().disciplineCount == 11');
ok(counts && counts.pairCount === 55, 'getCounts().pairCount == 55', `got ${counts && counts.pairCount}`);
ok(counts && counts.cellCount === 121, 'getCounts().cellCount == 121', `got ${counts && counts.cellCount}`);
ok(counts && counts.bridgingTerms === bridging, 'getCounts().bridgingTerms == 重算值',
   `${counts && counts.bridgingTerms} vs ${bridging}`);
ok(counts && counts.sharedTermTotal === sumShared, 'getCounts().sharedTermTotal == 重算值',
   `${counts && counts.sharedTermTotal} vs ${sumShared}`);
ok(counts && !('edgeCount' in counts), 'getCounts() 不留 edgeCount 别名（矩阵里没有边）');

// ---- 诊断出口
const dg = view.diagnostics;
ok(dg && dg.topicCountOk, 'arcs 的 topicId 全部落在 topics 块内', JSON.stringify(dg && dg.cross));
ok(dg && dg.arcTriplesOk, 'arcs 三元组整齐');

// ---- 矩阵本体（121 格逐格与暴力重算比对）
const M = view.matrix;
ok(M && M.length === D * D, 'matrix 是 11×11');
{
  let bad = 0, worst = null;
  for (let i = 0; i < D; i++) for (let j = i + 1; j < D; j++) {
    if (M[i * D + j] !== SH[i * D + j] || M[j * D + i] !== SH[i * D + j]) {
      bad++;
      if (!worst) worst = `(${i},${j}) module ${M[i * D + j]}/${M[j * D + i]} vs brute ${SH[i * D + j]}`;
    }
  }
  ok(bad === 0, '55 对 shared 逐格与从 arcs 暴力重算的值相等，且矩阵对称', `${bad} 格不符; ${worst || ''}`);
  ok(dg.symmetricOk, '模块自检：Σ_i Σ_{j≠i} shared(i,j) == 2 × Σ_{i<j} shared（镜像之后才成立）', '');
  ok(view.nodes.length === D, 'nodes 暴露 11 个学科');
  ok(view.nodes.every((n, i) => n.topics === TOP[i]),
     '每个学科自己的术语数 == 重算值', JSON.stringify(view.nodes.map((n) => n.topics)));
}

// ---- 第二来源：interdisc-data.json 预算的 55 个 shared
if (pre && Array.isArray(pre.edges)) {
  let bad = 0, worst = '';
  for (const e of pre.edges) {
    const lo = Math.min(e.a, e.b), hi = Math.max(e.a, e.b);
    if (M[lo * D + hi] !== e.shared) { bad++; if (!worst) worst = `${lo}-${hi}: ${M[lo * D + hi]} vs ${e.shared}`; }
  }
  ok(bad === 0, '两个独立来源（arcs 推导 vs interdisc-data.json）逐格一致', `${bad} 格不符; ${worst}`);
  ok(dg.cross && dg.cross.checked === 55 && !dg.cross.mismatches,
     '模块自己的交叉校验报了 55 格全对', JSON.stringify(dg.cross));
} else {
  console.log('  (interdisc-data.json 不可用，跳过第二来源比对)');
}

// ---- L0 画一遍，从发出的矩形里验几何
ctx = makeCtx();
view.draw(ctx, W, H, 1);
const m0 = view.getModel();
ok(m0 && m0.order && m0.order.length === D, 'L0 布局建立起来了');

// ---- 两条边际按公式独立重算（长度从布局里量，值从公式重算）
{
  let bad = 0, worst = '';
  for (let r = 0; r < D; r++) {
    const j = m0.order[r];
    const ob = m0.outBars[r], ib = m0.inBars[r];
    if (!near(ob.v, OUT[j], 1e-12)) { bad++; if (!worst) worst = `out[${j}] ${ob.v} vs ${OUT[j]}`; }
    if (!near(ib.v, IN[j], 1e-12)) { bad++; if (!worst) worst = `in[${j}] ${ib.v} vs ${IN[j]}`; }
  }
  ok(bad === 0, '22 条边缘条的长度按公式独立重算一致（同一个分子，两个分母）', `${bad} 条不符; ${worst}`);
  ok(OUT.every((v) => v >= 0 && v <= 1) && IN.every((v) => v >= 0 && v <= 1),
     '0 ≤ OUTWARD, INWARD ≤ 1', `out ${[...OUT].map((v) => v.toFixed(4))} in ${[...IN].map((v) => v.toFixed(4))}`);
  // 两个分母真的不同 → 这两条必须是两个不同的量，否则「两条边际」就是同一根条画了两遍
  const identical = OUT.every((v, i) => near(v, IN[i], 1e-12));
  ok(!identical, '两条边际不是同一个数（否 INWARD 的分母退化成 topics_i）');
  let distinct = 0;
  for (let i = 0; i < D; i++) if (Math.abs(OUT[i] - IN[i]) > 1e-9) distinct++;
  ok(distinct >= 10, '至少 10 个学科的 out/in 明显不同', `${distinct}/11`);

  // 条**画出来**的长度必须正比于值 —— 上面比的是布局里的 v，读者看到的是矩形高度/宽度。
  // 两处都是 withAlpha(学科色, 0.85)，L0 上一共 22 根（11 上 + 11 左）；L2 的条也是 0.85，
  // 但那个阶段已经不在 L0 了，所以这里按「0.85 且尺寸像边缘条」筛。
  const barRects = ctx.rects.filter((r) => typeof r.fill === 'string' && r.fill.endsWith(',0.85)'));
  // 用位置分开两条边，不要用长宽比：上沿条恒为宽 40、左沿条恒为高 40，
  // 按长宽比筛会把两支混在一起（自己踩过一次）。
  const outs = barRects.filter((r) => r.x >= m0.mx - 0.5 && r.y + r.h <= m0.my + 0.5)
    .sort((a, b) => a.x - b.x);
  const ins = barRects.filter((r) => r.y >= m0.my - 0.5 && r.x + r.w <= m0.mx + 0.5)
    .sort((a, b) => a.y - b.y);
  ok(outs.length === D, '上沿画了 11 根 OUTWARD 条', `${outs.length}`);
  ok(ins.length === D, '左沿画了 11 根 INWARD 条', `${ins.length}`);
  let badLen = 0, worstLen = '';
  for (let c = 0; c < Math.min(D, outs.length); c++) {
    const want = Math.max(1, 62 * Math.min(1, OUT[m0.order[c]]));
    if (!near(outs[c].h, want, 0.02)) { badLen++; if (!worstLen) worstLen = `col ${c}: ${outs[c].h} vs ${want}`; }
  }
  for (let r = 0; r < Math.min(D, ins.length); r++) {
    const want = Math.max(1, 62 * Math.min(1, IN[m0.order[r]]));
    if (!near(ins[r].w, want, 0.02)) { badLen++; if (!worstLen) worstLen = `row ${r}: ${ins[r].w} vs ${want}`; }
  }
  ok(badLen === 0, '22 根边缘条画出来的长度 = 62 × 值（读者看到的长度就是边际值）', `${badLen} 根不符; ${worstLen}`);
  const outLens = new Set(outs.map((r) => r.h.toFixed(1)));
  ok(outLens.size >= 8, 'OUTWARD 条的长度真的分了很多档（不是常量）', `只有 ${outLens.size} 种长度`);
}

// 聚类：叶子序是 0..10 的排列、合并高度单调不减、每次合并的簇大小是 2..11
{
  const order = dg.order;
  ok(order.length === D && new Set(order).size === D && order.every((x) => x >= 0 && x < D),
     '聚类叶子序是 0..10 的一个排列', JSON.stringify(order));
  const notIdentity = order.some((v, i) => v !== i);
  ok(notIdentity, '叶子序不是恒等排列（说明顺序真的来自聚类，不是原样照抄）', JSON.stringify(order));
  const hs = dg.mergeHeights, ss = dg.mergeSizes;
  ok(hs.length === D - 1, '恰好 11 − 1 次合并', `${hs.length}`);
  let mono = true;
  for (let i = 1; i < hs.length; i++) if (hs[i] < hs[i - 1] - 1e-12) mono = false;
  ok(mono, '合并高度单调不减（UPGMA 的可约性）', JSON.stringify(hs.map((h) => +h.toFixed(4))));
  ok(ss.length === hs.length && ss.every((s) => s >= 2 && s <= D),
     '每次合并的簇大小都在 2..11 之间', JSON.stringify(ss));
  ok(ss[ss.length - 1] === D, '最后一次合并把 11 个学科收成一个簇', `${ss[ss.length - 1]}`);
  const mc = dg.mergeChildren;
  ok(mc.length === hs.length && mc.every(([a, b], i) => a + b === ss[i]),
     '每次合并的簇大小 == 两个孩子之和（层次结构自洽）',
     JSON.stringify(mc.map(([a, b]) => `${a}+${b}`)) + ' vs ' + JSON.stringify(ss));
  ok(mc.every(([a, b]) => a >= 1 && b >= 1 && a + b <= D), '每个孩子都非空');

  // 语义：聚类距离是 1 − Jaccard ⟹ **第一次合并必须正好是 Jaccard 最大的那一对**。
  // 只验「是个排列 / 高度单调 / 确定性」是抓不住「距离取反」的 —— 取反后那三条照样成立，
  // 只有把第一次合并钉回数据才抓得住。
  let bestPair = null, bestJ = -1;
  for (let i = 0; i < D; i++) for (let j = i + 1; j < D; j++) {
    if (JAC[i * D + j] > bestJ) { bestJ = JAC[i * D + j]; bestPair = [i, j]; }
  }
  const firstLeaves = dg.mergeLeaves[0].flat().sort((a, b) => a - b);
  ok(firstLeaves.length === 2 && firstLeaves[0] === bestPair[0] && firstLeaves[1] === bestPair[1],
     '第一次合并就是 Jaccard 最大的那一对（距离没取反）',
     `${JSON.stringify(firstLeaves)} vs ${JSON.stringify(bestPair)} (J=${bestJ.toFixed(4)})`);
  // 那一对在叶子序里必须相邻 —— 这是读者在矩阵上直接看得见的那条性质
  const pos = new Map(order.map((v, k) => [v, k]));
  ok(Math.abs(pos.get(bestPair[0]) - pos.get(bestPair[1])) === 1,
     '最相似的两个学科在重排后的矩阵里是相邻的行/列',
     `${bestPair} 在位置 ${pos.get(bestPair[0])} 和 ${pos.get(bestPair[1])}`);
  // 树是描边画的，所以画出来的几何也得验：孩子必须挂在父节点**外侧**（col 树往上长、row 树往左长）
  {
    const stems = ctx.paths.filter((p) => p.length === 4);
    ok(stems.length === 2 * (D - 1), '两棵树各画了 10 段折线（每段 4 个点）', `${stems.length}`);
    const up = stems.filter((p) => p[1][1] < p[0][1] + 1e-9 && p[2][1] === p[1][1]);
    const left = stems.filter((p) => p[1][0] < p[0][0] + 1e-9 && p[2][0] === p[1][0]);
    ok(up.length >= D - 1, '往上的那棵（列树）：父节点的横线比孩子的起点更高（y 更小）', `${up.length}`);
    ok(left.length >= D - 1, '往左的那棵（行树）：父节点的竖线比孩子的起点更左（x 更小）', `${left.length}`);
    // 合并线的深度必须随合并次序单调（h 翻转会把这一步反过来）
    const depths = up.slice(0, D - 1).map((p) => p[1][1]);
    let mono = true;
    for (let i = 1; i < depths.length; i++) if (depths[i] > depths[i - 1] + 1e-9) mono = false;
    ok(mono, '列树的 10 条合并线离叶子基线越来越远（画出来的高度也单调）',
       JSON.stringify(depths.map((d) => +d.toFixed(1))));
  }
  // 排平必须确定：同一个输入建两个视图，得到的叶子序和合并高度必须逐位相同
  const v2 = createInterdiscView({});
  v2.setData(sb, pre);
  const d2 = v2.diagnostics;
  ok(JSON.stringify(d2.order) === JSON.stringify(order),
     '聚类是确定性的（同样的输入 → 同样的叶子序）',
     `${JSON.stringify(d2.order)} vs ${JSON.stringify(order)}`);
  ok(JSON.stringify(d2.mergeHeights) === JSON.stringify(hs), '合并高度也是确定性的');
}

// 121 格：底色 = Jaccard 色阶，内嵌方块面积 ∝ shared
{
  const bg = ctx.rects.filter((r) => typeof r.fill === 'string'
    && r.fill.startsWith('rgba(150,182,226,'));
  const insets = ctx.rects.filter((r) => r.fill === 'rgba(226,238,255,0.92)');
  const diag = ctx.rects.filter((r) => typeof r.fill === 'string'
    && r.fill.startsWith('rgba(') && r.fill.endsWith('0.3)'));
  // 非对角格 = 121 − 11 = 110
  ok(bg.length === 110, '110 个非对角格各画了一次底色', `got ${bg.length}`);
  ok(insets.filter((r) => r.w > 0).length === 110, '110 个内嵌方块', `got ${insets.filter((r) => r.w > 0).length}`);
  ok(diag.length >= 11, '对角线单独画法（不是按对数编码的格）', `${diag.length} 个对角矩形`);

  // 底色：α 必须等于 0.05 + 0.42·J/maxJ —— 逐格反查 Jaccard，不看模块记的 jacc
  const order = m0.order;
  const expectSeq = [];
  for (let r = 0; r < D; r++) for (let c = 0; c < D; c++) {
    const i = order[r], j = order[c];
    if (i === j) continue;
    expectSeq.push({ i, j, x: m0.mx + c * 52, y: m0.my + r * 52 });
  }
  let badA = 0, worstA = '';
  for (let k = 0; k < expectSeq.length && k < bg.length; k++) {
    const e = expectSeq[k], got = bg[k];
    const lo = Math.min(e.i, e.j), hi = Math.max(e.i, e.j);
    const want = 0.05 + 0.42 * (JAC[lo * D + hi] / maxJ);
    const alpha = parseFloat(String(got.fill).match(/,\s*([0-9.]+)\)$/)[1]);
    if (!near(alpha, want, 1e-4) || got.x !== e.x + 1 || got.y !== e.y + 1) {
      badA++; if (!worstA) worstA = `cell(${e.i},${e.j}) α ${alpha} vs ${want.toFixed(4)} @ ${got.x},${got.y}`;
    }
  }
  ok(badA === 0, '每个格底的 α 都是 0.05 + 0.42·Jaccard/maxJ 的纯函数（逐格反查）', `${badA} 格不符; ${worstA}`);

  // 内嵌方块：**面积 ∝ shared**，且边长是从发出的矩形量出来的
  let badS = 0, worstS = '';
  const insDrawn = ctx.rects.filter((r) => r.fill === 'rgba(226,238,255,0.92)' && r.w > 0);
  for (let k = 0; k < expectSeq.length && k < insDrawn.length; k++) {
    const e = expectSeq[k], got = insDrawn[k];
    const lo = Math.min(e.i, e.j), hi = Math.max(e.i, e.j);
    const wantSide = 52 * 0.66 * Math.sqrt(SH[lo * D + hi] / maxShared);
    if (!near(got.w, wantSide, 0.02) || !near(got.h, wantSide, 0.02)) {
      badS++; if (!worstS) worstS = `cell(${lo},${hi}) side ${got.w.toFixed(3)} vs ${wantSide.toFixed(3)} (shared ${SH[lo * D + hi]})`;
    }
  }
  ok(badS === 0, '内嵌方块的边长 = 0.66·CELL·sqrt(shared/maxShared)（面积 ∝ shared，量的是画出来的边长）',
     `${badS} 格不符; ${worstS}`);
  // 面积确实在变：如果所有方块一样大，上面那条就退化成比两个常量
  const sides = new Set(insDrawn.map((r) => r.w.toFixed(1)));
  ok(sides.size > 20, '内嵌方块的尺寸真的分了很多档', `只有 ${sides.size} 种尺寸`);

  // 格子里印的数 = 暴力重算的 shared（逐格，按绘制顺序对位）
  const wanted = expectSeq.map((e) => {
    const lo = Math.min(e.i, e.j), hi = Math.max(e.i, e.j);
    return fmt(SH[lo * D + hi]);
  });
  const printed = new Set(ctx.texts.filter((t) => /^[\d,]+$/.test(t.text)).map((t) => t.text));
  let missCount = 0, missingSample = '';
  for (const w of wanted) if (!printed.has(w)) { missCount++; if (!missingSample) missingSample = w; }
  ok(missCount === 0, '110 个格里印的 shared 数都能在发出的文本里找到',
     `${missCount} 个缺失，例如 ${missingSample}`);
}

// ================================================================= 2. rampColor 是纯函数
{
  const a1 = view.rampColor(maxJ), a2 = view.rampColor(maxJ);
  ok(a1 === a2, 'rampColor 是纯函数（同一输入 → 同一输出）');
  ok(near(parseFloat(a1.match(/,\s*([0-9.]+)\)$/)[1]), 0.47, 1e-4),
     '最大 Jaccard 落在色阶最深一档（值域固定，不随当前数据拉伸）', a1);
  ok(near(parseFloat(view.rampColor(0).match(/,\s*([0-9.]+)\)$/)[1]), 0.05, 1e-9),
     'Jaccard = 0 落在最浅一档', view.rampColor(0));
  ok(view.rampColor(maxJ / 2) !== view.rampColor(maxJ), '色阶不是常量');
}

// ================================================================= 3. L1：铺满不变量
// 选共享术语最多的那一对，把分页也一起走一遍。
let busiest = { i: 0, j: 1, s: -1 };
for (let i = 0; i < D; i++) for (let j = i + 1; j < D; j++) {
  if (SH[i * D + j] > busiest.s) busiest = { i, j, s: SH[i * D + j] };
}
const FOCUS = bruteFocus(busiest.i, busiest.j);
ok(FOCUS.length === busiest.s, 'L1 的行数 == 该对的 shared（暴力重算）',
   `${FOCUS.length} vs ${busiest.s}`);

{
  const before = calls.onChange;
  view.togglePinned({ type: 'cell', i: busiest.i, j: busiest.j });
  ok(calls.onChange === before + 1, '点格下钻调了 onChange（否则宿主不会重画）');
  ctx = makeCtx();
  view.draw(ctx, W, H, 1);
  const m1 = view.getModel();
  ok(m1.l1 && m1.l1.f.i < m1.l1.f.j, '焦点对是无序对的规范写法（小在前）', JSON.stringify(m1.l1 && [m1.l1.f.i, m1.l1.f.j]));
  // 同一个格再点一次 = 收起（图例行的 toggle 语义）。这条同时钉住了 pair 的方向：
  // 如果下钻时把 [i,j] 写反了，第二次点击就对不上，格会收不起来。
  view.togglePinned({ type: 'cell', i: busiest.i, j: busiest.j });
  ok(view.level === 0, '同一个格点两次回到 L0（收起）', `level ${view.level}`);
  view.togglePinned({ type: 'cell', i: busiest.i, j: busiest.j });
  ok(view.level === 1, '再点一次又展开', `level ${view.level}`);
  ctx = makeCtx();
  view.draw(ctx, W, H, 1);

  ok(m1.l1 && m1.l1.f.i === Math.min(busiest.i, busiest.j) && m1.l1.f.j === Math.max(busiest.i, busiest.j),
     'L1 的焦点对就是被点的那一对');
  ok(m1.l1.f.rows.length === busiest.s, 'L1 的术语行数 == shared', `${m1.l1.f.rows.length}`);
  // 降序：权重和必须单调不增
  {
    let bad = 0;
    for (let k = 1; k < m1.l1.f.rows.length; k++) {
      if (m1.l1.f.rows[k].sum > m1.l1.f.rows[k - 1].sum + 1e-12) bad++;
    }
    ok(bad === 0, 'L1 的行按权重降序（同桶连续的前提）', `${bad} 处逆序`);
  }
  // 画出来的标题必须说人话地报出这个数
  const title = ctx.texts.map((t) => t.text).find((s) => s.includes('shared topics'));
  ok(title && title.startsWith(fmt(busiest.s)),
     'L1 的标题印出的行数 == shared', `"${title}"`);

  // 逐页验「铺满」：每列发出的像素矩形不留缝、不重叠，且各列高度和相同
  const pages = m1.pages ? m1.pages.n : 1;
  for (let p = 0; p < pages; p++) {
    view.togglePinned({ type: 'page', page: p });   // 每轮都显式设页，不能靠"上一轮的残留"
    ctx = makeCtx();
    view.draw(ctx, W, H, 1);
    const mm = view.getModel();
    const runs = ctx.rects.filter((r) => r.fill === 'rgb(150,182,226)');
    ok(runs.length > 0, `第 ${p + 1} 页的像素区发了矩形`, `got ${runs.length}`);
    const byCol = new Map();
    for (const r of runs) {
      const c = Math.round((r.x - mm.l1.gridX) / 46);
      if (!byCol.has(c)) byCol.set(c, []);
      byCol.get(c).push(r);
    }
    let gap = 0, overlap = 0, badX = 0;
    const heights = [];
    for (const [c, list] of byCol) {
      list.sort((a, b) => a.y - b.y);
      let hsum = 0, cursor = null;
      for (const r of list) {
        if (c < 0 || c >= D) badX++;
        if (Math.abs(r.x - (mm.l1.gridX + c * 46)) > 1e-9) badX++;
        if (cursor === null) { cursor = r.y; }
        if (r.y > cursor + 1e-9) gap++;
        if (r.y < cursor - 1e-9) overlap++;
        cursor = r.y + r.h;
        hsum += r.h;
      }
      heights.push(hsum);
    }
    ok(gap === 0 && overlap === 0, `第 ${p + 1} 页：每列的像素行不留缝、不重叠`, `gap ${gap} overlap ${overlap}`);
    ok(badX === 0, `第 ${p + 1} 页：每个 run 落在它该在的那一列`, `${badX} 个跑错列`);
    ok(new Set(heights).size === 1, `第 ${p + 1} 页：11 列铺的高度相同（同一批行）`, JSON.stringify(heights));
    ok(heights.length === D, `第 ${p + 1} 页：11 列都有像素`, `只有 ${heights.length} 列`);
    // 覆盖的行数必须等于本页应有的行数 —— 从模块自己报的起止反推，但铺满是几何证明的
    const expectRows = mm.pix.end - mm.pix.start;
    ok(heights[0] === expectRows, `第 ${p + 1} 页：像素行数 == 本页行数`, `${heights[0]} vs ${expectRows}`);
    ok(heights.reduce((a, b) => a + b, 0) === expectRows * D,
       `第 ${p + 1} 页：总面积 == 行数 × 11`, `${heights.reduce((a, b) => a + b, 0)} vs ${expectRows * D}`);
    // 合并必须真的在省：每列最多 24 个桶，所以每页的矩形数应该是几十，不是 rows × 11。
    // 这一条是「关掉合并」唯一能被抓住的地方 —— 关掉之后铺满依然成立，只是慢得多。
    ok(runs.length <= D * 26, `第 ${p + 1} 页：同桶合并真的在省（矩形数 ≪ 行数 × 11）`,
       `${runs.length} 个矩形 vs ${expectRows * D} 格`);
  }
  // 头部（固定 0..headRows−1）+ 所有页的像素行，合起来必须恰好覆盖每一行一次。
  // 也就是「每一个共享术语都能被指认到」—— 要么在头部被读出名字，要么在像素区占了一行。
  {
    const seen = new Set();
    let dup = 0;
    const headRows = Math.min(12, FOCUS.length);
    for (let k = 0; k < headRows; k++) seen.add(k);
    for (let p = 0; p < pages; p++) {
      view.togglePinned({ type: 'page', page: p });   // 同上：显式设页
      view.draw(makeCtx(), W, H, 1);
      const mm = view.getModel();
      for (let k = mm.pix.start; k < mm.pix.end; k++) {
        if (seen.has(k)) dup++; else seen.add(k);
      }
    }
    ok(dup === 0, '头部和像素区之间、以及页与页之间都不重复任何一行', `${dup} 行重复`);
    ok(seen.size === FOCUS.length, '头部 ∪ 所有页 == 全部的共享术语行', `${seen.size} vs ${FOCUS.length}`);
    const minRow = Math.min(...seen), maxRow = Math.max(...seen);
    ok(minRow === 0 && maxRow === FOCUS.length - 1, '覆盖区间就是 0..n−1', `${minRow}..${maxRow}`);
    const perPage = m1.pix.end - m1.pix.start;
    ok(perPage * (pages - 1) < FOCUS.length - headRows && FOCUS.length - headRows <= perPage * pages,
       '分页数刚好够装下剩余行（不空转一页，也不漏行）',
       `${pages} 页 × ${perPage} 行 vs ${FOCUS.length - headRows} 行`);
  }

  // 头部能读：头部行数 = min(12, n)，且第一个头部行的术语名 == 权重最高的那个
  ok(m1.head.length === Math.min(12, FOCUS.length), '头部展开 12 行（或不足 12 就全展开）', `${m1.head.length}`);
  ok(m1.head.length === 0 || m1.head[0].row.t === FOCUS[0].t,
     '头部第一行就是权重最高的术语', `${m1.head[0] && m1.head[0].row.t} vs ${FOCUS[0].t}`);
  const topName = names[FOCUS[0].t];
  ok(ctx.texts.some((t) => t.text === topName) || topName.length > 40,
     '头部第一行的术语名真的被画出来了', `找不到 "${topName}"`);

  // 命中与描述：像素区任意一点都要能定位到具体某一行，且 name 对得上
  {
    const mm = view.getModel();
    const hit = view.pick(mm.l1.gridX + 20, mm.pix.y + 3);
    ok(hit && hit.type === 'prow', '像素区能被 pick 到', JSON.stringify(hit));
    ok(hit && hit.rank === mm.pix.start + 3, 'pick 出来的排名 == 该像素点对应的行', `${hit && hit.rank}`);
    ok(hit && hit.topic === FOCUS[hit.rank].t, 'pick 出来的术语 == 该行的术语', `${hit && hit.topic}`);
    const d1 = view.describe(hit);
    ok(d1.includes(names[hit.topic]), 'describe 说得出术语名', d1);
    const h2 = view.pick(mm.l1.gridX + 20, mm.pix.y + 3);
    ok(view.sameTarget(hit, h2), '同一个像素点两次 pick 是同一个目标');
    const h3 = view.pick(mm.l1.gridX + 20, mm.pix.y + 4);
    ok((mm.pix.start + 4 >= mm.pix.end) || !view.sameTarget(hit, h3),
       '相邻像素点是不同的目标（否则 hover 分不出行）');
  }

  // ============================================== 4. L2 + 返回键逐级回退
  {
    const before2 = calls.onChange;
    view.togglePinned({ type: 'head', topic: FOCUS[0].t });
    ok(calls.onChange === before2 + 1, '点术语行调了 onChange');
    ctx = makeCtx();
    view.draw(ctx, W, H, 1);
    const m2 = view.getModel();
    ok(m2.l2 && m2.l2.row.t === FOCUS[0].t, 'L2 聚焦的就是那一行术语');
    ok(m2.l2.bars.length === D, 'L2 有 11 根学科权重条', `${m2.l2.bars.length}`);
    const expectW = [];
    for (let d = 0; d < D; d++) {
      let w = 0;
      for (let k = off[FOCUS[0].t]; k < off[FOCUS[0].t + 1]; k++) if (domOf[k] === d) { w = wOf[k]; break; }
      expectW.push(w);
    }
    let badB = 0;
    for (let d = 0; d < D; d++) if (!near(m2.l2.bars[d].w, expectW[d], 1e-9)) badB++;
    ok(badB === 0, 'L2 的 11 根条按该术语的权重向量独立重算一致', `${badB} 根不符`);
    const doms = expectW.map((w, d) => (w ? d : -1)).filter((d) => d >= 0);
    ok(m2.l2.doms.length === doms.length, 'L2 的迷你矩阵只点亮这个词真正出现的学科',
       `${m2.l2.doms.length} vs ${doms.length}`);
    ok(ctx.texts.some((t) => t.text === names[FOCUS[0].t]), 'L2 画出了术语名');

    // 返回：L2 → L1 → L0，一步一级，每步都 onChange
    const b3 = calls.onChange;
    view.togglePinned({ type: 'back' });
    ok(view.level === 1 && calls.onChange === b3 + 1, '返回键从 L2 回到 L1（而不是一步跳回 L0）',
       `level ${view.level}`);
    view.draw(makeCtx(), W, H, 1);
    const b4 = calls.onChange;
    view.togglePinned({ type: 'back' });
    ok(view.level === 0 && calls.onChange === b4 + 1, '再按一次回到 L0', `level ${view.level}`);
    view.draw(makeCtx(), W, H, 1);
    const b5 = calls.onChange;
    view.togglePinned({ type: 'back' });
    ok(view.level === 0, '在 L0 上按返回键不会跑到别的地方去', `level ${view.level}`);
    ok(calls.onChange === b5, 'L0 上的空返回不产生多余重画');
  }
}

// ================================================================= 5. describe / 命中 / 图例
{
  // 先显式复位：上一段结束时可能停在 L1/L2 上（如果状态机坏了更是如此），
  // 而这一段假设自己在 L0 —— 不假设，直接 setData 把状态清干净。
  view.setData(sb, pre);
  view.draw(makeCtx(), W, H, 1);
  ok(view.level === 0, 'setData 之后回到 L0（换数据不许留在下钻状态里）', `level ${view.level}`);
  const m0b = view.getModel();
  const order = m0b.order;
  // 找一个非对角格，按它的中心 pick
  let target = null;
  for (let r = 0; r < D && !target; r++) for (let c = 0; c < D; c++) {
    if (order[r] !== order[c]) { target = { r, c, i: order[r], j: order[c] }; break; }
  }
  const cx = m0b.mx + target.c * 52 + 26, cy = m0b.my + target.r * 52 + 26;
  const hit = view.pick(cx, cy);
  ok(hit && hit.type === 'cell' && hit.i === target.i && hit.j === target.j,
     'L0 的格能被 pick 到，且行列没搞反', `${JSON.stringify(hit)} vs ${JSON.stringify(target)}`);
  const lo = Math.min(target.i, target.j), hi = Math.max(target.i, target.j);
  const txt = view.describe(hit);
  ok(txt.includes(fmt(SH[lo * D + hi])), 'describe 报出的 shared 与重算一致', txt.split('\n')[1]);
  ok(txt.includes((JAC[lo * D + hi] * 100).toFixed(2)), 'describe 报出的 Jaccard 与重算一致', txt.split('\n')[2]);

  // 边缘条：pick 上沿条 → describe 报 outward，读到的值 == 重算值。
  //
  // 坐标取**布局自己给的矩形中心**，不写死像素偏移。这里原来写的是 `my - 78 - 20` 和
  // `mx - 130 - 20`（当时 COLLAB=78、ROWLAB=118）。后来把边际百分比折进轴标签、ROWLAB 加宽到 168，
  // 这两个点就落进标签区了：下面 `if (oh && oh.type === 'outward')` 的守卫于是**静静地不再成立**，
  // 一条断言直接消失，检查数从 198 掉到 197，而套件依然全绿 —— 只有数一下才看得出来。
  // 所以别再猜屏幕位置；并且断言无条件跑，守卫只用来挡解引用。
  const ob = m0b.outBars[0];
  const oh = view.pick(ob.x + ob.w / 2, ob.y + ob.h / 2);
  const oTxt = oh ? view.describe(oh) : '';
  ok(oh && oh.type === 'outward' && oh.i === ob.j, '上沿条能被 pick 到，且命中的就是那根条',
     `${JSON.stringify(oh)} vs col ${ob.c} 学科 ${ob.j}`);
  ok(oTxt.includes((OUT[ob.j] * 100).toFixed(1)), 'describe 报出的 OUTWARD 与公式重算一致', oTxt);

  const ib = m0b.inBars[0];
  const ih = view.pick(ib.x + ib.w / 2, ib.y + ib.h / 2);
  const iTxt = ih ? view.describe(ih) : '';
  ok(ih && ih.type === 'inward' && ih.i === ib.i, '左沿条能被 pick 到，且命中的就是那根条',
     `${JSON.stringify(ih)} vs row ${ib.r} 学科 ${ib.i}`);
  ok(iTxt.includes((IN[ib.i] * 100).toFixed(1)), 'describe 报出的 INWARD 与公式重算一致', iTxt);

  // 对角线格：值必须是该学科自己的术语数，不是一对
  let diagHit = null;
  for (let r = 0; r < D && !diagHit; r++) {
    const h = view.pick(m0b.mx + r * 52 + 26, m0b.my + r * 52 + 26);
    if (h && h.type === 'cell' && h.diag) diagHit = h;
  }
  ok(!!diagHit, '对角线格被标成 diag（单独画法）');
  if (diagHit) {
    const dt = view.describe(diagHit);
    ok(dt.includes(fmt(TOP[diagHit.i])), '对角线格报出的是该学科自己的术语数', dt);
    ok(!/shared/i.test(dt), '对角线格不会被说成"共享多少"', dt);
  }

  // 命中和悬停
  view.setHover(hit);
  ok(view.getHover() === hit, 'setHover / getHover 往返一致');
  const before = calls.onChange;
  view.togglePinned({ type: 'node', i: 3 });
  ok(view.getPinned() && view.getPinned().i === 3, 'togglePinned 记住了高亮的学科');
  view.togglePinned({ type: 'node', i: 3 });
  ok(view.getPinned() === null, '再点一次取消高亮');
  view.draw(makeCtx(), W, H, 1);
  ok(calls.onChange >= before, '高亮切换不崩');

  // 图例：11 行、逐字写出两条公式、第二来源的自检结论
  const el = makeEl();
  view.renderLegend(el);
  const domRows = el.innerHTML.match(/data-dom="\d+"/g) || [];
  ok(domRows.length === D, '图例有 11 个学科行（带 data-dom）', `${domRows.length}`);
  ok(/Jaccard/.test(el.innerHTML) && /clustering/i.test(el.innerHTML),
     '图例写清楚了两个通道和聚类由来');
  ok(/OUTWARD/.test(el.innerHTML) && /INWARD/.test(el.innerHTML),
     '图例逐字写出两条边际');
  ok(el.innerHTML.includes('10 × topics'), '图例写出了 OUTWARD 的分母是 10 × topics', '');
  ok(el.innerHTML.includes('Σ other topics'), '图例写出了 INWARD 的分母是别人的术语总数', '');
  if (pre) ok(!/FAILED/.test(el.innerHTML), '图例没有报交叉校验失败');
  // 点图例行必须走 onChange（踩过坑：点图例不重画）
  const shift = calls.onChange;
  const rowEls = el._rows;
  ok(rowEls.length === D, '图例行的替身解析出了 11 行', `${rowEls.length}`);
  rowEls[2].onclick();
  ok(view.getPinned() && view.getPinned().i === 2, '点图例第 3 行高亮了第 3 个学科', JSON.stringify(view.getPinned()));
  ok(calls.onChange === shift + 1, '点图例行调了 onChange（宿主靠它重画）');
  rowEls[2].onclick();
  ok(view.getPinned() === null, '再点图例行取消高亮');
}

function makeEl() {
  const el = {
    _html: '', _rows: [],
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    // renderLegend 会 querySelectorAll 之后逐个挂 onclick —— 返回的行对象必须**是同一批**，
    // 否则点到的行不是它挂过事件的那一行，测试就变成了在测别的对象。
    querySelectorAll(sel) {
      if (sel !== '[data-dom]') return [];
      const re = /data-dom="(\d+)"/g;
      const out = [];
      let m;
      while ((m = re.exec(this._html))) out.push({ dataset: { dom: m[1] }, onclick: null });
      this._rows = out;
      return out;
    },
  };
  return el;
}

// L0 的空数据路径：宿主会先问 getCounts()，为 null 就画「缺数据」
{
  const v = createInterdiscView({});
  ok(v.getCounts() === null, '没数据时 getCounts() 是 null');
  v.draw(makeCtx(), W, H, 1);        // 不许抛
  ok(true, '没数据时 draw 不抛异常');
  const el = makeEl();
  v.renderLegend(el);
  ok(/not loaded/.test(el.innerHTML), '没数据时图例说明是缺数据');
  v.setData({ domains: [], meta: { topicCount: 0 }, topics: '', arcs: [] }, null);  // 空但合法
  ok(v.getCounts() === null || v.getCounts().pairCount === 0, '空但合法的数据不会崩');
}

report();
