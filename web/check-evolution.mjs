// check-evolution.mjs — 知识地层的几何不变量测试。
//
//     node check-evolution.mjs                              # 用同目录的 openalex-history.json
//     node check-evolution.mjs path/to/other.json
//
// 这张图压在四句话上：
//
//   1. **每年，所有带的宽度之和 == 那一年层的全宽**（份额之和恒为 1）。
//   2. **层的半宽 == maxHalf · √(当年总量 / 最大年总量)** —— 平方根标度，不是线性。
//      这条是整张图成立的前提：线性标度下第一年只有 0.84px，19 世纪整段消失。
//   3. **归一化没有偷偷换过分母**：带宽反推回绝对作品数，必须等于该 field 当年真实的
//      作品数，而分母是**总量**（含未分类）不是已分类和。用错的话未分类那条带会被抹平，
//      而"层内和 == 层宽"依然成立，从图上完全看不出来。
//   4. **断层阈值是从数据现算的 p90**，不是写死的数。
//
// 前三条都**从发出的 Path2D 顶点去量**，不读布局自己的 xl/xr 数组 ——
// 一个自己算错账的布局，无法被问它自己的测试抓住。
//
// 顶点解码用的是**竖直边**：每条带在每一年恰好有两条竖边（左、右各一条），
// 它们的高度区间就是那一年的上下界。这样解码不依赖画点时的顺序。

import { readFileSync } from 'node:fs';

class Path2D {
  constructor() { this.ops = []; }
  moveTo(...a) { this.ops.push(['moveTo', ...a]); }
  lineTo(...a) { this.ops.push(['lineTo', ...a]); }
  bezierCurveTo(...a) { this.ops.push(['c', ...a]); }
  quadraticCurveTo(...a) { this.ops.push(['q', ...a]); }
  arc(...a) { this.ops.push(['arc', ...a]); }
  closePath() { this.ops.push(['close']); }
}

function makeCtx() {
  const noop = () => {};
  const texts = [];
  const fills = [];
  const ctx = {
    save: noop, restore: noop, setTransform: noop, beginPath: noop,
    arc: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop,
    bezierCurveTo: noop, closePath: noop, stroke: noop, translate: noop, rotate: noop,
    strokeText: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
    setLineDash: noop,
    isPointInPath: () => false,
    // 宽度必须**随字号缩放**（11.5px 时约 6.5px/字符），否则替身量不出真实画布上的
    // 那个事实：带名字是屏幕空间的常数大小，世界空间里的宽度随 1/k 增长。写成定值
    // 的话，"窗口变窄 → 名字被排出画面"这条路径在 Node 侧根本复现不出来。
    measureText: (t) => {
      const m = /([\d.]+)px/.exec(ctx.font);
      const px = m ? parseFloat(m[1]) : 11.5;
      return { width: String(t).length * 0.5652 * px };
    },
    createLinearGradient: () => ({ addColorStop: noop }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    textBaseline: '', globalAlpha: 1, lineJoin: '', globalCompositeOperation: '',
    texts, fills,
    fill(p) { if (p instanceof Path2D) fills.push({ path: p, alpha: ctx.globalAlpha, color: ctx.fillStyle }); },
    fillText: (t, x, y) => {
      texts.push({ text: String(t), x, y, align: ctx.textAlign, font: ctx.font,
                   width: ctx.measureText(t).width });
    },
  };
  return ctx;
}

// EVOLUTION_CHART 让变异测试把一份**故意改坏**的副本喂进来，确认下面这些断言不是空的。
const src = readFileSync(
  process.env.EVOLUTION_CHART || new URL('./evolution-strata.js', import.meta.url), 'utf8');
const { createEvolutionView } = new Function('Path2D',
  src.replace(/^export\s+/gm, '')
    + '\nreturn { createEvolutionView };')(Path2D);

const dataPath = process.argv[2] || new URL('./openalex-history.json', import.meta.url);
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

let pass = 0;
const fails = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fails.push(detail ? `${label}\n      ${detail}` : label);
}
function report() {
  if (fails.length) {
    console.log(`\n${pass} checks passed, ${fails.length} FAILED:\n`);
    for (const f of fails) console.log(`  FAIL  ${f}`);
    console.log('');
  } else {
    console.log(`${pass} checks passed.`);
  }
}

