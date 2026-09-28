// check-coral.mjs — 知识珊瑚（7B）的不变量。
//
//   node web/check-coral.mjs                       # 用 web/coral-data.json + web/sunburst-data.json
//   node web/check-coral.mjs path/coral.json path/sunburst.json
//
// 阈值**全部来自实测**，不是先写好一个好看的数再让代码去凑。括号/标签里是实测值：
//   节点 8,614 · 链 3,445 · 叶端 1,823 · 分叉点 1,486 · 最大深度 153 · 根的孩子 9 ·
//   主枝 4（spineDepth 33 · 最大一条 5.8% · 4 条合计 8.5%）· 覆盖 85,643/85,643 ·
//   w(root) = 25,968,533 · 每帧 fill 11 + drawImage 1
//   半径：R0=44 · 中位 1.20px（= RMIN，全树 70% 落在下限上）· p90 2.63 · p99 6.91 · 最粗 44
//   平方和：ρ 层 0 违反（6,940 个节点取等号）；r 层 1,208 个节点超出，全部由下限造成
//
// 上界/下界只在**两类**地方用：① 数据文件里的定值（85,643 / 426,647 / 25,968,533 —— 精确相等）；
// ② 参数调优会动的量（节点数、深度、分叉率 —— 给一条能区分「树 / 毛虫 / 糊块」的带，不写死）。
// 结构性的东西一律取等号：平方和守恒、整数恒等式、颜色多数、链划分、可达性。
//
// 替身技法和 check-mycelium.mjs 同一套：读源码 → 剥 export → new Function 注入
// 记录版 Path2D 与 makeCtx()（Node 里没有 canvas，只能这么测渲染）。
import { readFileSync } from 'node:fs';

const D = 11;
const EPS = 1e-9;
const CELL0 = 40;                 // 和模块里的常量对齐（聚合守恒要独立重跑一次）

let checks = 0;
const fails = [];
function ok(cond, label, detail) {
  checks++;
  if (!cond) fails.push(detail ? `${label}\n      ${detail}` : label);
}
const near = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

// ------------------------------------------------------------------ 替身
class Path2D {
  constructor() { this.ops = []; }
  moveTo(x, y) { this.ops.push(['M', x, y]); }
  lineTo(x, y) { this.ops.push(['L', x, y]); }
  closePath() { this.ops.push(['Z']); }
}

function makeCtx(transform) {
  const texts = [], strokes = [], fills = [], grads = [], drawImages = [], scales = [];
  const noop = () => {};
  const ctx = {
    canvas: null, texts, strokes, fills, grads, drawImages, scales,
    _t: transform || null,
    getTransform: transform ? (() => transform) : undefined,
    save: noop, restore: noop, beginPath: noop, closePath: noop,
    translate: noop, rotate: noop,
    scale: (x, y) => { scales.push([x, y]); },
    moveTo: noop, lineTo: noop, arc: noop, rect: noop, clip: noop,
    clearRect: noop, strokeRect: noop, fillRect: noop,
    setLineDash: noop, quadraticCurveTo: noop, bezierCurveTo: noop,
    createLinearGradient: () => { const g = { addColorStop: noop }; grads.push(g); return g; },
    createRadialGradient: () => { const g = { addColorStop: noop }; grads.push(g); return g; },
    fill: (p, rule) => { fills.push({ style: ctx.fillStyle, rule, ops: p && p.ops ? p.ops.slice() : [] }); },
    stroke: (p) => { strokes.push({ style: ctx.strokeStyle, width: ctx.lineWidth, ops: p && p.ops ? p.ops.slice() : [] }); },
    drawImage: (img, ...a) => { drawImages.push({ img, a }); },
    fillText: (t, x, y) => { texts.push({ text: String(t), x, y, align: ctx.textAlign, fill: ctx.fillStyle }); },
    strokeText: noop,
  };
  return ctx;
}

// 记录被创建的离屏画布（缓存的直接证据）
const madeCanvases = [];
const makeCanvasStub = () => {
  const cv = {
    width: 0, height: 0, ctx: null,
    getContext() { if (!this.ctx) this.ctx = makeCtx(); return this.ctx; },
  };
  madeCanvases.push(cv);
  return cv;
};

// ------------------------------------------------------------------ 载入模块
// CORAL 让变异测试把一份**故意改坏**的副本喂进来。
const src = readFileSync(
  process.env.CORAL || new URL('./knowledge-coral.js', import.meta.url), 'utf8');
const { createCoralView } = new Function('Path2D',
  src.replace(/^export\s+/gm, '')
    + '\nreturn { createCoralView };')(Path2D);

const coralPath = process.argv[2] || new URL('./coral-data.json', import.meta.url);
const sbPath = process.argv[3] || new URL('./sunburst-data.json', import.meta.url);
const coral = JSON.parse(readFileSync(coralPath, 'utf8'));
const sb = JSON.parse(readFileSync(sbPath, 'utf8'));

const W = 1600, H = 900;

// ================================================================= 1. 数据完整
// 这一组**不碰模块**：直接读 JSON 独立重算。模块里任何一个数对不上都在这里露。
const N = coral.meta.clusterCount;
const cl = coral.cl;
const off = coral.cOff, cIdx = coral.cIdx;
const nT = sb.meta.topicCount;

ok(N === 85643, `cluster 总数 85,643（实测 ${N}）`);
ok(cl.x.length === N && cl.y.length === N && cl.dom.length === N && cl.articles.length === N,
  'cl 的四个数组等长且都等于 clusterCount',
  `x=${cl.x.length} y=${cl.y.length} dom=${cl.dom.length} a=${cl.articles.length}`);

let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
let artSum = 0, artBad = 0, domBad = 0, nonFinite = 0;
for (let i = 0; i < N; i++) {
  const x = cl.x[i], y = cl.y[i];
  if (!Number.isFinite(x) || !Number.isFinite(y)) nonFinite++;
  if (x < x0) x0 = x; if (x > x1) x1 = x;
  if (y < y0) y0 = y; if (y > y1) y1 = y;
  const a = cl.articles[i];
  if (!Number.isInteger(a) || a < 0) artBad++;
  artSum += a;
  const d = cl.dom[i];
  if (!Number.isInteger(d) || d < 0 || d >= D) domBad++;
}
ok(nonFinite === 0, 'cluster 坐标全部有限', `非有限 ${nonFinite}`);
ok(x0 >= -510 && x1 <= 570 && y0 >= -625 && y1 <= 480,
  '坐标落在 map 空间的文档范围内（x∈[−506.5,565.0] y∈[−621.5,476.0]）',
  `实测 x∈[${x0.toFixed(1)},${x1.toFixed(1)}] y∈[${y0.toFixed(1)},${y1.toFixed(1)}]`);
