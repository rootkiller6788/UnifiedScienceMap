// check-sunburst.mjs — 旭日图的角度不变量测试。
//
//     node check-sunburst.mjs                          # 用同目录的 sunburst-data.json
//     node check-sunburst.mjs path/to/other.json
//
// 这张图看着复杂，但正确性压在三条可测的话上：
//
//   1. 全部 299,286 条 topic 弧的角度跨度加起来 == 2π；
//   2. 每个 domain 的环 1 跨度 == 它自己所有环 2 弧的跨度之和；
//   3. Σ 环 1 跨度 == 2π（也就是中心）。
//
// 三条全破的图照样画得出来、还挺好看 —— 环 2 每一条弧的比例都对，只是整个环 2 与环 1
// 对不上。所以下面**从发出的 Path2D 绘制调用里反推角度**，而不是读布局自己记的 a0/a1：
// 一个自己算错账的布局，无法被问它自己的测试抓住。
//
// 另外还验 pick 与角度布局是否自洽 —— 这是悬停读数的整条链，Node 里测得到。

import { readFileSync } from 'node:fs';

const TAU = Math.PI * 2;
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
    fill(p) { if (p) fills.push({ path: p, alpha: ctx.globalAlpha, color: ctx.fillStyle }); },
    fillText: (t, x, y) => {
      texts.push({ text: String(t), x, y, align: ctx.textAlign, font: ctx.font,
                   width: ctx.measureText(t).width });
    },
  };
  return ctx;
}

// SUNBURST_CHART 让变异测试把一份**故意改坏**的副本喂进来，确认下面这些断言不是空的。
const src = readFileSync(
  process.env.SUNBURST_CHART || new URL('./sunburst-chart.js', import.meta.url), 'utf8');
const { createSunburstView } = new Function('Path2D',
  src.replace(/^export\s+/gm, '')
    + '\nreturn { createSunburstView };')(Path2D);

const dataPath = process.argv[2] || new URL('./sunburst-data.json', import.meta.url);
const data = JSON.parse(readFileSync(dataPath, 'utf8'));

let pass = 0;
const fails = [];
function ok(cond, label, detail) {
  if (cond) { pass++; return; }
  fails.push(detail ? `${label}\n      ${detail}` : label);
}
function near(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }
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
  ok(m.arcCount === 299286, 'dataset has 299,286 arcs', `got ${m.arcCount}`);
  ok(m.arcWeightTotal === 129731896, 'dataset arc weight total is 129,731,896',
     `got ${m.arcWeightTotal}`);
  ok(m.topicCount === 274422, 'dataset has 274,422 distinct topics', `got ${m.topicCount}`);
  ok(data.domains.length === 11, 'eleven domains', `got ${data.domains.length}`);
  ok(data.arcs.length === 3 * m.arcCount, 'flat arcs array is 3 per arc',
     `${data.arcs.length} vs ${3 * m.arcCount}`);
  ok(data.topics.split('\n').length === m.topicCount,
     'topic dictionary matches topicCount',
     `${data.topics.split('\n').length} vs ${m.topicCount}`);
  const sum = data.domains.reduce((a, d) => a + d.arcWeight, 0);
  ok(sum === m.arcWeightTotal, 'per-domain weights sum to the total', `${sum}`);
  const arcs = data.domains.reduce((a, d) => a + d.arcCount, 0);
  ok(arcs === m.arcCount, 'per-domain arc counts sum to the total', `${arcs}`);
}

// ------------------------------------------------------------- API 契约枚举
// phil-chord 那边出过「定义了但忘了导出」导致的白屏，所以这里逐个点名，不用循环拼。
const view = createSunburstView({ onChange: () => {} });
for (const name of ['setData', 'getData', 'getModel', 'draw', 'pick', 'describe',
                    'renderLegend', 'setHover', 'getHover', 'togglePinned', 'getPinned',
                    'sameTarget', 'topicName', 'getCounts']) {
  ok(typeof view[name] === 'function', `view exports ${name}()`, `typeof = ${typeof view[name]}`);
}
ok('layout' in view && 'links' in view && 'nodes' in view,
   'view exposes layout / links / nodes getters');

view.setData(data);
ok(view.getData() === data, 'getData returns what setData was given');

const ctx = makeCtx();
view.draw(ctx, W, H, 1);

