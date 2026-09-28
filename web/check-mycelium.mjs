// check-mycelium.mjs — 知识菌丝（Flow Field + Edge Bundling + Streamlines）的不变量测试。
//
//     node check-mycelium.mjs                              # 用同目录的 sunburst-data.json
//     node check-mycelium.mjs path/to/sunburst.json path/to/interdisc.json
//
// 这张图的通道和别的图都不一样，所以验法也不一样：
//
//   **推导**（纤维从哪来）—— 从 sunburst-data.json 的 arcs 独立重算 Σ C(k,2)，
//   逐对跟暴力重算比，再跟 interdisc-data.json 里预算的 55 个 shared 比。**两个独立来源**
//   给出同一个数，比任何自洽断言都强。
//
//   **几何**（场在哪、走廊怎么走、纤维长什么样）—— 全部从模块报出的 P/R/FX/FY 上量，
//   不看模块自己的说法。
//
//   **渲染**（这根纤维到底画出来了没有）—— 这条是这张图最要命的：把 35,313 根塞进**一个**
//   Path2D 里 stroke 一次，几何全对、形状也对，只是**没有密度**（一次 stroke 把整条 path
//   当一个遮罩合成一次，路径内自重叠不累积）。数 op 数发现不了这件事。所以这里断言的是
//   「批数 > 1」以及「所有 base 批的 __fibres 并集恰好是 0..n−1 各一次」，并且把每批的
//   op 数和**子路径首点**跟模型里的坐标对上 —— 免得一个变异体只把标签改对、几何画错。
//
// 状态机那一段是踩过坑的：alluvial / phil-chord 都出过「点了图例不重画」。

import { readFileSync } from 'node:fs';

const D = 11;
const EPS = 1e-9;

let checks = 0;
const fails = [];
function ok(cond, label, detail) {
  checks++;
  if (!cond) fails.push(detail ? `${label}\n      ${detail}` : label);
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

class Path2D {
  constructor() { this.ops = []; }
  moveTo(x, y) { this.ops.push(['M', x, y]); }
  lineTo(x, y) { this.ops.push(['L', x, y]); }
  closePath() { this.ops.push(['Z']); }
}

// 假 ctx。记三样：文本、**每一次 stroke 用的 path 与当时的样式**、以及渐变。
// 纤维的密度感完全落在 stroke 上，不记 stroke 就什么都验不了。
function makeCtx() {
  const noop = () => {};
  const texts = [];
  const strokes = [];
  const fills = [];
  const grads = [];
  let cur = null;
  let drawImages = 0;
  const ctx = {
    save: noop, restore: noop, setTransform: noop, translate: noop, rotate: noop,
    scale: noop,                                  // 文字反缩放用（draw 里 scale(1/k)）
    arc: noop, quadraticCurveTo: noop, bezierCurveTo: noop, strokeRect: noop, clearRect: noop,
    isPointInPath: () => false,
    measureText: (t) => ({ width: String(t).length * 6.5 }),
    createLinearGradient: () => ({ stops: [], addColorStop(o, c) { this.stops.push([o, c]); } }),
    createRadialGradient: () => {
      const g = { stops: [], addColorStop(o, c) { this.stops.push([o, c]); } };
      grads.push(g);
      return g;
    },
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    textBaseline: '', globalAlpha: 1, lineJoin: '', globalCompositeOperation: '',
    texts, strokes, fills, grads,
    drawImage: () => { drawImages++; },
    get images() { return drawImages; },
    beginPath() { cur = []; },
    moveTo(x, y) { if (cur) cur.push([x, y]); },
    lineTo(x, y) { if (cur) cur.push([x, y]); },
    closePath() { if (cur) cur.push('Z'); },
    fill(p) { fills.push({ path: p || null, ops: cur, fill: ctx.fillStyle, alpha: ctx.globalAlpha }); },
    stroke(p) {
      strokes.push({
        path: p || null, ops: p ? p.ops : cur, style: ctx.strokeStyle,
        alpha: ctx.globalAlpha, width: ctx.lineWidth, composite: ctx.globalCompositeOperation,
      });
    },
    fillText: (t, x, y) => { texts.push({ text: String(t), x, y, align: ctx.textAlign, fill: ctx.fillStyle }); },
    strokeText: noop,
  };
  return ctx;
}

// ------------------------------------------------------------------ 载入模块
// MYCELIUM 让变异测试把一份**故意改坏**的副本喂进来。
const src = readFileSync(
  process.env.MYCELIUM || new URL('./mycelium.js', import.meta.url), 'utf8');
const { createMyceliumView } = new Function('Path2D',
  src.replace(/^export\s+/gm, '')
    + '\nreturn { createMyceliumView };')(Path2D);

const sbPath = process.argv[2] || new URL('./sunburst-data.json', import.meta.url);
const prePath = process.argv[3] || new URL('./interdisc-data.json', import.meta.url);
const sb = JSON.parse(readFileSync(sbPath, 'utf8'));
let pre = null;
try { pre = JSON.parse(readFileSync(prePath, 'utf8')); } catch { pre = null; }

const W = 1600, H = 900;

// ================================================================= 1. 独立重算
const nT = sb.meta.topicCount;
const names = String(sb.topics).split('\n');
const mask = new Int32Array(nT);
for (let i = 0; i < sb.arcs.length; i += 3) mask[sb.arcs[i + 1]] |= 1 << sb.arcs[i];
const pop = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };

const TOP = new Int32Array(D);
for (let t = 0; t < nT; t++) for (let d = 0; d < D; d++) if (mask[t] >> d & 1) TOP[d]++;

const SH = new Int32Array(D * D);
const WANT = new Map();                       // "t:d" -> weight，暴力重算用
let bruteFib = 0, bruteBridge = 0;
for (let t = 0; t < nT; t++) {
  const k = pop(mask[t]);
  if (k >= 2) { bruteFib += (k * (k - 1)) / 2; bruteBridge++; }
}
for (let i = 0; i < sb.arcs.length; i += 3) WANT.set(`${sb.arcs[i + 1]}:${sb.arcs[i]}`, sb.arcs[i + 2]);
for (let t = 0; t < nT; t++) {
  const ds = [];
  for (let d = 0; d < D; d++) if (mask[t] >> d & 1) ds.push(d);
  for (let x = 0; x < ds.length; x++) for (let y = x + 1; y < ds.length; y++) SH[ds[x] * D + ds[y]]++;
}
const JAC = new Float64Array(D * D);
let maxJ = 0;
for (let i = 0; i < D; i++) {
  for (let j = i + 1; j < D; j++) {
    const s = SH[i * D + j], u = TOP[i] + TOP[j] - s;
    const v = u > 0 ? s / u : 0;
    JAC[i * D + j] = v; JAC[j * D + i] = v;
    if (v > maxJ) maxJ = v;
  }
}
const pairDist = (P, i, j) => Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
const rank = (a) => {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length);
  idx.forEach(([, i], k) => { r[i] = k; });
  return r;
};