ok(x1 - x0 > 900 && y1 - y0 > 900, '是二维铺开，不是一条线',
  `spanX=${(x1 - x0).toFixed(1)} spanY=${(y1 - y0).toFixed(1)}`);
ok(artBad === 0, '文章数全为非负整数', `${artBad} 个坏值`);
ok(domBad === 0, '学科标签全在 0–10', `${domBad} 个越界`);
ok(artSum === 25968533, `Σ num_recent_articles === 25,968,533（实测 ${artSum.toLocaleString()}）`);
ok(artSum === coral.meta.totalArticles && artSum === sb.meta.totalArticles,
  '=== coral.meta.totalArticles === sunburst.meta.totalArticles',
  `${coral.meta.totalArticles} / ${sb.meta.totalArticles}`);

ok(off.length === N + 1 && off[0] === 0 && off[N] === cIdx.length,
  'cOff 是长度 N+1 的 CSR 偏移（off[0]=0，off[N]=cIdx 长度）',
  `len=${off.length} off[0]=${off[0]} off[N]=${off[N]} cIdx=${cIdx.length}`);
let mono = true;
for (let i = 1; i <= N; i++) if (off[i] < off[i - 1]) { mono = false; break; }
ok(mono, 'cOff 单调不减（每个簇的概念是连续一段）');
ok(cIdx.length === 426647 && cIdx.length === coral.meta.conceptPairs,
  `(cluster, concept) 对共 426,647（实测 ${cIdx.length}）`);
let idxBad = 0;
for (let i = 0; i < cIdx.length; i++) if (cIdx[i] < 0 || cIdx[i] >= nT) idxBad++;
ok(idxBad === 0, '概念下标无越界', `越界 ${idxBad}`);
const seenT = new Uint8Array(nT);
for (let i = 0; i < cIdx.length; i++) seenT[cIdx[i]] = 1;
let unusedT = 0;
for (let i = 0; i < nT; i++) if (!seenT[i]) unusedT++;
ok(unusedT === 0, `274,422 个术语一个不漏都被引用（未引用 ${unusedT}）`);

console.log(`coral-data: ${N.toLocaleString()} clusters · ${cIdx.length.toLocaleString()} pairs · `
  + `${artSum.toLocaleString()} articles · x∈[${x0.toFixed(1)},${x1.toFixed(1)}] `
  + `y∈[${y0.toFixed(1)},${y1.toFixed(1)}]`);

// ================================================================= 2. 逐学科对账
// coral 的 cluster_category 和 sunburst 的 domains 必须是同一把尺子，否则颜色就是两套话。
const perDom = new Array(D).fill(0);
for (let i = 0; i < N; i++) perDom[cl.dom[i]]++;
let domMismatch = 0;
for (let d = 0; d < D; d++) {
  const want = sb.domains[d] && sb.domains[d].clusters;
  const good = want === perDom[d];
  if (!good) domMismatch++;
  ok(good, `学科 ${d}（${sb.domains[d] && sb.domains[d].name}）的簇数 == sunburst.domains[${d}].clusters`,
    `coral=${perDom[d]} sunburst=${want}`);
}
ok(domMismatch === 0, '11/11 逐学科对账全部吻合');
ok(perDom.reduce((a, b) => a + b, 0) === N, '逐学科学科簇数之和 === 85,643');
ok(coral.categories.length === D, `categories 恰好 ${D} 个`, `实测 ${coral.categories.length}`);
ok(coral.categories.every((c, d) => c.name === sb.domains[d].name && c.color === sb.domains[d].color),
  '分类名与颜色逐位等于 sunburst.domains（同一个调色板，不另起一套）');

// ================================================================= 3. 契约 / 推导
const calls = { onChange: 0 };
const view = createCoralView({ onChange: () => { calls.onChange++; } });
ok(typeof view.setData === 'function' && typeof view.draw === 'function'
  && typeof view.pick === 'function' && typeof view.describe === 'function'
  && typeof view.renderLegend === 'function' && typeof view.setHover === 'function'
  && typeof view.getHover === 'function' && typeof view.togglePinned === 'function'
  && typeof view.getPinned === 'function' && typeof view.sameTarget === 'function'
  && typeof view.getCounts === 'function' && typeof view.drawHoverOverlay === 'function',
  'API 契约：宿主用到的 12 个方法齐全');
ok(view.getCounts() === null && view.getModel() === null && view.diagnostics === null
  && view.fields.length === 0, 'setData 之前：counts / model / diagnostics 为 null，fields 为空');

const before = calls.onChange;
const t0 = Date.now();
view.setData(coral, sb);
const ms = Date.now() - t0;
ok(calls.onChange === before + 1, 'setData 调了一次 onChange（宿主才知道要重画）');
ok(view.getCounts() !== null, 'setData 之后 counts 非空');

const m = view.getModel();
const diag = view.diagnostics;
const counts = view.getCounts();
const t = { X: m.X, Y: m.Y, PARENT: m.PARENT, KIDS: m.KIDS, OWN: m.OWN, W: m.W, DOM: m.DOM, DEPTH: m.DEPTH, count: m.count };

console.log(`model: ${diag.nodeCount.toLocaleString()} nodes · ${diag.chainCount.toLocaleString()} chains · `
  + `${diag.tipCount.toLocaleString()} tips · ${diag.forkCount.toLocaleString()} forks · `
  + `depth ${diag.maxDepth} · rootKids ${diag.rootKids} · limbs ${diag.limbCount} · `
  + `covered ${diag.coveredClusters}/${diag.clusterCount} · ${ms}ms`);

ok(counts.clusterCount === N && counts.disciplineCount === D && counts.conceptPairs === cIdx.length,
  'getCounts 的数据层三个数与 JSON 一致');
ok(counts.articleTotal === artSum, 'getCounts().articleTotal === 25,968,533',
  `${counts.articleTotal} vs ${artSum}`);

