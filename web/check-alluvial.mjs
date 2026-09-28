// check-alluvial.mjs — 三级冲积图的几何不变量测试。
//
//     node check-alluvial.mjs                       # 用同目录的 unified-decls.json
//     node check-alluvial.mjs path/to/other.json
//
// 冲积图看着复杂，但正确性只压在一条不变量上：**全图共用同一个「像素 / 声明」标度**。
// 它有两个可测的后果：
//
//   1. 一条丝带离开源节点时的厚度，精确等于它落到目标节点时的厚度；
//   2. 每个节点的高度，精确等于它所有连线的权重之和（离开侧和到达侧都算）。
//
// 破了任何一条，节点和丝带就落在两把尺子上 —— 直线版的「双轴错误」。图还是画得出来、
// 还挺好看，但它在说谎。所以下面直接从 Path2D 记录的**实际绘制调用**里量厚度，而不是
// 信任布局自己算的 th 字段：布局算错了自己，测试是发现不了的。
//
// Path2D 和 canvas 在 Node 里不存在，所以下面是一组最小替身：它们只记录被调用了什么。

import { readFileSync } from 'node:fs';

const EPS = 1e-9;

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
  const ctx = {
    save: noop, restore: noop, setTransform: noop, beginPath: noop,
    arc: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop,
    bezierCurveTo: noop, closePath: noop, fill: noop, stroke: noop,
    strokeText: noop, fillRect: noop, strokeRect: noop, clearRect: noop,
    isPointInPath: () => false,
    measureText: (t) => ({ width: String(t).length * 6.5 }),
    createLinearGradient: () => ({ addColorStop: noop }),
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    textBaseline: '', globalAlpha: 1, lineJoin: '', globalCompositeOperation: '',
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

// 每次 draw 之后把累积的文字取走并清空，免得后续的 draw 混进来 —— 同一个标签被画两次
// 会得到两个完全重合的盒子，那是必然「重叠」的假阳性。
function takeTexts(ctx) {
  const out = ctx.texts.slice();
  ctx.texts.length = 0;
  return out;
}

// alluvial-chart.js 是 ESM，但 web/ 下没有 package.json 把它标成 module，Node 会当成
// CommonJS 而拒绝解析 export。所以读源码、摘掉 export、用 new Function 求值 —— 顺带把
// Path2D 注入进去（替身必须在模块体执行之前就位）。
// ALLUVIAL_CHART 可以指到另一个文件上 —— 变异测试用它跑一份故意改坏的副本，确认下面
// 的断言真的会红（一个永远通过的检查等于没有检查）。与三个新图的 check-*.mjs 同一套。
const srcPath = process.env.ALLUVIAL_CHART || new URL('./alluvial-chart.js', import.meta.url);
const src = readFileSync(srcPath, 'utf8');
const { createAlluvialView, buildAlluvial } = new Function('Path2D',
  src.replace(/^export\s+/gm, '')
    + '\nreturn { createAlluvialView, buildAlluvial };')(Path2D);

const dataPath = process.argv[2] || new URL('./unified-decls.json', import.meta.url);
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

let pass = 0;
const fails = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fails.push(detail ? `${label}\n      ${detail}` : label);
}
function near(a, b, eps = EPS) { return Math.abs(a - b) <= eps; }
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

// ---------------------------------------------------------------- 模块自测：聚合
// buildAlluvial 是纯函数，可以脱离渲染单独验。
const model = buildAlluvial(data);
ok(!!model, 'buildAlluvial produces a model');
if (!model) { report(); process.exit(1); }