const W = 1600, H = 900;

// 线性标度下有多少年的层宽会掉到 `px` 以下 —— 图例里那个数的独立重算。
function narrowUnder(g, px) {
  return Array.from(g.totals).filter((v) => 2 * g.maxHalf * (v / g.maxTotal) < px).length;
}

// ------------------------------------------------- 数据自身的账（与视图无关）
{
  const m = data.meta;
  ok(data.years.length === 200, 'indexed 200 years', `got ${data.years.length}`);
  ok(data.years[0] === 1827 && data.years[199] === 2026, 'year range is 1827..2026',
     `${data.years[0]}..${data.years[199]}`);
  ok(m.riverFirstYear === 1827, 'the column starts at the first indexed year');
  ok(m.riverLastYear === 2024, 'the column stops at the last trustworthy year', `got ${m.riverLastYear}`);
  ok(data.fields.length === 26, 'twenty-six fields', `got ${data.fields.length}`);
  for (const f of data.fields) {
    ok(f.byYear.length === data.years.length, `field ${f.name} has one value per year`,
       `${f.byYear.length} vs ${data.years.length}`);
  }

  // 未分类 = 总量 − Σ 26 个 field，**每一年**都要成立 —— 只要有一年不成立，
  // 那一年的层宽就是错的，而"层内和 == 层宽"依然成立。
  let worstYear = null, worstDiff = 0;
  for (let i = 0; i < data.years.length; i++) {
    const sum = data.fields.reduce((s, f) => s + f.byYear[i], 0);
    const diff = Math.abs((data.totalByYear[i] - sum) - data.unclassifiedByYear[i]);
    if (diff > worstDiff) { worstDiff = diff; worstYear = data.years[i]; }
  }
  ok(worstDiff === 0, 'unclassified is exactly total minus the sum of all fields, every year',
     `worst drift ${worstDiff} at ${worstYear}`);

  // 没有出生也没有灭绝 —— 这是本图最重要的一条**负面**事实，也正是图例里那句话。
  const born = data.fields.filter((f) => f.byYear.slice(data.years.indexOf(m.riverFirstYear),
    data.years.indexOf(m.riverLastYear) + 1).some((v) => v === 0));
  ok(born.length === 0, 'no field is ever absent in the drawn window (so: no births, no extinctions)',
     `${born.length} fields have a zero year, e.g. ${born[0] && born[0].name}`);

  ok(m.excludedYears.length === 2, 'two years are excluded', `got ${m.excludedYears.length}`);
  for (const e of m.excludedYears) {
    ok(e.unclassified / e.total > 0.2, `${e.year} is excluded for a high unclassified rate`,
       `only ${(e.unclassified / e.total * 100).toFixed(1)}%`);
    ok(data.years.includes(e.year), `${e.year} is still present in the arrays`);
  }

  // 19 世纪可用：头 20 年的未分类率必须正常（与 2025/26 的 24%/70% 形成对照）。
  const early = [];
  for (let i = 0; i < 20; i++) early.push(data.unclassifiedByYear[i] / data.totalByYear[i]);
  ok(Math.max(...early) < 0.15, 'the earliest years have a normal unclassified rate',
     `worst ${(Math.max(...early) * 100).toFixed(1)}%`);
}

// ------------------------------------------------------------- API 契约枚举
const view = createEvolutionView({ onChange: () => {} });
for (const name of ['setData', 'getData', 'getModel', 'draw', 'pick', 'describe',
                    'renderLegend', 'setHover', 'getHover', 'togglePinned', 'getPinned',
                    'sameTarget', 'isExpanded', 'shortNameOf', 'getCounts']) {
  ok(typeof view[name] === 'function', `view exports ${name}()`, `typeof = ${typeof view[name]}`);
}
ok('layout' in view && 'bands' in view && 'years' in view && 'faults' in view,
   'view exposes layout / bands / years / faults getters');

view.setData(data);
ok(view.getData() === data, 'getData returns what setData was given');

const ctx = makeCtx();
view.draw(ctx, W, H, 1);