// 朝向：单根基部 ⟹ 根落在画面底部，而且**几乎全部节点在它上方**。
// 只翻一下 y 的符号就会把整株倒过来，这一条钉住它。
{
  let gxMin = Infinity, gxMax = -Infinity, gyMin = Infinity, gyMax = -Infinity, above = 0;
  for (let i = 0; i < t.count; i++) {
    if (m.gx[i] < gxMin) gxMin = m.gx[i];
    if (m.gx[i] > gxMax) gxMax = m.gx[i];
    if (m.gy[i] < gyMin) gyMin = m.gy[i];
    if (m.gy[i] > gyMax) gyMax = m.gy[i];
    if (m.gy[i] < m.gy[0]) above++;
  }
  ok(gxMin >= 0 && gxMax <= W && gyMin >= 0 && gyMax <= H,
    '所有节点落在世界坐标 1600×900 之内（不出画布）',
    `x∈[${gxMin.toFixed(0)},${gxMax.toFixed(0)}] y∈[${gyMin.toFixed(0)},${gyMax.toFixed(0)}]`);
  ok(m.gy[0] > 0.7 * H, `根在画面底部（实测 y=${m.gy[0].toFixed(0)} = ${(m.gy[0] / H).toFixed(2)}H）`);
  ok(above / (t.count - 1) >= 0.9,
    `≥90% 的节点在根的上方（实测 ${(above / (t.count - 1) * 100).toFixed(1)}%）—— 一株，从底部长上去`,
    `${above}/${t.count - 1}`);
}

// ================================================================= 4. 聚合守恒（一个簇都没丢）
// ① 每个节点自己那一份 OWN 拼起来必须是 0..N−1 的一个**划分** —— 无重复、无遗漏。
//    无重复尤其重要：重复就是同一批文章被算进了两棵子树，粗度和覆盖率全是假的。
const ownSeen = new Int32Array(N).fill(-1);
let dup = 0, ownTotal = 0;
for (let i = 0; i < t.count; i++) {
  for (const c of t.OWN[i]) {
    if (c < 0 || c >= N) { dup++; continue; }
    if (ownSeen[c] >= 0) dup++;
    ownSeen[c] = i;
    ownTotal++;
  }
}
ok(dup === 0, 'OWN 无重复、无越界（每个簇只属于一个节点）', `重复/越界 ${dup}`);
ok(ownTotal === N, `Σ |OWN| === 85,643（实测 ${ownTotal.toLocaleString()}）`);
let unowned = 0;
for (let i = 0; i < N; i++) if (ownSeen[i] < 0) unowned++;
ok(unowned === 0, '没有簇是孤儿（每个簇都挂到了某个节点上）', `孤儿 ${unowned}`);
ok(counts.coveredClusters === ownTotal && counts.unservedClusters === N - ownTotal,
  'getCounts 报的覆盖数与**独立数出来的** OWN 并集一致（不是自己说自己）',
  `报 ${counts.coveredClusters}，实际 ${ownTotal}`);
ok(counts.coveredClusters === N && counts.unservedClusters === 0,
  'getCounts：覆盖 85,643/85,643，未服务 0',
  `${counts.coveredClusters}/${counts.clusterCount} unserved=${counts.unservedClusters}`);

// ② 独立重跑一次 L0 聚合：聚合是**一一映射**，不是抽样。
{
  const mm = new Map();
  for (let i = 0; i < N; i++) {
    const k = Math.floor(cl.x[i] / CELL0) + ':' + Math.floor(cl.y[i] / CELL0);
    const a = mm.get(k) || { w: 0, n: 0 };
    a.w += cl.articles[i]; a.n++;
    mm.set(k, a);
  }
  let sw = 0, sn = 0;
  for (const a of mm.values()) { sw += a.w; sn += a.n; }
  ok(sn === N, `独立重算 L0 聚合：Σ 成员数 === 85,643（实测 ${sn.toLocaleString()}，${mm.size} 个吸引子）`);
  ok(sw === artSum, `独立重算 L0 聚合：Σ 权重 === 25,968,533（实测 ${sw.toLocaleString()}）`);
  ok(mm.size > 200 && mm.size < 5000, 'L0 吸引子数量级合理（粗尺度，几百个）', `${mm.size}`);
}

// ================================================================= 5. 真的分枝
// 这张图的核心。原型阶段唯一失败过的地方：没有角度闸门时它是一团扇子（深度 10、979 叶端），
// 有了闸门又不是最近邻那条蛇（深度 59、16 叶端）。所以这三条一起看。
ok(t.PARENT[0] === -1 && t.KIDS[0].length >= 2, `根没有父、且真的分叉（${t.KIDS[0].length} 个孩子）`);

// 父子互为逆 + 从根可达一切
let backBad = 0, reachable = 0;
for (let i = 1; i < t.count; i++) {
  const p = t.PARENT[i];
  if (p < 0 || p >= t.count || !t.KIDS[p].includes(i)) backBad++;
}
ok(backBad === 0, 'PARENT 与 KIDS 互为逆（每个非根节点都在它父亲的孩子表里）', `${backBad} 处不一致`);
{
  const vis = new Uint8Array(t.count);
  const st = [0];
  vis[0] = 1;
  while (st.length) {
    const i = st.pop();
    reachable++;
    for (const k of t.KIDS[i]) { if (!vis[k]) { vis[k] = 1; st.push(k); } }
  }
  ok(reachable === t.count, '从根可达全部节点（没有孤岛、没有环）',
    `${reachable}/${t.count}`);
}

ok(diag.maxDepth <= 400, '最大深度 ≤ 400 —— 钉死「长脊」退化（朴素单层实测 1,197）',
  `实测 ${diag.maxDepth}`);
ok(diag.maxDepth >= 20, '最大深度 ≥ 20 —— 不是从根上炸开的一团',
  `实测 ${diag.maxDepth}`);
const forkRatio = diag.forkCount / diag.nodeCount;
ok(forkRatio >= 0.08, '分叉点 / 节点 ≥ 8% —— 「毛虫」是 2–4%（实测 16.8%）',
  `实测 ${(forkRatio * 100).toFixed(1)}%`);
ok(forkRatio <= 0.6, '分叉点 / 节点 ≤ 60% —— 也不是糊块', `实测 ${(forkRatio * 100).toFixed(1)}%`);
ok(diag.tipCount >= 200, '叶端 ≥ 200（实测 1,823）', `实测 ${diag.tipCount}`);
ok(diag.nodeCount >= 500 && diag.nodeCount <= 120000,
  '节点数在 [500, 120000] —— 上限是 NODE_CAP，不是优化而是终止性',
  `实测 ${diag.nodeCount}`);
ok(t.KIDS[0].length >= 2 && t.DEPTH[0] === 0, '根在第 0 层');
ok(t.KIDS.every((k, i) => k.every((c) => t.DEPTH[c] === t.DEPTH[i] + 1)),
  'DEPTH 逐节点自洽（孩子比父亲深 1）');

