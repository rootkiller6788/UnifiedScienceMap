// phil-chord.js — PhilPapers 哲学分类：二级分支之间的「交叉挂靠」弦图。
//
// 这是 Philpapers-API 径向树之外的第二视角。径向树画的是生成树（每个类目挂在唯一父
// 节点下），所以它展示分类体系「怎么组织」，但完全看不出各分支之间的互相渗透。弦图
// 反过来：丢掉树内部结构，只保留跨越分支的 DAG 边。
//
// **一条弦 = 一个类目。** 一个类目若有多个父节点，就在它的主父所在分支与每个额外父
// 节点所在分支之间画一条丝带。所以悬停能说出「这条弦是哪个类目」。
//
// 弧 = 二级分支（49 个中的 42 个参与了交叉挂靠），按 7 个顶层领域上色分带。
// 之所以用二级而不是顶层：1,035 条跨分支的弦里有 441 条（43%）两端落在同一个顶层
// 领域**内部**，领域级的弦图一条也画不出来 —— 边根本没离开那个领域，在那个分辨率
// 下它就不是一条边。最大的一条是 Applied Ethics ↔ Social and Political（39 条），
// 两端都在 Value Theory 下，而它是全图第三大的一对。
//
// 弧长 ∝ 该分支的交叉挂靠权重（degree），不是类目数量。这是必须的：弧长若按别的东西
// 分配，环和丝带就处在两个标度上（圆形版的「双轴错误」），丝带两端宽度会对不上。按
// 权重分配后，全图共用同一个「每单位权重多少弧度」的标度，每条丝带两端严格等宽。
//
// 颜色沿用与径向图相同的、已通过校验的分类色序，所以同一个领域在两个视角里同色。

const TAU = Math.PI * 2;
const GAP_SIB = 0.004;     // 同领域内两个分支之间的缝（弧度）
const GAP_DOM = 0.052;     // 两个领域之间的缝（弧度），让色带读得出来
const BAND = 46;           // 环的厚度（px）
const MIN_BAND = 16;
const LABEL_LINE = 17;     // 标签垂直间距（px）
const LABEL_MIN = 12;      // 弧长超过这个（px）才配得上标签
const LABEL_MAX = 34;
const HIT_PAD = 8;         // 环外可点范围（px）
const RIBBON_ALPHA = 0.30;
const DIM_ALPHA = 0.045;

