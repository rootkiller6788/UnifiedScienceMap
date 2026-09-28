// check-river.mjs — 河流图的几何不变量测试。
//
//     node check-river.mjs                              # 用同目录的 openalex-history.json
//     node check-river.mjs path/to/other.json
//
// 占比河流只压在一句话上：
//
//   **每一年，所有带的高度之和 == 河高**（因为份额之和恒为 1）。
//
// 而它的**诚实性**压在另一句话上：
//
//   **每条带的高度 == 该年该学科的作品数 / 该年总作品数 × 河高** ——
//   也就是「归一化没有偷偷换过分母」。分母必须是**总作品数**（含未分类），
//   不是已分类数；用错的话未分类那条带会被抹平，而且河高依然是对的，
//   从图上完全看不出来。所以下面按带逐年反推回绝对作品数。
//
// 两条都**从发出的 Path2D 顶点去量**，不读布局自己的 top/bot 数组 ——
// 一个自己算错账的布局，无法被问它自己的测试抓住。

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
    isPointInPath: () => false,
    measureText: (t) => ({ width: String(t).length * 6.5 }),
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

// RIVER_CHART 让变异测试把一份**故意改坏**的副本喂进来，确认下面这些断言不是空的。
const src = readFileSync(
  process.env.RIVER_CHART || new URL('./evolution-river.js', import.meta.url), 'utf8');
const { createRiverView } = new Function('Path2D',
  src.replace(/^export\s+/gm, '')
    + '\nreturn { createRiverView };')(Path2D);

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

// ------------------------------------------------- 数据自身的账（与视图无关）
{
  const m = data.meta;
  ok(data.years.length === 200, 'indexed 200 years', `got ${data.years.length}`);
  ok(data.years[0] === 1827 && data.years[199] === 2026, 'year range is 1827..2026',
     `${data.years[0]}..${data.years[199]}`);
  ok(m.riverFirstYear === 1827, 'river starts at the first indexed year');
  ok(m.riverLastYear === 2024, 'river stops at the last trustworthy year', `got ${m.riverLastYear}`);
  ok(data.fields.length === 26, 'twenty-six fields', `got ${data.fields.length}`);
  for (const f of data.fields) {
    ok(f.byYear.length === data.years.length, `field ${f.name} has one value per year`,
       `${f.byYear.length} vs ${data.years.length}`);
  }

  // 未分类 = 总量 − Σ 26 个 field。**每一年**都要成立 —— 只要有一年不成立，
  // 那一年河的顶部就会是错的，而河高仍然对。
  let worstYear = null, worstDiff = 0;
  for (let i = 0; i < data.years.length; i++) {
    const sum = data.fields.reduce((s, f) => s + f.byYear[i], 0);
    const derived = data.totalByYear[i] - sum;
    const diff = Math.abs(derived - data.unclassifiedByYear[i]);
    if (diff > worstDiff) { worstDiff = diff; worstYear = data.years[i]; }
    if (diff !== 0) fails.push(`unclassified for ${data.years[i]}: total-field = ${derived}, stored ${data.unclassifiedByYear[i]}`);
  }
  pass++;
  ok(worstDiff === 0, 'unclassified is exactly total minus the sum of all fields, every year',
     `worst drift ${worstDiff} at ${worstYear}`);

  // 抽查过的那一年必须与直接问 OpenAlex 得到的数一致。
  const ci = data.years.indexOf(m.unclassifiedCheckYear);
  ok(m.unclassifiedDirect === data.unclassifiedByYear[ci],
     'the direct unclassified count agrees with the derived one',
     `direct ${m.unclassifiedDirect}, derived ${data.unclassifiedByYear[ci]}`);
  ok(data.totalByYear[ci] === data.sumFieldsByYear[ci] + data.unclassifiedByYear[ci],
     'total == fields + unclassified at the check year');

  // 被排除的年份：数字还在，但份额离谱 —— 画出来就是在说 2026 年七成科学无法归类。
  ok(m.excludedYears.length === 2, 'two years are excluded', `got ${m.excludedYears.length}`);
  for (const e of m.excludedYears) {
    ok(e.unclassified / e.total > 0.2, `${e.year} is excluded for a high unclassified rate`,
       `only ${(e.unclassified / e.total * 100).toFixed(1)}%`);
    ok(data.years.includes(e.year), `${e.year} is still present in the arrays`);
  }
  const ri = data.years.indexOf(m.riverLastYear), xi = data.years.indexOf(m.firstYear);
  ok(data.unclassifiedByYear[ri] / data.totalByYear[ri] < 0.12,
     'the last drawn year has a normal unclassified rate',
     `${(data.unclassifiedByYear[ri] / data.totalByYear[ri] * 100).toFixed(1)}%`);
  ok(data.totalByYear[xi] > 0, 'the first drawn year has data');
  void ci;
}