// 「主枝」的定义：从根沿**最重的孩子**往下走到第一次真正分叉处。
// 不能拿根的孩子充数 —— 实测根有 9 个孩子，最重的一个背 97.4%，另外 8 条是残桩。
ok(diag.limbCount >= 2, `主枝 ≥ 2（实测 ${diag.limbCount}）`, `实测 ${diag.limbCount}`);
ok(diag.limbCount <= D, `主枝 ≤ ${D}（一个学科一条）`, `实测 ${diag.limbCount}`);
ok(diag.limbShare.every((s, i, a) => i === 0 || s <= a[i - 1]),
  '主枝按权重降序（最大的那条在前）', diag.limbShare.map((s) => s.toFixed(3)).join(' '));
{
  const sum = diag.limbShare.reduce((a, b) => a + b, 0);
  ok(sum <= 1 + EPS, '主枝的权重份额之和 ≤ 1（主枝互不重叠）',
    `${sum.toFixed(4)}`);
  // 这里原先断言的是「最大的主枝 > 1/11 的均分」。**M_STEP 改成 1×格子之后它不再成立**
  // （最大一条 5.8% < 均分 9.1%），而且不是回归：主干现在要走到第 33 层才真正分叉，
  // 权重压根就不在枝头上。所以钉住的是实测的那个事实 —— 不写一个好看的数字让代码去凑。
  ok(sum < 0.5,
    `主枝加起来也只有少数（实测 ${(sum * 100).toFixed(1)}%）—— 文章在**干**上，不在枝头`,
    `Σ ${(sum * 100).toFixed(2)}%`);
  ok(diag.spineDepth >= 2,
    `主干走到第 ${diag.spineDepth} 层才真正分叉（> 1 层 ⟹ 根的孩子不算主枝）`,
    `spineDepth=${diag.spineDepth}`);
  ok(diag.limbShare.every((s) => s >= 0), '没有负份额的主枝');
}

// ================================================================= 6. 粗度（平方和守恒）
// r = R0·√(W/W_T)。这个式子**本身就是** da Vinci 平方和守恒（w 可加），
// 唯一的偏离来自 RMIN 下限 —— 所以断言分三层：整数恒等式取等、单调取等、
// 平方和取 ≤、并且「自己那份为空且孩子没被夹住」时必须取等。
const R0 = 44, RMIN = 1.2, WT = m.totalArticles;
const ownW = new Float64Array(t.count);
for (let i = 0; i < t.count; i++) {
  let w = 0;
  for (const c of t.OWN[i]) w += cl.articles[c];
  ownW[i] = w;
}
let wBad = 0, wDetail = '';
for (let i = 0; i < t.count; i++) {
  let s = 0;
  for (const k of t.KIDS[i]) s += t.W[k];
  if (s + ownW[i] !== t.W[i]) {
    wBad++;
    if (!wDetail) wDetail = `节点 ${i}: ΣW_c=${s} + own=${ownW[i]} ≠ W=${t.W[i]}`;
  }
}
ok(wBad === 0, '整数恒等式：Σ W_子 + 自己那份 == W_自己（逐节点取等）', wDetail);
ok(t.W[0] === artSum, `w(root) === 25,968,533（实测 ${t.W[0].toLocaleString()}）`);

let radBad = 0, monoBad = 0, clamped = 0;
const rads = new Float64Array(t.count);      // 画出来的：max(RMIN, ρ)
const rhos = new Float64Array(t.count);      // 没有下限的：R0·√(W/W_T) —— 守恒定律在这上面成立
for (let i = 0; i < t.count; i++) {
  const want = Math.max(RMIN, R0 * Math.sqrt(t.W[i] / WT));
  const got = m.rad(i);
  rads[i] = got;
  rhos[i] = R0 * Math.sqrt(t.W[i] / WT);
  if (got !== want) radBad++;
  if (got === RMIN) clamped++;
}
ok(radBad === 0, '逐节点重算 r === max(RMIN, R0·√(W/W_T))', `${radBad} 个不符`);
for (let i = 0; i < t.count; i++) {
  for (const k of t.KIDS[i]) if (rads[i] < rads[k] - EPS) monoBad++;
}
ok(monoBad === 0, '父节点半径 ≥ 任一子节点半径（全部）', `${monoBad} 处违反`);

// 守恒定律。注意它在**无下限的 ρ** 上成立，画出来的 r 因为下限会被破坏 —— 两层分开断言：
//   ρ 层：Σ ρ_子² ≤ ρ_父²，且「自己那份为空」⟹ 取等号、「非空」⟹ 严格小于。逐节点取等。
//   r 层：允许超出，但**每处超出都必须伴随着一个被夹到 RMIN 的子节点** —— 否则就是真错。
let sqBad = 0, sqDetail = '';
let eqOwnZero = 0, eqOwnPos = 0, wrongEq = 0, ownNodes = 0;
let overR = 0, overUnexplained = 0;
for (let i = 0; i < t.count; i++) {
  if (!t.KIDS[i].length) continue;
  let sq = 0, sqR = 0, anyClamped = false;
  for (const k of t.KIDS[i]) {
    sq += rhos[k] * rhos[k];
    sqR += rads[k] * rads[k];
    if (rads[k] === RMIN) anyClamped = true;
  }
  const rp2 = rhos[i] * rhos[i];
  if (sq > rp2 + 1e-9) { sqBad++; if (!sqDetail) sqDetail = `节点 ${i}: Σρ_c²=${sq} > ρ_p²=${rp2}`; }
  if (ownW[i] === 0) { if (near(sq, rp2, 1e-9)) eqOwnZero++; else wrongEq++; }
  else { ownNodes++; if (sq < rp2 - 1e-12) eqOwnPos++; }
  if (sqR > rads[i] * rads[i] + 1e-6) { overR++; if (!anyClamped) overUnexplained++; }
}
ok(sqBad === 0, '平方和守恒（ρ 层）：Σ ρ_子² ≤ ρ_父² 逐节点成立', sqDetail);
ok(eqOwnZero > 0 && wrongEq === 0,
  '「自己那份为空」⟹ Σ ρ_子² === ρ_父² 取等号（真的守恒，不是永远小于）',
  `取等 ${eqOwnZero}，不取等 ${wrongEq}`);
ok(eqOwnPos === ownNodes, '「自己那份非空」⟹ 严格小于（自己那份占掉了半径）',
  `${eqOwnPos}/${ownNodes}`);