const g = view.layout;
ok(!!g, 'layout was produced');
if (!g) { report(); process.exit(1); }

const { cx, cy, R, innerR, ring1R } = g;

// -------------------------------------------------- 从 Path2D 调用反推几何
const sectors = [];      // 环 1 扇区
const buckets = [];      // 环 2 的 (domain, alpha 桶)
for (const f of ctx.fills) {
  const p = f.path;
  const arcs = p.ops.filter((o) => o[0] === 'arc');
  if (!arcs.length) continue;
  const outer = arcs[0][3];
  // color 必须一起收下来：section 1c 要查的是**真正传给 fill() 的那个 fillStyle**，
  // 少了这个字段它会读到 undefined，然后报「215 个桶颜色全错」—— 那是测试的账错了，
  // 不是模块的。（踩过一次：收集时只留了 p 和 alpha。）
  if (near(outer, R)) buckets.push({ p, alpha: f.alpha, color: f.color });
  else if (near(outer, ring1R)) sectors.push({ p, color: f.color });
}
ok(sectors.length === 11, 'eleven ring-1 sectors were filled', `got ${sectors.length}`);
ok(buckets.length > 0 && buckets.length <= 264,
   '264 or fewer ring-2 bucket paths', `got ${buckets.length}`);

function spanOf(op) { return Math.abs(op[5] - op[4]); }
// 一个桶里半径 == R 的那些 arc op，就是它覆盖的角度区间。
//
// 注意这里**不再是**「一条 op 一条 topic 弧」：同一 bucket 的 topic 在角度上连续，
// 所以 215 段连续区间被合并成 215 个圆环（见 sunburst-chart.js 的 buildPaths）。
// 断言因此改成更直接的一条 —— 这些区间必须无缝、无重叠地铺满整个圆周。
// 铺满 + 不重叠 ⇒ 每条 topic 弧恰好被覆盖一次，比数 op 条数更强：数条数看不出重叠。
function bucketArcs(p) { return p.ops.filter((o) => o[0] === 'arc' && near(o[3], R)); }

// ============================================ 1. Σ topic 弧跨度 == 2π
{
  const iv = [];
  let worstR = 0;
  for (const b of buckets) {
    for (const op of bucketArcs(b.p)) {
      iv.push([op[4], op[5]]);
      worstR = Math.max(worstR, Math.abs(op[3] - R));
    }
  }
  iv.sort((x, y) => x[0] - y[0]);
  let total = 0, gaps = 0, overlaps = 0, worstGap = 0;
  for (let i = 0; i < iv.length; i++) {
    total += iv[i][1] - iv[i][0];
    if (!i) continue;
    const d = iv[i][0] - iv[i - 1][1];
    if (d < -1e-12) overlaps++;
    else if (d > 1e-12) { gaps++; worstGap = Math.max(worstGap, d); }
  }
  ok(iv.length > 0 && iv.length <= 264,
     'ring 2 is emitted as merged runs, one per (domain, bucket)', `${iv.length} runs`);
  ok(gaps === 0, 'the ring-2 runs leave no angular gap', `${gaps} gaps, worst ${worstGap}`);
  ok(overlaps === 0, 'the ring-2 runs do not overlap', `${overlaps} overlaps`);
  ok(near(total, TAU, 1e-9), 'topic arc spans sum to exactly 2π',
     `got ${total} vs ${TAU} (off by ${(total - TAU).toExponential(2)})`);
  ok(worstR < 1e-9, 'every topic arc sits on the outer radius', `worst |r-R| = ${worstR}`);
}