// ------------------------------------------------------------- API 契约枚举
const view = createRiverView({ onChange: () => {} });
for (const name of ['setData', 'getData', 'getModel', 'draw', 'pick', 'describe',
                    'renderLegend', 'setHover', 'getHover', 'togglePinned', 'getPinned',
                    'sameTarget', 'isExpanded', 'shortNameOf', 'getCounts']) {
  ok(typeof view[name] === 'function', `view exports ${name}()`, `typeof = ${typeof view[name]}`);
}
ok('layout' in view && 'bands' in view && 'years' in view,
   'view exposes layout / bands / years getters');

view.setData(data);
ok(view.getData() === data, 'getData returns what setData was given');

const ctx = makeCtx();
view.draw(ctx, W, H, 1);

const g = view.layout;
ok(!!g, 'layout was produced');
if (!g) { report(); process.exit(1); }

const T = g.T;
ok(T === 198, 'the river draws 198 year columns', `got ${T}`);
ok(g.years[0] === 1827 && g.years[T - 1] === 2024, 'columns run 1827..2024',
   `${g.years[0]}..${g.years[T - 1]}`);
ok(g.bands.length === 10, 'ten bands by default (8 + Other + Unclassified)', `got ${g.bands.length}`);

// --------------------------------------------- 从 Path2D 调用反推每条带的逐年厚度
//
// 发出的 op 序：ops[0] = moveTo(顶, t=0)；ops[1..T-1] = lineTo(顶, t=1..T-1)；
// ops[T] = lineTo(底, t=T-1)；ops[T+1..2T-2] = lineTo(底, t=T-2..0)。
// 所以 t 年的顶在 ops[t]，底在 ops[2T-1-t]。
function thicknessAt(path, t) {
  const top = path.ops[t][2];
  const bot = path.ops[2 * T - 1 - t][2];
  return bot - top;
}

const shapes = [];
for (const f of ctx.fills) {
  const ops = f.path.ops;
  if (ops.length !== 2 * T + 1) continue;
  if (ops[0][0] !== 'moveTo' || ops[2 * T] [0] !== 'close') continue;
  shapes.push({ path: f.path, color: f.color, band: f.path.__band });
}
ok(shapes.length === 10, 'ten band shapes were filled', `got ${shapes.length}`);

// 画出来的顺序 = 栈序（从下往上），而 ctx.fills 记的就是调用顺序。
const drawn = ctx.fills.filter((f) => f.path.ops.length === 2 * T + 1);
ok(drawn.length === g.bands.length, 'one filled shape per band',
   `${drawn.length} shapes vs ${g.bands.length} bands`);

// 下面每一段都按下标去取「第 0 条」「第 9 条」这些具体位置。形状数一旦不对，
// 那些取值就是 undefined，测试会**崩**而不是**报错** —— 一个在它本该抓住的缺陷上
// 自己先倒下的测试，等于没有这条测试。所以在这里先把话说完再退出。
if (drawn.length !== 10 || g.bands.length !== 10) {
  report();
  process.exit(1);
}

{
  const H_river = g.yBottom - g.yTop;
  let worstGap = 0, worstYear = null;
  for (let t = 0; t < T; t++) {
    let sum = 0;
    for (const f of drawn) sum += thicknessAt(f.path, t);
    const gap = Math.abs(sum - H_river);
    if (gap > worstGap) { worstGap = gap; worstYear = g.years[t]; }
  }
  ok(worstGap < 1e-6, 'every column\'s band thicknesses sum to exactly the river height',
     `worst gap ${worstGap.toExponential(2)} at ${worstYear}`);

  // 栈必须是连续的：相邻两条在**每一年**都严丝合缝，不许有缝也不许重叠。
  let worstSeam = 0, seamYear = null;
  for (let t = 0; t < T; t++) {
    for (let i = 0; i + 1 < drawn.length; i++) {
      const botAbove = drawn[i].path.ops[t][2];              // 第 i 条的顶
      const topBelow = drawn[i + 1].path.ops[2 * T - 1 - t][2]; // 第 i+1 条的底
      const seam = Math.abs(botAbove - topBelow);
      if (seam > worstSeam) { worstSeam = seam; seamYear = g.years[t]; }
    }
  }
  ok(worstSeam < 1e-6, 'adjacent bands meet exactly, with no gap or overlap',
     `worst seam ${worstSeam.toExponential(2)} at ${seamYear}`);

  // 河的顶边必须落在 yTop，底边落在 yBottom。
  let topMin = Infinity, botMax = -Infinity;
  for (let t = 0; t < T; t++) {
    topMin = Math.min(topMin, drawn[drawn.length - 1].path.ops[t][2]);
    botMax = Math.max(botMax, drawn[0].path.ops[2 * T - 1 - t][2]);
  }
  ok(Math.abs(topMin - g.yTop) < 1e-6, 'the top of the stack sits on the plot top',
     `${topMin} vs ${g.yTop}`);
  ok(Math.abs(botMax - g.yBottom) < 1e-6, 'the bottom of the stack sits on the plot bottom',
     `${botMax} vs ${g.yBottom}`);
}