console.log(`mycelium: ${nT.toLocaleString()} topics · Σ C(k,2) = ${bruteFib.toLocaleString()} fibres · `
  + `${bruteBridge.toLocaleString()} bridging · maxJ ${(maxJ * 100).toFixed(2)}%`);

// ================================================================= 2. 契约 / 推导
const calls = { onChange: 0 };
const view = createMyceliumView({ onChange: () => { calls.onChange++; } });

for (const name of ['setData', 'draw', 'pick', 'describe', 'renderLegend', 'setHover',
                    'getHover', 'togglePinned', 'getPinned', 'sameTarget', 'getCounts']) {
  ok(typeof view[name] === 'function', `view exports ${name}()`, `typeof = ${typeof view[name]}`);
}
ok(view.getCounts() === null, 'setData 之前 getCounts() 是 null（宿主靠这个画"缺数据"）');
// setData(null) / 空对象都不许炸
{
  let threw = null;
  try { view.setData(null); view.draw(makeCtx(), W, H, 1); } catch (e) { threw = e.message; }
  ok(!threw, 'setData(null) 之后 draw 不抛异常', threw || '');
  ok(view.getCounts() === null, 'setData(null) 之后 getCounts() 仍是 null');
  threw = null;
  try { view.setData({}); view.draw(makeCtx(), W, H, 1); } catch (e) { threw = e.message; }
  ok(!threw, 'setData({}) 也不抛（arcs 缺失）', threw || '');
}

// setData 本身不许抛。「纤维配对写错」那类变异体会让 fibA/fibB 出现 a≥b，
// 于是 corridorOf 去读一个不存在的走廊 —— 一个未捕获的 TypeError 会把整个进程打死，
// 变异测试只能把它记成 crash-only（几何上没法证明它错了）。所以在这里接住，
// **并且报成一条失败**：从一个非法推导里抛异常，本来就是模块的契约缺陷。
try {
  view.setData(sb);
} catch (e) {
  ok(false, 'setData(sunburst-data.json) 不抛异常', `${e.message}`);
  console.log(`\n${checks - fails.length} checks passed, ${fails.length} FAILED:\n`);
  for (const f of fails) console.log(`  FAIL  ${f}`);
  console.log('');
  process.exit(1);
}
ok(true, 'setData(sunburst-data.json) 不抛异常');
const counts = view.getCounts();
ok(counts && counts.disciplineCount === D, 'getCounts().disciplineCount == 11');
ok(counts && counts.fibreCount === bruteFib, 'getCounts().fibreCount == 独立重算的 Σ C(k,2)',
   `${counts && counts.fibreCount} vs ${bruteFib}`);
ok(counts && counts.bridgingTerms === bruteBridge, 'getCounts().bridgingTerms == 独立重算',
   `${counts && counts.bridgingTerms} vs ${bruteBridge}`);
ok(counts && counts.pairCount === 55, 'getCounts().pairCount == 55', `${counts && counts.pairCount}`);

const diag = view.diagnostics;
const fib = view.fibres;
const meta = view.fibreMeta;
const fields = view.fields;
ok(!!fib && fib.n === bruteFib, 'fibres.n == 独立重算', `${fib && fib.n}`);
ok(fib.FX.length === fib.n * 17 && fib.FY.length === fib.n * 17, '纤维采样数组长度 == n × 17');
ok(meta.t.length === fib.n && meta.a.length === fib.n && meta.b.length === fib.n,
   'fibreMeta 三支长度一致');
{
  let bad = 0, worst = '';
  for (let f = 0; f < fib.n; f++) {
    if (!(meta.a[f] < meta.b[f])) { bad++; if (!worst) worst = `f${f}: ${meta.a[f]}>=${meta.b[f]}`; }
    if (!(mask[meta.t[f]] >> meta.a[f] & 1) || !(mask[meta.t[f]] >> meta.b[f] & 1)) {
      bad++; if (!worst) worst = `f${f}: 术语 ${meta.t[f]} 不属于 ${meta.a[f]}/${meta.b[f]}`;
    }
  }
  ok(bad === 0, '每根纤维的两个端点学科都真的含有该术语，且 a<b', `${bad} 根不符; ${worst}`);
}
// 逐对：模块画出来的条数必须等于暴力重算的 shared(i,j)
{
  const got = new Int32Array(D * D);
  for (let f = 0; f < fib.n; f++) got[meta.a[f] * D + meta.b[f]]++;
  let bad = 0, worst = '';
  for (let i = 0; i < D; i++) {
    for (let j = i + 1; j < D; j++) {
      if (got[i * D + j] !== SH[i * D + j]) {
        bad++; if (!worst) worst = `(${i},${j}) 画出 ${got[i * D + j]} vs 重算 ${SH[i * D + j]}`;
      }
    }
  }
  ok(bad === 0, '55 对的纤维数逐对等于从 arcs 重算的 shared', `${bad} 对不符; ${worst}`);
}
// 第二来源
if (pre && Array.isArray(pre.edges)) {
  const got = new Int32Array(D * D);
  for (let f = 0; f < fib.n; f++) got[meta.a[f] * D + meta.b[f]]++;
  let bad = 0, worst = '';
  for (const e of pre.edges) {
    const lo = Math.min(e.a, e.b), hi = Math.max(e.a, e.b);
    if (got[lo * D + hi] !== e.shared) {
      bad++; if (!worst) worst = `${lo}-${hi}: ${got[lo * D + hi]} vs ${e.shared}`;
    }
  }
  ok(bad === 0, '两个独立来源（arcs 推导 vs interdisc-data.json）逐对一致', `${bad} 对不符; ${worst}`);
} else {
  console.log('  (interdisc-data.json 不可用，跳过第二来源比对)');
}

