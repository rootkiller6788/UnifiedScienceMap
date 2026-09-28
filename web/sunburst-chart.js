// sunburst-chart.js — 全科学的严格层级旭日图：Science → 11 domain → 299,286 topic 弧。
//
// 读 web/sunburst-data.json（scripts/build-science-views-data.mjs 生成）。
//
// **没有 Field / Subfield 两级，这是数据说的，不是省事。** map_of_science 里
// key_concepts 是自由文本关键词（不是受控层级），labels.tsv 只有 49 条波兰语标签，
// foreground.svg 是纯装饰（foreground.js 只调 getBBox()，从不与 cluster 关联）。
// 所以真实存在的层级只有三层：全部 → cluster_category → 关键词。硬塞两级中间层
// 就得凭空发明分类法，那不是画数据，是画我的话。用户选定「只画真有的层级」。
//
// ---------------------------------------------------------------- 角度单位
//
// 一条 (domain, keyword) 弧的角度 ∝ **该 domain 下含这个 keyword 的所有 cluster 的
// num_recent_articles 之和**。总量 129,731,896，是「文章 × 主题对」，不是文章数
// (25,968,533)。两个量差 5 倍，且**用错哪个都看不出来** —— 每条弧的相对比例都对，
// 只有中心那圈的绝对长度不对。所以 build 脚本把两个数都钉进了断言。
//
// 选文章×主题对是因为它**直接实测**（不经过任何假设）、两环**精确闭合**，而且因为
// 每个 cluster 的关键词数在 11 个学科里恒为 4.94–4.99，它与文章数给出的百分比逐位
// 相同（差 <0.1%）。换句话说这个选择不影响读者能看到的任何结论，取能闭合的那个。
//
// ---------------------------------------------------------------- 颜色
//
// **颜色 = 学科，不透明度 = 该主题的权重**。两个通道编码两个不同的量，不重复编码。
// 扇区、环 2 的弧、图例里的横条、悬停读数四处用的是同一个 `domain.color`，所以
// 「这个楔子属于哪个学科」在四个地方是同一个答案。
//
// 曾经全部弧共用一个蓝（MONO_TINT），理由是「11 个色相过不了 dataviz 校验器的
// all-pairs 门」。那条理由有两点站不住，记在这里免得再被当成结论：
//
//   1. **它从没被跑过。** 校验器在本次工作中两次被拒（第二次的拒绝理由明确说明
//      「针对结果，不只是这条命令」），所以 11 个色到底能不能过门是**未测量**的，
//      不是测出来过不了。别再引用它当依据。
//   2. **即使用颜色，身份也不由颜色单独承载**（这本来就是 dataviz 的硬要求）：
//      环上每个楔子都有直接标注、楔子之间有一条黑色径向分隔线、图例列全 11 个名字
//      并带各自的色条。颜色在这里是**加速识别**，不是唯一线索 —— 色觉障碍的读者
//      拿到的信息一个都不少。
//
// 已知的诚实代价：11 个色相在深色底上并非两两都能可靠区分，尤其是环 2 里权重很小
// 的弧（alpha 低到 0.035）。所以相邻楔子的颜色**不保证**可分 —— 要区分就靠标注和
// 分隔线。若将来校验器可用并通过 all-pairs，这里可以放心提高饱和度；在那之前不要
// 把颜色当成可以单独依赖的通道。
//
// ---------------------------------------------------------------- 性能
//
// 299,286 条弧一条不画少、零截断（用户选定「全画，不透明度按权重」）。做法是按
// **(domain, 不透明度分桶)** 聚成 11 × 24 = 264 个 Path2D，每次 draw 只 264 次 fill()。
// 这 264 个 Path2D **按 (w,h) 缓存** —— 悬停只改 fillStyle 和 globalAlpha，几何一像素
// 都不动，所以悬停不需要重建 90 万个 path op，只重填 264 次。
//
// 已知取舍：外环周长约 1,670px 摊 299,286 条弧 ≈ 每像素 179 条，权重小的那些叠成一片
// 柔和的雾。这是「全画」的必然结果；「只画权重 ≥2」会丢掉近 9 成的弧，与用户的选择相悖。