// ---------------------------- 归一化的分母必须是**总作品数**，逐年反推回绝对数
//
// 这一段是整张图诚实性的支点。每条带的厚度 × (总作品数 / 河高) 必须精确等于
// 那个学科那一年的作品数。如果归一化用了「已分类数」当分母，各条带的**相对**高度
// 仍然对，河高也对，唯独这一条会整体偏掉 —— 从图上绝对看不出来。
{
  const H_river = g.yBottom - g.yTop;
  const ri = data.years.indexOf(data.meta.riverFirstYear);
  const byId = new Map(data.fields.map((f) => [f.id, f]));
  const top8 = data.meta.top8;

  let worst = 0, worstAt = '';
  const check = (t, expected, got, what) => {
    const err = Math.abs(got - expected);
    if (err > worst) { worst = err; worstAt = `${what} @ ${g.years[t]}`; }
    if (err > 1e-6) fails.push(`${what} @ ${g.years[t]}: recovered ${got}, expected ${expected}`);
  };

  for (let t = 0; t < T; t++) {
    const total = data.totalByYear[ri + t];
    const scale = total / H_river;                 // 厚度 → 作品数
    // 前 8 条是 8 个真实学科，逐个对上原始计数
    for (let i = 0; i < 8; i++) {
      const f = byId.get(top8[i]);
      check(t, f.byYear[ri + t], thicknessAt(drawn[i].path, t) * scale, f.name);
    }
    // 第 9 条是 Other（18 个 field 之和），第 10 条是未分类
    const rest = data.fields.filter((f) => !top8.includes(f.id));
    check(t, rest.reduce((s, f) => s + f.byYear[ri + t], 0),
          thicknessAt(drawn[8].path, t) * scale, 'Other (18 fields)');
    check(t, data.unclassifiedByYear[ri + t],
          thicknessAt(drawn[9].path, t) * scale, 'Unclassified');
  }
  pass++;
  ok(worst < 1e-6, 'band thicknesses decode back to the raw work counts, every band every year',
     `worst error ${worst.toFixed(4)} works at ${worstAt}`);

  // 反过来钉死分母：用**已分类数**当分母会得到另一套数，两者必须不同，
  // 否则上面那段就是在验一个恒等式。
  const t = T - 1, total = data.totalByYear[ri + t];
  const classified = data.sumFieldsByYear[ri + t];
  ok(Math.abs(total - classified) > 1e5, 'total and classified counts really differ in the last year',
     `${total} vs ${classified}`);
  const unc = thicknessAt(drawn[9].path, t) / H_river;
  ok(Math.abs(unc - data.unclassifiedByYear[ri + t] / total) < 1e-9,
     'the unclassified band uses the total (not classified) denominator',
     `${unc} vs ${data.unclassifiedByYear[ri + t] / total}`);
}