// ================================================================= 3. 布局
const P = fields.map((f) => [f.x, f.y]);
const R = fields.map((f) => f.r);
{
  let oob = 0;
  for (let i = 0; i < D; i++) {
    if (P[i][0] - R[i] < 0 || P[i][0] + R[i] > W || P[i][1] - R[i] < 0 || P[i][1] + R[i] > H) oob++;
  }
  ok(oob === 0, '11 个源场都落在世界矩形内', `${oob} 个越界`);
}
ok(diag.maxFieldOverlap <= 0.85 + 1e-9, '任意两个源场不重叠（R_i+R_j ≤ 0.85·d_ij）',
   `最坏 ${diag.maxFieldOverlap.toFixed(4)} 在 ${JSON.stringify(diag.worstPair)}`);
{
  const md = [], js = [];
  for (let i = 0; i < D; i++) for (let j = i + 1; j < D; j++) { md.push(pairDist(P, i, j)); js.push(JAC[i * D + j]); }
  const ra = rank(md), rb = rank(js), m = (ra.length - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) { num += (ra[i] - m) * (rb[i] - m); da += (ra[i] - m) ** 2; db += (rb[i] - m) ** 2; }
  const rho = num / Math.sqrt(da * db);
  ok(rho <= -0.6, '源场位置真的来自数据：Spearman(场距离, Jaccard) ≤ −0.6', `ρ = ${rho.toFixed(3)}`);
  // 模块自己也算了一个 ρ 印在图例上。两处必须一致 —— 图例里写死的数字是踩过的坑：
  // 改动布局之后真值变成 −0.768，图例却还在印 −0.73。
  ok(diag.rho != null && Math.abs(diag.rho - rho) < 1e-9,
     '模块自己报的 Spearman 与 harness 独立重算一致（图例里的数字不是写死的）',
     `模块 ${diag.rho} vs 重算 ${rho}`);
  console.log(`  源场布局：k=${diag.aniso ? diag.aniso.map((v) => v.toFixed(2)).join('/') : '?'} · `
    + `Spearman ${rho.toFixed(3)}`);
  const ps = [];
  for (let i = 0; i < D; i++) for (let j = i + 1; j < D; j++) ps.push([i, j, pairDist(P, i, j), JAC[i * D + j]]);
  ps.sort((a, b) => b[3] - a[3]);
  const strong = ps.slice(0, 3).reduce((s, p) => s + p[2], 0) / 3;
  const weak = ps.slice(-3).reduce((s, p) => s + p[2], 0) / 3;
  ok(strong < weak, '最强 3 对被拉得比最弱 3 对更近',
     `强 ${strong.toFixed(0)} vs 弱 ${weak.toFixed(0)}`);
}
{
  // 不是均匀圆环：如果摆成一个整圆，所有点到质心的距离会几乎相等
  const cx = P.reduce((s, p) => s + p[0], 0) / D, cy = P.reduce((s, p) => s + p[1], 0) / D;
  const rr = P.map((p) => Math.hypot(p[0] - cx, p[1] - cy));
  const mx = Math.max(...rr), mn = Math.min(...rr);
  ok(mx / mn > 1.25, '源场不是均匀圆环（到质心的距离有明显差异 ⟹ 位置来自数据）',
     `max/min = ${(mx / mn).toFixed(2)}`);
}
{
  const v2 = createMyceliumView({});
  v2.setData(sb);
  ok(JSON.stringify(v2.diagnostics.fieldCentres) === JSON.stringify(diag.fieldCentres)
     && JSON.stringify(v2.diagnostics.fieldRadii) === JSON.stringify(diag.fieldRadii),
     '布局是确定性的（同样输入 → 逐字节同样的场位置与半径）');
}

// ================================================================= 4. 走廊
{
  const model = view.getModel();
  const C = model.C;
  let bad = 0, worst = '';
  for (let i = 0; i < D; i++) {
    for (let j = i + 1; j < D; j++) {
      const ab = model.corridor(i, j);                      // 必须按任意顺序取，不能读 C[j*D+i]
      const ba = model.corridor(j, i);
      if (!ab || !ba || ab.length !== ba.length) { bad++; continue; }
      for (let k = 0; k < ab.length; k++) {
        if (Math.abs(ab[k][0] - ba[ab.length - 1 - k][0]) > 1e-9
          || Math.abs(ab[k][1] - ba[ab.length - 1 - k][1]) > 1e-9) {
          bad++; if (!worst) worst = `(${i},${j}) 第 ${k} 点不是逆序`;
          break;
        }
      }
    }
  }
  ok(bad === 0, '同一对只有一个走廊：corridor(a,b) 与 corridor(b,a) 严格互为逆序',
     `${bad} 对不符; ${worst}`);
  ok(C[1 * D + 0] === undefined, 'C 只存上三角（i<j）—— 逆序那一半是取的时候翻的，不是第二份账');
}
{
  const C = view.getModel().C;
  let bad = 0, worst = '', stepMismatch = 0, minClear = Infinity, clearAt = '';
  const STEPS = 48;
  for (let i = 0; i < D; i++) {
    for (let j = i + 1; j < D; j++) {
      const c = C[i * D + j];
      if (c.length !== STEPS + 2) stepMismatch++;
      if (Math.hypot(c[0][0] - P[i][0], c[0][1] - P[i][1]) > 1e-9
        || Math.hypot(c[c.length - 1][0] - P[j][0], c[c.length - 1][1] - P[j][1]) > 1e-9) bad++;
      for (let k = 0; k < D; k++) {
        if (k === i || k === j) continue;
        for (const pt of c) {
          // 留出**余量**而不是只判过/不过：0 距离最坏只有 1.0，越大于 1 越安全。
          const ratio = Math.hypot(pt[0] - P[k][0], pt[1] - P[k][1]) / R[k];
          if (ratio < minClear) { minClear = ratio; clearAt = `(${i},${j}) vs 场 ${k}`; }
          if (ratio <= 1) {
            bad++; if (!worst) worst = `(${i},${j}) 穿过场 ${k}`;
            break;
          }
        }
      }
    }
  }
  ok(stepMismatch === 0, `每条走廊都是 ${STEPS}+2 个点`, `${stepMismatch} 条不对`);
  ok(bad === 0, '走廊两端精确落在源场/目标场中心，且不穿过任何第三个源场',
     `${bad} 条不符; ${worst}; 最紧余量 ${minClear.toFixed(2)}×R 在 ${clearAt}`);
  ok(minClear > 1.15, '走廊对第三个场留有余量（不只是刚好擦过）',
     `最紧 ${minClear.toFixed(2)}×R 在 ${clearAt}`);
}