const g = view.layout;
ok(!!g, 'layout was produced');
if (!g) { report(); process.exit(1); }

const T = g.T;
ok(T === 198, 'the column draws 198 layers', `got ${T}`);
ok(g.years[0] === 1827 && g.years[T - 1] === 2024, 'layers run 1827..2024',
   `${g.years[0]}..${g.years[T - 1]}`);
ok(g.bands.length === 10, 'ten bands by default (8 + Other + Unclassified)', `got ${g.bands.length}`);

// 排除年一个顶点都不许出现。
ok(!g.years.includes(2025) && !g.years.includes(2026),
   'the excluded years are not drawn at all');
ok(g.years.every((y) => y >= 1827 && y <= 2024), 'every drawn layer is inside 1827..2024');

// --------------------------------------------- 从 Path2D 顶点解码每条带的左右边界
// 每条带在每一年恰好有两条**竖直**边。把它们按高度区间收集起来，
// 就能在完全不读布局内部数组的前提下还原 xl/xr。
function decodeBands(context) {
  return context.fills.map((f) => {
    const segs = [];
    let px = null, py = null;
    for (const op of f.path.ops) {
      if (op[0] === 'close') continue;
      const x = op[1], y = op[2];
      if (px !== null && op[0] === 'lineTo'
          && Math.abs(x - px) < 1e-9 && Math.abs(y - py) > 1e-9) {
        segs.push({ x, lo: Math.min(py, y), hi: Math.max(py, y) });
      }
      px = x; py = y;
    }
    return segs;
  });
}

const decoded = decodeBands(ctx);
ok(decoded.length === g.bands.length, 'one filled path per band',
   `${decoded.length} vs ${g.bands.length}`);

// y 越小越靠上，所以调用方传 (yOfTop, yOfBot) 还是反过来都行 —— 这里自己排好序。
// 返回 null 表示"这一层里这条带不是恰好两条竖边"，那本身就是一种错。
// 也容忍 segs 为 undefined：变异测试会把带子整个拿掉，那时这里该判 FAIL，不该把 harness 打死。
function edgesOf(segs, yA, yB) {
  if (!segs) return null;
  const lo = Math.min(yA, yB), hi = Math.max(yA, yB);
  const xs = [];
  for (const s of segs) {
    if (Math.abs(s.lo - lo) < 1e-6 && Math.abs(s.hi - hi) < 1e-6) xs.push(s.x);
  }
  return xs.length === 2 ? [Math.min(...xs), Math.max(...xs)] : null;
}

let segMissing = 0, worstSum = 0, worstHalf = 0, worstShare = 0, worstCount = null;
for (let t = 0; t < T; t++) {
  const yLo = g.yOfBot(t), yHi = g.yOfTop(t);
  let sum = 0;
  for (let i = 0; i < g.bands.length; i++) {
    const b = g.bands[i];
    const e = edgesOf(decoded[i], yLo, yHi);
    if (!e) { segMissing++; continue; }
    const width = e[1] - e[0];
    sum += width;
    // 份额反推绝对量：分母必须是**总量**（含未分类）。反推不出来就说明分母被换了。
    const share = width / (2 * g.half[t] || 1);
    const derived = share * g.totals[t];
    const want = b.kind === 'unclassified'
      ? data.unclassifiedByYear[g.t0 + t]
      : b.values[t];
    const err = Math.abs(derived - want);
    if (want > 0 && err / want > worstShare) { worstShare = err / want; worstCount = { t, i, derived, want }; }
  }
  worstSum = Math.max(worstSum, Math.abs(sum - 2 * g.half[t]));
  const wantHalf = g.maxHalf * Math.sqrt(g.totals[t] / g.maxTotal);
  worstHalf = Math.max(worstHalf, Math.abs(g.half[t] - wantHalf));
}
ok(segMissing === 0, 'every band has exactly two vertical edges in every layer',
   `${segMissing} missing`);
ok(worstSum < 1e-6, 'band widths sum to the layer width, every year (shares sum to 1)',
   `worst |Σwidth − 2·half| = ${worstSum}`);
ok(worstHalf < 1e-9, 'layer half-width is maxHalf · √(total / maxTotal) — a square-root scale',
   `worst |half − √| = ${worstHalf}${worstCount ? ` @${JSON.stringify(worstCount)}` : ''}`);