// ------------------------------------------------------------------- 展开 Other
{
  const before = view.bands.map((b) => ({
    key: b.key, top: Array.from(b.top), bot: Array.from(b.bot),
  }));
  ok(!view.isExpanded(), 'the river starts collapsed');

  const el = { innerHTML: '', querySelectorAll: () => [otherRow] };
  const otherRow = { dataset: { key: '__other__' }, onclick: null };
  let changes = 0;
  const v2 = createRiverView({ onChange: () => { changes++; } });
  v2.setData(data);
  v2.renderLegend(el);
  ok(typeof otherRow.onclick === 'function', 'the Other row is clickable');
  otherRow.onclick();
  ok(changes === 1, 'expanding fires onChange', `got ${changes}`);
  ok(v2.isExpanded(), 'clicking Other expands it');
  otherRow.onclick();
  ok(!v2.isExpanded(), 'clicking again collapses it');
  ok(changes === 2, 'collapsing fires onChange again', `got ${changes}`);

  // 展开后：8 + 18 + 1（Other 组，宽度为 0 的书签条）+ 未分类。
  v2.setData(data);
  v2.renderLegend(el);
  otherRow.onclick();
  const ctx2 = makeCtx();
  v2.draw(ctx2, W, H, 1);
  const g2 = v2.layout;
  const drawn2 = ctx2.fills.filter((f) => f.path.ops.length === 2 * T + 1);
  ok(drawn2.length === 27, 'expanded river has 27 shapes (8 + 18 + unclassified)',
     `got ${drawn2.length}`);
  ok(g2.bands.filter((b) => b.kind === 'other-field').length === 18,
     'eighteen grey sub-bands', `got ${g2.bands.filter((b) => b.kind === 'other-field').length}`);
  if (drawn2.length !== 27) { report(); process.exit(1); }

  const H_river = g2.yBottom - g2.yTop;
  let worstGap = 0;
  for (let t = 0; t < T; t++) {
    let sum = 0;
    for (const f of drawn2) sum += thicknessAt(f.path, t);
    worstGap = Math.max(worstGap, Math.abs(sum - H_river));
  }
  ok(worstGap < 1e-6, 'the expanded stack still sums to the river height',
     `worst gap ${worstGap.toExponential(2)}`);

  // 展开不许把别的带挤动：8 个学科带的上下边界必须逐点不变。
  let drift = 0;
  for (let i = 0; i < 8; i++) {
    for (let t = 0; t < T; t++) {
      drift = Math.max(drift, Math.abs(drawn2[i].path.ops[t][2] - drawn[i].path.ops[t][2]));
      drift = Math.max(drift, Math.abs(drawn2[i].path.ops[2 * T - 1 - t][2] - drawn[i].path.ops[2 * T - 1 - t][2]));
    }
  }
  ok(drift < 1e-6, 'expanding Other does not move any discipline band', `worst drift ${drift}`);

  // 18 条灰带的高度之和必须等于原来 Other 那一条。
  let worstSum = 0, worstAt = '';
  for (let t = 0; t < T; t++) {
    const collapsed = thicknessAt(drawn[8].path, t);
    let split = 0;
    for (let i = 8; i < 26; i++) split += thicknessAt(drawn2[i].path, t);
    if (Math.abs(split - collapsed) > worstSum) {
      worstSum = Math.abs(split - collapsed); worstAt = `${g.years[t]}`;
    }
  }
  ok(worstSum < 1e-6, 'the 18 sub-bands occupy exactly the collapsed Other span',
     `worst ${worstSum.toExponential(2)} at ${worstAt}`);

  // 未分类那条在展开前后必须是同一条，位置不变。
  ok(Math.abs(drawn2[drawn2.length - 1].path.ops[0][2] - drawn[drawn.length - 1].path.ops[0][2]) < 1e-6,
     'the unclassified band is unmoved by the expansion');
  void before;
}

// ---------------------------------------------------------------------- pick
{
  // 中线上取点：每一列里，每条带在它自己那段的中点必须命中的是自己。
  let hits = 0, probes = 0;
  const g3 = view.layout;
  for (let t = 0; t < T; t += 7) {
    const x = g3.x0 + t * g3.step;
    for (const b of g3.bands) {
      probes++;
      const y = (b.top[t] + b.bot[t]) / 2;
      const hit = view.pick(x, y);
      if (hit && hit.type === 'band' && hit.key === b.key && hit.year === g3.years[t]) hits++;
      else fails.push(`pick at the middle of ${b.name} in ${g3.years[t]} returned ${JSON.stringify(hit)}`);
    }
  }
  ok(hits === probes, 'pick at a band\'s own mid-height hits that band', `${hits}/${probes}`);

  // 悬停报的作品数必须与原始计数一致 —— 这是「读数不是布局自报」的那一环。
  const t3 = g3.years.length - 1;
  const x3 = g3.x0 + t3 * g3.step;
  const b8 = g3.bands[0];
  const hit = view.pick(x3, (b8.top[t3] + b8.bot[t3]) / 2);
  const f0 = data.fields.find((f) => f.id === b8.key);
  const ri = data.years.indexOf(data.meta.riverFirstYear);
  ok(hit && hit.count === f0.byYear[ri + t3], 'hover reports the raw work count for that year',
     `${hit && hit.count} vs ${f0.byYear[ri + t3]}`);
  ok(hit && hit.total === data.totalByYear[ri + t3], 'hover reports that year\'s total works',
     `${hit && hit.total} vs ${data.totalByYear[ri + t3]}`);

  // 河外
  ok(view.pick(-5000, -5000) === null, 'pick far outside returns null');
  ok(view.pick(g3.x0, g3.yBottom + 200) === null, 'pick well below the river returns null');

  // 河的正上方（轴的区域）返回年份而不是带
  const yearHit = view.pick(g3.x0, g3.yTop - 8);
  ok(yearHit && yearHit.type === 'year', 'pick just above the river reports the year',
     JSON.stringify(yearHit));

  const d1 = view.describe(hit);
  const d2 = view.describe(yearHit);
  ok(d1.includes(f0.name) && d1.includes('works'), 'describe(band) names the field and counts works');
  ok(d2.includes(String(yearHit.year)) && d2.includes('unclassified'),
     'describe(year) reports the total and the unclassified share', JSON.stringify(d2.slice(0, 60)));
  ok(view.describe({ type: 'band', key: '__nope__', year: 1900, count: 0, total: 1, share: 0 }) === '',
     'describe of an unknown band key returns empty rather than throwing');
}