// ================================================================= 5. 微纤维
{
  let bad = 0, worst = '';
  const inField = (x, y, i) => {
    const th = Math.atan2(y - P[i][1], x - P[i][0]);
    // 用模块自己的边界半径判：取一圈里的最小值做保守判据（BLOB_LO = 0.86）
    return Math.hypot(x - P[i][0], y - P[i][1]) <= R[i] * 0.861;
  };
  for (let f = 0; f < fib.n; f++) {
    const x0 = fib.FX[f * 17], y0 = fib.FY[f * 17];
    const x1 = fib.FX[f * 17 + 16], y1 = fib.FY[f * 17 + 16];
    if (!inField(x0, y0, meta.a[f])) { bad++; if (!worst) worst = `f${f} 起点不在场 ${meta.a[f]}`; }
    if (!inField(x1, y1, meta.b[f])) { bad++; if (!worst) worst = `f${f} 终点不在场 ${meta.b[f]}`; }
  }
  ok(bad === 0, '每根纤维的起点落在源场内、终点落在目标场内', `${bad} 根不符; ${worst}`);
}
{
  let bad = 0, worst = '', nan = 0;
  for (let i = 0; i < fib.FX.length; i++) {
    if (!Number.isFinite(fib.FX[i]) || !Number.isFinite(fib.FY[i])) nan++;
  }
  ok(nan === 0, '所有采样点都是有限数（没有 NaN）', `${nan} 个`);
  for (let f = 0; f < fib.n; f++) {
    for (let s = 0; s < 17; s++) {
      const x = fib.FX[f * 17 + s], y = fib.FY[f * 17 + s];
      if (x < -1 || x > W + 1 || y < -1 || y > H + 1) { bad++; if (!worst) worst = `f${f}s${s} = ${x.toFixed(0)},${y.toFixed(0)}`; break; }
    }
  }
  ok(bad === 0, '纤维不越出世界矩形', `${bad} 根越界; ${worst}`);
}
{
  // 分叉：同一个术语从**同一个学科的同一个位置**出发 —— 这就是 Optimization 那种叉
  const first = new Map();                     // "t:a" -> [x,y]
  let bad = 0, worst = '', forked = 0;
  for (let f = 0; f < fib.n; f++) {
    const t = meta.t[f];
    for (const [d, off] of [[meta.a[f], 0], [meta.b[f], 16]]) {
      const key = `${t}:${d}`;
      const x = fib.FX[f * 17 + off], y = fib.FY[f * 17 + off];
      if (!first.has(key)) first.set(key, [x, y]);
      else {
        const [px, py] = first.get(key);
        if (Math.abs(px - x) > 1e-9 || Math.abs(py - y) > 1e-9) {
          bad++; if (!worst) worst = `${key} 两次落在不同位置`;
        }
      }
    }
  }
  for (let t = 0; t < nT; t++) if (pop(mask[t]) >= 3) forked++;
  ok(bad === 0, '同一 (术语, 学科) 的起点完全相同 ⟹ k≥3 的术语真的分叉，不是每根各画各的',
     `${bad} 处不一致`);
  ok(forked > 3000, 'k≥3 的术语数量够多（分叉不是个别现象）', `${forked}`);

  // 反过来：**同一个学科里不同术语的起点必须是散开的**。源场是一块区域，不是一个点 ——
  // 这是这张图和 node-link 的分界（学科不是节点，是一团不规则的源区）。
  // 少了这条，「起点一律取场中心」的退化写法院子里所有断言都还是绿的：
  // 分叉那条会因为「大家都一样」而通过，端点在场内那条也会因为中心就在场里而通过。
  const spread = [];
  for (let d = 0; d < D; d++) spread.push(new Set());
  for (let f = 0; f < fib.n; f++) {
    spread[meta.a[f]].add(`${fib.FX[f * 17].toFixed(2)},${fib.FY[f * 17].toFixed(2)}`);
    spread[meta.b[f]].add(`${fib.FX[f * 17 + 16].toFixed(2)},${fib.FY[f * 17 + 16].toFixed(2)}`);
  }
  let thin = 0, thinnest = '';
  for (let d = 0; d < D; d++) {
    if (spread[d].size < 500) { thin++; if (!thinnest) thinnest = `场 ${d} 只有 ${spread[d].size} 个不同起点`; }
  }
  ok(thin === 0, '每个源场里有上千个互不相同的起点 ⟹ 源区是块区域，不是一个点',
     `${thin} 个场太稀疏; ${thinnest}`);

  // 落点必须在**学科之间也独立**：同一个术语在 Biology 的落点和在 Physics 的落点不能
  // 共用同一个相对位置。哈希里漏掉学科 id 的话（只 hash 术语），每个场会长出**一模一样的
  // 扇形图案**，几何上仍然自洽、分叉和散开也都成立 —— 只有这条能抓住它。
  // 比的是**方向**（单位向量），不是原始偏移 —— 偏移里含 R[d]，而各场半径本来就不同，
  // 拿原始偏移去比，即使哈希里漏掉学科 id 也照样"不相等"，等于没测（第一版就是这样漏的）。
  // 只有方向才纯粹反映「哈希有没有带学科」。
  const dirs = new Map();                       // t -> [[ux,uy, d], ...]
  for (let f = 0; f < fib.n; f++) {
    const t = meta.t[f];
    for (const [d, o] of [[meta.a[f], 0], [meta.b[f], 16]]) {
      const dx = fib.FX[f * 17 + o] - P[d][0], dy = fib.FY[f * 17 + o] - P[d][1];
      const n = Math.hypot(dx, dy) || 1e-9;
      if (!dirs.has(t)) dirs.set(t, []);
      dirs.get(t).push([dx / n, dy / n, d]);
    }
  }
  let sameDir = 0, dirEx = '';
  for (const [t, list] of dirs) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i][2] === list[j][2]) continue;
        if (Math.abs(list[i][0] - list[j][0]) < 1e-9 && Math.abs(list[i][1] - list[j][1]) < 1e-9) {
          sameDir++;
          if (!dirEx) dirEx = `术语 ${t}: 场 ${list[i][2]} 与场 ${list[j][2]} 的方向完全相同`;
        }
      }
    }
  }
  ok(sameDir === 0, '同一个术语在不同学科里的落点方向互不相同（哈希里带了学科，不是只 hash 术语）',
     `${sameDir} 对方向重合; ${dirEx}`);
}

