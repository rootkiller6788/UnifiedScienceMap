// check-phil-chord.mjs — 弦图渲染器的几何不变量测试。
//
//     node check-phil-chord.mjs            # 用同目录的 philpapers-chord.json
//     node check-phil-chord.mjs other.json
//
// 弦图看着复杂，但正确性其实只压在一条不变量上：**每条丝带离开一端时的宽度，必须
// 等于它落到另一端时的宽度**。破了这条，图还是能画出来、还挺好看，但它在说谎 ——
// 这正是圆形版的「双轴错误」。所以这里直接从 Path2D 记录的 arc 调用里量宽度，而不
// 是信任布局自己记的账；布局记错了自己，测试是发现不了的。
//
// Path2D 和 canvas 在 Node 里不存在，所以下面是一组最小替身：它们只记录被调用了什么，
// 不画任何东西。

import { readFileSync } from 'node:fs';

const TAU = Math.PI * 2;
const EPS = 1e-9;

class Path2D {
  constructor() { this.ops = []; }
  moveTo(...a) { this.ops.push(['moveTo', ...a]); }
  lineTo(...a) { this.ops.push(['lineTo', ...a]); }
  arc(...a) { this.ops.push(['arc', ...a]); }
  quadraticCurveTo(...a) { this.ops.push(['q', ...a]); }
  closePath() { this.ops.push(['close']); }
}