ok(overR > 0 && overUnexplained === 0,
  'r 层的超出**全部**由 RMIN 下限造成（每处超出的父节点都有被夹住的子节点）—— 不假装 r 也守恒',
  `超出 ${overR} 个节点，其中无法归因的 ${overUnexplained} 个`);

ok(rads[0] === Math.max(...rads), '根最粗');
ok(rads[0] > RMIN, `根半径 > RMIN（实测 ${rads[0].toFixed(2)}px）`);
let belowMin = 0;
for (let i = 0; i < t.count; i++) if (rads[i] < RMIN - EPS) belowMin++;
ok(belowMin === 0, '没有半径细到看不见的节点（全部 ≥ RMIN=1.2px）', `${belowMin} 个`);
// 文章权重极度偏斜 —— 这是实测，不是缺陷：粗度读得出差别的是主干和头几条主枝。
// 所以这里**不**断言中位数好看（它恰好等于下限），而是断言「分层的可见性真的存在」。
const sortedR = Array.from(rads).sort((a, b) => a - b);
const p50 = sortedR[Math.floor(sortedR.length * 0.5)];
const p90 = sortedR[Math.floor(sortedR.length * 0.9)];
const p99 = sortedR[Math.floor(sortedR.length * 0.99)];
const taper = rads.filter((r) => r > RMIN + 0.5).length / t.count;
ok(p50 === RMIN, `中位半径 === RMIN —— 文章权重偏斜的直接后果（实测 floor ${(clamped / t.count * 100).toFixed(0)}%）`,
  `floor=${(clamped / t.count * 100).toFixed(0)}%`);
ok(taper >= 0.10, '至少 10% 的节点明显粗于下限（粗细这个通道真的在传信息，实测 16.3%）',
  `实测 ${(taper * 100).toFixed(1)}%`);
ok(p90 >= 1.8 * RMIN, `p90 ≥ 1.8×RMIN（实测 ${(p90 / RMIN).toFixed(2)}×，2.63px）`,
  `p90=${p90.toFixed(2)}`);
ok(p99 >= 5 * RMIN, `p99 ≥ 5×RMIN（实测 ${p99.toFixed(2)}px）—— 主干与毛细差一个量级以上`,
  `p99=${p99.toFixed(2)}`);
ok(sortedR[sortedR.length - 1] === R0 * Math.sqrt(t.W[0] / WT) || rads[0] === R0,
  `最粗 === R0（根的文章权重 = 全局 ⟹ ρ=44px）`, `实测 ${sortedR[sortedR.length - 1].toFixed(2)}`);

// ================================================================= 7. 颜色来自数据
// 每个节点的颜色 = 它**子树**里文章权重最大的那个学科。逐节点独立自底向上重算。
{
  const order = [];
  const st = [0];
  while (st.length) { const i = st.pop(); order.push(i); for (const k of t.KIDS[i]) st.push(k); }
  ok(order.length === t.count, '自底向上序覆盖全部节点');
  const sums = new Float64Array(D);
  const acc = new Array(t.count);
  let domBad2 = 0, domNotMax = 0, domDetail = '';
  for (let oi = order.length - 1; oi >= 0; oi--) {
    const i = order[oi];
    sums.fill(0);
    for (const c of t.OWN[i]) sums[cl.dom[c]] += cl.articles[c];
    for (const k of t.KIDS[i]) { const s = acc[k]; for (let d = 0; d < D; d++) sums[d] += s[d]; }
    let mx = 0;
    for (let d = 0; d < D; d++) if (sums[d] > mx) mx = sums[d];
    const got = t.DOM[i];
    if (got < 0 || got >= D) domBad2++;
    else if (sums[got] !== mx) { domNotMax++; if (!domDetail) domDetail = `节点 ${i}: DOM=${got} 权重 ${sums[got]} ≠ 最大 ${mx}`; }
    acc[i] = Float64Array.from(sums);
  }
  ok(domBad2 === 0, 'DOM 全部落在 0–10', `${domBad2} 个越界`);
  ok(domNotMax === 0, '每个节点的颜色都是它子树里文章权重最大的学科（逐节点重算取等）', domDetail);
  // 根的颜色必须等于全局文章权重最大的学科
  const gs = new Float64Array(D);
  for (let i = 0; i < N; i++) gs[cl.dom[i]] += cl.articles[i];
  let gd = 0;
  for (let d = 1; d < D; d++) if (gs[d] > gs[gd]) gd = d;
  ok(t.DOM[0] === gd, `根的颜色 === 全局文章权重最大的学科（#${gd} ${sb.domains[gd].name}）`,
    `根 DOM=${t.DOM[0]}，全局最大 ${gd}`);
}

// 链：degree-2 的极大路径，颜色 = **末端**节点的颜色；颜色一变就切断。
{
  const chains = m.chains;
  ok(chains.length === diag.chainCount, '链条数 === diagnostics.chainCount');
  const times = new Int32Array(t.count);
  let badColour = 0, badLink = 0, badTail = 0, badHead = 0;
  for (const ch of chains) {
    if (ch.idx.length < 2) badLink++;
    if (ch.idx[0] !== t.PARENT[ch.idx[1]]) badHead++;
    for (let k = 1; k < ch.idx.length; k++) {
      times[ch.idx[k]]++;
      if (t.DOM[ch.idx[k]] !== ch.colour) badColour++;
      if (k >= 2 && t.PARENT[ch.idx[k]] !== ch.idx[k - 1]) badLink++;
    }
    if (t.DOM[ch.idx[ch.idx.length - 1]] !== ch.colour) badTail++;
  }
  ok(badColour === 0, '链内（起点之后）每个节点的 DOM === 链色 —— 颜色一变就切断', `${badColour} 处`);
  ok(badTail === 0, '链色 === 末端节点的颜色（末端更具体，不是起点）', `${badTail} 处`);
  ok(badHead === 0, '链的第一个节点是第二个节点的父亲', `${badHead} 处`);
  ok(badLink === 0, '链内相邻两点严格是父子（链就是一条路径）', `${badLink} 处`);
  let miss = 0, multi = 0;
  for (let i = 1; i < t.count; i++) { if (times[i] === 0) miss++; if (times[i] > 1) multi++; }
  ok(miss === 0 && multi === 0, '所有非根节点恰好落在一条链上（链是节点集的一个划分）',
    `漏 ${miss} 重复 ${multi}`);
  let coBad = 0;
  for (let i = 0; i < t.count; i++) if (m.chainOf[i] < 0 || m.chainOf[i] >= chains.length) coBad++;
  ok(coBad === 0, 'chainOf 覆盖每个节点', `${coBad} 个为 −1`);
  const distinct = new Set(chains.map((c) => c.colour));
  ok(distinct.size >= 2 && distinct.size <= D, `链色种数在 2–${D} 之间（实测 ${distinct.size}）`);
  console.log(`chains: ${chains.length.toLocaleString()} · 颜色 ${distinct.size} 种 `
    + `· 平均 ${(chains.reduce((s, c) => s + c.idx.length, 0) / chains.length).toFixed(1)} 节点/链`);
}