{
  const m = model.meta;
  ok(m.declarations === 170974, 'every declaration is accounted for',
     `meta.declarations = ${m.declarations}`);
  ok(m.domains === 4, 'four domains', `got ${m.domains}`);
  ok(m.dirs === 52, 'fifty-two dirs', `got ${m.dirs}`);
  ok(m.kinds === 9, 'nine kinds', `got ${m.kinds}`);
  ok(m.ribbons === m.stage0 + m.stage1, 'ribbon count == the two stages summed',
     `${m.ribbons} vs ${m.stage0} + ${m.stage1}`);
  ok(m.stage0 === 65, '65 domain→dir ribbons', `got ${m.stage0}`);
  ok(m.stage1 === 318, '318 dir→kind ribbons', `got ${m.stage1}`);

  // 三列的权重和必须都等于总声明数 —— 每条声明恰好贡献一次。
  for (let c = 0; c < 3; c++) {
    const s = model.cols[c].reduce((a, n) => a + n.weight, 0);
    ok(s === m.declarations, `column ${c} weights sum to the declaration count`,
       `${s} vs ${m.declarations}`);
  }
  // 没有任何节点权重为 0，也没有重复。
  for (let c = 0; c < 3; c++) {
    const names = model.cols[c].map((n) => n.name);
    ok(new Set(names).size === names.length, `column ${c} has no duplicate names`);
    ok(model.cols[c].every((n) => n.weight > 0), `column ${c} has no zero-weight node`);
  }
  // 第 2 列按主 domain 分组：同一个 domain 的 dir 必须连成一段，中间不许插别的 domain。
  const seen = new Set();
  let runs = 0, prev = null;
  for (const d of model.cols[1]) {
    if (d.dom !== prev) { runs++; prev = d.dom; }
    seen.add(d.dom);
  }
  ok(runs === seen.size, 'column 2 is grouped by dominant domain (one run per domain)',
     `${runs} runs for ${seen.size} domains`);
}

// ---------------------------------------------------------------- 布局与绘制
const view = createAlluvialView();
view.setData(data);
const ctx = makeCtx();
view.draw(ctx, W, H, 1);
const firstPaint = takeTexts(ctx);

const g = view.layout;
ok(!!g, 'layout was produced');
if (!g) { report(); process.exit(1); }

const { cols, links, scale } = g;

// ================================================== 1. 丝带两端等宽（地基）
{
  let worst = 0, worstLabel = '';
  for (const l of links) {
    const ops = l.path.ops;
    // 绘制时发出的调用序列：
    //   moveTo(x0, sy)
    //   bezierCurveTo(c0, sy, c1, ty, x1, ty)
    //   lineTo(x1, ty + t)
    //   bezierCurveTo(c1, ty+t, c0, sy+t, x0, sy+t)
    // 左端厚度 = 最后一段的终点 y 减起点 y；右端厚度 = lineTo 的 y 减贝塞尔的终点 y。
    const [move, bez1, line, bez2] = ops;
    if (move[0] !== 'moveTo' || bez1[0] !== 'c' || line[0] !== 'lineTo' || bez2[0] !== 'c') {
      ok(false, 'ribbon emits the expected op sequence', `${l.A.name}→${l.B.name}`);
      continue;
    }
    const left = bez2[6] - move[2];
    const right = line[2] - bez1[6];
    const d = Math.abs(left - right);
    if (d > worst) { worst = d; worstLabel = `${l.A.name}→${l.B.name} (${left} vs ${right})`; }
  }
  ok(worst <= EPS, 'every ribbon is exactly as thick where it lands as where it leaves',
     `worst mismatch ${worst} at ${worstLabel}`);
}

// ================================================== 2. 厚度 == 权重 × 全局标度
{
  let worst = 0, worstLabel = '';
  for (const l of links) {
    const ops = l.path.ops;
    const t = ops[2][2] - ops[1][6];
    const d = Math.abs(t - l.w * scale);
    if (d > worst) { worst = d; worstLabel = `${l.A.name}→${l.B.name}`; }
  }
  ok(worst <= 1e-9 * scale * 1e6, 'thickness matches weight × the one global scale',
     `worst ${worst} at ${worstLabel}`);
}

// ================================================== 3. 节点高度 == 连线权重之和
// 最右一列只有到达侧、最左一列只有离开侧，所以只能对**存在的那一侧**断言。空的一侧
// 记 0 并不是失败 —— 它根本没有丝带，没有东西可以和它的高度对齐。
{
  let worstOut = 0, worstIn = 0, stranded = 0;
  for (const c of [0, 1, 2]) {
    for (const nd of cols[c]) {
      if (nd.out.length) worstOut = Math.max(worstOut, Math.abs(nd.h - nd.outSum * scale));
      if (nd.in.length) worstIn = Math.max(worstIn, Math.abs(nd.h - nd.inSum * scale));
      if (!nd.out.length && !nd.in.length) stranded++;
    }
  }
  ok(worstOut <= EPS, 'every node height equals the sum of its outgoing ribbons',
     `worst ${worstOut}`);
  ok(worstIn <= EPS, 'every node height equals the sum of its incoming ribbons',
     `worst ${worstIn}`);
  ok(stranded === 0, 'no node is stranded without any ribbon', `${stranded} stranded`);
  ok(cols[0].every((nd) => nd.in.length === 0) && cols[2].every((nd) => nd.out.length === 0),
     'the outer columns are terminals: first only leaves, last only arrives');
}