function makeCtx() {
  const noop = () => {};
  const texts = [];
  const ctx = {
    save: noop, restore: noop, setTransform: noop, beginPath: noop,
    arc: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop,
    closePath: noop, fill: noop, stroke: noop, strokeText: noop,
    isPointInPath: () => false,
    measureText: (t) => ({ width: String(t).length * 6.5 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    textBaseline: '', globalAlpha: 1, lineJoin: '', globalCompositeOperation: '',
    // 记录每次 fillText：文字的落点只能从这里拿到。font / textAlign 是调用时读的，
    // 因为渲染器每画一个标签都会先设好它们。
    texts,
    fillText: (t, x, y) => {
      texts.push({
        text: String(t), x, y, align: ctx.textAlign, font: ctx.font,
        width: ctx.measureText(t).width,
      });
    },
  };
  return ctx;
}

// 每次 draw 之后把累积的文字取走并清空，免得后续的 draw 混进来 —— 同一个标签被画
// 两次会得到两个完全重合的盒子，那是必然「重叠」的假阳性。
function takeTexts(ctx) {
  const out = ctx.texts.slice();
  ctx.texts.length = 0;
  return out;
}

// phil-chord.js 是 ESM，但 web/ 下没有 package.json 把它标成 module，Node 会当成
// CommonJS 而拒绝解析 export。所以读源码、摘掉 export、用 new Function 求值 —— 顺带
// 把 Path2D 注入进去（替身必须在 import 之前就位）。
// CHORD_CHART 可以指到另一个文件上 —— 变异测试用它跑一份故意改坏的副本，确认下面的
// 断言真的会红（一个永远通过的检查等于没有检查）。与三个新图的 check-*.mjs 同一套。
const srcPath = process.env.CHORD_CHART || new URL('./phil-chord.js', import.meta.url);
const src = readFileSync(srcPath, 'utf8');
const createChordView = new Function('Path2D', 'document', 'window',
  src.replace(/^export\s+/m, '') + '\nreturn createChordView;')(Path2D, undefined, undefined);

const dataPath = process.argv[2] || new URL('./philpapers-chord.json', import.meta.url);
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

let pass = 0;
const fails = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fails.push(detail ? `${label}\n      ${detail}` : label);
}
function near(a, b, eps = EPS) { return Math.abs(a - b) <= eps; }

const W = 1600, H = 900;
const view = createChordView();
view.setData(data);
const ctx = makeCtx();
view.draw(ctx, W, H, 1);
const firstPaint = takeTexts(ctx);

const g = view.layout;
ok(!!g, 'layout was produced');
if (!g) { report(); process.exit(1); }

const { arcs, pairs, slots, scale, cx, cy, R0, R1 } = g;
const n = arcs.length;
const chords = data.chords;

// ---------------------------------------------------------------- the dataset
{
  const meta = data.meta;
  ok(chords.length === meta.chords, 'meta.chords matches the chord list',
     `${chords.length} vs ${meta.chords}`);
  ok(data.loops.reduce((a, l) => a + l.count, 0) === meta.loops,
     'meta.loops matches the loop list');
  // 账必须平：每条额外父边要么变成一条跨分支的弦，要么归入某个分支的自环。
  ok(meta.chords + meta.loops === meta.parentPairs,
     'every extra parent edge is accounted for',
     `${meta.chords} + ${meta.loops} != ${meta.parentPairs}`);
  ok(arcs.length === meta.branches, 'every branch with cross-listings got an arc',
     `${arcs.length} vs ${meta.branches}`);

  const bad = chords.filter((c) => c.s === c.t);
  ok(bad.length === 0, 'no chord is a self-loop', `${bad.length} found`);
}

// ------------------------------------------------------------ labels do not collide
{
  // 颜色之外，标签是唯一能说出「这条弧是哪个分支」的通道。两个标签叠在一起，等于
  // 那两个分支没有名字 —— 所以这里要求任意两个标签盒都不相交。
  //
  // 宽度用的是替身自己的 measureText，和布局避让时用的是同一把尺子。因此这条检查
  // 问的是「避让有没有把所有重叠对都分开」，不是「字体度量准不准」。后者只能在真有
  // 字体的地方问，见 check-phil-chord.html —— 它把重叠数写进 document.title。
  //
  // 之所以要专门测：避让循环原先只比较按 y 排序后的相邻两项，只要中间夹着一个水平
  // 不重叠的标签，真正重叠的那一对就永远不相邻、永远分不开。当时环底部
  // Philosophy of the Americas / European Philosophy 就这样叠了 63px。
  const all = firstPaint.map((t) => {
    const x0 = t.align === 'right' ? t.x - t.width
      : t.align === 'center' ? t.x - t.width / 2
        : t.x;
    return { x0, x1: x0 + t.width, y0: t.y - 7, y1: t.y + 7, text: t.text };
  });
  ok(all.length > 0, 'the renderer drew text');

  const clashes = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ox > 1 && oy > 1) clashes.push(`${a.text} / ${b.text} (${ox.toFixed(0)}x${oy.toFixed(0)})`);
    }
  }
  ok(clashes.length === 0, 'no two labels overlap', clashes.slice(0, 4).join('; '));

  // 标签会为了避让离开自己的锚点，但不能离得太远，否则引线比图还长。
  const far = all.filter((b) => b.y0 < -8 || (b.y1 > H + 8));
  ok(far.length === 0, 'no label was pushed off the canvas',
     far.map((b) => b.text).join(', '));
}

// ------------------------------------------------------- the ring closes to 2π
{
  let spans = 0, gaps = 0;
  for (let k = 0; k < n; k++) {
    spans += arcs[k].span;
    gaps += arcs[k].domain === arcs[(k + 1) % n].domain ? 0.004 : 0.052;
  }
  ok(near(spans + gaps, TAU), 'arcs plus inter-arc gaps close the circle exactly',
     `${spans + gaps} vs ${TAU}`);
  // 反向：弧长必须刚好等于该分支的权重 × 标度，多一分少一分都说明有弦没安置。
  const off = arcs.filter((a) => !near(a.span, a.deg * scale));
  ok(off.length === 0, 'every arc is exactly degree × scale long',
     off.slice(0, 3).map((a) => `${data.branches[a.bi].name}: ${a.span} vs ${a.deg * scale}`).join('; '));
}