ok(worstShare < 1e-6, 'band width × total reproduces the absolute work count — the denominator is the TOTAL, not the classified sum',
   `worst relative error ${worstShare}${worstCount ? ` @year ${g.years[worstCount.t]} band ${worstCount.i}: derived ${worstCount.derived} want ${worstCount.want}` : ''}`);

// 这条就是"为什么不能用线性"的钉子：√ 标度下第一年可画，线性下不可画。
const firstHalf = g.half[0];
ok(firstHalf > 8, 'the first layer is wide enough to draw', `${firstHalf.toFixed(2)}px`);
{
  const linearHalf = g.maxHalf * (g.totals[0] / g.maxTotal);
  ok(linearHalf < 1, '…whereas a linear scale would make it sub-pixel',
     `linear would be ${(linearHalf * 2).toFixed(2)}px wide`);
  ok(narrowUnder(g, 8) > 50, 'a linear scale would strand most of the 19th century under 8px',
     `only ${narrowUnder(g, 8)} years would be under 8px`);
  ok(narrowUnder(g, 1) > 0, 'and some of them would be thinner than a single pixel',
     `${narrowUnder(g, 1)} years under 1px`);
}

// 层序固定：198 年里同一个学科永远在同一横位 —— "隆起"能被看见的全部原因。
// 若改成按当年大小排序，色带会互换位置，隆起就变成了噪声。这里从三个角度钉住它。
{
  let seams = 0;
  for (let t = 0; t < T; t++) {
    for (let i = 1; i < g.bands.length; i++) {
      const prev = edgesOf(decoded[i - 1], g.yOfBot(t), g.yOfTop(t));
      const cur = edgesOf(decoded[i], g.yOfBot(t), g.yOfTop(t));
      if (prev && cur && Math.abs(prev[1] - cur[0]) > 1e-6) seams++;
    }
  }
  ok(seams === 0, 'bands are edge-to-edge in every layer (no gaps, no overlap)', `${seams} seams`);

  ok(g.bands[0].key === data.meta.top8[0],
     'slot 0 is the largest subject of 2024, not of whichever year is being drawn',
     `slot 0 = ${g.bands[0].key}, top8[0] = ${data.meta.top8[0]}`);

  // 固定次序的定义：最上面那一层按份额降序排列。
  const widthsAt = (t) => g.bands.map((b, i) => {
    const e = edgesOf(decoded[i], g.yOfBot(t), g.yOfTop(t));
    return e ? e[1] - e[0] : 0;
  });
  const top8w = widthsAt(T - 1).slice(0, 8);
  ok(top8w.every((w, i) => i === 0 || w <= top8w[i - 1]),
     'the fixed order is descending share at the top layer (2024)',
     top8w.map((w) => w.toFixed(1)).join(' '));

  // 反过来的钉子：如果次序是"每年按大小重排"，那么每一年的宽度序列都会单调递减。
  // 事实上大半的年份都不单调 —— 因为次序由身份定，不由当年大小定。
  let monotone = 0;
  for (let t = 0; t < T; t++) {
    const w = widthsAt(t);
    if (w.every((v, i) => i === 0 || v <= w[i - 1])) monotone++;
  }
  ok(monotone < T * 0.25, 'most layers are NOT sorted by size — the order is fixed by identity',
     `${monotone} of ${T} layers happen to be monotone`);
}

// Unclassified 必须是独立的一条，不能并进 Other。
{
  const unc = g.bands.filter((b) => b.kind === 'unclassified');
  ok(unc.length === 1, 'exactly one Unclassified band', `got ${unc.length}`);
  const other = g.bands.filter((b) => b.kind === 'other');
  ok(other.length === 1, 'exactly one Other band', `got ${other.length}`);
  const t1 = T - 1;
  const ui = g.bands.findIndex((b) => b.kind === 'unclassified');
  const e = ui < 0 ? null : edgesOf(decoded[ui], g.yOfBot(t1), g.yOfTop(t1));
  const share = e ? (e[1] - e[0]) / (2 * g.half[t1]) : NaN;
  const want = data.unclassifiedByYear[g.t0 + t1] / g.totals[t1];
  ok(Math.abs(share - want) < 1e-9, 'Unclassified carries its own share, not folded into Other',
     `drawn ${(share * 100).toFixed(3)}% vs stored ${(want * 100).toFixed(3)}%`);
}