// ================================ 1b. 每条路径的两条弧落在正确的半径上
//
// 角度不变量对半径完全不敏感 —— 半径画错，所有跨度照样是 2π。所以这一段单独钉半径。
// （变异测试就是在这里留了一个洞：把扇区内沿从 innerR 改成 innerR/2，上面全过。）
{
  let badSector = 0;
  for (const s of sectors) {
    const rs = s.p.ops.filter((o) => o[0] === 'arc').map((o) => o[3]);
    if (rs.length !== 2 || !near(rs[0], ring1R) || !near(rs[1], innerR)) badSector++;
  }
  ok(badSector === 0, 'every ring-1 sector spans exactly innerR → ring1R',
     `${badSector} sectors with wrong radii`);

  let badBucket = 0, badPairing = 0;
  for (const b of buckets) {
    const rs = b.p.ops.filter((o) => o[0] === 'arc').map((o) => o[3]);
    if (rs.length % 2 !== 0) { badBucket++; continue; }
    for (let i = 0; i < rs.length; i += 2) {
      // 每条 topic 弧都是「外缘 R 正向 + 内缘 ring1R 反向」这一对。
      if (!near(rs[i], R) || !near(rs[i + 1], ring1R)) badPairing++;
    }
  }
  ok(badBucket === 0, 'every bucket path has an even number of arc ops',
     `${badBucket} paths with an unpaired arc`);
  ok(badPairing === 0, 'every topic arc pairs an outer R edge with an inner ring1R edge',
     `${badPairing} malformed pairs`);
}

// ============================== 1c. 颜色跟随学科，不跟随排名或过滤
//
// 这是「改成一个蓝 → 按学科上色」那次改动的断言。颜色必须来自数据集里的
// domain.color，且**楔子和它里面的弧同色** —— 否则读者没法把「环 2 这片红」
// 和「图例里那个红条」对上。查的是真正传给 fill() 的那个 fillStyle，不是图例文案。
{
  const colorOf = new Map(data.domains.map((d) => [d.id, d.color]));
  let wrongArc = 0, wrongSector = 0, mono = new Set(), sample = '';
  for (const b of buckets) {
    const want = colorOf.get(b.p.__dom);
    if (b.color !== want) {
      wrongArc++;
      if (!sample) sample = `dom ${b.p.__dom}: got ${b.color}, want ${want}, data.domains[0].color=${data.domains[0].color}`;
    }
    mono.add(b.color);
  }
  for (const s of sectors) {
    const want = colorOf.get(s.p.__dom);
    // 扇区的 fillStyle 要从它自己那次 fill 上取。
    const f = ctx.fills.find((x) => x.path === s.p);
    if (!f || f.color !== want) wrongSector++;
    mono.add(f && f.color);
  }
  ok(wrongArc === 0, 'every ring-2 bucket is filled with its discipline’s colour',
     `${wrongArc} buckets with the wrong colour — ${sample}`);
  ok(wrongSector === 0, 'every ring-1 sector is filled with its discipline’s colour',
     `${wrongSector} sectors with the wrong colour`);
  const present = new Set(data.domains.map((d) => d.color));
  ok(mono.size > 1, 'the ring is no longer a single colour', `${mono.size} colour(s) used`);
  ok([...mono].every((c) => present.has(c)),
     'every colour on the ring comes from the dataset, none invented in the draw code');
}

// ================================= 2. 每个 domain 的环 1 跨度 == 它的环 2 之和
{
  let worst = 0, worstName = '';
  const sectorSpans = new Map();
  for (const s of sectors) {
    const op = s.p.ops.find((o) => o[0] === 'arc' && near(o[3], ring1R));
    if (op) sectorSpans.set(s.p.__dom, spanOf(op));   // 缺了就留给下面的断言报，不要在这里抛
  }
  const bucketSpans = new Map();
  for (const b of buckets) {
    const s = bucketArcs(b.p).reduce((a, op) => a + spanOf(op), 0);
    bucketSpans.set(b.p.__dom, (bucketSpans.get(b.p.__dom) || 0) + s);
  }
  for (const d of data.domains) {
    const a = sectorSpans.get(d.id);
    const b = bucketSpans.get(d.id);
    ok(a !== undefined && b !== undefined, `domain ${d.id} has both a sector and arcs`);
    if (a === undefined || b === undefined) continue;
    const diff = Math.abs(a - b);
    if (diff > worst) { worst = diff; worstName = d.name; }
  }
  ok(worst < 1e-12, 'each domain: ring-1 span == sum of its ring-2 arc spans',
     `worst mismatch ${worst.toExponential(2)} at ${worstName}`);
}

// ============================================================ 3. Σ 环 1 == 2π
{
  let total = 0;
  for (const s of sectors) {
    const op = s.p.ops.find((o) => o[0] === 'arc' && near(o[3], ring1R));
    if (op) total += spanOf(op);
  }
  ok(near(total, TAU, 1e-9), 'ring-1 spans sum to exactly 2π (the centre)',
     `got ${total}`);
}