// ================================================== 4. 连线在节点上首尾相接、不重叠
// 离开侧按 sy 排、到达侧按 ty 排 —— 各自用自己的坐标。拿源节点的 sy 去量目标节点的高度
// 是错的：那条坐标属于丝带的另一头，跟这个节点在哪儿毫无关系。
{
  let gaps = 0, overlaps = 0, escaped = 0, short = 0;
  for (const c of [0, 1, 2]) {
    for (const nd of cols[c]) {
      for (const [list, key] of [[nd.out, 'sy'], [nd.in, 'ty']]) {
        if (!list.length) continue;
        const sorted = list.slice().sort((a, b) => a[key] - b[key]);
        for (const l of sorted) {
          if (l[key] < nd.y0 - EPS || l[key] + l.th > nd.y1 + EPS) escaped++;
        }
        // 连线必须把节点从头到尾铺满：第一根的起点落在 y0，最后一根的终点落在 y1。
        if (Math.abs(sorted[0][key] - nd.y0) > EPS
          || Math.abs(sorted[sorted.length - 1][key] + sorted[sorted.length - 1].th - nd.y1) > EPS) {
          short++;
        }
        for (let i = 1; i < sorted.length; i++) {
          const d = sorted[i][key] - (sorted[i - 1][key] + sorted[i - 1].th);
          if (d > EPS) gaps++;
          if (d < -EPS) overlaps++;
        }
      }
    }
  }
  ok(gaps === 0, 'ribbons stack against each other without gaps', `${gaps} gaps`);
  ok(overlaps === 0, 'ribbons never overlap within a node', `${overlaps} overlaps`);
  ok(escaped === 0, 'ribbons stay inside their node', `${escaped} escaped`);
  ok(short === 0, 'ribbons fill their node end to end', `${short} nodes not covered`);
}

// ================================================== 5. 标度分母的看门人
// 最长的那一列必须正好填满绘图区：节点高度之和加上缝，一像素不多不少。
//
// 这条专抓一种很隐蔽的错：标度的分母取成「所有丝带的权重之和」而不是「声明数」。
// 每条声明跨两级、在连线表里出现两次，分母因此翻倍，整张图缩成一半 —— 而上面四条
// 等宽断言**全都照样通过**，因为等宽只说丝带两端一致，从来不说它有多大。缩了一半的
// 图看起来只是「留白多了点」，不像 bug。
{
  const fullest = cols.reduce((a, c) => (c.length > a.length ? c : a), []);
  const sumH = fullest.reduce((a, nd) => a + nd.h, 0);
  const span = fullest[fullest.length - 1].y1 - fullest[0].y0;
  const gap = (span - sumH) / Math.max(1, fullest.length - 1);
  const used = sumH + gap * (fullest.length - 1);
  ok(Math.abs(used - g.box) <= 1e-6, 'the fullest column exactly fills the drawing box',
     `used ${used.toFixed(2)} of ${g.box} — off by ${(g.box / used).toFixed(3)}x; `
     + 'the scale denominator is not the declaration count');
}

// ================================================== 6. 几何健全性
{
  let nan = 0, inverted = 0, detached = 0;
  const names = [new Set(cols[0].map((n) => n.name)),
                 new Set(cols[1].map((n) => n.name)),
                 new Set(cols[2].map((n) => n.name))];
  for (const l of links) {
    for (const op of l.path.ops) {
      for (let i = 1; i < op.length; i++) if (!Number.isFinite(op[i])) nan++;
    }
    if (l.A.x1 >= l.B.x0) inverted++;
    if (!names[l.A.col].has(l.A.name) || !names[l.B.col].has(l.B.name)) detached++;
    if (l.w <= 0) detached++;
  }
  ok(nan === 0, 'no NaN or Infinity reaches the canvas', `${nan} bad arguments`);
  ok(inverted === 0, 'every ribbon runs left to right across a real gap', `${inverted} bad`);
  ok(detached === 0, 'every ribbon joins two existing, non-empty nodes', `${detached} bad`);

  // 三级的总吞吐相等 —— 每一条声明在每一级都被数到一次。
  const t0 = cols[0].reduce((a, n) => a + n.weight, 0);
  const t1 = cols[1].reduce((a, n) => a + n.weight, 0);
  const t2 = cols[2].reduce((a, n) => a + n.weight, 0);
  ok(t0 === t1 && t1 === t2 && t0 === 170974, 'all three stages carry the same throughput',
     `${t0} / ${t1} / ${t2}`);
  ok(t0 + t1 + t2 === 3 * 170974, 'no declaration is double-counted between stages');
}