// ------------------------------------------------------------------ 断层
{
  const tv = g.tv;
  const sorted = Array.from(tv.slice(1)).sort((a, b) => a - b);
  const wantThr = sorted[Math.round(0.90 * (sorted.length - 1))];
  ok(Math.abs(g.thr - wantThr) < 1e-12, 'the fault threshold is the p90 of the measured series',
     `got ${g.thr}, recomputed ${wantThr}`);
  ok(g.thr > 0.005 && g.thr < 0.05, 'the threshold is a plausible measured value',
     `${(g.thr * 100).toFixed(2)}%`);
  ok(g.faults.length > 0 && g.faults.length < 30, 'faults are found, but sparingly',
     `${g.faults.length} runs`);

  const runsTxt = g.faults.map((f) => `${f.year0}-${f.year1}${f.lowN ? '(low n)' : ''}`).join(', ');
  // 一段是"连续超阈值年"的极大延伸，所以它只保证每一年的变化都超阈值，
  // 不保证刚好等于某个人手写的区间。断言用**交叠**，不用相等。
  const covers = (y0, y1) => g.faults.some((f) => f.year0 <= y0 && f.year1 >= y1);
  const realAt = (y) => g.faults.some((f) => !f.lowN && f.year0 <= y && f.year1 >= y);
  ok(realAt(1943) && realAt(1946) && realAt(1949),
     'a well-sampled (non-low-n) fault covers every year of the mid-century shift 1943–1949',
     `runs: ${runsTxt}`);
  ok(covers(2020, 2021), 'a fault run covers 2020–2021 (the largest-volume shift)',
     `runs: ${runsTxt}`);
  ok(g.faults.some((f) => f.lowN), 'the early runs are flagged low n', `runs: ${runsTxt}`);
  ok(g.faults.some((f) => !f.lowN), 'at least one run is real enough to read as history',
     `runs: ${runsTxt}`);
  ok(g.faults.every((f) => (f.meanVol < 100000) === f.lowN),
     'low-n is exactly the runs whose mean volume is under the declared floor',
     `runs: ${runsTxt}`);
  for (const f of g.faults) {
    ok(f.year0 <= f.year1, `fault ${f.year0}-${f.year1} is a well-formed run`);
    ok(f.peak > g.thr, `fault ${f.year0}-${f.year1} contains a year above the threshold`,
       `peak ${(f.peak * 100).toFixed(2)}% vs thr ${(g.thr * 100).toFixed(2)}%`);
    // 早年的段必须标 low n —— 那是小样本噪声，不是历史。
    if (f.year1 < 1900) {
      ok(f.lowN, `the early run ${f.year0}-${f.year1} is flagged low n (it is sampling noise)`,
         `meanVol ${Math.round(f.meanVol)}`);
    } else if (f.year0 >= 1900) {
      ok(!f.lowN, `the modern run ${f.year0}-${f.year1} is NOT flagged low n`,
         `meanVol ${Math.round(f.meanVol)}`);
    }
  }
}

// ------------------------------------------------------- 事件锚点（全部实测）
{
  const shareOf = (name, year) => {
    const f = data.fields.find((x) => x.name === name);
    const i = data.years.indexOf(year);
    return f.byYear[i] / data.totalByYear[i];
  };
  ok(shareOf('Computer Science', 1827) < shareOf('Computer Science', 1950)
     && shareOf('Computer Science', 1950) < shareOf('Computer Science', 2024),
     'Computer Science rises across the window (0.77% → 1.22% → 6.74%)',
     `${(shareOf('Computer Science', 1827) * 100).toFixed(2)}% → `
     + `${(shareOf('Computer Science', 1950) * 100).toFixed(2)}% → `
     + `${(shareOf('Computer Science', 2024) * 100).toFixed(2)}%`);

  const ah = [1827, 1900, 1950, 2000, 2024].map((y) => shareOf('Arts and Humanities', y));
  ok(ah.every((v, i) => i === 0 || v < ah[i - 1]),
     'Arts & Humanities erodes monotonically across the sampled century marks',
     ah.map((v) => (v * 100).toFixed(1) + '%').join(' → '));

  const en = [1950, 2000, 2024].map((y) => shareOf('Engineering', y));
  ok(en[0] < en[1] && en[1] > en[2],
     'Engineering uplifts and then erodes (10.8% → 19.4% → 13.0%) — a real non-monotone arc',
     en.map((v) => (v * 100).toFixed(1) + '%').join(' → '));
}