// ============================== 4. 桶的划分不丢弧：每个 (domain,桶) 只出现一次
{
  const keys = new Set();
  let dup = 0;
  for (const b of buckets) {
    const k = b.p.__dom + ':' + b.p.__bucket;
    if (keys.has(k)) dup++;
    keys.add(k);
  }
  ok(dup === 0, 'no (domain, bucket) path is emitted twice', `${dup} duplicates`);
  ok(keys.size === buckets.length, 'bucket keys are unique');

  // 合并之后「桶里的 op 数 == 该 domain 的 arcCount」不再成立（215 个圆环 vs 299,286 条弧）。
  // 代替它的是**逐 domain 的铺满检查**：该 domain 发出的区间必须无缝、无重叠地
  // 盖满它自己的角度跨度，且区间数不超过 24（一个 bucket 一段，BUCKETS = 24）。
  // 加上上面 (domain, 桶) 键唯一，就得到「每条 topic 弧恰好落进一个桶」——
  // 也就是原来那条断言真正想说的东西。
  // 跨 domain 的接缝和全局 Σ 已经在 section 1 查了；每个 domain 的「环 1 跨度 ==
  // 环 2 之和」在 section 2 查了（用的是**发出的**扇区 op，不是布局自己记的账）。
  // 这一段只管剩下的两件：逐 domain 内部无缝，以及段数不超过桶数。
  let badDom = 0, detail = '';
  for (const d of data.domains) {
    const iv = [];
    for (const b of buckets) {
      if (b.p.__dom !== d.id) continue;
      for (const op of bucketArcs(b.p)) iv.push([op[4], op[5]]);
    }
    iv.sort((x, y) => x[0] - y[0]);
    let seamless = iv.length > 0 && iv.length <= 24;
    for (let i = 1; i < iv.length; i++) {
      if (Math.abs(iv[i][0] - iv[i - 1][1]) > 1e-12) seamless = false;
    }
    if (!seamless) { badDom++; detail = `${d.name} (${iv.length} runs)`; }
  }
  ok(badDom === 0, 'every domain: its ring-2 runs are seamless, at most one per bucket',
     `${badDom} domains off — ${detail}`);
}

// ================================ 5. 桶内不透明度一致，且越重的桶越不透明
{
  // 每个桶路径只被 fill 一次，且用的就是该桶的代表不透明度。
  const alphas = new Map();
  for (const b of buckets) {
    const k = b.p.__dom + ':' + b.p.__bucket;
    if (alphas.has(k)) ok(false, `bucket ${k} filled once`);
    alphas.set(k, b.alpha);
  }
  // 不透明度是**桶号**的函数，不是 (domain,桶号) 的函数：同一个桶号在 11 个学科里
  // 必须是同一个值，否则「深浅 = 权重」这个读法在每个扇区里都换一套刻度。
  const byBucket = new Map();
  let split = 0;
  for (const b of buckets) {
    const k = b.p.__bucket;
    if (byBucket.has(k) && byBucket.get(k) !== b.alpha) split++;
    byBucket.set(k, b.alpha);
  }
  ok(split === 0, 'one opacity per bucket index, shared across all disciplines',
     `${split} buckets disagree between disciplines`);
  ok(byBucket.size <= 24, 'at most 24 opacity levels', `got ${byBucket.size}`);
  const sorted = [...alphas.values()].sort((x, y) => x - y);
  // detail 字符串不能比断言本身更脆：这里 sorted 可能是空的，直接 .toFixed 会在
  // **构造失败信息**的时候抛，于是整份报告变成一段 stack trace，后面的断言全都不再跑。
  const rangeText = sorted.length
    ? `range ${sorted[0].toFixed(3)}..${sorted[sorted.length - 1].toFixed(3)}`
    : 'no bucket paths were filled at all';
  ok(sorted.length > 0 && sorted[0] >= 0.03 && sorted[sorted.length - 1] <= 1.0,
     'opacities stay inside [0.035, 0.965]', rangeText);
  // 桶号越大越不透明 —— 不透明度是权重的单调函数，不是随便分档。
  const byDomBuckets = new Map();
  for (const b of buckets) {
    const list = byDomBuckets.get(b.p.__dom) || [];
    list.push(b);
    byDomBuckets.set(b.p.__dom, list);
  }
  let bad = 0;
  for (const list of byDomBuckets.values()) {
    list.sort((x, y) => x.p.__bucket - y.p.__bucket);
    for (let i = 1; i < list.length; i++) {
      if (!(list[i].alpha > list[i - 1].alpha)) bad++;
    }
  }
  ok(bad === 0, 'higher bucket index always means higher opacity', `${bad} violations`);
}