// ------------------------------------------------------------- hover / pin / legend
{
  const b = view.bands[0];
  view.setHover({ type: 'band', key: b.key, year: 1900 });
  ok(view.getHover() && view.getHover().key === b.key, 'setHover stores the hit');
  ok(view.togglePinned({ type: 'band', key: b.key, year: 1900 }) !== null, 'togglePinned sets a pin');
  ok(view.sameTarget({ type: 'band', key: b.key, year: 1900 }, view.getPinned()),
     'sameTarget requires the same year as well as the same band');
  ok(!view.sameTarget({ type: 'band', key: b.key, year: 1901 }, view.getPinned()),
     'a different year is a different target');
  ok(view.togglePinned({ type: 'band', key: b.key, year: 1900 }) === null, 'toggling the same target clears it');

  const el = { innerHTML: '', querySelectorAll: () => [] };
  view.renderLegend(el);
  const html = el.innerHTML;
  ok(html.length > 800, 'renderLegend produced markup', `${html.length} chars`);
  for (const id of data.meta.top8) {
    const f = data.fields.find((x) => x.id === id);
    ok(html.includes(f.name), `legend names ${f.name}`);
  }
  ok(html.includes('Unclassified'), 'legend names the unclassified band');
  ok(/Other \(\d+ fields\)/.test(html), 'legend names the Other aggregate');
  ok(/splitting and merging, no/i.test(html), 'legend states what the data cannot show');
  // 光出现「2025」「2026」不够 —— 那两个年份在别处也可能被提到。必须说清楚它们是
  // **被排除**的、以及为什么（已入库但未分类），否则读者会以为数据到此为止。
  ok(html.includes('2025') && html.includes('2026'), 'legend names the excluded years');
  ok(html.includes('excluded'), 'legend says those years were excluded, not merely mentions them');
  ok(html.includes('not yet classified'), 'legend gives the reason for the exclusion');
  ok(html.includes('normalised to 100%'), 'legend explains the normalisation');
  ok(!/&(?!amp;|lt;|gt;|rsquo;|#)/.test(html), 'legend escapes ampersands');
}

// -------------------------------------------------------------- onChange / 空数据
{
  const blank = createRiverView({});
  const beh = makeCtx();
  blank.draw(beh, W, H, 1);
  ok(beh.texts.some((t) => /openalex-history\.json not loaded/.test(t.text)),
     'a view with no data draws the missing-data notice');
  ok(blank.pick(10, 10) === null, 'pick on an empty view returns null');
  ok(blank.describe(null) === '', 'describe(null) returns empty');
  blank.renderLegend({ innerHTML: '', querySelectorAll: () => [] });
  ok(blank.getCounts() === null, 'getCounts is null before data is set');
  pass++;
}

// 刻度与直接标注：这两样是「身份不靠颜色单独承载」的兑现方式，必须真的有。
{
  const ctx4 = makeCtx();
  view.setData(data);
  view.draw(ctx4, W, H, 1);
  const years = ctx4.texts.filter((t) => /^\d{4}$/.test(t.text)).map((t) => Number(t.text));
  ok(years.length >= 7, 'the year axis is drawn', `${years.length} tick labels`);
  ok(years.includes(1900) && years.includes(2000), 'axis ticks land on round years',
     years.join(','));
  const labeled = ctx4.texts.filter((t) => /Medicine|Engineering|Social Sciences/.test(t.text));
  ok(labeled.length > 0, 'bands are directly labelled on the right',
     `${labeled.length} band labels`);
  ok(labeled.every((t) => t.x > 1300), 'band labels sit to the right of the plot',
     labeled.map((t) => Math.round(t.x)).join(','));
}

report();
process.exit(fails.length ? 1 : 0);