// ---------------------------------------------------- 带名字必须留在画面里
// 名字是屏幕空间里的常数大小，所以世界空间里的宽度随 1/k 增长：窗口越窄这一行越宽，
// 最外侧的就会被排出画面。1600 宽时看不出来，1280 宽时 "Unclassified" 被右边缘切掉 ——
// 这个 bug 画得出图、也没有任何读数错，只有截图看得见，所以必须有断言盯着。
{
  const shorts = new Set(g.bands.map((b) => b.short).filter(Boolean));
  const atK = (k) => {
    const c = makeCtx();
    view.draw(c, W, H, k);
    return c.texts.filter((t) => shorts.has(t.text))
      .map((t) => ({ text: t.text, k, lo: t.x - t.width / 2, hi: t.x + t.width / 2 }))
      .sort((p, q) => p.lo - q.lo);
  };

  let outside = 0, overlaps = 0, worstOut = 0;
  let widest = 0, narrowest = Infinity, droppedAtHalf = 0;
  for (const k of [1, 0.9, 0.8, 0.7, 0.6, 0.5]) {
    const mine = atK(k);
    for (const l of mine) {
      const out = Math.max(g.x0 - 1 - l.lo, l.hi - (g.x1 + 1));
      if (out > 0) { outside++; worstOut = Math.max(worstOut, out); }
    }
    for (let i = 1; i < mine.length; i++) if (mine[i].lo < mine[i - 1].hi - 1e-6) overlaps++;
    if (k === 1) widest = mine.length;
    if (k === 0.5) { narrowest = mine.length; droppedAtHalf = shorts.size - mine.length; }
  }
  ok(outside === 0, 'band labels stay inside the world box at every scale factor k = 1 … 0.5',
     `${outside} label(s) past the edge, worst ${worstOut.toFixed(1)} world px`);
  ok(overlaps === 0, 'band labels never overlap one another at any scale factor',
     `${overlaps} overlapping pair(s)`);
  ok(widest === shorts.size,
     `nothing is dropped while the row fits (all ${shorts.size} labels drawn at k = 1)`,
     `${widest} drawn`);
  ok(narrowest >= shorts.size - 2,
     'at k = 0.5 the row is still legible — shrink first, drop at most the widest couple',
     `${narrowest} drawn, ${droppedAtHalf} dropped`);
}

// ------------------------------------------------------------------ 确定性
{
  const c2 = makeCtx();
  view.draw(c2, W, H, 1);
  // 顶点 + 填充属性都要一样。只比顶点的话，随机的透明度或抖动过的行高会溜过去。
  const sig = (c) => JSON.stringify(c.fills.map((f) => [f.path.ops, f.alpha, f.color]));
  ok(sig(ctx) === sig(c2), 'same input → byte-identical geometry and styling (no Math.random)');
}