// ---- 束化必须真的发生：中段的横向散开要远小于两端的弦
// 这条是「把 β 设成 0（只剩弦，等于没束化）」唯一能被抓住的地方 ——
// 那种写法几何全对、走廊也照算不误，只是纤维全走了直线。
{
  const ratios = [];
  let degenerate = 0, matched = 0;
  const spread = (pts) => {
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return Math.sqrt(pts.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / pts.length);
  };
  for (let i = 0; i < D; i++) {
    for (let j = i + 1; j < D; j++) {
      const ms = [], cs = [];
      for (let f = 0; f < fib.n; f++) {
        if (meta.a[f] !== i || meta.b[f] !== j) continue;
        ms.push([fib.FX[f * 17 + 8], fib.FY[f * 17 + 8]]);
        cs.push([(fib.FX[f * 17] + fib.FX[f * 17 + 16]) / 2,
          (fib.FY[f * 17] + fib.FY[f * 17 + 16]) / 2]);
      }
      if (ms.length < 8) continue;
      matched++;
      const cm = spread(cs);
      if (cm <= 1e-6) { degenerate++; continue; }     // 所有纤维共用一条弦
      ratios.push(spread(ms) / cm);
    }
  }
  ratios.sort((a, b) => a - b);
  const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : NaN;
  // 这三条分开报，别让「没量到」伪装成「量到了而且没问题」——
  // 上一版把 cm==0 的样本 `continue` 掉了，于是 ratios 空掉、med 是 undefined，
  // 直接 TypeError 崩掉整个进程，变异测试只能记成 crash-only。
  ok(matched === 55, '55 对都取到了纤维样本', `${matched} 对`);
  ok(degenerate === 0, '每对的弦都有真实散开（不是所有纤维共用一条弦）', `${degenerate} 对退化`);
  ok(Number.isFinite(med) && med < 0.5,
     '纤维中段真的向走廊靠拢（中段散开 / 弦散开 的中位数 < 0.5）', `中位数 ${med}`);
}