// ================================================================= 8. 确定性
// 生长必须是输入的纯函数，否则「同一份数据长出来的珊瑚」这句话就没意义。
ok(!/Math\.random\s*\(/.test(src), '源码里没有一处 Math.random 调用（注释里提到不算）');
{
  const v2 = createCoralView({});
  v2.setData(coral, sb);
  const m2 = v2.getModel();
  let same = m2.count === t.count;
  if (same) {
    for (let i = 0; i < t.count; i++) {
      if (m2.X[i] !== t.X[i] || m2.Y[i] !== t.Y[i] || m2.PARENT[i] !== t.PARENT[i]
        || m2.W[i] !== t.W[i] || m2.DOM[i] !== t.DOM[i] || m2.DEPTH[i] !== t.DEPTH[i]) { same = false; break; }
    }
  }
  ok(same, '同输入重跑：节点坐标 / 父指针 / 权重 / 颜色 / 层数逐位相同');
  ok(JSON.stringify(m2.chains) === JSON.stringify(m.chains), '同输入重跑：链的切分逐位相同');
  ok(m2.ox === m.ox && m2.oy === m.oy && m2.kx === m.kx && m2.ky === m.ky,
    '同输入重跑：世界仿射逐位相同');
  let rSame = true;
  for (let i = 0; i < t.count; i++) if (m2.rad(i) !== m.rad(i)) { rSame = false; break; }
  ok(rSame, '同输入重跑：半径逐位相同');
}

// ================================================================= 9. 渲染 / 离屏缓存
// Mycelium 那一课是实测出来的（每帧直画 565,008 段，鼠标一动就整帧重光栅化）。
// 这里断言三件事：主画布 0 次枝条 fill、恰好 1 次 drawImage、缓存路径与直画回退**逐点相同**。
{
  madeCanvases.length = 0;
  const vc = createCoralView({ makeCanvas: makeCanvasStub });
  vc.setData(coral, sb);

  const main = makeCtx();
  vc.draw(main, W, H, 1);
  const firstFills = main.fills.length;
  const firstOps = main.fills.reduce((s, f) => s + f.ops.length, 0);
  ok(firstFills === 0, '主画布上没有一次枝条 fill（枝条全在离屏层上）', `实测 ${firstFills}`);
  ok(main.drawImages.length === 1, '每帧恰好 1 次 drawImage', `实测 ${main.drawImages.length}`);
  ok(main.strokes.length === 0, '无悬停 / 无聚焦时主画布不描边', `实测 ${main.strokes.length}`);
  ok(main.texts.length === 2 * view.fields.length,
    '标签画了：每个学科一次投影 + 一次本体',
    `实测 ${main.texts.length}（${view.fields.length} 个学科）`);
  ok(madeCanvases.length === 1, '第一帧只建了一个离屏画布（基础层）', `实测 ${madeCanvases.length}`);
  const layerCtx = madeCanvases[0].ctx;
  ok(layerCtx && layerCtx.fills.length === D,
    `基础层里恰好 ${D} 次 fill —— 一种颜色一个 Path2D（不是一个节点一次 draw）`,
    `实测 ${layerCtx ? layerCtx.fills.length : 'null'}`);
  const nonEmpty = layerCtx.fills.filter((f) => f.ops.length > 0).length;
  ok(nonEmpty === D, `每个学科色都真的有枝条用到（实测 ${nonEmpty}/${D}）`);
  ok(firstOps === 0, '主画布上的路径操作数为 0（fill 全落在离屏层）', `实测 ${firstOps}`);
  console.log(`draw #1: fills ${layerCtx.fills.length} on layer · drawImage ${main.drawImages.length} `
    + `· fillText ${main.texts.length} · pathOps ${layerCtx.fills.reduce((s, f) => s + f.ops.length, 0).toLocaleString()}`);

  // 第二帧：不重建，且没有新的路径操作
  const made2 = madeCanvases.length;
  const main2 = makeCtx();
  vc.draw(main2, W, H, 1);
  ok(madeCanvases.length === made2, '第二帧不重建离屏层（缓存命中）',
    `${made2} → ${madeCanvases.length}`);
  ok(main2.drawImages.length === 1, '第二帧仍然只 drawImage 一次');
  ok(main2.fills.length === 0, '第二帧主画布上 0 次 fill');
  const layer2 = madeCanvases[0].ctx;
  ok(layer2.fills.length === 11, '第二帧没有往上加路径（层没被重画）',
    `实测 ${layer2.fills.length}`);

  // 悬停：不重建层，只多一次描边
  const someNode = 1 + Math.floor(diag.nodeCount / 3);
  vc.setHover({ type: 'node', i: someNode });
  const main3 = makeCtx();
  vc.draw(main3, W, H, 1);
  ok(madeCanvases.length === made2, '悬停**不**重建离屏层', `${made2} → ${madeCanvases.length}`);
  ok(main3.strokes.length === 1, '悬停只多一次 stroke（那一条链）', `实测 ${main3.strokes.length}`);
  ok(near(main3.strokes[0].width, 1, 1e-9), '悬停描边线宽 = 1/k（不跟着缩放变粗）',
    `实测 ${main3.strokes[0].width}`);
  vc.setHover(null);

  // 过采样：跟着当前变换走，夹在 [1,2]
  for (const [a, want] of [[5, 2], [0.4, 1], [1.5, 1.5]]) {
    const v3 = createCoralView({ makeCanvas: makeCanvasStub });
    v3.setData(coral, sb);
    const n0 = madeCanvases.length;
    v3.draw(makeCtx({ a, b: 0, c: 0, d: a, e: 0, f: 0 }), W, H, a);
    const cv = madeCanvases[n0];
    ok(cv && cv.width === Math.round(W * want) && cv.height === Math.round(H * want),
      `变换 a=${a} → 过采样 ${want}×（夹在 [1,2]）`,
      `实测 ${cv ? `${cv.width}×${cv.height}（期望 ${Math.round(W * want)}×${Math.round(H * want)}）` : 'null'}`);
    ok(cv && cv.ctx.scales.some(([sx]) => near(sx, want)),
      `变换 a=${a} → 离屏层按 ${want}× 缩放绘制`);
  }

  // 聚焦：重建 lit 层；取消聚焦后不再建
  const n1 = madeCanvases.length;
  vc.togglePinned({ type: 'discipline', i: 0 });
  const main4 = makeCtx();
  vc.draw(main4, W, H, 1);
  ok(madeCanvases.length === n1 + 2, '聚焦改变 ⟹ 基础层与高亮层一起重建',
    `${n1} → ${madeCanvases.length}`);
  ok(main4.drawImages.length === 2, '聚焦时两帧层：基础 + 高亮', `实测 ${main4.drawImages.length}`);
  const litCtx = madeCanvases[madeCanvases.length - 1].ctx;
  ok(litCtx.fills.length === 1, '高亮层只有一次 fill（一个颜色一次画完）', `实测 ${litCtx.fills.length}`);
  const n2 = madeCanvases.length;
  const main5 = makeCtx();
  vc.draw(main5, W, H, 1);
  ok(madeCanvases.length === n2, '同一聚焦下第二帧也不重建');

  // 同一个视图、只改变换：必须重新光栅化 —— 否则放大就是糊的。
  // 缓存键里带倍率，这一条直接钉住它。
  {
    const vt = createCoralView({ makeCanvas: makeCanvasStub });
    vt.setData(coral, sb);
    const n0 = madeCanvases.length;
    const t1 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const t2 = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
    vt.draw(makeCtx(t1), W, H, 1);
    ok(madeCanvases.length === n0 + 1, '同一视图第一帧建一层');
    vt.draw(makeCtx(t2), W, H, 2);
    ok(madeCanvases.length === n0 + 2, '变换 1× → 2× ⟹ 重新光栅化（缓存键里有倍率）',
      `${n0 + 1} → ${madeCanvases.length}`);
    vt.draw(makeCtx(t2), W, H, 2);
    ok(madeCanvases.length === n0 + 2, '同一倍率再来一帧不重建');
    vt.draw(makeCtx(t1), W, H, 1);
    ok(madeCanvases.length === n0 + 3, '变回 1× 也要重建（不是只有第一次算数）');
  }
  vc.togglePinned(null);
  const n3 = madeCanvases.length;
  const main6 = makeCtx();
  vc.draw(main6, W, H, 1);
  ok(madeCanvases.length === n3 + 1, '取消聚焦后只重建基础层（不再建高亮层）',
    `${n3} → ${madeCanvases.length}`);
  ok(main6.drawImages.length === 1, '取消聚焦后回到 1 次 drawImage');

  // 缓存路径 vs 直画回退：**逐条逐点相同**。
  // 这是整个离屏方案唯一可能悄悄改变画面的地方，所以必须逐点比，不是比数量。
  const vDirect = createCoralView({ makeCanvas: null });
  vDirect.setData(coral, sb);
  const direct = makeCtx();
  vDirect.draw(direct, W, H, 1);
  const vCache = createCoralView({ makeCanvas: makeCanvasStub });
  vCache.setData(coral, sb);
  const n4 = madeCanvases.length;
  const cached = makeCtx();
  vCache.draw(cached, W, H, 1);
  const cacheLayer = madeCanvases[n4].ctx;
  ok(direct.fills.length === cacheLayer.fills.length,
    '缓存路径与直画回退：fill 次数相同',
    `${direct.fills.length} vs ${cacheLayer.fills.length}`);
  ok(JSON.stringify(direct.fills.map((f) => f.style)) === JSON.stringify(cacheLayer.fills.map((f) => f.style)),
    '缓存路径与直画回退：每个颜色的出现顺序相同');
  ok(JSON.stringify(direct.fills.map((f) => f.ops)) === JSON.stringify(cacheLayer.fills.map((f) => f.ops)),
    '缓存路径与直画回退：每条路径的操作**逐点相同**');
  ok(direct.drawImages.length === 0 && cached.drawImages.length === 1,
    '直画回退不 drawImage，缓存路径 drawImage（两条路真的不一样）');
  const directOps = direct.fills.reduce((s, f) => s + f.ops.length, 0);
  ok(directOps > m.chains.length * 4,
    `路径操作数 > 4×链条数（锥形多边形每段至少 4 个点，实测 ${directOps.toLocaleString()} / ${m.chains.length.toLocaleString()} 链）`);
}

// ================================================================= 10. pick / describe
{
  ok(view.pick(1e9, 1e9) === null, '点远处（空白）返回 null');
  const hit = view.pick(m.gx[1], m.gy[1]);
  ok(hit && hit.type === 'node' && hit.i === 1,
    '在模型给的世界坐标上 pick 得到那个节点（不猜屏幕位置）', JSON.stringify(hit));
  const sNode = view.describe(hit);
  ok(typeof sNode === 'string' && sNode.includes('服务') && sNode.includes('第') && sNode.includes('半径'),
    'describe(节点) 报出服务的文章数 / 层数 / 半径', sNode);
  ok(sNode.includes(t.W[1].toLocaleString('en-US')),
    'describe 里的文章数 === 模型里的 W（不是另算一个）', sNode);
  const sDisc = view.describe({ type: 'discipline', i: 0 });
  ok(sDisc.includes(sb.domains[0].name) && sDisc.includes('个簇'),
    'describe(学科) 报出簇数与「以它为主色」的枝条数', sDisc);
  ok(view.describe(null) === '', 'describe(null) 返回空串');

  // 叶端 / 分叉点 / 枝条三种 kind 都能报出来
  let leaf = -1, fork = -1;
  for (let i = 0; i < t.count; i++) {
    if (leaf < 0 && !t.KIDS[i].length && i > 0) leaf = i;
    if (fork < 0 && t.KIDS[i].length > 1) fork = i;
    if (leaf >= 0 && fork >= 0) break;
  }
  ok(view.describe({ type: 'node', i: leaf }).includes('叶端'), '叶端报「叶端」',
    view.describe({ type: 'node', i: leaf }));
  ok(view.describe({ type: 'node', i: fork }).includes('分叉点'), '多孩子报「分叉点」',
    view.describe({ type: 'node', i: fork }));

  const a = { type: 'node', i: 3 }, b = { type: 'discipline', i: 3 };
  ok(view.sameTarget(a, { type: 'node', i: 3 }), 'sameTarget 自反（node）');
  ok(view.sameTarget(b, { type: 'discipline', i: 3 }), 'sameTarget 自反（discipline）');
  ok(view.sameTarget(null, null), 'sameTarget(null, null)');
  ok(!view.sameTarget(a, b), 'sameTarget 不把 node:3 和 discipline:3 混为一谈');
  ok(!view.sameTarget(a, null), 'sameTarget(a, null) 为假');

  // 钉住 / 取消：focus 与 pinned 同步
  view.togglePinned(a);
  ok(view.getPinned() && view.getPinned().i === 3 && view.focus && view.focus.i === 3,
    'togglePinned 后 pinned 与 focus 同步');
  view.togglePinned(a);
  ok(view.getPinned() === null && view.focus === null, '再点一次取消钉住');
}

// ================================================================= 11. 图例
{
  const rows = [];
  for (let d = 0; d < D; d++) rows.push({ dataset: { disc: String(d) }, onclick: null });
  const el = { innerHTML: '', querySelectorAll: (sel) => (sel.includes('[data-disc]') ? rows : []) };
  const before2 = calls.onChange;
  view.renderLegend(el);
  ok(el.innerHTML.includes(`data-disc="0"`) && el.innerHTML.includes(`data-disc="${D - 1}"`),
    '图例列出全部 11 个学科行');
  ok(rows.every((r) => typeof r.onclick === 'function'), '每个学科行都挂上了点击处理');
  ok(el.innerHTML.includes('诚实边界 ①') && el.innerHTML.includes('诚实边界 ②')
    && el.innerHTML.includes('诚实边界 ③') && el.innerHTML.includes('诚实边界 ④'),
    '四条诚实边界都写进图例（拓扑是长出来的 / 吸引子聚合过 / 主枝不色纯 / 只有 N 条主枝且相差很大）');
  ok(el.innerHTML.includes('拓扑是算法长出来的'), '边界①明说拓扑不是数据的父子关系');
  ok(el.innerHTML.includes('不等于'), '边界②明说「一个吸引点」不等于「一个 cluster」');
  // 这两条必须**贴着标签**比，不能用 includes('10') 那种松比较 ——
  // 图例里有 10,920 这种数字，松比较会让「写死主枝数」的变异体蒙混过关（实测过）。
  const solid = diag.limbShare.filter((s) => s >= 0.01).length;
  ok(el.innerHTML.includes(`<b>${diag.limbCount}</b> 条主枝`),
    `图例里的主枝数 === diagnostics.limbCount（${diag.limbCount}）`,
    el.innerHTML.match(/主干分成[^。]*。/)?.[0] || '');
  ok(el.innerHTML.includes(`<b>${solid} 条是实的</b>`),
    `图例报了「几条主枝是实的」（独立重算 = ${solid}）—— 不把 4 条写成势均力敌的 4 条`);
  // 还有一条更重要的：这几条主枝加起来只占 8.5%。只报「4 条主枝」会让人以为
  // 「文章分成 4 支」，所以图例必须把**它们总共占多少**也说出来（实测 8.5%）。
  const shareSum = diag.limbShare.reduce((a, b) => a + b, 0);
  ok(el.innerHTML.includes(`<b>${(shareSum * 100).toFixed(1)}%</b>`),
    `图例报了主枝**总共**占多少（独立重算 = ${(shareSum * 100).toFixed(1)}%）—— 权重在干上`);
  ok(el.innerHTML.includes(`第 <b>${diag.spineDepth}</b> 层才真正分叉`),
    `图例报了主干走了多深才分叉（= ${diag.spineDepth}）—— 「根的孩子」不是主枝`);

  rows[5].onclick();
  ok(calls.onChange === before2 + 1, '点图例行调了 onChange（宿主才会重画）');
  ok(view.getPinned() && view.getPinned().type === 'discipline' && view.getPinned().i === 5,
    '点图例行聚焦到对应学科', JSON.stringify(view.getPinned()));
  view.togglePinned(null);
}

// ================================================================= 12. 空数据 / 边界
{
  ok(view.fields.length === D, `fields 有 ${D} 个学科`, `实测 ${view.fields.length}`);
  ok(view.fields.every((f) => Number.isFinite(f.x) && Number.isFinite(f.y) && f.name && f.colour),
    'fields 的坐标 / 名字 / 颜色齐全');
  ok(view.fields.every((f) => f.x >= 0 && f.x <= W && f.y >= 0 && f.y <= H),
    '学科标签落在世界坐标内（不会飘到画布外）');

  const v3 = createCoralView({ onChange: () => {} });
  let threw = null;
  try {
    v3.setData(null, sb);
    ok(v3.getCounts() === null, 'setData(null) → getCounts() 为 null');
    ok(v3.getModel() === null && v3.diagnostics === null && v3.fields.length === 0,
      'setData(null) → model / diagnostics / fields 都空');
    v3.draw(makeCtx(), W, H, 1);
    ok(v3.pick(10, 10) === null, 'setData(null) → pick 返回 null');
    ok(v3.describe(null) === '' && v3.renderLegend({ innerHTML: '', querySelectorAll: () => [] }) === undefined,
      'setData(null) → describe / renderLegend 不抛');
  } catch (e) { threw = e.message; }
  ok(!threw, '空数据路径不抛', threw || '');

  // 缺 sunburst（第二个参数是 null）也必须能长出来，只是报不出概念名
  const v4 = createCoralView({});
  let threw2 = null;
  try {
    v4.setData(coral, null);
    ok(v4.getCounts() && v4.getCounts().nodeCount === diag.nodeCount,
      'sunburst 缺失时照样长出来（术语名只影响 describe 的文案）');
    v4.draw(makeCtx(), W, H, 1);
  } catch (e) { threw2 = e.message; }
  ok(!threw2, '缺 sunburst 时不抛', threw2 || '');

  // 长出来的东西和参数一起报出来，方便对着截图调参
  console.log(`params: CELL0=${diag.cell0} ANGLE=${diag.angle}° SHRINK=${diag.shrink} `
    + `MAXLEVEL=${diag.maxLevel} MINREC=${diag.minRec} · R0=${R0} RMIN=${RMIN} `
    + `· aniso ${diag.aniso.toFixed(2)} · scale ${diag.scale.toFixed(2)}`);
}

// ================================================================= 报数
if (fails.length) {
  console.log(`\n${checks - fails.length} checks passed, ${fails.length} FAILED:\n`);
  for (const f of fails) console.log(`  FAIL  ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`${checks} checks passed.`);