// ------------------------------------------------------------ pick / describe
{
  view.setHover(null);
  const t = g.years.indexOf(1969);
  const b = g.bands[0];
  const hit = view.pick((b.xl[t] + b.xr[t]) / 2, (g.yOfBot(t) + g.yOfTop(t)) / 2);
  ok(!!hit && hit.type === 'band' && hit.key === b.key && hit.year === 1969,
     'pick returns the band under the cursor, with its year',
     JSON.stringify(hit));
  ok(hit && hit.count === b.values[t], 'the hit reports the absolute work count',
     `${hit && hit.count} vs ${b.values[t]}`);
  ok(hit && Math.abs(hit.share - b.values[t] / g.totals[t]) < 1e-12,
     'the hit reports a SHARE of the year, not an absolute count relabelled',
     `${hit && hit.share} vs ${b.values[t] / g.totals[t]}`);
  ok(hit && hit.total === g.totals[t],
     'the hit reports the year total it is a share of', `${hit && hit.total}`);

  ok(view.pick(g.cx, g.yTop - 200) === null, 'pick above the column returns null');
  ok(view.pick(g.cx - g.maxHalf - 200, (g.yOfBot(t) + g.yOfTop(t)) / 2) === null,
     'pick left of the column returns null');

  const d = view.describe(hit);
  ok(d.includes(b.name) && d.includes('1969'), 'describe names the band and the year', d);
  ok(view.describe({ type: 'band', key: '__nope__', year: 1900 }) === '',
     'describe refuses a band key that is not in the layout');
  ok(view.describe(null) === '', 'describe(null) is empty');

  const yhit = view.pick(g.cx, (g.yOfBot(t) + g.yOfTop(t)) / 2);
  ok(!!yhit && yhit.type === 'band', 'a point inside the column always hits some band');
  ok(view.sameTarget(hit, hit), 'sameTarget is reflexive');
  ok(!view.sameTarget(hit, { ...hit, year: 1900 }), 'sameTarget separates two years');
  ok(!view.sameTarget(hit, null), 'sameTarget against null is false');
  view.togglePinned(hit);
  ok(view.getPinned() && view.getPinned().key === hit.key, 'togglePinned pins');
  view.togglePinned(hit);
  ok(view.getPinned() === null, 'togglePinned unpins the same target');
}

// ------------------------------------------------------------------ 图例
{
  const el = { innerHTML: '', querySelectorAll: () => [] };
  view.renderLegend(el);
  const html = el.innerHTML;
  // 图例里那个"线性下只有 0.85px"必须是**现算的**。写死一个数、然后让几何去凑，
  // 是这份代码明确拒绝的做法 —— 所以这里独立重算一遍，再要求它出现在文案里。
  const linPx = (2 * g.maxHalf * (g.totals[0] / g.maxTotal)).toFixed(2);
  ok(html.includes(`${linPx} px`),
     'the legend reports the linear-scale width of the first year, computed from the data',
     `expected "${linPx} px"`);
  ok(html.includes(`<b>${narrowUnder(g, 8)} of ${T} years</b>`),
     'the legend reports how many years a linear scale would strand under 8px',
     `expected "${narrowUnder(g, 8)} of ${T} years"`);
  ok(html.includes('√works'), 'the legend declares the square-root width scale');
  ok(html.includes('every one of the 198 years'),
     'the legend states that no field is ever absent (no births, no extinctions)');
  ok(html.includes('Splitting and merging cannot be shown'),
     'the legend states that splitting and merging are unobservable');
  ok(html.includes(`${(g.thr * 100).toFixed(2)}%`),
     'the legend prints the threshold it actually measured',
     `expected ${(g.thr * 100).toFixed(2)}%`);
  ok(html.includes('low n'), 'the legend explains the low-n flag');
  ok(html.includes('annotated, never drawn as displacement'),
     'the legend states faults are annotations, not deformation');
}

// ----------------------------------------------------------- 空数据路径
{
  const bare = createEvolutionView({});
  ok(bare.getCounts() === null, 'getCounts() is null before any data');
  bare.setData(null);
  ok(bare.getCounts() === null, 'getCounts() is null after setData(null)');
  ok(bare.pick(0, 0) === null, 'pick returns null without data');
  ok(bare.describe(null) === '', 'describe(null) is empty without data');
  ok(bare.getModel() === null, 'getModel() is null without data');
  let threw = null;
  const c = makeCtx();
  try { bare.draw(c, W, H, 1); } catch (e) { threw = e; }
  ok(threw === null, 'draw() does not throw without data', threw && String(threw));
  ok(c.texts.some((x) => String(x.text).includes('openalex-history.json')),
     'draw() paints the missing-data notice itself');
  const el = { innerHTML: 'x', querySelectorAll: () => [] };
  bare.renderLegend(el);
  ok(el.innerHTML === '', 'renderLegend clears itself without data');
}

report();
process.exit(fails.length ? 1 : 0);