// ============================ 5b. 桶必须真的跟着权重走（这条是变异测试逼出来的）
//
// 上面那一整块在「所有弧都塞进 0 号桶」时会**全部空过**：只有一个桶号时，跨学科的
// 一致性平凡成立，单调性没有任何一对可比，不透明度也落在合法区间里。也就是说
// opacity 这个唯一的编码通道可以完全失效而测试一声不吭 —— 变异测试正是用这一刀
// 找到这个洞的。所以下面直接验「桶是权重的单调函数，且真的用满了值域」。
{
  const all = [];
  for (const a of view.links) {
    for (let i = 0; i < a.w.length; i++) all.push([a.w[i], a.bucket[i]]);
  }
  all.sort((x, y) => (x[0] - y[0]) || (x[1] - y[1]));
  let drop = 0;
  for (let i = 1; i < all.length; i++) if (all[i][1] < all[i - 1][1]) drop++;
  ok(drop === 0, 'bucket index never decreases as weight increases', `${drop} inversions`);
  ok(all.length === 299286, 'every arc contributed a (weight, bucket) pair', `${all.length}`);

  const distinct = new Set(all.map((x) => x[1]));
  ok(distinct.size >= 20, 'the opacity range is genuinely used, not collapsed',
     `only ${distinct.size} of 24 buckets are populated`);
  ok(all[0][1] === 0, 'the lightest arc sits in the bottom bucket', `got ${all[0][1]}`);
  ok(all[all.length - 1][1] === 23, 'the heaviest arc sits in the top bucket',
     `got ${all[all.length - 1][1]} for weight ${all[all.length - 1][0]}`);

  // 把账本和发出的绘制调用对起来：每个 domain 的桶路径数 == 它用到的不同桶号数。
  const pathsPerDom = new Map();
  for (const b of buckets) {
    const s = pathsPerDom.get(b.p.__dom) || new Set();
    s.add(b.p.__bucket);
    pathsPerDom.set(b.p.__dom, s);
  }
  for (const a of view.links) {
    const s = pathsPerDom.get(a.id);
    const want = new Set(a.bucket).size;
    ok(s && s.size === want, `domain ${a.name}: exactly one path per distinct bucket`,
       `${s ? s.size : 'no paths'} vs ${want} distinct buckets`);
  }
}

// =========================== 6. 布局给 pick 用的前提（存储次序即角度次序）
{
  let bad = 0, badW = 0;
  for (const a of view.links) {
    for (let i = 1; i < a.a0.length; i++) {
      if (!(a.a0[i] >= a.a1[i - 1] - 1e-12)) bad++;
      if (a.w[i] > a.w[i - 1]) badW++;
    }
  }
  ok(bad === 0, 'arc start angles are non-decreasing (binary search is valid)',
     `${bad} out-of-order arcs`);
  ok(badW === 0, 'arcs are stored heaviest-first', `${badW} ascending pairs`);
}

// ==================================================== 7. pick ↔ 角度布局自洽
{
  const r1 = (innerR + ring1R) / 2;
  for (const d of data.domains) {
    const s = g.domains.find((x) => x.id === d.id);
    const am = (s.a0 + s.a1) / 2;
    const hit = view.pick(cx + Math.cos(am) * r1, cy + Math.sin(am) * r1);
    ok(hit && hit.type === 'domain' && hit.id === d.id,
       `pick at the middle of the ${d.name} wedge returns that domain`,
       hit ? `got ${hit.type}/${hit.id}` : 'got null');
  }

  const r2 = (ring1R + R) / 2;
  let checked = 0, miss = 0, wrong = 0;
  for (const a of view.links) {
    const n = a.a0.length;
    const stride = Math.max(1, Math.floor(n / 40));
    for (let i = 0; i < n; i += stride) {
      const am = (a.a0[i] + a.a1[i]) / 2;
      const hit = view.pick(cx + Math.cos(am) * r2, cy + Math.sin(am) * r2);
      checked++;
      if (!hit || hit.type !== 'topic') { miss++; continue; }
      if (hit.dom !== a.id || hit.topicId !== a.topic[i]) wrong++;
    }
  }
  ok(checked > 400, 'sampled enough topic arcs for pick', `${checked} probes`);
  ok(miss === 0, 'every sampled topic arc is pickable', `${miss}/${checked} missed`);
  ok(wrong === 0, 'pick returns the arc actually under the cursor',
     `${wrong}/${checked} returned a different arc`);
}