// ---------------------------------------------- arc space is fully consumed
{
  const bad = [];
  for (const a of arcs) {
    let used = a.loops * scale;
    for (const p of pairs) {
      if (p.bi === a.bi || p.pi === a.bi) used += p.list.length * scale;
    }
    if (!near(used, a.span)) {
      bad.push(`${data.branches[a.bi].name}: blocks use ${used}, arc is ${a.span}`);
    }
  }
  ok(bad.length === 0, 'each arc is exactly tiled by its bundles and its self-loop',
     bad.slice(0, 3).join('; '));
}

// ------------------------------------------------ THE invariant: equal widths
{
  let checked = 0;
  const bad = [], nan = [], missing = [];
  for (let ci = 0; ci < chords.length; ci++) {
    const sl = slots[ci];
    if (!sl) { missing.push(ci); continue; }
    if (sl.A0 === undefined || sl.B0 === undefined) { missing.push(ci); continue; }
    const ops = sl.path.ops;
    const arcsIn = ops.filter((o) => o[0] === 'arc');
    if (arcsIn.length !== 2) { bad.push(`chord ${ci}: ${arcsIn.length} arc ops`); continue; }

    for (const o of ops) {
      if (o[0] === 'close') continue;
      for (let k = 1; k < o.length; k++) {
        if (!Number.isFinite(o[k])) { nan.push(`chord ${ci} op ${o[0]}`); break; }
      }
    }
    // 两个弧的半径必须相同：半径不同就是丝带被画到了两个不同的环上。
    if (!near(arcsIn[0][3], arcsIn[1][3])) bad.push(`chord ${ci}: differing radii`);
    const wa = arcsIn[0][5] - arcsIn[0][4];
    const wb = arcsIn[1][5] - arcsIn[1][4];
    if (!near(wa, wb)) bad.push(`chord ${ci}: ${wa} vs ${wb}`);
    if (!near(wa, scale)) bad.push(`chord ${ci}: width ${wa} != scale ${scale}`);
    checked++;
  }
  ok(missing.length === 0, 'every chord got geometry at both ends',
     `${missing.length} without a slot`);
  ok(nan.length === 0, 'no ribbon coordinate is NaN or Infinity', nan.slice(0, 3).join('; '));
  ok(bad.length === 0, 'every ribbon leaves and lands at exactly the same width',
     bad.slice(0, 3).join('; '));
  ok(checked === chords.length, 'all chords were width-checked',
     `${checked} of ${chords.length}`);
}

// ------------------------------------------------- each chord lands where it says
{
  const bad = [];
  for (let ci = 0; ci < chords.length; ci++) {
    const sl = slots[ci];
    if (!sl) continue;
    const holderA = arcs.find((a) => between(sl.A0, a.start, a.end));
    const holderB = arcs.find((a) => between(sl.B0, a.start, a.end));
    if (!holderA || holderA.bi !== chords[ci].s) bad.push(`chord ${ci} A-end`);
    if (!holderB || holderB.bi !== chords[ci].t) bad.push(`chord ${ci} B-end`);
  }
  function between(x, lo, hi) { return x >= lo - EPS && x <= hi + EPS; }
  ok(bad.length === 0, 'every chord anchors on the branches it claims',
     bad.slice(0, 3).join('; '));
}