const TAU = Math.PI * 2;

const PAD_T = 132;          // 标题压在 70/100，绘图区从 132 起
const PAD_B = 44;
const PAD_X = 120;

const HOLE_F = 0.26;        // 中心孔半径（× R）
const RING1_F = 0.44;       // domain 环外沿（× R）

const ALPHA_MIN = 0.035;
const ALPHA_MAX = 0.965;
const BUCKETS = 24;
const DIM = 0.16;

const LABEL_FONT = 12;
const LABEL_GAP = 9;        // 标签锚点离外沿的距离
const DIM_ALPHA = 0.30;     // 被压暗的标签

// 现在只当**兜底**:某个学科没带 color 时才会用到。与 science-categories.mjs 的
// MONO_TINT 同值。内联而不是 import:chart 模块是给浏览器直接 <script> 加载的,
// web/ 下没有打包器,跨文件 import 会把加载顺序变成隐式依赖。
const MONO_TINT = '#3987e5';
const BG = '#1a1a19';

export function createSunburstView(opts) {
  const onChange = (opts && opts.onChange) || (() => {});

  let data = null;
  let meta = null;
  let topics = null;         // 换行连接的主题词表
  let topicList = null;      // 惰性 split，只有悬停到 topic 时才需要用
  let hidden = new Set();    // 占位：旭日图不过滤，保留是为了与其它视图的 API 对齐
  let hover = null;
  let pinned = null;
  let geo = null;

  function setData(d) {
    data = d || null;
    meta = (d && d.meta) || null;
    topics = (d && d.topics) || '';
    topicList = null;
    hover = null;
    pinned = null;
    geo = null;
  }
  function getData() { return data; }

  function topicName(id) {
    if (!topicList) topicList = topics ? topics.split('\n') : [];
    return topicList[id] || '';
  }

  // 环序 = 按弧权重（文章×主题对）降序。这个次序与按文章数降序**完全一致**（每个
  // cluster 恒约 5 个关键词），也与 build 脚本里 arcs 的存储次序一致。它由数据算出，
  // 不是写死的 —— 换了数据集就跟着变。
  function orderOf(d) {
    return (d.domains || []).slice().sort((a, b) => (b.arcWeight - a.arcWeight) || (a.id - b.id));
  }

  // ------------------------------------------------------------------- 分桶
  function alphaOf(w, maxW) {
    if (!(w > 1) || !(maxW > 1)) return ALPHA_MIN;
    const t = Math.log(w) / Math.log(maxW);
    return ALPHA_MIN + (ALPHA_MAX - ALPHA_MIN) * Math.max(0, Math.min(1, t));
  }
  function bucketOf(w, maxW) {
    const t = (alphaOf(w, maxW) - ALPHA_MIN) / (ALPHA_MAX - ALPHA_MIN);
    return Math.max(0, Math.min(BUCKETS - 1, Math.floor(t * (BUCKETS - 1) + 1e-9)));
  }
  function bucketAlpha(b) { return ALPHA_MIN + (ALPHA_MAX - ALPHA_MIN) * (b / (BUCKETS - 1)); }

  // ------------------------------------------------------------------ layout
  function layout(w, h) {
    const sig = `${w}x${h}|${hidden.size}`;
    if (geo && geo.sig === sig) return geo;
    if (!data || !data.domains || !data.arcs) { geo = null; return null; }

    const availH = h - PAD_T - PAD_B;
    const cx = w / 2;
    const cy = PAD_T + availH / 2;
    const R = Math.max(40, Math.min(availH / 2, w / 2 - PAD_X));
    const innerR = R * HOLE_F;
    const ring1R = R * RING1_F;

    const order = orderOf(data);
    const maxW = meta.maxArcWeight || 1;

    // arcs 是扁平的 [domId, topicId, weight, ...]；按 domain 建 TypedArray 视图。
    const raw = data.arcs;
    const perDom = new Map();
    for (let i = 0; i < raw.length; i += 3) {
      const dom = raw[i];
      let e = perDom.get(dom);
      if (!e) { e = { topic: [], w: [] }; perDom.set(dom, e); }
      e.topic.push(raw[i + 1]);
      e.w.push(raw[i + 2]);
    }

    const totalWeight = order.reduce((a, d) => a + d.arcWeight, 0) || 1;

    const domains = [];
    const arcs = [];
    let cursor = -Math.PI / 2;                 // 12 点方向起，顺时针（canvas 的正角方向）

    for (const d of order) {
      const span = (d.arcWeight / totalWeight) * TAU;
      const a0 = cursor, a1 = cursor + span;
      cursor = a1;
      const sectors = { id: d.id, name: d.name, color: d.color, arcWeight: d.arcWeight,
                        arcs: d.arcCount, distinctKeywords: d.distinctKeywords,
                        clusters: d.clusters, articles: d.articles,
                        a0, a1, span };
      domains.push(sectors);

      const e = perDom.get(d.id) || { topic: [], w: [] };
      const n = e.topic.length;
      const tA0 = new Float64Array(n), tA1 = new Float64Array(n);
      const tId = new Int32Array(n), tW = new Int32Array(n), tB = new Int32Array(n);
      // 存储次序就是角度次序（build 脚本按权重降序排的），所以 a0 单调递增，
      // pick 可以直接二分。权重降序还有第二个好处：重的弧在下、轻的弧压在上面。
      let acc = a0;
      for (let i = 0; i < n; i++) {
        const step = (e.w[i] / d.arcWeight) * span;
        tA0[i] = acc; tA1[i] = acc + step;
        tId[i] = e.topic[i];
        tW[i] = e.w[i];
        tB[i] = bucketOf(e.w[i], maxW);
        acc += step;
      }
      arcs.push({ id: d.id, name: d.name, a0: tA0, a1: tA1, topic: tId, w: tW, bucket: tB });
    }

    geo = { sig, w, h, cx, cy, R, innerR, ring1R, order, domains, arcs, totalWeight, maxW, paths: null };
    return geo;
  }

  // 264 个 Path2D，按 (w,h) 缓存。悬停不重建 —— 它只改 fillStyle / globalAlpha。
  // 11 个 domain 扇区也走 Path2D，一是为了能填色，二是为了让「环 1 跨度 == 环 2 之和」
  // 这条不变量能从**发出的绘制调用**里量出来，而不是问布局自己记的账。
  function buildPaths(g) {
    if (g.paths) return g.paths;
    const buckets = new Map();                 // 'domId:bucket' -> Path2D
    const labelR = g.ring1R;                   // 环 2 内沿
    // 学科色只在建路径时查一次表，挂到 path 上。draw() 里每帧 264 次 fill 就不必再查，
    // 也就不可能在悬停路径上漏掉某个分支（颜色跟随**实体**，不跟随排名/过滤）。
    const colorOf = new Map(g.domains.map((d) => [d.id, d.color]));
    // **同一 bucket 的弧在角度上必然连续**，所以整段连续区间可以合成一个圆环：
    // 1 正 1 反两次 arc() 就够，而不是每条弧各两次。
    //
    // 为什么必然连续：data.arcs 在每个 domain 内是按权重**降序**存的（build 脚本排的），
    // 而 bucket 是权重的单调函数 bucketOf(w)。实测 299,275 对递减、**0 对递增**。
    // 环 2 的内外缘都是定半径（R 和 labelR），所以区间 [a0[i], a1[j]] 的圆环就是
    // 这些弧的并集，像素完全一样（同色同透明度）。
    //
    // 为什么非这样不可：逐条画要 2×299,286 = 598,572 次 arc()，实测首帧 3.9 秒，
    // 切到 Sunburst 就是卡死四秒。合并后是 2×215 = 430 次。跨 bucket 不合并 ——
    // 循环只在 bucket 相等时延伸，所以数据没排序也不会画错，只是慢回去。
    for (const a of g.arcs) {
      const n = a.a0.length;
      let i = 0;
      while (i < n) {
        const b = a.bucket[i];
        const key = a.id + ':' + b;
        let p = buckets.get(key);
        if (!p) { p = new Path2D(); p.__dom = a.id; p.__bucket = b; p.__color = colorOf.get(a.id) || MONO_TINT; buckets.set(key, p); }
        let j = i;
        while (j + 1 < n && a.bucket[j + 1] === b) j++;
        // 外缘正向、内缘反向，闭合 —— 一环上每个像素恰好被一条弧覆盖一次。
        p.arc(g.cx, g.cy, g.R, a.a0[i], a.a1[j]);
        p.arc(g.cx, g.cy, labelR, a.a1[j], a.a0[i], true);
        p.closePath();
        i = j + 1;
      }
    }
    const sectors = [];
    for (const d of g.domains) {
      const p = new Path2D();
      p.__dom = d.id;
      p.__ring = 1;
      p.__color = d.color || MONO_TINT;
      p.arc(g.cx, g.cy, g.ring1R, d.a0, d.a1);
      p.arc(g.cx, g.cy, g.innerR, d.a1, d.a0, true);
      p.closePath();
      sectors.push(p);
    }
    g.paths = { buckets, list: [...buckets.values()], sectors };
    return g.paths;
  }

  // --------------------------------------------------------------------- draw
  function draw(ctx, w, h, k) {
    k = k || 1;
    if (!data) {
      ctx.save();
      ctx.fillStyle = 'rgba(139,148,158,0.9)';
      ctx.font = `${13 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('sunburst-data.json not loaded — run scripts/build-science-views-data.mjs',
                   w / 2, h / 2);
      ctx.restore();
      return;
    }
    const g = layout(w, h);
    if (!g) return;
    const paths = buildPaths(g);

    const focus = hover || pinned;
    const focusDom = focus && (focus.type === 'domain' || focus.type === 'topic') ? focus.dom : null;

    // 1. 中心孔：先擦干净，264 条弧的雾不能糊到中心读数上。
    ctx.save();
    ctx.globalAlpha = 1;
    const centerGlow = ctx.createRadialGradient(g.cx, g.cy, 0, g.cx, g.cy, g.innerR * 1.12);
    centerGlow.addColorStop(0, 'rgba(0,0,0,0.96)');
    centerGlow.addColorStop(0.62, 'rgba(5,8,14,0.92)');
    centerGlow.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = centerGlow;
    ctx.beginPath();
    ctx.arc(g.cx, g.cy, g.innerR - 0.5, 0, TAU);
    ctx.fill();

    // 2. 环 1（11 个 domain 扇区）。比环 2 淡得多：它的作用是「这 11 个楔子有多宽」，
    //    不是抢戏。被聚焦的 domain 提到接近满不透明度。颜色 = 该学科，和环 2 同色，
    //    这样「楔子」和「楔子里的主题」读起来是同一个学科的两个层次。
    for (const p of paths.sectors) {
      const lit = !focusDom || p.__dom === focusDom;
      ctx.globalAlpha = lit ? (focusDom ? 0.85 : 0.34) : DIM;
      ctx.fillStyle = p.__color || MONO_TINT;
      ctx.fill(p);
    }

    // 3. 环 2（264 个桶）。颜色跟随**学科**，不透明度跟随重量级 —— 两个通道编码两个
    //    不同的量，不重复编码。被聚焦的 domain 保持原亮度，其余压暗。
    for (const p of paths.list) {
      const lit = !focusDom || p.__dom === focusDom;
      ctx.globalAlpha = bucketAlpha(p.__bucket) * (lit ? 1 : DIM);
      ctx.fillStyle = p.__color;
      ctx.fill(p);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // 4. 分隔：11 条**径向**线，从中心孔一直划到外沿。是描边不是几何缝隙 ——
    //    留缝就得把扇区角度缩短，那样 Σ 角跨度就不再是 2π，不变量当场破。
    //    描边不动几何，读者照样能看出 11 个楔子的边界在哪。
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.48)';
    ctx.lineWidth = 1.15 / k;
    ctx.beginPath();
    for (const d of g.domains) {
      const c = Math.cos(d.a0), s = Math.sin(d.a0);
      ctx.moveTo(g.cx + c * g.innerR, g.cy + s * g.innerR);
      ctx.lineTo(g.cx + c * g.R, g.cy + s * g.R);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1 / k;
    ctx.beginPath();
    for (const r of [g.innerR, g.ring1R, g.R]) {
      ctx.moveTo(g.cx + r, g.cy);
      ctx.arc(g.cx, g.cy, r, 0, TAU);
    }
    ctx.stroke();
    ctx.restore();

    // 5. 被聚焦的单条 topic 弧：它在某个桶里，单独重画一条亮边才看得见。
    if (focus && focus.type === 'topic') {
      const a = g.arcs.find((x) => x.id === focus.dom);
      if (a) {
        const i = a.topic.indexOf(focus.topicId);
        if (i >= 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(g.cx, g.cy, g.R, a.a0[i], a.a1[i]);
          ctx.arc(g.cx, g.cy, g.ring1R, a.a1[i], a.a0[i], true);
          ctx.closePath();
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = 0.55;
          ctx.fill();
          ctx.globalAlpha = 0.95;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.4 / k;
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    drawDomainLabels(ctx, g, focus, k);
    drawCenter(ctx, g, focus, k);

    // 6. 环名。读者得知道哪一圈是什么 —— 不该逼他从图例文案反推哪一圈对应哪一句。
    //
    // 两条都竖排在 6 点方向（`rotate(-π/2)` 把局部 +x 转到世界 -y，于是 -midR 落在
    // 圆心**下方**）、各自落在自己那一环的中径上，所以「离圆心多远」就直接说明了它在说
    // 哪一圈。原来环 2 那条是横排一长句（"299,286 topics — every arc,
    // opacity by weight"），横跨整个圆盘压在 11 个楔子上，改成按学科上色之后更读不出来；
    // 长短句交给图例（那里已经写了），环上只留两个词。
    //
    // 压在彩色弧上的文字必须自带深色描边，否则灰字落在浅色楔子上（比如近白的
    // Social Science）等于消失。这是 dataviz 那条「重叠的标记要有 2px 底色环」用在文字上。
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${10.5 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2 / k;
    ctx.strokeStyle = 'rgba(10,10,10,0.78)';
    const ringName = (text, midR, alpha) => {
      ctx.save();
      ctx.translate(g.cx, g.cy);
      ctx.rotate(-Math.PI / 2);
      ctx.strokeText(text, -midR, 0);
      ctx.fillStyle = `rgba(214,222,235,${alpha})`;
      ctx.fillText(text, -midR, 0);
      ctx.restore();
    };
    if (focus) {
      ringName('domains', (g.innerR + g.ring1R) / 2, 0.62);
      ringName('topics', (g.ring1R + g.R) / 2, 0.52);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------- 环上直接标注
  // 11 个 domain 的名字贴在环 1 中径上。扇区窄到装不下名字的（Humanities 只占 1.5%）
  // 推不开就靠引出线。角度方向做排斥，跟 alluvial 的线性避让是同一个办法，只是搬到圆周上。
  function drawDomainLabels(ctx, g, focus, k) {
    const font = `600 ${LABEL_FONT / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.save();
    ctx.font = font;
    ctx.textBaseline = 'middle';

    const mid = (g.innerR + g.ring1R) / 2;
    const items = g.domains.map((d) => {
      const am = (d.a0 + d.a1) / 2;
      const room = d.span * mid;                        // 这个扇区在环 1 中径上的弧长
      return { d, am, room, w: ctx.measureText(d.name).width / k + 8 / k, moved: false, use: am };
    });

    // 只在**扇区装不下**时才推。装得下的留在正中，那才是它该在的地方。
    const movable = items.filter((it) => it.w > it.room);
    for (let pass = 0; pass < 60; pass++) {
      movable.sort((a, b) => a.use - b.use);
      let worst = 0;
      for (let i = 0; i < movable.length; i++) {
        const a = movable[i], b = movable[(i + 1) % movable.length];
        if (a === b) continue;
        // 圆周上的相邻间距（最后一项与第一项跨 2π 相接）
        let gap = b.use - a.use;
        if (i === movable.length - 1) gap += TAU;
        const need = (a.w + b.w) / 2 / mid;
        if (gap >= need) continue;
        const push = (need - gap) / 2;
        a.use -= push; b.use += push;
        worst = Math.max(worst, push);
      }
      if (worst < 0.0005) break;
    }
    for (const it of movable) it.moved = Math.abs(it.use - it.am) > 0.004;

    for (const it of items) {
      const lit = !focus || focus.type === 'center'
        || (focus.type === 'domain' ? focus.id === it.d.id : focus.dom === it.d.id);
      ctx.globalAlpha = lit ? 1 : DIM_ALPHA;

      const cos = Math.cos(it.use), sin = Math.sin(it.use);
      const lx = g.cx + cos * (g.R + LABEL_GAP / k);
      const ly = g.cy + sin * (g.R + LABEL_GAP / k);

      if (it.moved) {
        // 引出线：从标签的真实位置回到扇区的正中，读者才知道这个名字属于谁。
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(g.cx + Math.cos(it.am) * (g.R + 2 / k),
                   g.cy + Math.sin(it.am) * (g.R + 2 / k));
        ctx.strokeStyle = 'rgba(180,190,205,0.5)';
        ctx.lineWidth = 1 / k;
        ctx.stroke();
      }

      // 文字沿径向摆：右半边左对齐，左半边右对齐，都不压到环上。
      const right = cos >= 0;
      ctx.textAlign = right ? 'left' : 'right';
      const tx = g.cx + cos * (g.R + (LABEL_GAP + 4) / k);
      const ty = g.cy + sin * (g.R + (LABEL_GAP + 4) / k);
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = '#000';
      ctx.strokeText(it.d.name, tx, ty);
      ctx.fillStyle = it.d.color || '#e6edf3';
      ctx.fillText(it.d.name, tx, ty);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------- 中心读数
  function drawCenter(ctx, g, focus, k) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const big = `600 ${17 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    const small = `${10.5 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;

    if (focus && focus.type === 'topic') {
      const a = g.arcs.find((x) => x.id === focus.dom);
      const i = a ? a.topic.indexOf(focus.topicId) : -1;
      const name = topicName(focus.topicId);
      const short = name.length > 26 ? name.slice(0, 25) + '…' : name;
      ctx.font = big;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(short, g.cx, g.cy - 16 / k);
      ctx.font = small;
      ctx.fillStyle = 'rgba(160,172,190,0.95)';
      ctx.fillText(a ? a.name : '', g.cx, g.cy + 4 / k);
      if (i >= 0) {
        const share = (a.w[i] / g.totalWeight) * 100;
        const inDom = (a.w[i] / a.arcWeight) * 100;
        ctx.fillStyle = 'rgba(200,210,225,0.95)';
        ctx.fillText(`${a.w[i].toLocaleString()} article×topic · ${share.toFixed(3)}% of science`,
                     g.cx, g.cy + 22 / k);
        ctx.fillStyle = 'rgba(150,162,180,0.85)';
        ctx.fillText(`${inDom.toFixed(2)}% of ${a.name}`, g.cx, g.cy + 38 / k);
      }
      ctx.restore();
      return;
    }

    const m = meta || {};
    ctx.font = big;
    ctx.fillStyle = '#ffffff';
    ctx.fillText((m.totalArticles || 0).toLocaleString(), g.cx, g.cy - 26 / k);
    ctx.font = small;
    ctx.fillStyle = 'rgba(160,172,190,0.95)';
    ctx.fillText('recent articles', g.cx, g.cy - 8 / k);
    ctx.fillStyle = 'rgba(150,162,180,0.85)';
    ctx.fillText(`${(m.clusterCount || 0).toLocaleString()} clusters`, g.cx, g.cy + 12 / k);
    ctx.fillText(`${(m.topicCount || 0).toLocaleString()} distinct topics`, g.cx, g.cy + 27 / k);
    ctx.fillText(`${((m.arcWeightTotal || 0)).toLocaleString()} article×topic`, g.cx, g.cy + 42 / k);
    ctx.restore();
  }

  // --------------------------------------------------------------------- pick
  // 世界坐标（调用方按 state.transform 换算）。
  function pick(wx, wy) {
    if (!geo) return null;
    const g = geo;
    const dx = wx - g.cx, dy = wy - g.cy;
    const r = Math.hypot(dx, dy);
    if (r > g.R * 1.06) return null;

    if (r <= g.innerR) return { type: 'center' };

    let ang = Math.atan2(dy, dx);
    // 归一到与扇区相同的 [-π/2, 3π/2) 区间
    while (ang < -Math.PI / 2) ang += TAU;
    while (ang >= -Math.PI / 2 + TAU) ang -= TAU;

    const d = g.domains.find((x) => ang >= x.a0 && ang < x.a1)
      || (ang < g.domains[0].a0 ? g.domains[g.domains.length - 1] : g.domains[0]);
    if (!d) return null;

    if (r < g.ring1R) {
      return { type: 'domain', id: d.id, name: d.name, dom: d.id };
    }

    // 环 2：a0 单调递增（存储次序 = 权重降序 = 角度次序），二分即可。
    const a = g.arcs.find((x) => x.id === d.id);
    if (!a || !a.a0.length) return { type: 'domain', id: d.id, name: d.name, dom: d.id };
    let lo = 0, hi = a.a0.length - 1, found = -1;
    while (lo <= hi) {
      const midI = (lo + hi) >> 1;
      if (ang < a.a0[midI]) hi = midI - 1;
      else if (ang >= a.a1[midI]) lo = midI + 1;
      else { found = midI; break; }
    }
    if (found < 0) {
      // 角度落在浮点缝隙里（每条弧的终点与下一条的起点严格相等，理论上不会）。
      found = Math.max(0, Math.min(a.a0.length - 1, lo));
    }
    return { type: 'topic', dom: d.id, name: d.name, topicId: a.topic[found], w: a.w[found] };
  }

  function setHover(x) { hover = x; }
  function getHover() { return hover; }
  function getPinned() { return pinned; }
  function togglePinned(p) { pinned = sameTarget(p, pinned) ? null : p; return pinned; }
  function sameTarget(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'center') return true;
    if (a.type === 'domain') return a.id === b.id;
    return a.dom === b.dom && a.topicId === b.topicId;
  }

  // ---------------------------------------------------------------------- HUD
  function describe(f) {
    if (!f || !meta) return '';
    const tot = meta.arcWeightTotal || 1;
    if (f.type === 'center') {
      return `Science  ·  all ${(meta.arcWeightTotal || 0).toLocaleString()} article×topic pairs\n`
        + `${(meta.clusterCount || 0).toLocaleString()} clusters · `
        + `${(meta.totalArticles || 0).toLocaleString()} articles\n`
        + `${(meta.topicCount || 0).toLocaleString()} distinct topics across `
        + `${(meta.categoryCount || 11)} disciplines`;
    }
    if (f.type === 'domain') {
      const d = geo && geo.domains.find((x) => x.id === f.id);
      if (!d) return '';
      return `${d.name}  ·  discipline\n`
        + `${d.arcWeight.toLocaleString()} article×topic · ${(d.arcWeight / tot * 100).toFixed(2)}% of science\n`
        + `${d.arcs.toLocaleString()} topic arcs · ${d.distinctKeywords.toLocaleString()} distinct topics\n`
        + `${d.clusters.toLocaleString()} clusters · ${d.articles.toLocaleString()} articles`;
    }
    const d = geo && geo.domains.find((x) => x.id === f.dom);
    const nm = topicName(f.topicId);
    return `${nm}  ·  topic in ${f.name}\n`
      + `${f.w.toLocaleString()} article×topic · ${(f.w / tot * 100).toFixed(3)}% of science\n`
      + (d ? `${(f.w / d.arcWeight * 100).toFixed(2)}% of ${d.name}` : '');
  }

  function renderLegend(el) {
    if (!data || !geo) {
      // geo 还没建（首帧之前）：用数据自己排一次序，不要退回空图例。
      if (!data || !data.domains) { el.innerHTML = ''; return; }
    }
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const m = meta || {};
    const order = orderOf(data);
    const tot = m.arcWeightTotal || 1;
    const max = order.length ? order[0].arcWeight : 1;

    let html = '<div style="font-weight:600;margin-bottom:3px;color:var(--muted);">'
      + 'Disciplines (click to pin)</div>'
      + '<div style="color:var(--muted);font-size:10.5px;margin-bottom:5px;line-height:1.45;">'
      + `Colour is the <b>discipline</b>, opacity is the <b>topic's weight</b> — two channels, `
      + 'two different quantities. Identity does not rest on colour: every wedge is directly '
      + 'labelled on the ring and separated by a radial rule. Angles count '
      + '<b>article×topic pairs</b>, not articles.</div>';

    for (const d of order) {
      const pct = d.arcWeight / tot * 100;
      const bar = Math.max(1, Math.round(d.arcWeight / max * 100));
      html += `<div class="item row" data-dom="${d.id}">`
        + '<span style="flex:1;min-width:0;">'
        + `<span style="display:block;">${esc(d.name)}</span>`
        + '<span style="display:block;height:3px;margin-top:3px;border-radius:2px;'
        + `background:${d.color || MONO_TINT};width:${bar}%;opacity:0.85;"></span>`
        + '<span style="color:var(--muted);font-size:10px;">'
        + `${d.arcCount.toLocaleString()} topics · ${d.clusters.toLocaleString()} clusters</span>`
        + '</span>'
        + `<span class="cnt">${pct.toFixed(1)}%</span></div>`;
    }

    html += '<div style="color:var(--muted);font-size:10.5px;margin-top:6px;line-height:1.45;'
      + 'max-width:310px;">'
      + `${order.length} disciplines → ${(m.arcCount || 0).toLocaleString()} topic arcs, `
      + 'nothing filtered or truncated. '
      + `The outer ring carries ~179 arcs per pixel, so the lightest ones read as a soft haze — `
      + 'that is what “draw every arc” looks like. Steeper opacity = heavier topic.'
      + '<br>No Field/Subfield tier: this dataset has no such hierarchy, only free-text keywords.'
      + '</div>';

    el.innerHTML = html;
    el.querySelectorAll('[data-dom]').forEach((row) => {
      row.onclick = () => {
        const id = Number(row.dataset.dom);
        const d = order.find((x) => x.id === id);
        togglePinned({ type: 'domain', id, name: d ? d.name : '', dom: id });
        renderLegend(el);
        onChange();          // 见 main.js 的 §4：图例点击必须触发重画
      };
    });
  }

  return {
    setData, getData, getModel: () => (geo ? { ...geo, paths: undefined } : null),
    draw, pick, describe, renderLegend,
    setHover, getHover, togglePinned, getPinned, sameTarget,
    topicName,
    getCounts: () => (meta ? { arcCount: meta.arcCount, arcWeightTotal: meta.arcWeightTotal,
                               topicCount: meta.topicCount, clusterCount: meta.clusterCount,
                               totalArticles: meta.totalArticles } : null),
    get layout() { return geo; },
    get links() { return geo ? geo.arcs : []; },
    get nodes() { return geo ? geo.domains : []; },
  };
}
