// interdisc-network.js — 跨学科网络：11 个 cluster_category 之间共享多少主题。
//
// 读 web/interdisc-data.json（scripts/build-science-views-data.mjs 生成）。
//
// **只有 shared-topic 这一条通道。** map_of_science 的 data.tsv 里没有 citation、
// 没有 similarity、没有任何 A→B 的引用字段（逐列看过）。所以「哪些学科真正连在一起」
// 只能靠「两个学科的关键词表重叠多少」来回答。这是数据的边界，不是画法的选择。
//
// ------------------------------------------------------------------ 两个通道
//
//   宽度 = 共享关键词数（51–2,861）
//   颜色 = Jaccard %：shared / (|A| + |B| − shared)，实测 0.21%–3.81%
//
// 为什么要颜色：宽度**被体量主导** —— 医学和社会科学最大，几乎所有边都连向它们，
// 于是最粗的边只说明「这两个学科都很大」，不说明它们真的亲近。Jaccard 把体量除掉，
// 才是「相对于各自的规模，它们重叠得算多吗」。两个通道各管一个量，不冗余。
// 颜色用固定值域 0–4%，不按当前数据重新拉伸 —— 换个过滤条件不许同一对边换颜色。
//
// ------------------------------------------------------------------ lift 为什么不用
//
// 用户最初要的是「颜色 = lift」，实测推翻了它，所以这里画的是 Jaccard。
// 55 对边的 lift 全部小于 1（0.051–0.574，中位数 0.142，**没有一对大于 1**）。
// 用正确的零模型（把 cluster 的学科标签随机重排，保持各学科 cluster 数不变）算，
// 期望值反而更高：生物↔医学期望 7,498 共享，实测 2,861。
//
// 朴素独立模型会算错，因为它把 274,422 个关键词的「份额」都当成可花的，而其中
// 237,325 个（86.5%）只出现在 1 个 cluster 里 —— 这些**结构上不可能被共享**。
// 换成置换零模型后结论不变：**关键词词汇表高度学科自封闭**，连 f=1,048 的高频词
// 都基本留在一两个学科内。这是一个真实的结构事实，所以它写成图例里的一句话，
// 而不是当成一个颜色通道 —— 一条 55 个值全落在同一侧的量做不了视觉通道。
//
// ------------------------------------------------------------------ 几何
//
// 11 个节点摆在圆上（次序 = 文章数降序），边是**直的定宽色带**。不做弯曲：
// 弯曲后每一点的宽度只能靠折线逼近，而「带在两端正好等于 shared×scale」是本图唯一
// 的可测不变量（check-interdisc.mjs 直接从发出的 Path2D 顶点去量）。直带让宽度精确，
// 也让命中判定是精确的点到线段距离。

const TAU = Math.PI * 2;

const PAD_T = 132;
const PAD_B = 44;
// R_NODE_MAX 不是随便调大就好看 —— 它被圆上的几何卡死。11 个节点均分圆周，相邻间隔
// 32.727°；一对**隔一个**的节点之间的直线弦，中点落在半径 RN·cos(32.727°) = 0.8413·RN 处，
// 离中间那个节点中心只有 RN·0.1587。那条弦要从那个圆盘旁边过，就必须
//   R_NODE_MAX ≤ RN · 0.1587
// 否则弦钻进圆盘底下 —— 圆盘画在色带之上，读者会看到一条连接「穿过」了第三个学科。
// 实测 4 条边的中点在 R_NODE_MAX=70 时落在别的圆盘里（计算机–材料的中点整个埋在生物学里）。
// 所以半径上限由 RN 反推，而不是先定半径再把环挤出去。
const R_NODE_MAX = 42;
const RING_PAD = 26;
const LABEL_PAD = 12;
const LABEL_FONT = 12;