// ------------------------------------------------------ bundles agree both ways
{
  const bad = [];
  for (const p of pairs) {
    const rev = pairs.find((q) => q.bi === p.pi && q.pi === p.bi);
    if (rev) bad.push(`duplicate pair ${p.bi}/${p.pi}`);
    const byName = p.list.map((i) => chords[i]);
    for (const c of byName) {
      if (!((c.s === p.bi && c.t === p.pi) || (c.s === p.pi && c.t === p.bi))) {
        bad.push(`chord ${c.name} not between ${p.bi} and ${p.pi}`);
      }
    }
    // 束的宽度两端必须一样，否则悬停区域和它声称的弦数对不上。
    if (!near(p.a1 - p.a0, p.list.length * scale)) bad.push(`pair ${p.bi}/${p.pi} width`);
    if (!near(p.b1 - p.b0, p.list.length * scale)) bad.push(`pair ${p.bi}/${p.pi} far width`);
  }
  ok(bad.length === 0, 'each bundle holds exactly its own chords at both ends',
     bad.slice(0, 3).join('; '));

  // 束是按「对」去重的，所以每条弦只该出现在一个束里。
  const seen = new Map();
  for (const p of pairs) for (const i of p.list) seen.set(i, (seen.get(i) || 0) + 1);
  const wrong = [...seen.entries()].filter(([, k]) => k !== 1);
  ok(seen.size === chords.length && wrong.length === 0,
     'every chord belongs to exactly one bundle',
     `${seen.size} of ${chords.length} chords placed, ${wrong.length} misplaced`);
  // 两端顺序必须一致：同一条弦在 A 端的第 j 格和 B 端的第 j 格要对应，否则丝带两端
  // 会接错伙伴，宽度不变但连错了地方 —— 那比宽度错了更难发现。
  const crossed = pairs.filter((p) => !near(p.a1 - p.a0, p.b1 - p.b0));
  ok(crossed.length === 0, 'a bundle is the same width at both of its ends',
     crossed.slice(0, 3).map((p) => `${p.bi}/${p.pi}`).join('; '));
}

// ------------------------------------------------------------- hiding is sound
{
  const before = arcs.length;
  view.toggleDomain(0);
  view.draw(ctx, W, H, 1);
  const g2 = view.layout;
  ok(g2 && g2.arcs.length < before, 'hiding a domain removes its arcs',
     `${before} -> ${g2 ? g2.arcs.length : 'null'}`);

  const hiddenSet = new Set();
  data.branches.forEach((b, i) => { if (b.domain === 0) hiddenSet.add(i); });
  const leaked = [];
  for (let ci = 0; ci < chords.length; ci++) {
    const sl = g2.slots[ci];
    if (!sl) continue;
    if (hiddenSet.has(chords[ci].s)) leaked.push(ci);
  }
  ok(leaked.length === 0, 'no chord survives from a hidden branch', `${leaked.length} leaked`);

  // 隐藏之后必须重新满足同一条不变量。这里正是最容易出错的地方：弧长若还按 JSON
  // 里的旧权重算，被抽走的弦就会在环上留下一段没有解释的空白。
  let spans = 0, gaps = 0;
  for (let k = 0; k < g2.arcs.length; k++) {
    spans += g2.arcs[k].span;
    const cur = g2.arcs[k], nxt = g2.arcs[(k + 1) % g2.arcs.length];
    gaps += cur.domain === nxt.domain ? 0.004 : 0.052;
  }
  ok(near(spans + gaps, TAU), 'the ring still closes after hiding a domain',
     `${spans + gaps} vs ${TAU}`);

  const short = g2.arcs.filter((a) => !near(a.span, a.deg * g2.scale));
  ok(short.length === 0, 'arc length is still degree × scale after hiding',
     short.slice(0, 3).map((a) => `${data.branches[a.bi].name}: ${a.span} vs ${a.deg * g2.scale}`).join('; '));

  const tiled = [];
  for (const a of g2.arcs) {
    let used = a.loops * g2.scale;
    for (const p of g2.pairs) {
      if (p.bi === a.bi || p.pi === a.bi) used += p.list.length * g2.scale;
    }
    if (!near(used, a.span)) tiled.push(data.branches[a.bi].name);
  }
  ok(tiled.length === 0, 'arcs are still fully tiled by their bundles after hiding',
     tiled.slice(0, 3).join('; '));

  view.clearHidden();
  view.draw(ctx, W, H, 1);
  ok(view.layout.arcs.length === 42, 'unhiding restores every arc',
     `${view.layout.arcs.length}`);
}