// onChange：模块自己改了状态之后喊一声，让 host 重画。渲染是按需的（requestRender →
// 单次 rAF），没有这条线的话，图例里点「隐藏某个分支」之后环会一直停在改动之前的那一帧，
// 直到下一次 mousemove 顺手重画。默认空函数，单独测这个模块时不需要造一个 host。
export function createChordView(opts) {
  const onChange = (opts && opts.onChange) || (() => {});
  let data = null;
  let hidden = new Set();     // 被隐藏的分支（原始索引）
  let query = '';
  let hover = null;           // {type:'arc'|'pair'|'loop', ...}
  let pinned = null;
  let geo = null;
  let lastCtx = null;
  let lastDPR = 1;
  function setData(d) { data = d; geo = null; }
  function getData() { return data; }
  function setQuery(q) { query = (q || '').trim().toLowerCase(); }
  function getQuery() { return query; }
  function branches() { return data ? data.branches : []; }
  function domains() { return data ? data.domains : []; }
  function palette() { return (data && data.palette) || ['#3987e5']; }
  function color(i) {
    const b = data && data.branches[i];
    const p = palette();
    return p[(b ? b.domain : i) % p.length];
  }
  function domainColor(d) { const p = palette(); return p[d % p.length]; }

  function isHidden(i) { return hidden.has(i); }
  function toggle(i) { if (hidden.has(i)) hidden.delete(i); else hidden.add(i); }
  function clearHidden() { hidden = new Set(); }
  function domainBranches(d) {
    const out = [];
    branches().forEach((b, i) => { if (b.domain === d) out.push(i); });
    return out;
  }
  // 三态：整个领域全显 / 部分隐藏 / 全隐
  function domainState(d) {
    const list = domainBranches(d);
    let off = 0;
    for (const i of list) if (hidden.has(i)) off++;
    return off === 0 ? 'on' : (off === list.length ? 'off' : 'some');
  }
  function toggleDomain(d) {
    const list = domainBranches(d);
    const on = domainState(d) === 'on';
    for (const i of list) { if (on) hidden.add(i); else hidden.delete(i); }
  }

  // 一个分支被搜索命中，或者它是某条被命中的弦的端点。
  function matched() {
    if (!data || !query) return null;
    const hit = new Set();
    branches().forEach((b, i) => {
      if (b.name.toLowerCase().includes(query)) hit.add(i);
    });
    for (const c of (data.chords || [])) {
      if (c.name.toLowerCase().includes(query)) { hit.add(c.s); hit.add(c.t); }
    }
    return hit.size ? hit : new Set();
  }

  // ------------------------------------------------------------------ layout
  function layout(w, h) {
    const sig = w + 'x' + h + '|' + [...hidden].sort((a, b) => a - b).join(',');
    if (geo && geo.sig === sig) return geo;
    if (!data || !data.branches.length) return null;

    const all = data.branches;

    // 权重必须先按「还活着的弦」重算，不能直接读 JSON 里的 degree：隐藏一个分支会
    // 连带抽掉它与别的分支之间的弦，JSON 的 degree 却还记着它们。用旧值定标度，
    // 弧就填不满，环上会留下一段谁也解释不了的空白。
    const live = new Map();       // 分支原始索引 -> 幸存的弦端点数
    for (const c of (data.chords || [])) {
      if (hidden.has(c.s) || hidden.has(c.t)) continue;
      live.set(c.s, (live.get(c.s) || 0) + 1);
      live.set(c.t, (live.get(c.t) || 0) + 1);
    }

    const arcOf = new Map();      // 分支原始索引 -> 弧位置
    const arcs = [];
    all.forEach((b, i) => {
      if (hidden.has(i)) return;
      // 自环是分支内部的，不受隐藏别的分支影响。
      const deg = (live.get(i) || 0) + b.loops;
      if (!deg) return;
      arcOf.set(i, arcs.length);
      arcs.push({ bi: i, domain: b.domain, deg, loops: b.loops, start: 0, end: 0, span: 0 });
    });
    const n = arcs.length;
    if (!n) { geo = null; return null; }

    // 环永远在画布里居中，跟左下角的面板开不开、图例里显示什么都不相干。
    // 之前让它躲开面板，代价是面板一开一合整张图就往右跳，跳多少还取决于图例当时的
    // 内容 —— 一个会自己动的图比一个被挡掉一条边的图更糟。代价是窄窗口下最左边那段
    // 弧会有一部分压在面板下面，这是明知而接受的取舍。
    const cx = w / 2;
    const cy = h / 2 - Math.min(24, h * 0.03);
    const pad = Math.max(104, Math.min(w, h) * 0.16);
    const R1 = Math.max(70, Math.min(cx - pad / 2, h / 2 - pad * 0.62));
    // R1 - BAND 一定小于 R1 - 4，把它俩一起丢进 max 里，环就永远是 4px 厚 ——
    // 画出来是一条细线，不是一条带。只留 BAND 和下限。
    const R0 = Math.max(R1 - BAND, MIN_BAND);

    // 缝必须先减掉再定标度，否则环会超出 2π。
    let gaps = 0;
    for (let k = 0; k < n; k++) {
      gaps += arcs[k].domain === arcs[(k + 1) % n].domain ? GAP_SIB : GAP_DOM;
    }
    const total = arcs.reduce((a, x) => a + x.deg, 0) || 1;

    // 全图唯一的「每单位权重多少弧度」：这正是丝带两端等宽的原因。
    const scale = Math.max(1e-9, (TAU - gaps) / total);

    // 每个分支把与各伙伴之间的弦收成一个连续块，块内按全局顺序排。这样同伙伴的弦
    // 在弧上彼此相邻，成束的走向才看得出来；也保证同一条弦在两端落在同一个块序号上。
    const chords = data.chords || [];
    const slots = new Array(chords.length);
    const blkAt = new Map();       // `${bi}|${partnerBi}` -> {a0,a1,list}
    let angle = -Math.PI / 2;      // 从 12 点开始

    for (let k = 0; k < n; k++) {
      const a = arcs[k];
      const bi = a.bi;
      const counts = new Map();
      for (let ci = 0; ci < chords.length; ci++) {
        const c = chords[ci];
        const p = c.s === bi ? c.t : (c.t === bi ? c.s : -1);
        if (p < 0 || hidden.has(p)) continue;
        let list = counts.get(p);
        if (!list) { list = []; counts.set(p, list); }
        list.push(ci);
      }
      // 伙伴按「伙伴自己的领域」再按索引排序：弧上的去向于是也按色带成段，
      // 一眼能看出「这个分支主要向外语领域输出了多少」。
      const parts = [...counts.keys()]
        .sort((x, y) => (all[x].domain - all[y].domain) || (x - y));

      let cursor = angle;
      for (const p of parts) {
        const list = counts.get(p);
        const width = list.length * scale;
        for (let j = 0; j < list.length; j++) {
          const ci = list[j];
          const s0 = cursor + j * scale;
          const sl = slots[ci] || (slots[ci] = {});
          if (chords[ci].s === bi) { sl.A0 = s0; sl.A1 = s0 + scale; }
          else { sl.B0 = s0; sl.B1 = s0 + scale; }
        }
        blkAt.set(bi + '|' + p, { a0: cursor, a1: cursor + width, list });
        cursor += width;
      }
      if (a.loops > 0) {
        a.loopA0 = cursor;
        a.loopA1 = cursor + a.loops * scale;
        cursor += a.loops * scale;
      }
      a.start = angle;
      a.end = cursor;
      a.span = cursor - angle;

      const nxt = arcs[(k + 1) % n];
      angle = cursor + (nxt.domain === a.domain ? GAP_SIB : GAP_DOM);
    }

    // 弦的 Path2D：画它和命中测试用的是同一个对象。同一条弦两端各占 scale 宽，
    // 所以严格等宽 —— 这是整张图唯一真正的正确性不变量。
    for (let ci = 0; ci < chords.length; ci++) {
      const sl = slots[ci];
      if (!sl || sl.A0 === undefined || sl.B0 === undefined) continue;
      sl.path = ribbonPath(cx, cy, R0, sl.A0, sl.A1, sl.B0, sl.B1);
    }

    // 悬停目标按「对」合并：同一对分支的两个方向落在同一片区域上，留一个就够。
    // 稠密处的丝带只有亚像素宽，逐条命中在物理上不可能，所以悬停的单位是束，
    // 束里只有一条弦时再退回成「这一条弦」。
    const pairs = [];
    for (const [key, v] of blkAt) {
      const cut = key.indexOf('|');
      const bi = +key.slice(0, cut), p = +key.slice(cut + 1);
      if (bi >= p) continue;
      const other = blkAt.get(p + '|' + bi);
      if (!other) continue;
      pairs.push({
        bi, pi: p, list: v.list,
        a0: v.a0, a1: v.a1, b0: other.a0, b1: other.a1,
        path: ribbonPath(cx, cy, R0, v.a0, v.a1, other.a0, other.a1),
      });
    }

    geo = { sig, cx, cy, R0, R1, arcs, pairs, slots, scale, w, h, grads: new Map() };
    return geo;
  }

  function ribbonPath(cx, cy, R0, A0, A1, B0, B1) {
    const p = new Path2D();
    const a0x = cx + R0 * Math.cos(A0), a0y = cy + R0 * Math.sin(A0);
    const b0x = cx + R0 * Math.cos(B0), b0y = cy + R0 * Math.sin(B0);
    p.moveTo(a0x, a0y);
    p.arc(cx, cy, R0, A0, A1);
    // 控制点取圆心是经典弦带：中间收窄，读起来是「连接」而不是「色块」。
    p.quadraticCurveTo(cx, cy, b0x, b0y);
    p.arc(cx, cy, R0, B0, B1);
    p.quadraticCurveTo(cx, cy, a0x, a0y);
    p.closePath();
    return p;
  }

  // 渐变按「方向」缓存，不按弦缓存：一束里所有弦的走向夹角几乎相同，共用一条渐变
  // 看不出来，却把 1,035 条渐变降到 468 条 —— 而且是每个布局只建一次。透明度不进
  // 渐变色，改由 globalAlpha 调暗，这样悬停时不必重建任何几何。
  function gradient(ctx, r, s, t) {
    const key = s + '|' + t;
    let g = geo.grads.get(key);
    if (g) return g;
    const blk = geo.pairs.find((p) => p.bi === Math.min(s, t) && p.pi === Math.max(s, t));
    let a0, a1, b0, b1;
    if (!blk) return palette()[0];
    if (blk.bi === s) { a0 = blk.a0; a1 = blk.a1; b0 = blk.b0; b1 = blk.b1; }
    else { a0 = blk.b0; a1 = blk.b1; b0 = blk.a0; b1 = blk.a1; }
    const { cx, cy, R0 } = geo;
    const mA = (a0 + a1) / 2, mB = (b0 + b1) / 2;
    g = ctx.createLinearGradient(cx + R0 * Math.cos(mA), cy + R0 * Math.sin(mA),
                                 cx + R0 * Math.cos(mB), cy + R0 * Math.sin(mB));
    g.addColorStop(0, color(s));
    g.addColorStop(1, color(t));
    geo.grads.set(key, g);
    return g;
  }

  // ------------------------------------------------------------------- draw
  function draw(ctx, w, h, dpr) {
    lastCtx = ctx;
    lastDPR = dpr || 1;
    if (!data || !data.branches.length) {
      ctx.fillStyle = 'rgba(139,148,158,0.9)';
      ctx.font = '13px -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Chord data not loaded — run the Philpapers pipeline with --web-dir', w / 2, h / 2);
      ctx.textAlign = 'start';
      return;
    }
    const g = layout(w, h);
    if (!g) return;
    const { cx, cy, R0, R1, arcs } = g;
    const hit = matched();
    const focus = hover || pinned;
    const hl = focus ? endpointsOf(focus) : null;

    // 1. 丝带。按端点排序：不透明的一束最后画，才不会被别的压住。
    ctx.save();
    ctx.lineJoin = 'round';
    const order = [];
    for (let ci = 0; ci < data.chords.length; ci++) if (g.slots[ci]?.path) order.push(ci);
    order.sort((p, q) => rank(g.slots[p], data.chords[p]) - rank(g.slots[q], data.chords[q]));
    function rank(sl, c) {
      if (!hl) return 0;
      return (hl.has(c.s) && hl.has(c.t)) ? 1 : 0;
    }
    for (const ci of order) {
      const c = data.chords[ci];
      const sl = g.slots[ci];
      let alpha = RIBBON_ALPHA;
      if (hl) alpha = (hl.has(c.s) && hl.has(c.t)) ? 0.60 : DIM_ALPHA;
      if (hit) alpha = (hit.has(c.s) && hit.has(c.t)) ? 0.60 : DIM_ALPHA;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = gradient(ctx, g, c.s, c.t);
      // 只填充不描边：单条弦在环上只有亚像素宽，描边会把它变成一层灰网，
      // 而灰网会把成束的走向彻底糊掉。
      ctx.fill(sl.path);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // 2. 环。颜色从来不是唯一渠道：下面的直接标签会写出分支名，HUD 里有确切数字。
    for (const a of arcs) {
      const off = hit ? (hit.has(a.bi) ? 1 : 0.18) : 1;
      const col = color(a.bi);
      ctx.beginPath();
      ctx.arc(cx, cy, (R0 + R1) / 2, a.start, a.end);
      ctx.lineWidth = R1 - R0;
      ctx.strokeStyle = rgba(col, 0.30 * off);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, R1 - 1.5, a.start, a.end);
      ctx.lineWidth = 3;
      ctx.strokeStyle = rgba(col, (hl && hl.has(a.bi) ? 1 : 0.85) * off);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, R0 + 1.5, a.start, a.end);
      ctx.lineWidth = 3;
      ctx.strokeStyle = rgba(col, 0.75 * off);
      ctx.stroke();
    }

    // 3. 同分支内部的挂靠（自环）收敛成该分支内侧的一个鼓包：581 条单独画成向内的
    //    羽毛只会是噪声，而且弦图画不出自环。宽度仍是 条数 × scale，与丝带同标度。
    for (const a of arcs) {
      if (!a.loops) continue;
      const p = loopPath(cx, cy, R0, a.loopA0, a.loopA1);
      const on = hl ? hl.has(a.bi) : true;
      ctx.fillStyle = rgba(color(a.bi), on ? 0.5 : 0.10);
      ctx.fill(p);
      ctx.strokeStyle = rgba(color(a.bi), on ? 0.9 : 0.2);
      ctx.lineWidth = 1;
      ctx.stroke(p);
      a.loopPath = p;
    }

    // 4. 细到看不见的弧补一根刻度线，免得读者以为环在那里断了。
    for (const a of arcs) {
      if (a.span * R1 >= 3) continue;
      const mid = (a.start + a.end) / 2;
      ctx.beginPath();
      ctx.moveTo(cx + (R0 - 6) * Math.cos(mid), cy + (R0 - 6) * Math.sin(mid));
      ctx.lineTo(cx + (R1 + 6) * Math.cos(mid), cy + (R1 + 6) * Math.sin(mid));
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(color(a.bi), 0.9);
      ctx.stroke();
    }

    if (focus && focus.type === 'arc') {
      const a = arcs.find((x) => x.bi === focus.bi);
      if (a) {
        ctx.beginPath();
        ctx.arc(cx, cy, (R0 + R1) / 2, a.start, a.end);
        ctx.lineWidth = R1 - R0;
        ctx.strokeStyle = rgba(color(a.bi), 0.5);
        ctx.stroke();
      }
    }
    drawLabels(ctx, w, h, focus);
  }

  function endpointsOf(f) {
    if (f.type === 'arc') return new Set([f.bi]);
    if (f.type === 'loop') return new Set([f.bi]);
    return new Set([f.bi, f.pi]);
  }

  function loopPath(cx, cy, R0, a0, a1) {
    const mid = (a0 + a1) / 2;
    const depth = Math.min(R0 * 0.30, 24 + (a1 - a0) * R0 * 0.5);
    const p = new Path2D();
    p.moveTo(cx + R0 * Math.cos(a0), cy + R0 * Math.sin(a0));
    p.quadraticCurveTo(cx + (R0 - depth) * Math.cos(mid),
                       cy + (R0 - depth) * Math.sin(mid),
                       cx + R0 * Math.cos(a1), cy + R0 * Math.sin(a1));
    p.arc(cx, cy, R0, a1, a0, true);
    p.closePath();
    return p;
  }

  function drawLabels(ctx, w, h, focus) {
    const { cx, cy, R0, R1, arcs } = geo;
    const hit = matched();
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    let items = [];
    for (const a of arcs) {
      const len = a.span * R1;
      const forced = focus && focus.type === 'arc' && focus.bi === a.bi;
      if (len < LABEL_MIN && !forced) continue;
      const mid = (a.start + a.end) / 2;
      const dx = Math.cos(mid), dy = Math.sin(mid);
      items.push({
        bi: a.bi, mid, dx, dy, len, text: data.branches[a.bi].name, count: a.deg,
        ax: cx + (R1 + 7) * dx, ay: cy + (R1 + 7) * dy,
        left: dx < 0, w: 0, y: 0, x0: 0, moved: false, tiny: len < 3,
      });
    }
    // 标签配额给最大的那些分支：42 个分支里有 4 个权重只有 1，全都标出来会变成
    // 一堵引线墙，反而把大分支的名字淹没。
    items.sort((a, b) => b.len - a.len);
    items = items.slice(0, LABEL_MAX);

    for (const it of items) {
      ctx.font = '600 12.5px -apple-system, "Segoe UI", sans-serif';
      it.nameW = ctx.measureText(it.text).width;
      ctx.font = '500 11px -apple-system, "Segoe UI", sans-serif';
      it.cntW = ctx.measureText(String(it.count)).width;
      it.w = it.nameW + it.cntW + 18;
      it.y = it.ay;
      const lx = it.ax + (it.left ? -7 : 7);
      it.x0 = it.left ? lx - it.w : lx;
    }
    // 标签盒是 右侧 [点][12px][名字][6px][计数]，左侧镜像 —— 计数因此永远压不到
    // 名字上（若只是「放在名字后面」，左侧标签是右对齐的，正好会叠上去）。
    for (const it of items) {
      if (it.x0 < 6) { it.x0 = 6; it.moved = true; }
      if (it.x0 + it.w > w - 6) { it.x0 = w - 6 - it.w; it.moved = true; }
    }
    // 标签避让：只有水平方向也重叠的两个标签才可能垂直撞上，把它们拉开即可。
    //
    // 这里必须比较**所有对**，不能只比较按 y 排序后的相邻两项：只要中间夹着一个
    // 水平不重叠的标签，真正重叠的那一对就永远不相邻，于是永远不会被分开。
    // 环底部那两个右对齐的长名字（Philosophy of the Americas / European
    // Philosophy）正是这样叠在一起的——它们各自跟邻居都不冲突，冲突的只有彼此。
    // 每轮重新排序，因为推挤本身会改变 y 的次序。
    for (let pass = 0; pass < 40; pass++) {
      items.sort((a, b) => a.y - b.y);
      let worst = 0;
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j];
          if (!(a.x0 < b.x0 + b.w && b.x0 < a.x0 + a.w)) continue;
          const gap = b.y - a.y;
          if (gap >= LABEL_LINE) continue;
          const push = (LABEL_LINE - gap) / 2;
          a.y -= push; b.y += push;
          worst = Math.max(worst, push);
        }
      }
      if (worst < 0.01) break;
    }

    for (const it of items) {
      const col = color(it.bi);
      const off = hit ? (hit.has(it.bi) ? 1 : 0.25) : 1;
      const dim = focus && focus.type === 'arc' && focus.bi !== it.bi ? 0.35 : 1;
      ctx.globalAlpha = off * dim || 0.25;

      if (it.moved || it.tiny || Math.abs(it.y - it.ay) > 1.5) {
        const toX = it.left ? it.x0 + it.w : it.x0;
        ctx.beginPath();
        ctx.moveTo(cx + R1 * Math.cos(it.mid), cy + R1 * Math.sin(it.mid));
        ctx.lineTo(it.ax, it.ay);
        ctx.lineTo(toX + (it.left ? 4 : -4), it.y);
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = rgba(col, 0.75);
        ctx.stroke();
      }

      // 圆点始终在标签盒靠近环的那一侧。
      const dotX = it.left ? it.x0 + it.w - 4 : it.x0 + 4;
      ctx.beginPath();
      ctx.arc(dotX, it.y, 3.4, 0, TAU);
      ctx.fillStyle = col;
      ctx.fill();

      const tx = it.left ? dotX - 12 : dotX + 12;
      ctx.textAlign = it.left ? 'right' : 'left';
      ctx.font = '600 12.5px -apple-system, "Segoe UI", sans-serif';
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#000';
      ctx.strokeText(it.text, tx, it.y);
      ctx.fillStyle = '#e6edf3';
      ctx.fillText(it.text, tx, it.y);

      // 计数朝外放，绝不压在名字上。
      const cntX = it.left ? tx - it.nameW - 6 : tx + it.nameW + 6;
      ctx.font = '500 11px -apple-system, "Segoe UI", sans-serif';
      ctx.strokeStyle = '#000';
      ctx.strokeText(String(it.count), cntX, it.y);
      ctx.fillStyle = 'rgba(139,148,158,0.95)';
      ctx.fillText(String(it.count), cntX, it.y);
    }
    ctx.textAlign = 'start';
    ctx.globalAlpha = 1;
  }

  // -------------------------------------------------------------------- pick
  function pick(mx, my) {
    if (!geo) return null;
    const { cx, cy, R0, R1, arcs } = geo;
    const dx = mx - cx, dy = my - cy;
    const r = Math.hypot(dx, dy);

    if (r >= R0 - 4 && r <= R1 + HIT_PAD) {
      let ang = Math.atan2(dy, dx);
      if (ang < -Math.PI / 2) ang += TAU;
      for (const a of arcs) {
        if (ang >= a.start - GAP_SIB && ang <= a.end + GAP_SIB) {
          // 自环的鼓包压在环内侧，优先还给它，否则它在环上永远点不到。
          if (a.loops && r < R0 && ang >= a.loopA0 && ang <= a.loopA1) {
            return { type: 'loop', bi: a.bi, count: a.loops, examples: loopExamples(a.bi) };
          }
          return { type: 'arc', bi: a.bi };
        }
      }
      return null;
    }
    if (r >= R0 || !lastCtx) return null;

    lastCtx.save();
    lastCtx.setTransform(lastDPR, 0, 0, lastDPR, 0, 0);
    // 稠密处单条弦只有亚像素宽，逐条命中物理上不可能，所以按束命中；束里只有一条
    // 弦时它自然就退化回「这一条弦」。
    for (const p of geo.pairs) {
      if (p.path && lastCtx.isPointInPath(p.path, mx, my)) {
        lastCtx.restore();
        return { type: 'pair', bi: p.bi, pi: p.pi, list: p.list };
      }
    }
    // 自环鼓包在环内，也要能在环外圈之外点到。
    for (const a of arcs) {
      if (a.loopPath && lastCtx.isPointInPath(a.loopPath, mx, my)) {
        lastCtx.restore();
        return { type: 'loop', bi: a.bi, count: a.loops, examples: loopExamples(a.bi) };
      }
    }
    lastCtx.restore();
    return null;
  }

  function loopExamples(bi) {
    const l = (data.loops || []).find((x) => x.b === bi);
    return l ? l.examples : [];
  }

  function setHover(h) { hover = h; }
  function getHover() { return hover; }
  function getPinned() { return pinned; }

  // 点已钉住的那个就取消钉住，点别的就改钉它。
  function togglePinned(p) {
    pinned = sameTarget(p, pinned) ? null : p;
    return pinned;
  }
  function sameTarget(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'arc' || a.type === 'loop') return a.bi === b.bi;
    return (a.bi === b.bi && a.pi === b.pi) || (a.bi === b.pi && a.pi === b.bi);
  }

  // ------------------------------------------------------------------- HUD
  function describe(f) {
    if (!f || !data) return '';
    const B = data.branches;
    if (f.type === 'arc') {
      const b = B[f.bi];
      const partners = [];
      for (const p of geo ? geo.pairs : []) {
        if (p.bi === f.bi) partners.push([B[p.pi].name, p.list.length]);
        else if (p.pi === f.bi) partners.push([B[p.bi].name, p.list.length]);
      }
      partners.sort((x, y) => y[1] - x[1]);
      return `${b.name}  ·  ${data.domains[b.domain].name}\n`
        + `${b.nodes.toLocaleString()} categories · ${b.degree.toLocaleString()} cross-listings`
        + (b.loops ? ` (${b.loops} internal)` : '') + '\n'
        + (partners.length
            ? 'linked to: ' + partners.slice(0, 8).map((p) => `${p[0]} (${p[1]})`).join(', ')
              + (partners.length > 8 ? `, +${partners.length - 8} more` : '')
            : 'no cross-listings to other branches');
    }
    if (f.type === 'loop') {
      const b = B[f.bi];
      const ex = (f.examples || []).map((e) => e[0]).join(', ');
      return `${b.name} — internal cross-listings\n`
        + `${f.count} categor${f.count === 1 ? 'y' : 'ies'} filed under two parents `
        + `inside this branch\n` + (ex ? `e.g. ${ex}` : '');
    }
    const A = B[f.bi], C = B[f.pi];
    const list = f.list || [];
    if (list.length === 1) {
      const c = data.chords[list[0]];
      const from = B[c.s].name, to = B[c.t].name;
      return `${c.name}\nprimary: ${from}  →  also filed under: ${to}\ndepth ${c.depth} · the one chord in this bundle`;
    }
    const names = list.slice(0, 8).map((ci) => data.chords[ci].name);
    return `${A.name}  ↔  ${C.name}\n${list.length} cross-listed categories\n`
      + `e.g. ${names.join(', ')}` + (list.length > 8 ? `, +${list.length - 8} more` : '');
  }

  function renderLegend(el) {
    if (!data) { el.innerHTML = ''; return; }
    const hit = matched();
    const meta = data.meta;
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

    let html = '<div style="font-weight:600;margin-bottom:4px;color:var(--muted);">'
      + 'Philosophy domains (click to toggle)</div>'
      + '<div style="color:var(--muted);font-size:10.5px;margin-bottom:3px;">'
      + 'Right-hand number is cross-listing weight (that is the arc length, '
      + 'not the category count). · N is how many branches it holds.</div>';

    const doms = data.domains;
    doms.forEach((d, di) => {
      const list = domainBranches(di);
      const on = domainState(di);
      const deg = list.reduce((a, i) => a + data.branches[i].degree, 0);
      const dim = hit && !list.some((i) => hit.has(i)) ? 0.35 : 1;
      html += `<div class="item row${on === 'off' ? ' off' : ''}" data-dom="${di}" `
        + `style="cursor:pointer;opacity:${dim};" title="${esc(d.name)}">`
        + `<span><span class="sw" style="background:${domainColor(di)};`
        + `opacity:${on === 'off' ? 1 : (on === 'some' ? 0.55 : 0.9)}"></span>${esc(d.name)}`
        + `<span style="color:var(--muted);font-size:10.5px;"> · ${list.length}</span></span>`
        + `<span class="cnt">${deg.toLocaleString()}</span></div>`;
    });

    // 顶部交换对是这张图的结论本身，用表格给确切数字 —— 也是颜色之外的第二条渠道。
    // 这里直接数 data.chords，不能走 geo：图例在第一次 draw 之前就要渲染，那时
    // geo 还是 null，表格会是一片空白。顺带这样也会跟着隐藏状态实时更新。
    const counts = new Map();
    for (const c of data.chords) {
      if (hidden.has(c.s) || hidden.has(c.t)) continue;
      const key = Math.min(c.s, c.t) + '|' + Math.max(c.s, c.t);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const top = [...counts.entries()].map(([key, n]) => {
      const cut = key.indexOf('|');
      const a = +key.slice(0, cut), b = +key.slice(cut + 1);
      return { a, b, n };
    }).sort((x, y) => y.n - x.n).slice(0, 8);

    html += '<div style="font-weight:600;margin:8px 0 4px;color:var(--muted);">'
      + 'Largest exchanges</div><table style="border-collapse:collapse;font-size:10.5px;">';
    if (!top.length) {
      html += '<tr><td style="color:var(--muted);">nothing left unhidden</td></tr>';
    }
    for (const p of top) {
      html += `<tr><td style="padding:1px 3px;white-space:nowrap;">`
        + `<span style="color:${color(p.a)}">${esc(short(data.branches[p.a].name))}</span>`
        + `<span style="color:var(--muted)"> ↔ </span>`
        + `<span style="color:${color(p.b)}">${esc(short(data.branches[p.b].name))}</span></td>`
        + `<td style="padding:1px 3px;text-align:right;color:var(--fg);">${p.n}</td></tr>`;
    }
    html += '</table>';

    // 简短是故意的：#legend 限高 46vh 且隐藏了滚动条，长脚注不是「能滚到」而是
    // 「根本看不见」。
    html += `<div style="color:var(--muted);font-size:10.5px;margin-top:5px;line-height:1.45;max-width:310px;">`
      + `One chord per cross-listed category: ${meta.chords.toLocaleString()} between branches + `
      + `${meta.loops.toLocaleString()} inside a branch = ${meta.parentPairs.toLocaleString()} `
      + `extra parent edges, which accounts for every one of them.<br>`
      + `A single chord is sub-pixel wide at the ring, so what you see is the bundles, `
      + `not the threads. Hover a bundle to list the categories in it.</div>`;

    el.innerHTML = html;
    el.querySelectorAll('[data-dom]').forEach((row) => {
      row.onclick = () => {
        toggleDomain(+row.dataset.dom);
        geo = null;
        renderLegend(el);
        onChange();          // 见 main.js：图例点击必须触发重画
      };
    });
  }

  const SHORT = {
    'History of Western Philosophy': 'History',
    'Metaphysics and Epistemology': 'Metaphysics',
    'Other Academic Areas': 'Other Acad.',
    'Philosophical Traditions': 'Traditions',
    'Philosophy, Misc': 'Misc',
    'Science, Logic, and Mathematics': 'Science',
    'Value Theory': 'Value',
  };
  function abbrev(name) {
    if (SHORT[name]) return SHORT[name];
    return name.length > 12 ? name.slice(0, 11) + '…' : name;
  }
  // 面板压在图上面，行标签一长就把环挡到后面去，所以这里另有一个更狠的截断：
  // 每行必须在 300px 里放得下「A ↔ B」，否则表格一律折行，面板就白窄了。
  function short(name) {
    const clean = name
      .replace('Philosophy of ', '')
      .replace(' Philosophy', '')
      .replace(/, and /g, ' & ')
      .replace(/,$/, '');
    const s = clean.length ? clean : name;
    return s.length > 17 ? s.slice(0, 16) + '…' : s;
  }

  return {
    setData, getData, setQuery, getQuery, draw, pick,
    setHover, getHover, togglePinned, getPinned, describe,
    renderLegend, domains, branches, color, isHidden, toggle, clearHidden, matched,
    toggleDomain, domainState, sameTarget,
    get layout() { return geo; },
    get ribbons() { return geo ? geo.slots : []; },
    get pairs() { return geo ? geo.pairs : []; },
    abbrev,
  };
}

function rgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