const W_MAX = 30;           // 最粗的边（世界像素）
const HIT_MIN = 3;          // 发丝边也要点得到
const EDGE_ALPHA = 0.55;
const EDGE_HL = 0.92;
const EDGE_DIM = 0.07;
const DIM_ALPHA = 0.28;
const DEFAULT_GLOBAL_EDGES = 16;
const DEFAULT_PER_NODE_EDGES = 2;
const BRIDGE_TOPIC_COUNT = 150;
const TOPIC_LABEL_COUNT = 58;
const TOPIC_R_MIN = 2.2;
const TOPIC_R_MAX = 7.5;

const JACCARD_MAX = 0.04;   // 颜色的固定值域上界（实测最大 3.81%）

// 顺序色阶，深 → 浅（与 science-categories.mjs 的 SEQUENTIAL_BLUE 同一组值，反向）。
// 深色底上「浅」才显眼，所以低 Jaccard 用最深那档。同值内联的理由与 sunburst 一致：
// web/ 下没有打包器，跨文件 import 会把加载顺序变成隐式依赖。
const EDGE_RAMP = [
  '#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5',
  '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4', '#b7d3f6', '#cde2fb',
];
const NODE_TINT = '#3987e5';
const BG = '#1a1a19';

function hexToRgb(hex) {
  const raw = String(hex || '#e5e7eb').replace('#', '');
  const n = Number.parseInt(raw.length === 3
    ? raw.split('').map((c) => c + c).join('')
    : raw, 16);
  if (!Number.isFinite(n)) return '229,231,235';
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export function createInterdiscView(opts) {
  const onChange = (opts && opts.onChange) || (() => {});

  let data = null;
  let meta = null;
  let hover = null;
  let pinned = null;
  let geo = null;
  let hidden = new Set();

  function setData(d) {
    data = d || null;
    meta = (d && d.meta) || null;
    hover = null;
    pinned = null;
    geo = null;
    hidden = new Set();
  }
  function getData() { return data; }

  function rampColor(jaccard) {
    const t = Math.max(0, Math.min(1, jaccard / JACCARD_MAX));
    return EDGE_RAMP[Math.round(t * (EDGE_RAMP.length - 1))];
  }

  // ------------------------------------------------------------------ layout
  function layout(w, h) {
    const sig = `${w}x${h}`;
    if (geo && geo.sig === sig) return geo;
    if (!data || !data.nodes || !data.edges) { geo = null; return null; }

    const availH = h - PAD_T - PAD_B;
    const cx = w / 2;
    const cy = PAD_T + availH / 2;
    const RN = Math.max(60, Math.min(availH / 2 - R_NODE_MAX - RING_PAD,
                                    w / 2 - R_NODE_MAX - 200));

    // 节点面积 ∝ 文章数 ⇒ 半径 ∝ √文章数。用面积而不是半径编码大小，否则读者
    // 会系统性地高估大节点（这是面积编码里最常见的错）。
    const maxArticles = Math.max(...data.nodes.map((n) => n.articles), 1);
    const order = data.nodes.slice().sort((a, b) => (b.articles - a.articles) || (a.id - b.id));

    const nodes = order.map((n, i) => {
      const ang = -Math.PI / 2 + (i / order.length) * TAU;
      return {
        id: n.id, name: n.name, articles: n.articles, clusters: n.clusters,
        distinctKeywords: n.distinctKeywords, keywordOccurrences: n.keywordOccurrences,
        color: n.color || NODE_TINT,
        rgb: hexToRgb(n.color || NODE_TINT),
        ang, r: R_NODE_MAX * Math.sqrt(n.articles / maxArticles),
        x: cx + Math.cos(ang) * RN, y: cy + Math.sin(ang) * RN,
      };
    });
    const at = new Map(nodes.map((n) => [n.id, n]));

    const maxShared = Math.max(...data.edges.map((e) => e.shared), 1);
    const edges = [];
    for (const e of data.edges) {
      const A = at.get(e.a), B = at.get(e.b);
      if (!A || !B) continue;
      const dx = B.x - A.x, dy = B.y - A.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const nx = -uy, ny = ux;
      const t = Math.max(0, Math.min(1, e.jaccard / JACCARD_MAX));
      edges.push({
        ...e, A, B,
        width: W_MAX * (e.shared / maxShared),
        color: EDGE_RAMP[Math.round(t * (EDGE_RAMP.length - 1))],
        rampIndex: Math.round(t * (EDGE_RAMP.length - 1)),
        // 从节点**边界**起画，色带才不会钻到圆盘底下
        sx: A.x + ux * A.r, sy: A.y + uy * A.r,
        ex: B.x - ux * B.r, ey: B.y - uy * B.r,
        ux, uy, nx, ny,
      });
    }
    // 细的在下、粗的在上：最粗的几条最后画，不会被发丝盖住。
    edges.sort((p, q) => (p.width - q.width) || (p.a - q.a) || (p.b - q.b));
    markDefaultEdges(edges);

    const topics = buildBridgeTopics(data.bridgeTopics || [], at, cx, cy, RN, maxArticles);
    geo = { sig, w, h, cx, cy, RN, nodes, edges, topics, at, maxShared, maxArticles };
    return geo;
  }

  function buildBridgeTopics(rawTopics, at, cx, cy, RN) {
    const list = rawTopics.slice(0, BRIDGE_TOPIC_COUNT);
    const maxScore = Math.max(1, ...list.map((t) => t.score || 0));
    const maxWeight = Math.max(1, ...list.map((t) => t.totalWeight || 0));
    return list.map((t, i) => {
      let vx = 0, vy = 0, total = 0;
      for (const d of t.domains || []) {
        const n = at.get(d.id);
        if (!n) continue;
        const w = Math.sqrt(Math.max(1, d.weight || 1));
        vx += Math.cos(n.ang) * w;
        vy += Math.sin(n.ang) * w;
        total += w;
      }
      if (total > 0) { vx /= total; vy /= total; }
      const len = Math.hypot(vx, vy) || 1;
      const openness = Math.max(0, Math.min(1, (t.domainCount - 2) / 6));
      const hash = hash01(t.topic || String(i));
      const angle = Math.atan2(vy, vx) + (hash - 0.5) * 0.42;
      const radius = RN * (0.18 + 0.50 * (1 - openness) + 0.10 * hash);
      const scoreNorm = Math.sqrt((t.score || 0) / maxScore);
      const weightNorm = Math.sqrt((t.totalWeight || 0) / maxWeight);
      const primary = at.get(t.domains?.[0]?.id);
      return {
        ...t,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        r: TOPIC_R_MIN + (TOPIC_R_MAX - TOPIC_R_MIN) * Math.max(scoreNorm, weightNorm * 0.75),
        scoreNorm,
        weightNorm,
        color: primary?.color || NODE_TINT,
        rgb: primary?.rgb || hexToRgb(NODE_TINT),
      };
    });
  }

  function hash01(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  function edgeScore(e) {
    return e.jaccard * 0.72 + (e.shared / Math.max(1, geo?.maxShared || 2861)) * 0.28;
  }

  function edgeKey(e) {
    return `${Math.min(e.a, e.b)}|${Math.max(e.a, e.b)}`;
  }

  function markDefaultEdges(edges) {
    const keep = new Set();
    const ranked = [...edges].sort((a, b) => {
      const sa = a.jaccard * 100000 + a.shared;
      const sb = b.jaccard * 100000 + b.shared;
      return sb - sa;
    });
    for (const e of ranked.slice(0, DEFAULT_GLOBAL_EDGES)) keep.add(edgeKey(e));
    const ids = new Set(edges.flatMap((e) => [e.a, e.b]));
    for (const id of ids) {
      const local = ranked
        .filter((e) => e.a === id || e.b === id)
        .slice(0, DEFAULT_PER_NODE_EDGES);
      for (const e of local) keep.add(edgeKey(e));
    }
    for (const e of edges) e.visibleDefault = keep.has(edgeKey(e));
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
      ctx.fillText('interdisc-data.json not loaded — run scripts/build-science-views-data.mjs',
                   w / 2, h / 2);
      ctx.restore();
      return;
    }
    const g = layout(w, h);
    if (!g) return;
    const focus = hover || pinned;
    const focusNode = focus && focus.type === 'node' ? focus.id : null;
    const touches = (e) => {
      if (!focus) return e.visibleDefault;
      if (focus.type === 'node') return e.a === focus.id || e.b === focus.id;
      return e.a === focus.a && e.b === focus.b;
    };

    drawBridgeLinks(ctx, g, focus, k);

    // 1. 学科间骨架边。只作为背景，不再当主视觉。
    for (const e of g.edges) {
      const visible = touches(e);
      if (!visible && !focus) continue;
      const p = new Path2D();
      const hw = e.width / 2;
      p.moveTo(e.sx + e.nx * hw, e.sy + e.ny * hw);
      p.lineTo(e.ex + e.nx * hw, e.ey + e.ny * hw);
      p.lineTo(e.ex - e.nx * hw, e.ey - e.ny * hw);
      p.lineTo(e.sx - e.nx * hw, e.sy - e.ny * hw);
      p.closePath();
      e.path = p;

      ctx.globalAlpha = !focus ? (e.visibleDefault ? 0.13 : 0.0) : (visible ? 0.34 : 0.035);
      const grad = ctx.createLinearGradient(e.sx, e.sy, e.ex, e.ey);
      grad.addColorStop(0, `rgba(${e.A.rgb},0.92)`);
      grad.addColorStop(1, `rgba(${e.B.rgb},0.92)`);
      ctx.fillStyle = grad;
      ctx.fill(p);
    }
    ctx.globalAlpha = 1;

    drawBridgeTopics(ctx, g, focus, k);

    // 2. 学科盘。面积 ∝ 文章数，所以最大的盘一眼就是医学。
    for (const n of g.nodes) {
      const lit = !focusNode || focusNode === n.id
        || (focus && focus.type === 'edge' && (focus.a === n.id || focus.b === n.id));
      ctx.globalAlpha = lit ? 0.92 : DIM_ALPHA;
      ctx.fillStyle = `rgba(${n.rgb},0.92)`;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = lit ? 0.5 : DIM_ALPHA * 0.6;
      ctx.strokeStyle = lit ? '#f5f7ff' : `rgba(${n.rgb},0.55)`;
      ctx.lineWidth = 1.4 / k;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 3. 盘内写文章数：节点大小是面积编码，读者估不准绝对值，给个数。
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${10.5 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    for (const n of g.nodes) {
      if (n.r < 21) continue;
      const label = (n.articles / 1e6).toFixed(2) + 'M';
      ctx.fillStyle = 'rgba(10,16,26,0.85)';
      ctx.fillText(label, n.x, n.y);
    }
    ctx.restore();

    drawNodeLabels(ctx, g, focus, focusNode, k);
    drawScaleBar(ctx, g, k);
  }

  function topicTouchedByFocus(topic, focus) {
    if (!focus) return true;
    if (focus.type === 'topic') return topic.id === focus.id;
    if (focus.type === 'node') return (topic.domains || []).some((d) => d.id === focus.id);
    if (focus.type === 'edge') return (topic.domains || []).some((d) => d.id === focus.a || d.id === focus.b);
    return true;
  }

  function drawBridgeLinks(ctx, g, focus, k) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    for (const topic of g.topics) {
      const lit = topicTouchedByFocus(topic, focus);
      if (!lit && focus) continue;
      const alphaBase = !focus ? 0.075 + topic.scoreNorm * 0.11 : 0.20 + topic.scoreNorm * 0.24;
      const domains = (topic.domains || []).slice(0, focus?.type === 'topic' ? 8 : 5);
      for (const d of domains) {
        const n = g.at.get(d.id);
        if (!n) continue;
        const grad = ctx.createLinearGradient(topic.x, topic.y, n.x, n.y);
        grad.addColorStop(0, `rgba(${topic.rgb},${alphaBase})`);
        grad.addColorStop(1, `rgba(${n.rgb},${alphaBase * 0.82})`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = (0.35 + Math.sqrt(Math.max(1, d.weight || 1)) * 0.018) / k;
        ctx.beginPath();
        ctx.moveTo(topic.x, topic.y);
        const mx = (topic.x + n.x) / 2;
        const my = (topic.y + n.y) / 2;
        ctx.quadraticCurveTo(mx, my, n.x, n.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawBridgeTopics(ctx, g, focus, k) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const t of g.topics) {
      const lit = topicTouchedByFocus(t, focus);
      ctx.globalAlpha = lit ? 0.72 : 0.12;
      ctx.fillStyle = `rgba(${t.rgb},${0.40 + t.scoreNorm * 0.36})`;
      ctx.beginPath();
      ctx.arc(t.x, t.y, t.r / k, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const labels = g.topics
      .filter((t) => topicTouchedByFocus(t, focus))
      .sort((a, b) => b.score - a.score)
      .slice(0, focus ? 95 : TOPIC_LABEL_COUNT);
    const placed = [];
    for (const t of labels) {
      const label = cleanTopic(t.topic);
      if (!label) continue;
      const font = (focus?.type === 'topic' && focus.id === t.id ? 12.5 : 9.2 + t.scoreNorm * 2.2) / k;
      ctx.font = `600 ${font}px "Segoe UI","Microsoft YaHei",sans-serif`;
      const w = ctx.measureText(label).width;
      const box = { x: t.x - w / 2, y: t.y + (t.r + 7) / k - 6 / k, w, h: 12 / k };
      if (!focus && placed.some((b) => boxesOverlap(box, b))) continue;
      placed.push(box);
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = BG;
      ctx.strokeText(label, t.x, t.y + (t.r + 9) / k);
      ctx.fillStyle = `rgba(${t.rgb},${focus ? 0.98 : 0.78})`;
      ctx.fillText(label, t.x, t.y + (t.r + 9) / k);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function cleanTopic(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 34);
  }

  function boxesOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  // 节点名标在盘外侧，沿径向朝外。相邻标签做角度排斥（与 sunburst 同一套办法）。
  function drawNodeLabels(ctx, g, focus, focusNode, k) {
    ctx.save();
    ctx.font = `600 ${LABEL_FONT / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textBaseline = 'middle';

    const items = g.nodes.map((n) => ({
      n, use: n.ang, w: ctx.measureText(n.name).width / k,
    }));
    for (let pass = 0; pass < 60; pass++) {
      items.sort((a, b) => a.use - b.use);
      let worst = 0;
      for (let i = 0; i < items.length - 1; i++) {
        const a = items[i], b = items[i + 1];
        const mid = a.n.r + b.n.r + 2 * LABEL_PAD;
        const need = (a.w + b.w + 16 / k) / Math.max(40, g.RN + mid / 2);
        const gap = b.use - a.use;
        if (gap >= need) continue;
        const push = (need - gap) / 2;
        a.use -= push; b.use += push;
        worst = Math.max(worst, push);
      }
      if (worst < 0.0005) break;
    }

    for (const it of items) {
      const n = it.n;
      const lit = !focusNode || focusNode === n.id
        || (focus && focus.type === 'edge' && (focus.a === n.id || focus.b === n.id));
      ctx.globalAlpha = lit ? 1 : DIM_ALPHA;
      const cos = Math.cos(it.use), sin = Math.sin(it.use);
      const rr = g.RN + n.r + LABEL_PAD / k;
      const tx = g.cx + cos * rr, ty = g.cy + sin * rr;
      if (Math.abs(it.use - n.ang) > 0.004) {
        ctx.beginPath();
        ctx.moveTo(g.cx + Math.cos(n.ang) * (g.RN + n.r + 2 / k),
                   g.cy + Math.sin(n.ang) * (g.RN + n.r + 2 / k));
        ctx.lineTo(tx, ty);
        ctx.strokeStyle = 'rgba(180,190,205,0.45)';
        ctx.lineWidth = 1 / k;
        ctx.stroke();
      }
      ctx.textAlign = cos >= 0 ? 'left' : 'right';
      const ax = g.cx + cos * (rr + 4 / k), ay = g.cy + sin * (rr + 4 / k);
      ctx.lineWidth = 3 / k;
      ctx.strokeStyle = BG;
      ctx.strokeText(n.name, ax, ay);
      ctx.fillStyle = n.color || '#e6edf3';
      ctx.fillText(n.name, ax, ay);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // 宽度刻度：不给一把尺子，读者没法把「这条比那条粗」换算成共享了多少个主题。
  function drawScaleBar(ctx, g, k) {
    const x = 46 / k;
    let y = 176 / k;
    ctx.save();
    ctx.font = `${10.5 / k}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(150,162,180,0.85)';
    ctx.fillText('edge width = shared topics', x, y - 18 / k);
    for (const s of [500, 1500, 2861]) {
      const wid = W_MAX * (s / g.maxShared);
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = 'rgba(180,190,205,0.7)';
      ctx.fillRect(x, y + 0, wid, Math.max(1.4, wid * 0.5));
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(150,162,180,0.8)';
      ctx.fillText(`${s.toLocaleString()}`, x + W_MAX + 10 / k, y);
      y += 15 / k;
    }
    ctx.restore();
  }

  // --------------------------------------------------------------------- pick
  function pick(wx, wy) {
    if (!geo) return null;
    const g = geo;
    let bestTopic = null;
    let bestTopicD = Infinity;
    for (const t of g.topics) {
      const d = Math.hypot(wx - t.x, wy - t.y);
      if (d <= Math.max(7, t.r + 4) && d < bestTopicD) {
        bestTopicD = d;
        bestTopic = {
          type: 'topic',
          id: t.id,
          name: t.topic,
          topic: t.topic,
          domains: t.domains,
          totalWeight: t.totalWeight,
          domainCount: t.domainCount,
          entropy: t.entropy,
          score: t.score,
        };
      }
    }
    if (bestTopic) return bestTopic;
    // 节点优先：盘压在边上，点在盘里就该报盘。
    for (const n of g.nodes) {
      if (Math.hypot(wx - n.x, wy - n.y) <= n.r) return { type: 'node', id: n.id, name: n.name };
    }
    let best = null, bestD = Infinity;
    for (const e of g.edges) {
      if (!e.visibleDefault && !hover && !pinned) continue;
      const dx = e.ex - e.sx, dy = e.ey - e.sy;
      const len2 = dx * dx + dy * dy;
      let u = len2 ? ((wx - e.sx) * dx + (wy - e.sy) * dy) / len2 : 0;
      if (u < 0 || u > 1) continue;
      const px = e.sx + u * dx, py = e.sy + u * dy;
      const dist = Math.hypot(wx - px, wy - py);
      const tol = Math.max(e.width / 2, HIT_MIN);
      if (dist <= tol && dist < bestD) {
        bestD = dist;
        best = { type: 'edge', a: e.a, b: e.b, name: `${e.A.name} ↔ ${e.B.name}`,
                 shared: e.shared, union: e.union, jaccard: e.jaccard,
                 expected: e.expected, lift: e.lift };
      }
    }
    return best;
  }

  function setHover(x) { hover = x; }
  function getHover() { return hover; }
  function getPinned() { return pinned; }
  function togglePinned(p) { pinned = sameTarget(p, pinned) ? null : p; return pinned; }
  function sameTarget(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    if (a.type === 'topic') return a.id === b.id;
    if (a.type === 'node') return a.id === b.id;
    return a.a === b.a && a.b === b.b;
  }

  // ---------------------------------------------------------------------- HUD
  function describe(f) {
    if (!f || !meta) return '';
    if (f.type === 'topic') {
      const domains = (f.domains || [])
        .slice(0, 7)
        .map((d) => {
          const n = geo && geo.at.get(d.id);
          return `${n ? n.name : d.id} ${Math.round(d.weight).toLocaleString()}`;
        })
        .join(', ');
      return `${f.topic}  ·  bridge topic\n`
        + `${Number(f.totalWeight || 0).toLocaleString()} article×topic weight · appears in ${f.domainCount} disciplines\n`
        + `disciplinary spread ${Number(f.entropy || 0).toFixed(2)}\n`
        + `links: ${domains}`;
    }
    if (f.type === 'node') {
      const n = geo && geo.at.get(f.id);
      if (!n) return '';
      const links = geo.edges.filter((e) => e.a === f.id || e.b === f.id)
        .sort((p, q) => q.shared - p.shared);
      const top = links.slice(0, 5)
        .map((e) => `${e.a === f.id ? e.B.name : e.A.name} ${e.shared.toLocaleString()}`)
        .join(', ');
      return `${n.name}  ·  discipline\n`
        + `${n.articles.toLocaleString()} articles · ${n.clusters.toLocaleString()} clusters\n`
        + `${n.distinctKeywords.toLocaleString()} distinct topics\n`
        + `shares most with: ${top}`;
    }
    return `${f.name}\n`
      + `${f.shared.toLocaleString()} shared topics · Jaccard ${(f.jaccard * 100).toFixed(2)}%\n`
      + `union ${f.union.toLocaleString()} · lift ${f.lift.toFixed(3)} `
      + `(chance would give ${Math.round(f.expected).toLocaleString()})`;
  }

  function renderLegend(el) {
    if (!data || !data.nodes) { el.innerHTML = ''; return; }
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const m = meta || {};
    const nodes = data.nodes.slice().sort((a, b) => (b.articles - a.articles) || (a.id - b.id));
    const edges = data.edges.slice().sort((p, q) => q.jaccard - p.jaccard);
    const maxA = nodes.length ? nodes[0].articles : 1;

    let html = '<div style="font-weight:600;margin-bottom:3px;color:var(--muted);">'
      + 'Bridge topics between disciplines</div>'
      + '<div style="color:var(--muted);font-size:10.5px;margin-bottom:5px;line-height:1.45;">'
      + `${BRIDGE_TOPIC_COUNT} high-scoring topics sit inside the circle. `
      + 'A topic is nearer to the disciplines where it carries more article weight. '
      + 'Click a discipline or topic to isolate its neighborhood.</div>';

    for (const n of nodes) {
      html += `<div class="item row" data-node="${n.id}">`
        + '<span style="flex:1;min-width:0;">'
        + `<span style="display:block;">${esc(n.name)}</span>`
        + '<span style="display:block;height:3px;margin-top:3px;border-radius:2px;'
        + `background:${n.color || NODE_TINT};width:${Math.max(1, Math.round(n.articles / maxA * 100))}%;`
        + 'opacity:0.85;"></span>'
        + '<span style="color:var(--muted);font-size:10px;">'
        + `${n.distinctKeywords.toLocaleString()} topics · ${n.clusters.toLocaleString()} clusters`
        + '</span></span>'
        + `<span class="cnt">${(n.articles / 1e6).toFixed(2)}M</span></div>`;
    }

    html += '<div style="font-weight:600;margin:8px 0 3px;color:var(--muted);">'
      + 'Strong bridge topics</div>';
    for (const t of (data.bridgeTopics || []).slice(0, 14)) {
      const first = nodes.find((n) => n.id === t.domains?.[0]?.id);
      html += `<div class="item row" data-topic="${t.id}">`
        + '<span style="flex:1;min-width:0;">'
        + `<span style="display:block;color:${first?.color || 'var(--fg)'};">${esc(t.topic)}</span>`
        + '<span style="color:var(--muted);font-size:10px;">'
        + `${t.domainCount} disciplines · spread ${Number(t.entropy || 0).toFixed(2)}`
        + '</span></span>'
        + `<span class="cnt">${Math.round(t.totalWeight).toLocaleString()}</span></div>`;
    }

    html += '<div style="font-weight:600;margin:8px 0 4px;color:var(--muted);">'
      + 'Strongest discipline pairs</div>'
      + '<table style="border-collapse:collapse;font-size:10.5px;">';
    for (const e of edges.slice(0, 6)) {
      const A = nodes.find((x) => x.id === e.a), B = nodes.find((x) => x.id === e.b);
      html += '<tr><td style="padding:1px 3px;white-space:nowrap;">'
        + `<span style="display:inline-block;width:7px;height:7px;border-radius:1px;`
        + `background:${rampColor(e.jaccard)};margin-right:4px;"></span>`
        + `${esc(A ? A.name : e.a)} <span style="color:var(--muted)">↔</span> `
        + `${esc(B ? B.name : e.b)}</td>`
        + `<td style="padding:1px 3px;text-align:right;">${(e.jaccard * 100).toFixed(2)}%</td>`
        + `<td style="padding:1px 3px;text-align:right;color:var(--muted);">`
        + `${e.shared.toLocaleString()}</td></tr>`;
    }
    html += '</table>';

    // 这一句是实测结论，不是免责声明 —— 它才是这张图最想告诉读者的事。
    const lifts = data.edges.map((e) => e.lift);
    const lo = Math.min(...lifts).toFixed(2), hi = Math.max(...lifts).toFixed(2);
    html += '<div style="color:var(--muted);font-size:10.5px;margin-top:6px;line-height:1.5;'
      + 'max-width:315px;">'
      + `<b>Every one of the 55 pairs sits below chance</b> (lift ${lo}–${hi}; none above 1). `
      + 'Shuffling discipline labels across clusters would predict <i>more</i> shared topics than '
      + 'we observe — biology ↔ medicine expects 7,498 but shares 2,861. '
      + `That is because ${(m.globalDistinctKeywords || 0).toLocaleString()} topics are extremely `
      + 'local: 237,325 of them (86.5%) appear in a single cluster and can never be shared at all. '
      + 'So colour here is <b>Jaccard</b>, which compares disciplines with each other rather than '
      + 'with chance — and the honest reading is that this vocabulary is strongly self-segregating, '
      + 'not that disciplines are unconnected.'
      + '</div>';

    el.innerHTML = html;
    el.querySelectorAll('[data-node]').forEach((row) => {
      row.onclick = () => {
        const id = Number(row.dataset.node);
        const n = nodes.find((x) => x.id === id);
        togglePinned({ type: 'node', id, name: n ? n.name : '' });
        renderLegend(el);
        onChange();
      };
    });
    el.querySelectorAll('[data-topic]').forEach((row) => {
      row.onclick = () => {
        const id = Number(row.dataset.topic);
        const t = (data.bridgeTopics || []).find((x) => x.id === id);
        if (!t) return;
        togglePinned({ type: 'topic', id, name: t.topic, topic: t.topic, domains: t.domains,
          totalWeight: t.totalWeight, domainCount: t.domainCount, entropy: t.entropy, score: t.score });
        renderLegend(el);
        onChange();
      };
    });
  }

  return {
    setData, getData, getModel: () => geo,
    draw, pick, describe, renderLegend,
    setHover, getHover, togglePinned, getPinned, sameTarget,
    rampColor,
    getCounts: () => (meta ? { edgeCount: (data.bridgeTopics || []).length, nodeCount: (data.nodes || []).length,
                               clusterCount: meta.clusterCount,
                               totalArticles: meta.totalArticles } : null),
    get layout() { return geo; },
    get links() { return geo ? geo.edges : []; },
    get nodes() { return geo ? geo.nodes : []; },
  };
}