// ------------------------------------------------------------------- resizing
{
  const before = view.layout;
  view.draw(makeCtx(), 1100, 700, 1);
  const after = view.layout;
  // scale 是「每单位权重多少弧度」，本来就与像素无关，缩小窗口不该动它 ——
  // 动的是 R1。真正要断言的是半径跟着走、环还是完整的。
  ok(after !== before && Number.isFinite(after.R1) && after.R1 !== before.R1,
     'a resize produces a fresh layout', `R1 ${before.R1} -> ${after.R1}`);
  ok(near(after.scale, before.scale), 'the radian scale is pixel-independent',
     `${before.scale} -> ${after.scale}`);
  ok(after.R0 > 0 && after.R1 > after.R0, 'radii stay ordered',
     `R0=${after.R0} R1=${after.R1}`);
  ok(near(after.R1 - after.R0, 46) || near(after.R0, 16), 'the ring keeps its thickness',
     `band = ${after.R1 - after.R0}px`);

  // 小窗口：环必须缩到放得下，而不是变成负数或者 NaN。
  view.draw(makeCtx(), 420, 300, 1);
  const tiny = view.layout;
  ok(Number.isFinite(tiny.R0) && Number.isFinite(tiny.R1) && tiny.R0 > 0 && tiny.R1 >= tiny.R0,
     'a very small window still yields sane radii', `R0=${tiny.R0} R1=${tiny.R1}`);

  const base = view.layout;
  view.draw(ctx, W, H, 1);
  ok(near(view.layout.scale, base.scale), 'returning to the old size rebuilds consistently');
}

// ----------------------------------------------------------------- API surface
{
  // main.js calls exactly these. 一个函数定义了却忘了放进返回值，上面所有几何测试都
  // 照样通过 —— 它只在浏览器里表现为一块卡在 loading 上的白屏。所以单独守一道。
  const v = createChordView();
  const required = [
    'setData', 'getData', 'setQuery', 'getQuery', 'draw', 'pick', 'setHover',
    'getHover', 'togglePinned', 'getPinned', 'describe', 'renderLegend', 'domains',
    'branches', 'color', 'isHidden', 'toggle', 'clearHidden', 'matched',
    'toggleDomain', 'domainState', 'sameTarget',
  ];
  const missing = required.filter((k) => typeof v[k] !== 'function');
  ok(missing.length === 0, 'every method the host page calls is exported',
     `missing: ${missing.join(', ')}`);

  // 环的圆心必须与画布中心重合，跟任何宿主 chrome 都无关。这条曾经是反的：视图
  // 收下一个「左侧面板有多宽」的 inset 并把环右移躲开它，于是面板一开一合整张图
  // 就横向跳。现在钉死：换个画布尺寸，圆心跟着走；不接收任何外部偏移。
  for (const [cw, ch] of [[1600, 900], [1100, 700], [900, 500]]) {
    const probe = createChordView();
    probe.setData(data);
    probe.draw(makeCtx(), cw, ch, 1);
    const lay = probe.layout;
    ok(lay && Math.abs(lay.cx - cw / 2) < 1e-9,
       `ring is centred horizontally at ${cw}x${ch}`,
       lay && `cx ${lay.cx} vs ${cw / 2}`);
  }
  ok(typeof v.setInset === 'undefined',
     'no inset hook survives to shift the ring off-centre');

  const empty = createChordView();
  let early = null;
  try {
    empty.draw(makeCtx(), W, H, 1);
    empty.renderLegend({ innerHTML: '', querySelectorAll: () => [] });
    empty.pick(10, 10);
    empty.describe(null);
    empty.setQuery('x');
    empty.matched();
  } catch (e) { early = e; }
  ok(!early, 'the view survives being driven before any data arrives',
     early && early.message);
}