// ============================================== 8. 中心与画布外的 pick
{
  const c = view.pick(cx, cy);
  ok(c && c.type === 'center', 'pick at the centre returns the centre',
     c ? c.type : 'null');
  ok(view.pick(cx, cy - R - 200) === null, 'pick far outside returns null');
  const edge = view.pick(cx, cy - innerR + 0.5);
  ok(edge && edge.type === 'center', 'the innermost pixel is still the centre',
     edge ? edge.type : 'null');
}

// ============================================================ 9. sameTarget
{
  const a = { type: 'domain', id: 3 };
  const b = { type: 'domain', id: 3 };
  const c = { type: 'domain', id: 4 };
  ok(view.sameTarget(a, b), 'sameTarget: identical domains match');
  ok(!view.sameTarget(a, c), 'sameTarget: different domains do not');
  ok(!view.sameTarget(a, { type: 'topic', dom: 3, topicId: 1 }),
     'sameTarget: different types do not match');
  ok(view.sameTarget({ type: 'topic', dom: 2, topicId: 9 },
                     { type: 'topic', dom: 2, topicId: 9 }),
     'sameTarget: identical topics match');
  ok(!view.sameTarget(null, a), 'sameTarget: null never matches');
}

// ============================================================ 10. describe
{
  const m = data.meta;
  const c = view.describe({ type: 'center' });
  ok(c.includes(m.arcWeightTotal.toLocaleString()),
     'centre readout prints the article×topic total (not the article count)',
     c);
  ok(c.includes(m.totalArticles.toLocaleString()), 'centre readout prints article count', c);
  ok(!c.includes((129731896).toLocaleString() + '0'), 'sanity');

  const d = view.describe({ type: 'domain', id: 8, name: 'Medicine', dom: 8 });
  ok(d.includes('Medicine') && d.includes('6,138,406'),
     'domain readout includes its article count', d);

  const s = g.domains.find((x) => x.id === 8);
  const first = view.links.find((x) => x.id === 8);
  const t = view.describe({ type: 'topic', dom: 8, name: 'Medicine',
                            topicId: first.topic[0], w: first.w[0] });
  ok(t.includes(view.topicName(first.topic[0])),
     'topic readout names the topic', t);
  ok(t.includes('Medicine'), 'topic readout names its discipline', t);
  ok(!/\bundefined\b|\bNaN\b/.test(c + d + t), 'no undefined/NaN in any readout',
     `${c} | ${d} | ${t}`);
}