// ================================================================= 6. 渲染
let ctx = makeCtx();
view.draw(ctx, W, H, 1);
{
  const base = ctx.strokes.filter((s) => s.path && s.path.__layer === 'base');
  ok(base.length > 1, '纤维是**分批** stroke 的，不是塞进一个 Path2D 画一次',
     `${base.length} 批`);
  ok(base.length === diag.batches, `批数 == 模块自报的 ${diag.batches}`, `${base.length}`);
  const notLighter = base.filter((s) => s.composite !== 'lighter').length;
  ok(notLighter === 0, "每批纤维都设了 globalCompositeOperation='lighter'（密度靠累积）",
     `${notLighter} 批没设`);
  // 并集恰好是 0..n−1 各一次
  const seen = new Int32Array(fib.n);
  let dup = 0, cnt = 0;
  for (const s of base) {
    for (const f of s.path.__fibres) { seen[f]++; cnt++; }
  }
  for (let f = 0; f < fib.n; f++) if (seen[f] !== 1) dup++;
  ok(dup === 0, '所有 base 批的纤维并集恰好覆盖每一根一次（不多不少）', `${dup} 根重复/遗漏`);
  ok(cnt === fib.n, '并集的条数 == 纤维总数', `${cnt} vs ${fib.n}`);
  // 把标签和几何绑起来：op 数、以及每个子路径的首点，都要和模型对得上
  let opBad = 0, ptBad = 0, worstOp = '', worstPt = '';
  for (const s of base) {
    if (s.ops.length !== s.path.__fibres.length * 17) {
      opBad++; if (!worstOp) worstOp = `批 ${s.path.__batch}: ${s.ops.length} ops / ${s.path.__fibres.length} 根`;
      continue;
    }
    for (let k = 0; k < s.path.__fibres.length; k++) {
      const f = s.path.__fibres[k];
      const op = s.ops[k * 17];
      if (op[0] !== 'M' || Math.abs(op[1] - fib.FX[f * 17]) > 1e-9 || Math.abs(op[2] - fib.FY[f * 17]) > 1e-9) {
        ptBad++; if (!worstPt) worstPt = `f${f}: op ${op[0]},${op[1]},${op[2]} vs ${fib.FX[f * 17]},${fib.FY[f * 17]}`;
        break;
      }
    }
  }
  ok(opBad === 0, '每批的 op 数 == 该批纤维数 × 17（标签和几何对得上）', `${opBad} 批不符; ${worstOp}`);
  ok(ptBad === 0, '每个子路径的首点 == 模型里那根纤维的起点（几何真的画出来了）', `${ptBad} 批不符; ${worstPt}`);
}
{
  // 源场：11 次填充 + 11 次描边，且渐变 0 号 stop 用的是该学科的身份色
  const blobFills = ctx.fills.filter((f) => f.fill && String(f.fill).includes('CanvasGradient') === false);
  ok(ctx.grads.length >= D, `画了至少 ${D} 个径向渐变（每个源场一个光晕）`, `${ctx.grads.length}`);
  const domColors = sb.domains.map((d) => d.color);
  let hit = 0;
  for (const c of domColors) {
    const h = String(c).replace('#', '').toLowerCase();
    const found = ctx.grads.some((g) => g.stops.some(([, s]) => {
      const m = String(s).match(/rgba?\((\d+),(\d+),(\d+)/);
      if (!m) return false;
      const hex = [1, 2, 3].map((i) => (+m[i]).toString(16).padStart(2, '0')).join('');
      return hex === h;
    }));
    if (found) hit++;
  }
  ok(hit === D, '11 个源场的光晕分别用了该学科自己的身份色', `${hit}/${D}`);
  void blobFills;
}
{
  const texts = ctx.texts.map((t) => t.text);
  let miss = 0, first = '';
  for (const d of sb.domains) if (!texts.includes(d.name)) { miss++; if (!first) first = d.name; }
  ok(miss === 0, '11 个源场的名字都被画出来了', `缺 ${miss}，例如 ${first}`);
}
{
  // 纤维的颜色必须是**单一色相**，不能是 11 个身份色的任意一个
  const base = ctx.strokes.filter((s) => s.path && s.path.__layer === 'base');
  const styles = new Set(base.map((s) => s.style));
  ok(styles.size === 1, '所有纤维批次用的是同一个颜色（单一色相，身份不靠纤维颜色）',
     `${styles.size} 种: ${[...styles].join(' ')}`);
  const domHex = new Set(sb.domains.map((d) => String(d.color).replace('#', '').toLowerCase()));
  const only = [...styles][0] || '';
  const m = only.match(/(\d+),(\d+),(\d+)/);
  const hex = m ? [1, 2, 3].map((i) => (+m[i]).toString(16).padStart(2, '0')).join('') : '';
  ok(!domHex.has(hex), '纤维的颜色不是 11 个身份色里的任何一个', `用了 ${only} (${hex})`);
}

// ================================================================= 6b. 离屏缓存（不是优化，是可用性）
// 纤维是 35,313 × 16 = 565,008 条线段，而宿主是「鼠标一动就整幅重画」。不缓存的话每一次
// mousemove 都要把这 56 万段重新光栅化一遍，交互必然卡。缓存之后每帧只剩 11 个源场多边形
// 加一次 blit。这一段断言的就是「缓存真的在命中」以及「缓存没有画出不一样的东西」。
{
  let layerCtx = null, builds = 0, lastCanvas = null;
  const v2 = createMyceliumView({
    onChange: () => {},
    makeCanvas: () => {
      builds++;
      layerCtx = makeCtx();
      lastCanvas = { width: 0, height: 0, getContext: () => layerCtx };
      return lastCanvas;
    },
  });
  v2.setData(sb);
  const drawWith = (devScale) => {
    const c = makeCtx();
    if (devScale != null) {
      c.getTransform = () => ({ a: devScale, b: 0, c: 0, d: devScale, e: 0, f: 0 });
    }
    v2.draw(c, W, H, 1);
    return c;
  };

  const c1 = drawWith(1);
  ok(builds === 1, '第一帧建一次离屏层', `建了 ${builds} 次`);
  ok(lastCanvas.width === W && lastCanvas.height === H,
     '过采样倍率 1× 时离屏画布就是世界尺寸', `${lastCanvas.width}×${lastCanvas.height}`);
  ok(c1.strokes.filter((s) => s.path).length === 0,
     '缓存路径下主画布**不再描任何纤维 path**（这正是省下来的那 56 万段）',
     `${c1.strokes.filter((s) => s.path).length} 条`);
  ok(c1.strokes.filter((s) => s.path === null).length === D,
     '源场边界仍然直画在主画布上（它们本来就便宜，且要跟着聚焦状态变）',
     `${c1.strokes.filter((s) => s.path === null).length} 条`);
  ok(c1.images === 1, '每帧恰好 blit 一次', `${c1.images}`);

  const c2 = drawWith(1);
  ok(builds === 1, '连画第二帧命中缓存，不重建离屏层', `建了 ${builds} 次`);
  ok(c2.images === 1, '第二帧也恰好 blit 一次', `${c2.images}`);

  // 取景变了 ⟹ 过采样倍率变了 ⟹ 必须重建，否则分辨率对不上（糊或者白占显存）
  drawWith(3);
  ok(builds === 2, '设备缩放 3× → 夹到 2× ⟹ 重建', `建了 ${builds} 次`);
  ok(lastCanvas.width === 2 * W, '夹到 2× 时离屏画布是 2 × 世界尺寸', `${lastCanvas.width}`);
  drawWith(0.4);
  ok(builds === 3, '设备缩放 0.4× → 夹到 1× ⟹ 再重建（不糊）', `建了 ${builds} 次`);
  ok(lastCanvas.width === W, '夹到 1× 时回到世界尺寸', `${lastCanvas.width}`);

  // 聚焦变了必须重建 —— 否则点了学科不亮
  const b4 = builds;
  v2.togglePinned({ type: 'field', i: 3 });
  drawWith(1);
  ok(builds === b4 + 1, '聚焦变化 ⟹ 重建离屏层（不然点学科不会亮）', `建了 ${builds} 次`);
  ok(layerCtx.strokes.some((s) => s.path && s.path.__layer === 'focus'),
     '重建后的层里含聚焦覆盖层');
  v2.togglePinned(null);

  // **两条路必须画出逐字节相同的东西**。缓存是一份可以悄悄跟直画分叉的账 ——
  // 除非有一条断言拿两条路的产出直接对比。这里比的是每一条 stroke 的
  // 图层 / 颜色 / alpha / 线宽 / 全部折线点。
  const sig = (strokes) => strokes
    .filter((s) => s.path && s.path.__layer)
    .map((s) => `${s.path.__layer}|${s.style}|${s.alpha.toFixed(6)}|${s.width.toFixed(6)}|`
      + JSON.stringify(s.ops));
  const vf = createMyceliumView({});          // Node 里没有 document ⟹ 走直画回退
  vf.setData(sb);
  const compare = (label, focusHit) => {
    v2.togglePinned(focusHit);
    vf.togglePinned(focusHit);
    drawWith(1);                              // 让缓存层对应到这个聚焦状态
    const cf = makeCtx();
    vf.draw(cf, W, H, 1);
    const sigL = sig(layerCtx.strokes);
    const sigF = sig(cf.strokes);
    let diff = -1;
    for (let i = 0; i < Math.max(sigL.length, sigF.length); i++) {
      if (sigL[i] !== sigF[i]) { diff = i; break; }
    }
    ok(sigL.length === sigF.length && diff < 0,
       `离屏缓存与直画回退在「${label}」下**逐条、逐点相同**（两条路不会分叉）`,
       `缓存 ${sigL.length} 条 vs 直画 ${sigF.length} 条; 第一处不同 #${diff}`);
    return { sigL, sigF, segs: cf.strokes.filter((s) => s.path).reduce((n, s) => n + s.ops.length, 0) };
  };
  // 三种聚焦状态都要比 —— 只比「无聚焦」的话，聚焦覆盖层那条分支根本没进对比
  const r0 = compare('无聚焦', null);
  ok(r0.sigL.length === diag.batches, '无聚焦时两条路都是 64 批', `${r0.sigL.length}`);
  const r1 = compare('聚焦一个源场', { type: 'field', i: 3 });
  ok(r1.sigL.length === diag.batches + 2, '聚焦源场时两条路都多出 2 条覆盖层',
     `${r1.sigL.length} vs ${diag.batches + 2}`);
  const r2 = compare('聚焦一根纤维', { type: 'fibre', id: 100 });
  ok(r2.sigL.length === diag.batches + 1, '聚焦单根时两条路都多出 1 条覆盖层',
     `${r2.sigL.length} vs ${diag.batches + 1}`);
  v2.togglePinned(null); vf.togglePinned(null);
  // 顺带把「省了多少」也钉住：直画回退一帧要描的段数不能悄悄涨回去
  ok(r0.segs > 500000, '直画回退一帧确实要描 50 万段以上（这就是必须缓存的原因）',
     `${r0.segs.toLocaleString()} 段`);
}

// ================================================================= 7. 聚焦
{
  const per = [];
  for (let i = 0; i < D; i++) per.push(0);
  for (let f = 0; f < fib.n; f++) { per[meta.a[f]]++; per[meta.b[f]]++; }
  const target = 8;                            // 挑一个场
  const expect = new Set();
  for (let f = 0; f < fib.n; f++) if (meta.a[f] === target || meta.b[f] === target) expect.add(f);

  const before = calls.onChange;
  view.togglePinned({ type: 'field', i: target });
  ok(calls.onChange === before + 1, '聚焦一个源场调了 onChange（宿主不重画的话画面停在上一帧）');
  ctx = makeCtx();
  view.draw(ctx, W, H, 1);
  const base = ctx.strokes.filter((s) => s.path && s.path.__layer === 'base');
  const seen = new Int32Array(fib.n);
  for (const s of base) for (const f of s.path.__fibres) seen[f]++;
  let baseBad = 0;
  for (let f = 0; f < fib.n; f++) if (seen[f] !== 1) baseBad++;
  ok(baseBad === 0, '聚焦时底层仍然是全部纤维（一次不多一次不少）', `${baseBad} 根异常`);

  const focusStrokes = ctx.strokes.filter((s) => s.path && s.path.__layer === 'focus');
  ok(focusStrokes.length > 0, '聚焦时画了覆盖层', `${focusStrokes.length} 条`);
  // 逐根核对：覆盖层挂的 id 列表里每一根都必须真的触及被聚焦的学科，
  // 而且 op 数要跟 id 数对得上（免得只改标签、几何画的是别的）。
  const lit = new Set();
  let wrong = 0, sample = '', opBad = 0;
  for (const s of focusStrokes) {
    const ids = s.path.__fibres || [];
    if (s.path.ops.length !== ids.length * 17) opBad++;
    for (const f of ids) {
      lit.add(f);
      if (!expect.has(f)) { wrong++; if (!sample) sample = `f${f} (${meta.a[f]},${meta.b[f]}) 不该亮`; }
    }
  }
  ok(opBad === 0, '聚焦覆盖层的 op 数 == id 数 × 17', `${opBad} 条不符`);
  // 覆盖层的**强度**也要钉住。它是"学科色 + 亮芯"两遍叠出来的，少一遍或者强度改了
  // 肉眼能看出不对，但几何和命中全都还是对的 —— 没有这条就没人管它。
  // （顺带：这个变异体改的是两条路**共用**的 strokeFibres，所以"两条路逐点相同"那条
  //   断言永远抓不到它 —— 它压根不会让两条路分叉。得直接量强度。）
  const alphas = focusStrokes.map((s) => +s.alpha.toFixed(4));
  ok(alphas.length === 2 && alphas[0] === 0.3 && alphas[1] === 0.16,
     '聚焦源场是两遍：0.30 的学科色 + 0.16 的亮芯', JSON.stringify(alphas));
  ok(wrong === 0, '亮起的每一根都真的触及被聚焦的学科', `${wrong} 根不该亮; ${sample}`);
  ok(lit.size > 0 && lit.size <= expect.size, '亮起的集合是被聚焦学科的子集', `${lit.size}/${expect.size}`);
  ok(per[target] === expect.size, `fibresTouching(${target}) 与暴力重算一致`, `${per[target]} vs ${expect.size}`);

  // 取消聚焦
  const b2 = calls.onChange;
  view.togglePinned({ type: 'field', i: target });
  ok(view.getPinned() === null && calls.onChange === b2 + 1, '再点一次取消聚焦，并调了 onChange');
  ctx = makeCtx();
  view.draw(ctx, W, H, 1);
  ok(!ctx.strokes.some((s) => s.path && s.path.__layer === 'focus'), '取消后不再画覆盖层');
}
{
  // 聚焦单根纤维
  const fid = 12345;
  view.togglePinned({ type: 'fibre', id: fid });
  ctx = makeCtx();
  view.draw(ctx, W, H, 1);
  const fs = ctx.strokes.filter((s) => s.path && s.path.__layer === 'focus');
  ok(fs.length >= 1 && fs.some((s) => s.path.ops.length === 17),
     '聚焦单根纤维时，覆盖层里恰好有一根 17 点的折线', JSON.stringify(fs.map((s) => s.path.ops.length)));
  ok(fs.length === 1 && +fs[0].alpha.toFixed(4) === 0.95,
     '聚焦单根时是一遍 0.95 的高亮', JSON.stringify(fs.map((s) => +s.alpha.toFixed(4))));
  view.togglePinned({ type: 'fibre', id: fid });
  ok(view.getPinned() === null, '再点一次取消单根聚焦');
}

// ================================================================= 8. pick / describe
view.togglePinned(null);
ctx = makeCtx();
view.draw(ctx, W, H, 1);
{
  let bad = 0, worst = '';
  for (let i = 0; i < D; i++) {
    const h = view.pick(P[i][0], P[i][1]);
    if (!h || h.type !== 'field' || h.i !== i) { bad++; if (!worst) worst = `场 ${i} 命中 ${JSON.stringify(h)}`; }
  }
  ok(bad === 0, '点在源场中心一定命中该场', `${bad} 个不符; ${worst}`);
}
{
  // 纤维中点：必须命中它自己
  let bad = 0, worst = '';
  for (let f = 0; f < fib.n; f += 977) {
    const s = 8;
    const h = view.pick(fib.FX[f * 17 + s], fib.FY[f * 17 + s]);
    if (!h || h.type !== 'fibre' || Math.abs(h.id - f) > 3) {
      bad++; if (!worst) worst = `f${f} 命中 ${JSON.stringify(h)}`;
    }
  }
  ok(bad === 0, '点在纤维上命中的是它附近的那根（不是全场随便一根）', `${bad} 处不符; ${worst}`);
}
{
  // pick 的半径守卫：**hit 为 null ⟺ 网格邻域内最近采样点 > 12px**。
  // 上一版只探了 (−9999,−9999)，那里连网格邻域都是空的，pick 会因为 best<0 返回 null，
  // 跟有没有半径守卫毫无关系 —— 于是「去掉 12px 守卫」那个变异体悄悄溜过去了。
  // 要真正验到它，必须找到「邻域里有纤维、但每一根都 >12px」的点。下面按网格扫一遍，
  // 并逐点用与 pick 相同的 3×3 邻域重算，把契约整体断言掉。
  const g = view.grid;
  const CELL = 10, RAD = 12;
  const nearestInHood = (x, y) => {
    const c = Math.min(g.cols - 1, Math.max(0, Math.floor(x / CELL)));
    const r = Math.min(g.rows - 1, Math.max(0, Math.floor(y / CELL)));
    let mind = Infinity, n = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= g.rows || cc < 0 || cc >= g.cols) continue;
        const cell = rr * g.cols + cc;
        for (let k = g.off[cell]; k < g.off[cell + 1]; k++) {
          n++;
          const i = g.idx[k];
          const d = Math.hypot(fib.FX[i] - x, fib.FY[i] - y);
          if (d < mind) mind = d;
        }
      }
    }
    return { mind, n };
  };
  let mismatch = 0, examples = '', far = 0, probes = 0;
  for (let y = 5; y < H; y += 23) {
    for (let x = 5; x < W; x += 29) {
      const { mind, n } = nearestInHood(x, y);
      const hit = view.pick(x, y);
      probes++;
      if (mind > RAD) far++;
      if ((hit === null) !== (mind > RAD)) {
        mismatch++;
        if (!examples) examples = `(${x},${y}) 最近 ${mind.toFixed(1)}px · n=${n} · pick=${JSON.stringify(hit)}`;
      }
    }
  }
  ok(probes > 1000, '扫了足够多的点', `${probes}`);
  ok(far > 0, '确实存在「邻域里有纤维但都在 12px 外」的点（否则那条守卫是死代码，测不到）',
     `只有 ${far} 个`);
  ok(mismatch === 0, 'pick 的半径守卫是精确的：返回 null ⟺ 邻域最近纤维 > 12px',
     `${mismatch}/${probes} 处不符; ${examples}`);
  ok(view.pick(-9999, -9999) === null, '点在画布外面返回 null');
}
{
  const h = view.pick(P[8][0], P[8][1]);
  const d = view.describe(h);
  ok(d.includes(sb.domains[8].name), 'describe(场) 报出学科名', d.split('\n')[0]);
  ok(d.includes(TOP[8].toLocaleString('en-US')), 'describe(场) 报出该学科自己的术语数', d);
  ok(view.describe(null) === '', 'describe(null) 返回空串');
}
{
  const f = 20000;
  const t = meta.t[f], a = meta.a[f], b = meta.b[f];
  const d = view.describe({ type: 'fibre', id: f });
  ok(d.includes(names[t]), 'describe(纤维) 报出术语名', d.split('\n')[0]);
  ok(d.includes(sb.domains[a].name) && d.includes(sb.domains[b].name), 'describe(纤维) 报出两端的学科', d);
  const wa = WANT.get(`${t}:${a}`), wb = WANT.get(`${t}:${b}`);
  ok(wa != null && d.includes(wa.toFixed(3)), 'describe 报出的源端权重 == 独立重算', d);
  ok(wb != null && d.includes(wb.toFixed(3)), 'describe 报出的目标端权重 == 独立重算', d);
}
{
  const h1 = view.pick(P[3][0], P[3][1]);
  const h2 = view.pick(P[3][0], P[3][1]);
  ok(view.sameTarget(h1, h2), '同一个点两次 pick 是同一个目标');
  ok(!view.sameTarget(h1, view.pick(P[4][0], P[4][1])), '两个不同的场不是同一个目标');
  ok(!view.sameTarget({ type: 'field', i: 1 }, { type: 'fibre', id: 1 }), '类型不同的目标不相等');
  ok(view.sameTarget(null, null), 'sameTarget(null, null) 为真');
}