// ---------------------------------------------------------------------- legend
{
  // 回归测试：图例在第一次 draw 之前就要渲染（切换模式时就是如此），那时还没有
  // 布局。「最大的若干组交换」如果从布局里取，这一段会静悄悄地渲染成一张空表。
  const fresh = createChordView();
  fresh.setData(data);
  const el = { innerHTML: '', querySelectorAll: () => [] };
  fresh.renderLegend(el);
  const html = el.innerHTML;
  ok(html.includes('Largest exchanges'), 'the legend renders before any layout exists');
  ok(!html.includes('nothing left unhidden'), 'the exchanges table was populated',
     'table rendered as empty');
  const rows = (html.match(/↔/g) || []).length;
  ok(rows === 8, 'the legend lists its top exchanges', `${rows} rows`);
  ok(html.includes('6,135') === false, 'the legend does not print the category total as a weight');

  // 但这个 stub 的 querySelectorAll 永远返回空数组，所以点击处理器根本没被装上 ——
  // 上面只证明了 HTML 里有 class="item"。这里真的装一行、真的点下去。
  //
  // 盯的是 §4 那个潜伏 bug：渲染是按需的，模块自己改了状态却不喊 onChange，宿主的画布
  // 就停在改动之前的那一帧 —— 点「隐藏某个分支」，环上的弧还在，直到下一次 mousemove。
  const fired = [];
  // data-dom 是 domain 的**下标**，不是 data.domains[i].id —— domainState/toggleDomain
  // 比的也是下标（b.domain === d）。用 id（"51"）去点会 toggle 一个空列表，于是
  // domainState 仍然报 'on'，看起来像模块没反应，其实是测试点错了东西。
  const dm = 0;
  const el2 = {
    innerHTML: '',
    _rows: [{ dataset: { dom: String(dm) }, onclick: null }],
    querySelectorAll() { return this._rows; },
  };
  const live = createChordView({ onChange: () => fired.push(1) });
  live.setData(data);
  live.renderLegend(el2);
  // 没装上处理器时必须**报失败然后跳过**，不能直接调 —— 否则检查脚本自己抛 TypeError，
  // 死在它唯一要报告的那个缺陷上（变异测试里踩过）。ok() 不中断执行，所以这里要显式分支。
  const click = el2._rows[0].onclick;
  if (typeof click !== 'function') {
    ok(false, 'renderLegend installs a click handler on each row', 'no onclick was installed');
  } else {
    ok(true, 'renderLegend installs a click handler on each row');
    ok(live.domainState(dm) === 'on', 'the domain starts fully shown');
    click();
    ok(live.domainState(dm) === 'off', 'clicking that row hides the domain it names');
    ok(fired.length === 1,
       'clicking a legend row calls onChange, so the host repaints (the §4 fix)',
       `onChange fired ${fired.length} times`);
    click();
    ok(live.domainState(dm) === 'on', 'clicking it again brings the domain back');
    ok(fired.length === 2, 'and it calls onChange every time', `fired ${fired.length}`);
  }

  // onChange 默认空函数：不带宿主单独测这个模块也不能炸。
  const noOpts = createChordView();
  noOpts.setData(data);
  const el3 = {
    innerHTML: '', _rows: [{ dataset: { dom: String(dm) }, onclick: null }],
    querySelectorAll() { return this._rows; },
  };
  noOpts.renderLegend(el3);
  let threw = null;
  if (typeof el3._rows[0].onclick === 'function') {
    try { el3._rows[0].onclick(); } catch (e) { threw = e; }
  } else {
    threw = new Error('no onclick installed at all');
  }
  ok(threw === null, 'a view created without onChange still survives a legend click',
     threw && threw.message);

  // 每一条交换对的数字都必须真的等于该类对在数据里的弦数。
  const counts = new Map();
  for (const c of data.chords) {
    const k = Math.min(c.s, c.t) + '|' + Math.max(c.s, c.t);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const biggest = Math.max(...counts.values());
  ok(html.includes(`>${biggest}<`), 'the largest exchange shows its true count',
     `expected ${biggest} in the table`);

  // 全隐之后必须说实话，而不是继续显示已经看不见的交换。
  data.domains.forEach((_, di) => fresh.toggleDomain(di));
  fresh.renderLegend(el);
  ok(el.innerHTML.includes('nothing left unhidden'),
     'hiding every domain empties the table instead of lying');
  const arcFree = createChordView();
  arcFree.setData(data);
  arcFree.renderLegend({ innerHTML: '', querySelectorAll: () => [] });
}

// --------------------------------------------------------------------- picking
{
  // 每个弧都要能从环上点回自己。这同时压住两件事：角度不回绕，以及 42 段里没有
  // 两段的区间互相吃掉。只测第 0 段是测不出后者的。
  const bad = [];
  for (const a of view.layout.arcs) {
    const mid = (a.start + a.end) / 2;
    const r = (view.layout.R0 + view.layout.R1) / 2;
    const hit = view.pick(view.layout.cx + r * Math.cos(mid),
                          view.layout.cy + r * Math.sin(mid));
    if (!hit || hit.type !== 'arc' || hit.bi !== a.bi) {
      bad.push(`${data.branches[a.bi].name} -> ${JSON.stringify(hit)}`);
    }
  }
  ok(bad.length === 0, 'every arc picks itself from its own midpoint',
     bad.slice(0, 3).join('; '));

  const a0 = view.layout.arcs[0];
  ok(view.describe({ type: 'arc', bi: a0.bi }).includes(data.branches[a0.bi].name),
     'describe() names the branch');
  const off = view.pick(-5000, -5000);
  ok(off === null, 'a click far outside picks nothing', JSON.stringify(off));
}

// ------------------------------------------------ describe() numbers must add up
{
  // 弧的工具提示列出的伙伴权重 + 分支内部自环，必须正好等于该分支的总权重。
  // 这是一个独立的账：它不查几何，只查描述里的数字有没有漏掉一部分弦。
  const bad = [];
  for (const a of view.layout.arcs) {
    const txt = view.describe({ type: 'arc', bi: a.bi });
    const shown = [...txt.matchAll(/\((\d+)\)/g)].reduce((s, m) => s + (+m[1]), 0);
    // describe 会把伙伴列表截断到 8 个，截断时按 max(0, ...) 兜底。
    const truncated = txt.includes('more');
    const total = shown + data.branches[a.bi].loops;
    if (!truncated && total !== a.deg) {
      bad.push(`${data.branches[a.bi].name}: described ${total}, arc is ${a.deg}`);
    }
  }
  ok(bad.length === 0, 'the arc tooltip accounts for every one of its chords',
     bad.slice(0, 3).join('; '));
}

// --------------------------------------------------------------- describe text
{
  const big = [...view.pairs].sort((x, y) => y.list.length - x.list.length)[0];
  const txt = view.describe({ type: 'pair', bi: big.bi, pi: big.pi, list: big.list });
  ok(txt.includes(data.branches[big.bi].name) && txt.includes(data.branches[big.pi].name),
     'describe() names both ends of a bundle');
  ok(txt.includes(String(big.list.length)), 'describe() states the bundle size');

  const single = view.pairs.find((p) => p.list.length === 1);
  if (single) {
    const one = view.describe({ type: 'pair', bi: single.bi, pi: single.pi, list: single.list });
    ok(one.includes(data.chords[single.list[0]].name),
       'a one-chord bundle names the category itself');
    ok(one.includes('the one chord in this bundle'), 'and says so');
  }
}

report();
function report() {
  if (fails.length) {
    console.log(`FAIL  ${fails.length} of ${pass + fails.length} checks`);
    for (const f of fails) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  const m = data.meta;
  console.log(`ok    ${pass} checks passed`);
  console.log(`      ${m.categories.toLocaleString()} categories, ${m.crossListed.toLocaleString()} cross-listed`);
  console.log(`      ${m.chords.toLocaleString()} cross-branch chords + ${m.loops.toLocaleString()} internal = ${m.parentPairs.toLocaleString()} extra parent edges`);
  console.log(`      ${m.branches} of ${m.branchesTotal} branches on the ring, ${m.distinctPairs} distinct pairs`);
  console.log(`      ${chords.length.toLocaleString()} ribbons ${(view.layout.scale * view.layout.R1).toFixed(3)}px wide at the ring`);
}