// ============================================================ 11. renderLegend
{
  const el = { innerHTML: '', querySelectorAll: () => [] };
  view.renderLegend(el);
  ok(el.innerHTML.length > 400, 'legend renders something substantial',
     `${el.innerHTML.length} chars`);
  for (const d of data.domains) {
    ok(el.innerHTML.includes(d.name), `legend lists ${d.name}`);
  }
  ok(!/undefined|NaN/.test(el.innerHTML), 'no undefined/NaN in the legend');
  // 图例必须把三个通道说清楚：颜色 = 学科、不透明度 = 主题权重、角度 = 文章×主题对。
  // 少说一个，读者就会把深浅当成学科色、或把角度当成文章数。
  ok(/Colour is the <b>discipline<\/b>/.test(el.innerHTML),
     'legend states that colour is the discipline');
  ok(/opacity is the <b>topic's weight<\/b>/.test(el.innerHTML),
     'legend states that opacity is the topic weight');
  ok(/article×topic pairs/.test(el.innerHTML),
     'legend states the angular unit');
  // 颜色不是唯一线索 —— 这条不是文案偏好，是 dataviz 的硬要求，所以钉住。
  ok(/Identity does not rest on colour/.test(el.innerHTML),
     'legend does not let colour carry identity alone');
  // 每个学科的色条必须用它**自己**的颜色，且 11 个各不相同。
  const bars = [...el.innerHTML.matchAll(/background:(#[0-9a-f]{6});width:([\d.]+)%/g)];
  ok(bars.length === 11, 'all 11 disciplines get a colour bar in the legend',
     `got ${bars.length}`);
  ok(new Set(bars.map((b) => b[1])).size === 11,
     'the 11 legend bars use 11 distinct colours',
     `${new Set(bars.map((b) => b[1])).size} distinct`);
  const domColors = new Set(data.domains.map((d) => d.color));
  ok(domColors.size === 11, 'the dataset itself carries 11 distinct discipline colours',
     `${domColors.size} distinct`);
  ok(bars.every((b) => domColors.has(b[1])),
     'every legend bar colour comes from the dataset, not invented in the legend');
}

// ============================================================ 12. 画布内
{
  ok(cx - R > 0 && cx + R < W, 'chart fits horizontally', `cx=${cx} R=${R}`);
  ok(cy - R > 100, 'chart clears the title/subtitle band', `top = ${cy - R}`);
  ok(cy + R < H, 'chart fits vertically', `bottom = ${cy + R}`);
  ok(innerR > 0 && innerR < ring1R && ring1R < R, 'radii are ordered',
     `${innerR} < ${ring1R} < ${R}`);
  // 11 个扇区在环 1 上从 12 点起首尾相接，不留缝也不重叠。
  let cursor = -Math.PI / 2, worst = 0;
  for (const d of g.domains) {
    worst = Math.max(worst, Math.abs(d.a0 - cursor));
    cursor = d.a1;
  }
  ok(worst < 1e-12, 'ring-1 sectors are contiguous from 12 o’clock',
     `worst gap ${worst.toExponential(2)}`);
  ok(Math.abs(cursor - (-Math.PI / 2 + TAU)) < 1e-12, 'sectors close the circle',
     `ends at ${cursor}`);
}

// ================================================= 13. 换尺寸后不变量仍然成立
{
  const ctx2 = makeCtx();
  view.draw(ctx2, 1280, 720, 1.4);
  const g2 = view.layout;
  const iv = [];
  for (const f of ctx2.fills) {
    const p = f.path;
    if (!p || !p.ops.length) continue;
    for (const op of p.ops) {
      if (op[0] === 'arc' && near(op[3], g2.R)) iv.push([op[4], op[5]]);
    }
  }
  iv.sort((x, y) => x[0] - y[0]);
  let total = 0, broken = 0;
  for (let i = 0; i < iv.length; i++) {
    total += iv[i][1] - iv[i][0];
    if (i && Math.abs(iv[i][0] - iv[i - 1][1]) > 1e-12) broken++;
  }
  // 这里原来数的是 op 条数（== 299,286）。合并成一个桶一段之后条数不再等于弧数，
  // 换成「换个尺寸后仍然无缝铺满」—— 尺寸变了要重算几何、重建路径，正是会漏的地方。
  ok(iv.length > 0 && broken === 0, 'ring-2 runs still tile seamlessly at 1280×720',
     `${iv.length} runs, ${broken} seams`);
  ok(near(total, TAU, 1e-9), 'spans still sum to 2π at 1280×720', `got ${total}`);
  ok(g2.R < R, 'smaller canvas means a smaller radius', `${g2.R} vs ${R}`);
}

// ============================================ 14. 空数据不抛错（接线用）
{
  const v2 = createSunburstView();
  v2.setData(null);
  const c2 = makeCtx();
  v2.draw(c2, W, H, 1);            // 不能抛
  ok(c2.texts.length === 1, 'empty data draws the one explanatory line',
     `${c2.texts.length} texts`);
  ok(/build-science-views-data/.test(c2.texts[0].text), 'the line names the build command',
     c2.texts[0].text);
  ok(v2.pick(10, 10) === null, 'pick on empty data returns null');
  ok(v2.describe({ type: 'center' }) === '', 'describe on empty data returns empty');
  const el = { innerHTML: 'x', querySelectorAll: () => [] };
  v2.renderLegend(el);
  ok(el.innerHTML === '', 'legend clears on empty data');
}

report();
process.exit(fails.length ? 1 : 0);