// ================================================== 7. 命中测试
{
  let misses = 0;
  for (const c of [0, 1, 2]) {
    for (const nd of cols[c]) {
      const hit = view.pick(nd.x0 + 7, nd.mid);
      if (!hit || hit.type !== 'node' || hit.col !== c || hit.name !== nd.name) misses++;
    }
  }
  ok(misses === 0, 'picking a node centre returns that node', `${misses} misses`);

  // 一个点在某个 x 处的丝带横带。必须和 alluvial-chart.js 里 pick 用的是同一个三次式，
  // 否则这里量的是另一个东西。
  const bandAt = (l, x) => {
    const u = (x - l.A.x1) / Math.max(1e-6, l.B.x0 - l.A.x1);
    const s = 1 - u;
    const top = l.sy * (s * s * (s + 3 * u)) + l.ty * (u * u * (3 * s + u));
    return { top, covers: (y) => y >= top && y <= top + Math.max(l.th, 2.6) };
  };
  let linkMisses = 0, ambiguous = 0, checked = 0;
  for (const l of links) {
    if (l.th < 4) continue;                  // 发丝太细，中点会被邻居抢走，跳过
    const x = (l.A.x1 + l.B.x0) / 2;
    const b = bandAt(l, x);
    const y = b.top + l.th / 2;
    // 不同束的丝带会在中途交叉，同一个点上可能叠着好几条。这时 pick 只能返回其中一条，
    // 所以断言的是「返回的那条确实盖住了这个点」，而不是「返回的必须是这一条」——
    // 后者在交叉处是个无法满足的要求，会变成一个看起来很深奥的假失败。
    const covering = links.filter((m) => bandAt(m, x).covers(y));
    if (covering.length > 1) ambiguous++;
    checked++;
    const hit = view.pick(x, y);
    if (!hit || hit.type !== 'link') { linkMisses++; continue; }
    if (!covering.some((m) => m.A.name === hit.a && m.B.name === hit.b)) linkMisses++;
  }
  ok(linkMisses === 0, 'picking a ribbon mid-span returns a ribbon that covers that point',
     `${linkMisses} misses out of ${checked} (${ambiguous} of them crossed by another ribbon)`);

  ok(view.pick(-500, -500) === null, 'picking empty space returns null');
}

// ================================================== 8. 隐藏一个 domain 之后仍成立
{
  const probe = createAlluvialView();
  probe.setData(data);
  probe.draw(makeCtx(), W, H, 1);
  const before = probe.layout.cols[1].length;
  probe.toggleDomain('Math');
  probe.draw(makeCtx(), W, H, 1);
  const after = probe.layout;
  ok(after.cols[1].length < before, 'hiding Math drops the dirs that lived only under it',
     `${before} -> ${after.cols[1].length}`);
  ok(after.cols[0].every((n) => n.name !== 'Math'), 'the hidden domain is gone from column 1');
  const t = after.cols.map((c) => c.reduce((a, n) => a + n.weight, 0));
  ok(t[0] === t[1] && t[1] === t[2], 'the invariant survives filtering',
     `throughput ${t.join(' / ')}`);
  ok(t[0] === 170974 - 152942, 'the surviving throughput is exactly the unhidden declarations',
     `${t[0]} vs ${170974 - 152942}`);
  let worst = 0;
  for (const l of after.links) {
    const ops = l.path.ops;
    worst = Math.max(worst, Math.abs((ops[3][6] - ops[0][2]) - (ops[2][2] - ops[1][6])));
  }
  ok(worst <= EPS, 'ribbons are still equal-width after filtering', `worst ${worst}`);
  // 隐藏过的视图不能污染没隐藏过的。
  probe.clearHidden();
  probe.draw(makeCtx(), W, H, 1);
  ok(probe.layout.cols[1].length === before, 'clearing the filter restores every node');
}