// ================================================================= 9. 图例
{
  const el = {
    _html: '',
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    querySelectorAll() { return []; },
  };
  view.renderLegend(el);
  const dom = el.innerHTML.match(/data-field="\d+"/g) || [];
  ok(dom.length === D, '图例有 11 个学科行（带 data-field）', `${dom.length}`);
  ok(/93\.4%|256,276/.test(el.innerHTML), '图例写出了「93.4% 的术语只属于一个学科」这条诚实边界');
  ok(/Jaccard/.test(el.innerHTML), '图例写清楚了源场位置是 Jaccard 推导出来的');
  ok(/density|密度/.test(el.innerHTML), '图例写清楚了「粗的地方是密度，不是一个能读出的数」');
  ok(el.innerHTML.includes(counts.fibreCount.toLocaleString('en-US')),
     '图例印出的纤维总数 == getCounts()', '');
  // 图例里那个 Spearman 必须是**算出来的**，不是写的字面量
  ok(diag.rho != null && el.innerHTML.includes(diag.rho.toFixed(2)),
     '图例印的 Spearman == 模块自己算出来的 ρ（不是写死的 −0.73）', `ρ = ${diag.rho}`);
}
{
  // 图例点击必须调到 onChange（alluvial / phil-chord 的坑）
  let handler = null;
  const el = {
    _html: '',
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
    querySelectorAll() {
      return [{ dataset: { field: '5' }, set onclick(fn) { handler = fn; }, get onclick() { return handler; } }];
    },
  };
  view.renderLegend(el);
  ok(typeof handler === 'function', '图例行装了 onclick');
  const before = calls.onChange;
  handler();
  ok(calls.onChange === before + 1, '点图例行调了 onChange（宿主才会重画）');
  ok(view.getPinned() && view.getPinned().type === 'field' && view.getPinned().i === 5,
     '点图例行聚焦到对应学科', JSON.stringify(view.getPinned()));
  view.togglePinned(null);
}

// ================================================================= 10. 空数据 / 边界
{
  const v3 = createMyceliumView({});
  v3.setData({ arcs: [], domains: sb.domains, topics: '', meta: { topicCount: 0 } });
  ok(v3.getCounts() && v3.getCounts().fibreCount === 0, '空 arcs → 0 根纤维，不抛');
  let threw = null;
  try { v3.draw(makeCtx(), W, H, 1); v3.pick(0, 0); v3.describe(null); } catch (e) { threw = e.message; }
  ok(!threw, '空数据下 draw / pick / describe 都不抛', threw || '');
}

// ================================================================= 报数
if (fails.length) {
  console.log(`\n${checks - fails.length} checks passed, ${fails.length} FAILED:\n`);
  for (const f of fails) console.log(`  FAIL  ${f}`);
  console.log('');
  process.exit(1);
}
console.log(`${checks} checks passed.`);