// ================================================== 9. 标签不重叠
{
  const SKIP = new Set(['domain', 'dir', 'kind']);   // 列标题，不在同一层
  const boxes = firstPaint
    .filter((t) => !SKIP.has(t.text))
    .map((t) => {
      const x0 = t.align === 'right' ? t.x - t.width
        : t.align === 'center' ? t.x - t.width / 2 : t.x;
      return { x0, x1: x0 + t.width, y0: t.y - 7.5, y1: t.y + 7.5, text: t.text };
    });
  const clashes = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ox > 1 && oy > 1) clashes.push(`${a.text} / ${b.text} (${ox.toFixed(0)}px)`);
    }
  }
  ok(clashes.length === 0, 'no two labels overlap',
     `${clashes.length}: ${clashes.slice(0, 3).join('; ')}`);
  ok(firstPaint.length > 10, 'labels were actually drawn',
     `only ${firstPaint.length} fillText calls — the check above would be vacuous`);
  const off = boxes.filter((b) => b.x0 < 0 || b.x1 > W);
  ok(off.length === 0, 'no label is pushed off the canvas',
     off.slice(0, 3).map((b) => b.text).join(', '));
}

// ================================================== 10. 不同画布尺寸下都成立
{
  for (const [w, h] of [[1600, 900], [1100, 700], [960, 540]]) {
    const probe = createAlluvialView();
    probe.setData(data);
    probe.draw(makeCtx(), w, h, 1);
    const lay = probe.layout;
    let worst = 0, outside = 0;
    for (const l of lay.links) {
      const ops = l.path.ops;
      worst = Math.max(worst, Math.abs((ops[3][6] - ops[0][2]) - (ops[2][2] - ops[1][6])));
    }
    for (const c of lay.cols) {
      for (const nd of c) {
        if (nd.y0 < -1 || nd.y1 > h + 1) outside++;
        if (nd.x0 < -1 || nd.x1 > w + 1) outside++;
      }
    }
    ok(worst <= EPS, `equal-width holds at ${w}x${h}`, `worst ${worst}`);
    ok(outside === 0, `nothing escapes the canvas at ${w}x${h}`, `${outside} outside`);
  }
}

// ================================================== 11. API 契约
// main.js 会调的每一个方法都得真的导出了 —— phil-chord 那边抓到过「定义了但忘了导出」
// 导致的白屏。
{
  const need = ['setData', 'getData', 'draw', 'pick', 'describe', 'renderLegend',
                'setHover', 'getHover', 'togglePinned', 'getPinned', 'sameTarget',
                'colorOf', 'domains', 'isHidden', 'toggleDomain', 'clearHidden'];
  for (const k of need) {
    ok(typeof view[k] === 'function', `view.${k} is exported and callable`);
  }
  ok(Array.isArray(view.layout.cols), 'view.layout.cols is reachable for the HUD');
  ok(Array.isArray(view.links), 'view.links is reachable for the HUD');
  ok(Array.isArray(view.nodes), 'view.nodes is reachable for the HUD');

  // 悬停目标是值相等语义：同样的对象内容必须判为同一个，否则悬停状态每帧都变。
  const a1 = { type: 'node', col: 1, name: 'Algebra' };
  const a2 = { type: 'node', col: 1, name: 'Algebra' };
  const b1 = { type: 'node', col: 1, name: 'Analysis' };
  ok(view.sameTarget(a1, a2), 'sameTarget: equal nodes compare equal');
  ok(!view.sameTarget(a1, b1), 'sameTarget: different nodes do not');
  ok(!view.sameTarget(a1, null) && !view.sameTarget(null, null), 'sameTarget handles null');

  view.setHover(a1);
  ok(view.getHover() === a1, 'setHover/getHover round-trips');
  view.setHover(null);
  ok(view.togglePinned(a1) === a1, 'togglePinned pins');
  ok(view.togglePinned(a1) === null, 'togglePinned on the same target unpins');
  view.togglePinned(null);
  ok(view.getPinned() === null, 'pinning null is the same as unpinning');

  // describe 必须能对每种目标说话，且不能抛。
  view.draw(makeCtx(), W, H, 1);
  const dn = view.describe({ type: 'node', col: 1, name: 'Algebra' });
  ok(dn.includes('Algebra') && /declaration/.test(dn), 'describe(node) names it', dn);
  const dl = view.describe({ type: 'link', stage: 0, a: 'Math', b: 'Algebra', w: 1, dom: 'Math' });
  ok(dl.includes('Math') && dl.includes('Algebra'), 'describe(link) names both ends', dl);
  ok(view.describe(null) === '', 'describe(null) is empty, not a crash');

  // 图例必须能渲染，而且能装上点击处理。
  const el = {
    innerHTML: '', _rows: [],
    querySelectorAll() { return this._rows; },
  };
  view.renderLegend(el);
  ok(el.innerHTML.includes('Math') && el.innerHTML.includes('Algebra'),
     'renderLegend writes the domains and the largest flows');
  ok(/class="item/.test(el.innerHTML), 'the legend rows are clickable');
  ok(!/NaN|undefined/.test(el.innerHTML), 'no NaN or undefined leaks into the legend');

  // 上面那句只证明了 HTML 里有 class="item"，证明不了点击接上了。这里真的装一行、
  // 真的点它 —— 而且点的必须是**带 onChange 的那个实例**。
  //
  // 这一条盯的是 §4 那个潜伏 bug：渲染是按需的（requestRender → 单次 rAF），模块自己
  // 改了状态却不喊 onChange，宿主的画布就停在改动之前的那一帧：点「隐藏 Math」，声明少了
  // 一片，丝带却还在，直到下一次 mousemove 顺手重画。stub 的 querySelectorAll 默认返回
  // 空数组，所以这个缺陷不会被任何原有断言挡住。
  const fired = [];
  const el2 = {
    innerHTML: '',
    _rows: [{ dataset: { dom: 'Math' }, onclick: null }],
    querySelectorAll() { return this._rows; },
  };
  const live = createAlluvialView({ onChange: () => fired.push(1) });
  live.setData(data);
  live.renderLegend(el2);
  // 没装上处理器时必须**报失败然后跳过**，不能直接调 —— 否则检查脚本自己抛 TypeError，
  // 死在它唯一要报告的那个缺陷上（变异测试里踩过）。ok() 不中断执行，所以这里要显式分支。
  const click = el2._rows[0].onclick;
  if (typeof click !== 'function') {
    ok(false, 'renderLegend installs a click handler on each row', 'no onclick was installed');
  } else {
    ok(true, 'renderLegend installs a click handler on each row');
    click();
    ok(live.isHidden('Math'), 'clicking that row hides the domain it names');
    ok(fired.length === 1,
       'clicking a legend row calls onChange, so the host repaints (the §4 fix)',
       `onChange fired ${fired.length} times`);
    click();
    ok(!live.isHidden('Math'), 'clicking it again brings the domain back');
    ok(fired.length === 2, 'and it calls onChange every time', `fired ${fired.length}`);
  }

  // onChange 默认是空函数：单独测这个模块时不需要造一个宿主。
  const noOpts = createAlluvialView();
  noOpts.setData(data);
  const el3 = {
    innerHTML: '', _rows: [{ dataset: { dom: 'Math' }, onclick: null }],
    querySelectorAll() { return this._rows; },
  };
  noOpts.renderLegend(el3);
  let threw = null;
  try { el3._rows[0].onclick(); } catch (e) { threw = e; }
  ok(threw === null, 'a view created without onChange still survives a legend click',
     threw && threw.message);

  // 颜色按 domain 的名字走，不按过滤后的名次 —— 隐藏一个不能让别的换色。
  const cMath = view.colorOf('Math');
  view.toggleDomain('Physics');
  ok(view.colorOf('Math') === cMath, 'hiding a domain does not repaint the survivors');
  view.clearHidden();
  ok(view.colorOf('Math') === '#3987e5', 'Math keeps its assigned hue', view.colorOf('Math'));

  // 没有数据时不能抛，画一句说明就走。
  const empty = createAlluvialView();
  empty.draw(makeCtx(), W, H, 1);
  ok(empty.layout === null, 'an empty view has no layout');
  ok(empty.pick(10, 10) === null, 'an empty view picks nothing');
  ok(empty.describe(null) === '', 'an empty view describes nothing');
  ok(buildAlluvial(null) === null && buildAlluvial({}) === null,
     'buildAlluvial tolerates missing data');
}

report();
process.exit(fails.length ? 1 : 0);
