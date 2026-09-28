// interdisc-matrix.js — 学科矩阵：Clustered Adjacency Matrix + Pixel Heatmap + Marginal Histograms.
//
// 为什么把 node-link 换掉（不是美化，是换图形）：
//   Network 模式已经把 node-link 画到 170,974 个节点 / 40,417 条边。11 个节点 + 55 条边的
//   node-link 无论怎么调，都只是它的低分辨率版本 —— 而且 55 这个数量级本身没有信息量：
//   真正有信息的是**每条边内部的 51–2,861 个共享术语**，node-link 把它们压成了一根粗线。
//   换成矩阵之后，可指认对象从 66（11 盘 + 55 边）变成 L0 的 121 格 + L1 的 2,861 × 11 格，
//   每一格都能 hover 出数。
//
// 三级（都在同一个世界坐标里画，导航是本模块内部状态，照 evolution-river.js 的 expanded 惯例）：
//   L0  11×11 对称矩阵：底色深浅 = Jaccard（亲和度），内嵌方块**面积** = 共享术语数（体量）。
//       上沿 OUTWARD 条、左沿 INWARD 条、行列各一棵层次聚类树，矩阵按叶子序重排。
//   L1  点一个格 → 该对的**共享术语（行）× 11 学科（列）**矩阵。头部若干行展开可读，
//       其余每行 1px 铺成像素矩阵，超过一屏就分页（每一行仍然可以被单独指认）。
//   L2  点一行术语 → 该术语在 11 个学科里的权重条 + 它到底桥接了哪些对。
//
// 数据**不新增文件**：全部从 sunburst-data.json 的 arcs 现场推导。arcs 是扁平的
// [domId, topicId, weight, …] 三元组，一条弧 = 「某术语在某学科里的权重」，
// 所以一条弧就是一次学科归属，按 topicId 归并就得到每个术语的学科向量。
// 第二个参数是 interdisc-data.json —— 它里面**没有**逐对的术语表（只有聚合标量 shared），
// 但它预计算了 55 对的 shared，正好当**独立第二来源**做逐格交叉校验。
//
// 配色（dataviz 规则，按通道分工）：
//   格填充 = 单色相顺序色阶（中性钢蓝，浅→深 = Jaccard），内嵌方块 = 同色相的亮芯（面积 = 共享数）。
//   这就是 hive 的「宽而淡的底 + 窄而亮的芯」搬到方格上，也正好是旧 node-link
//   「宽度 = 共享数、颜色 = Jaccard」的分工。
//   11 个学科的身份色**只**用在图例色块和两条边缘条上；格填充刻意避开身份色，
//   因为 11 个身份色里已经包含了各种色相，矩阵内部再用其中任何一个都会和身份撞车。
//   身份从头到尾由「行列位置 + 轴上 11 个名字 + 图例」承载，不靠格的深浅。
//
// 已知的诚实代价：11 个学科色是全对比对（任意两个都可能相邻），从来没跑过 dataviz 校验器
// （那次拒绝针对的是结论本身，不是单条命令）。矩阵的轴标签一直是画出来的，
// 所以身份不依赖颜色区分 —— 这一点写进图例。

const D = 11;                                  // 学科数（cluster_category 0–10）

// ---------------------------------------------------------------- 版式常量（世界坐标 1600×900）
const CELL = 52;                               // L0 一格
const DENDRO = 34;                             // 树带宽
const OUTBAR = 62;                             // 上沿条最大高度
const INBAR = 62;                              // 左沿条最大宽度
const ROWLAB = 168;                            // 行标签区（名字 + 内向百分比）
const COLLAB = 96;                             // 列标签（45° 旋转，名字 + 外向百分比）区
const LABEL_FONT = 11;
const HEAD_ROW = 16;                           // L1 头部每一行
const HEAD_MAX = 12;                           // L1 头部最多展开几行
const CELL1 = 46;                              // L1 一列
const PIX = 1;                                 // L1 像素区一行 = 1px

// 顺序色阶：中性钢蓝，刻意不是 11 个身份色里的任何一个
const SEQ_RGB = '150,182,226';
const SEQ_CORE = 'rgba(226,238,255,0.92)';
const INK = '#e6edf3';
const INK_DIM = '#93a1b5';
const INK_FAINT = '#5b6673';

const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));

export function createInterdiscView(opts = {}) {
  const onChange = opts.onChange || (() => {});

  let sbData = null;                           // sunburst-data.json
  let preData = null;                          // interdisc-data.json（可选，只用于交叉校验）
  let der = null;                              // 推导结果（一次算完，之后只读）
  let hover = null;
  let pinned = null;
  let geo = null;
  let level = 0;                               // 0 | 1 | 2
  let pair = null;                             // L1: [i, j]（已排序）
  let page = 0;                                // L1 像素区分页
  let termIdx = -1;                            // L2: 该术语在 focus 列表里的下标

  // ------------------------------------------------------------------ 推导
  // 一次遍历 299,286 条弧。用 typed array 而不是 Map：Map 存 30 万个条目要 ~30MB 开销，
  // 这里 cnt/off/domOf/wOf 加起来约 4MB。
  function derive(sb) {
    const nD = sb.domains.length;
    const nT = sb.meta.topicCount;
    const arcs = sb.arcs;

    const cnt = new Uint8Array(nT);
    for (let i = 0; i < arcs.length; i += 3) cnt[arcs[i + 1]]++;
    const off = new Int32Array(nT + 1);
    for (let t = 0; t < nT; t++) off[t + 1] = off[t] + cnt[t];
    const total = off[nT];
    const domOf = new Uint8Array(total);
    const wOf = new Float64Array(total);
    const cur = off.slice(0, nT);
    const domArcs = new Int32Array(nD);         // 每学科的弧数（独立于 JSON 自己数一遍）
    for (let i = 0; i < arcs.length; i += 3) {
      const d = arcs[i], t = arcs[i + 1], w = arcs[i + 2];
      if (d < 0 || d >= nD) continue;
      const k = cur[t]++;
      domOf[k] = d; wOf[k] = w;
      domArcs[d]++;
    }
    const names = sb.topics.split('\n');
    // topics 是一整块换行拼接的字符串，arcs 的 topicId 就是它的下标。两边条数必须对上，
    // 否则第 t 行的名字根本不是第 t 行的名字 —— 错位不报错，只是安静地画错，所以记下来给 harness 断言。
    const nameCount = names.length;
    // 身份：名字和颜色都来自 domains。格子里的深浅**永远**不承担身份。
    const domRecs = sb.domains.map((d, i) => ({
      id: i, name: d.name, color: d.color,
      topics: domArcs[i], articles: d.articles, clusters: d.clusters,
    }));
    const dname = (i) => (domRecs[i] ? domRecs[i].name : `#${i}`);
    const dcolor = (i) => (domRecs[i] && domRecs[i].color) || '#93a1b5';

    // shared[i][j]：同时出现在 i 和 j 里的术语数。一个术语的弧数 ≤ 11，所以
    // Σ_t C(k_t,2) 只有 35,313 次计数，跟 299,286 条弧无关 —— 这一步是白送的。
    const shared = new Int32Array(D * D);
    let bridging = 0;
    for (let t = 0; t < nT; t++) {
      const a = off[t], b = off[t + 1];
      const k = b - a;
      if (k < 2) continue;
      bridging++;
      for (let x = a; x < b; x++) {
        for (let y = x + 1; y < b; y++) {
          const p = domOf[x], q = domOf[y];
          const lo = p < q ? p : q, hi = p < q ? q : p;
          shared[lo * D + hi]++;
        }
      }
    }

    const topics = new Int32Array(D);           // 每学科的**不同术语数** = 它的弧数
    for (let d = 0; d < nD; d++) topics[d] = domArcs[d];

    // 计数只落在上三角。这里把它镜像成真正的对称矩阵 —— 不只是好看：
    // 下面按行求和时，如果只填了上三角，第 i 行就只剩 Σ_{j>i}，第 10 行的和会变成 0，
    // 于是 OUTWARD/INWARD 会从第 1 个学科起**逐个少算**（只有第 0 行是对的）。
    // 这个错不会报错、不会崩，只会让边缘条安静地画错，所以对称性是必须显式成立的。
    for (let i = 0; i < D; i++) {
      for (let j = i + 1; j < D; j++) shared[j * D + i] = shared[i * D + j];
    }

    // 两条边缘：同一个分子、两个分母。
    const rowSum = new Float64Array(D);         // Σ_{j≠i} shared(i,j)
    for (let i = 0; i < D; i++) {
      let s = 0;
      for (let j = 0; j < D; j++) if (i !== j) s += shared[i * D + j];
      rowSum[i] = s;
    }
    // 自检：镜像之后全矩阵的和必须是成对的（Σ_i rowSum_i == 2·Σ_{i<j} shared）
    const sumSharedPre = (() => {
      let s = 0;
      for (let i = 0; i < D; i++) for (let j = i + 1; j < D; j++) s += shared[i * D + j];
      return s;
    })();
    let rowTotal = 0;
    for (let i = 0; i < D; i++) rowTotal += rowSum[i];
    const symmetricOk = rowTotal === 2 * sumSharedPre;
    let grand = 0;                              // Σ_i topics_i
    for (let i = 0; i < D; i++) grand += topics[i];
    const outward = new Float64Array(D);        // 我的词被借走多少
    const inward = new Float64Array(D);         // 别人的词我借了多少
    for (let i = 0; i < D; i++) {
      outward[i] = topics[i] ? rowSum[i] / ((D - 1) * topics[i]) : 0;
      const rest = grand - topics[i];
      inward[i] = rest ? rowSum[i] / rest : 0;
    }

    let maxShared = 0, maxJ = 0, sumShared = 0;
    const jacc = new Float64Array(D * D);
    for (let i = 0; i < D; i++) {
      for (let j = i + 1; j < D; j++) {
        const s = shared[i * D + j];
        sumShared += s;
        if (s > maxShared) maxShared = s;
        const jv = s / (topics[i] + topics[j] - s);
        jacc[i * D + j] = jacc[j * D + i] = jv;
        if (jv > maxJ) maxJ = jv;
      }
    }

    // 聚类：距离 = 1 − Jaccard，average linkage（UPGMA，合并高度单调不减，可断言）。
    // 并列时取下标最小的一对 —— 排平是确定性的，harness 能钉住一个固定排列。
    const dist = (i, j) => 1 - jacc[i * D + j];
    const cluster = clusterOrder(nD, dist);

    // 交叉校验：interdisc-data.json 预计算的 55 对 shared 必须逐格相等。
    // 两个独立推导（一条遍历 arcs，一条是构建脚本自己的循环）给出同一个数，比任何断言都强。
    const cross = crossCheck(preData, shared);
    return {
      nD, nT, names, nameCount, domRecs, dname, color: dcolor,
      off, domOf, wOf, shared, topics, outward, inward,
      jacc, maxShared, maxJ, sumShared, bridging, rowSum, grand, cluster, cross,
      symmetricOk,
    };
  }

  function crossCheck(pre, shared) {
    if (!pre || !Array.isArray(pre.edges)) return { checked: 0, mismatches: null };
    let checked = 0;
    const bad = [];
    for (const e of pre.edges) {
      const a = e.a, b = e.b;
      if (!(a >= 0 && a < D && b >= 0 && b < D) || a === b) continue;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      checked++;
      if (shared[lo * D + hi] !== e.shared) {
        bad.push({ a: lo, b: hi, got: shared[lo * D + hi], want: e.shared });
      }
    }
    return { checked, mismatches: bad.length ? bad : null };
  }

  // 层次聚类（average linkage），返回 { order, merges, leaves }
  function clusterOrder(n, dist) {
    let next = 0;
    let active = [];
    for (let i = 0; i < n; i++) active.push({ id: next++, leaves: [i], h: 0, a: null, b: null, idc: i });
    const merges = [];
    while (active.length > 1) {
      let best = null;
      for (let x = 0; x < active.length; x++) {
        for (let y = x + 1; y < active.length; y++) {
          // average linkage：两个簇的全部叶子对距离的平均
          let sum = 0, cnt = 0;
          for (const li of active[x].leaves) {
            for (const lj of active[y].leaves) { sum += dist(li, lj); cnt++; }
          }
          const h = sum / cnt;
          // 严格小于（带容差）⟹ 并列时保留先遇到的那一对，排平是确定的
          if (best === null || h < best.h - 1e-12) best = { x, y, h };
        }
      }
      const A = active[best.x], B = active[best.y];
      const node = {
        id: next++, leaves: A.leaves.concat(B.leaves), h: best.h, a: A, b: B,
        idc: Math.min(A.idc, B.idc),
      };
      merges.push({ left: A, right: B, h: best.h, size: node.leaves.length });
      active = active.filter((_, i) => i !== best.x && i !== best.y);
      active.push(node);
    }
    const root = active[0];
    const order = [];
    (function walk(nd) {
      if (!nd) return;
      if (!nd.a) { order.push(nd.leaves[0]); return; }
      walk(nd.a); walk(nd.b);
    })(root);
    return { order, merges, root };
  }

  // ------------------------------------------------------------------ 数据接口
  function setData(sb, pre) {
    sbData = sb || null;
    preData = pre || null;
    der = null;
    geo = null;
    reset();
    if (sbData && sbData.arcs && sbData.topics) der = derive(sbData);
  }
  const getData = () => sbData;

  function reset() {
    level = 0; pair = null; termIdx = -1; page = 0; hover = null; pinned = null;
  }

  function setHover(h) { hover = h || null; }
  const getHover = () => hover;
  const getPinned = () => pinned;

  function sameTarget(a, b) {
    if (!a || !b || a.type !== b.type) return false;
    switch (a.type) {
      case 'cell': return a.i === b.i && a.j === b.j;
      case 'node': case 'outward': case 'inward': return a.i === b.i;
      case 'head': case 'prow': return a.topic === b.topic;
      case 'termbar': return a.d === b.d;
      case 'page': return a.page === b.page;
      default: return true;                        // 'back' / 'center' 之类的无参目标
    }
  }

  // 点一下 = 下钻；同一件事点了两次就退回来（和图例行的 toggle 语义一致）
  function togglePinned(h) {
    if (!h) return;
    if (h.type === 'back') { back(); return; }
    if (h.type === 'cell') {
      if (level === 1 && pair && pair[0] === h.i && pair[1] === h.j) { level = 0; pair = null; }
      else { pair = [h.i, h.j]; level = 1; page = 0; termIdx = -1; }
      after();
      return;
    }
    if (h.type === 'head' || h.type === 'prow') {
      termIdx = h.topic; level = 2; after();
      return;
    }
    if (h.type === 'page') { page = Math.max(0, h.page); after(); return; }
    if (h.type === 'node' || h.type === 'outward' || h.type === 'inward') {
      pinned = sameTarget(pinned, h) ? null : h;
      after();
      return;
    }
    pinned = sameTarget(pinned, h) ? null : h;
    after();
  }

  function back() {
    // 逐级退回：L2 → L1 → L0。在 L0 上按返回键没有上一级，什么也不做（不能一步跳回 L0）
    if (level === 2) { level = 1; termIdx = -1; }
    else if (level === 1) { level = 0; pair = null; page = 0; }
    else return;
    after();
  }

  function after() { geo = null; onChange(); }

  function getCounts() {
    if (!der) return null;
    return {
      disciplineCount: der.nD,
      pairCount: (der.nD * (der.nD - 1)) / 2,
      cellCount: der.nD * der.nD,
      bridgingTerms: der.bridging,
      sharedTermTotal: der.sumShared,
      clusterCount: sbData?.meta?.clusterCount || 0,
      totalArticles: sbData?.meta?.totalArticles || 0,
    };
  }

  // Jaccard → 格底色的 alpha。刻意做成**只依赖 Jaccard 值**的纯函数：
  // 排序、过滤、聚类重排都不许改变它（颜色跟随实体，不跟随排名）。
  function rampColor(j) {
    if (!(j > 0)) return `rgba(${SEQ_RGB},0.05)`;
    const t = Math.min(1, j / (der ? der.maxJ : 1));
    return `rgba(${SEQ_RGB},${(0.05 + 0.42 * t).toFixed(4)})`;
  }

  // ------------------------------------------------------------------ 布局（世界坐标）
  function layout(w, h) {
    const sig = `${w}x${h}|${level}|${pair ? pair.join('-') : ''}|${page}|${termIdx}`;
    if (geo && geo.sig === sig) return geo;
    const g = { sig, w, h, hits: [] };
    g.cx = w / 2; g.cy = h / 2;

    if (!der) { geo = g; return g; }
    if (level === 0) layoutL0(g);
    else if (level === 1) layoutL1(g);
    else layoutL2(g);

    geo = g;
    return g;
  }

  // ---- L0：11×11 -------------------------------------------------------------
  function layoutL0(g) {
    const n = der.nD;
    const tw = DENDRO + INBAR + ROWLAB + n * CELL;
    const th = DENDRO + OUTBAR + COLLAB + n * CELL;
    const ox = (g.w - tw) / 2, oy = (g.h - th) / 2;
    const mx = ox + DENDRO + INBAR + ROWLAB;
    const my = oy + DENDRO + OUTBAR + COLLAB;

    g.ox = ox; g.oy = oy; g.mx = mx; g.my = my;
    g.cell = CELL; g.order = der.cluster.order;

    // 矩阵格：底色 = Jaccard 色阶，内嵌方块面积 ∝ shared
    g.cells = [];
    for (let r = 0; r < n; r++) {
      const i = der.cluster.order[r];
      for (let c = 0; c < n; c++) {
        const j = der.cluster.order[c];
        const x = mx + c * CELL, y = my + r * CELL;
        if (i === j) {
          g.cells.push({ r, c, i, j, x, y, diag: true, value: der.topics[i] });
          g.hits.push({ x, y, w: CELL, h: CELL, hit: { type: 'cell', i, j, diag: true } });
          continue;
        }
        const lo = Math.min(i, j), hi = Math.max(i, j);
        const s = der.shared[lo * D + hi];
        const side = CELL * 0.66 * Math.sqrt(der.maxShared ? s / der.maxShared : 0);
        g.cells.push({
          r, c, i, j, x, y, shared: s, jacc: der.jacc[lo * D + hi],
          side, inx: x + (CELL - side) / 2, iny: y + (CELL - side) / 2,
        });
        g.hits.push({ x, y, w: CELL, h: CELL, hit: { type: 'cell', i, j } });
      }
    }

    // 上沿 OUTWARD 条（列方向）
    g.outBars = [];
    for (let c = 0; c < n; c++) {
      const j = der.cluster.order[c];
      const v = der.outward[j];
      const bh = Math.max(1, OUTBAR * Math.min(1, v));
      const x = mx + c * CELL + 6, wd = CELL - 12;
      const y = my - COLLAB - bh;
      g.outBars.push({ c, j, x, y, w: wd, h: bh, v });
      g.hits.push({ x: mx + c * CELL, y: my - COLLAB - OUTBAR, w: CELL, h: OUTBAR, hit: { type: 'outward', i: j } });
    }
    // 左沿 INWARD 条（行方向）
    g.inBars = [];
    for (let r = 0; r < n; r++) {
      const i = der.cluster.order[r];
      const v = der.inward[i];
      const bw = Math.max(1, INBAR * Math.min(1, v));
      const y = my + r * CELL + 6, ht = CELL - 12;
      const x = mx - ROWLAB - bw;
      g.inBars.push({ r, i, x, y, w: bw, h: ht, v });
      g.hits.push({ x: mx - ROWLAB - INBAR, y: my + r * CELL, w: INBAR, h: CELL, hit: { type: 'inward', i } });
    }

    // 两棵树
    g.colTree = treeGeom(der.cluster.merges, 'col', mx, oy + DENDRO - 4, CELL, DENDRO - 6, der.cluster.order);
    g.rowTree = treeGeom(der.cluster.merges, 'row', ox + DENDRO - 4, my, CELL, DENDRO - 6, der.cluster.order);

    // 轴标签。**每条轴标签自带自己那侧的边际值** —— 一开始把百分比单独画在条旁边，
    // 结果和 45° 的列标签撞了 11 处（探针量出来的）。折进标签里就没有第二个文本框，
    // 数字也跟着自己的学科走，读者不用在条和轴之间对位。
    g.rowLabels = der.cluster.order.map((i, r) => ({
      i, r, x: mx - 8, y: my + r * CELL + CELL / 2,
      text: `${der.dname(i)} ${inwardPct(i)}`,
    }));
    g.colLabels = der.cluster.order.map((j, c) => ({
      j, c, x: mx + c * CELL + CELL / 2, y: my - COLLAB + 6,
      text: `${der.dname(j)} ${outwardPct(j)}`,
    }));
  }

  const outwardPct = (i) => `${(der.outward[i] * 100).toFixed(0)}%`;
  const inwardPct = (i) => `${(der.inward[i] * 100).toFixed(0)}%`;

  // 树：轴上的叶子位置 → 合并点。col = 沿 x 排（叶子在下、树往上长），row = 沿 y 排（叶子在右、树往左长）
  function treeGeom(merges, axis, startX, startY, cell, span, order) {
    const pos = new Map();                       // 叶子 id -> 它在轴上的中心
    order.forEach((leaf, k) => pos.set(leaf, k * cell + cell / 2));
    const nodes = new Map();                     // 已经合并出来的簇 -> {c, h}，键是叶子集合
    let maxH = 0;
    for (const m of merges) maxH = Math.max(maxH, m.h);
    const seg = [];
    const key = (leaves) => leaves.join(',');
    const at = (nd) => (nd.leaves.length === 1
      ? pos.get(nd.leaves[0])
      : nodes.get(key(nd.leaves)).c);
    const heightOf = (nd) => (nd.leaves.length === 1 ? 0 : nodes.get(key(nd.leaves)).h);
    for (const m of merges) {
      const cl = at(m.left), cr = at(m.right);
      const h = maxH ? m.h / maxH : 0;
      nodes.set(key(m.left.leaves.concat(m.right.leaves)), { c: (cl + cr) / 2, h });
      seg.push({ a: cl, b: cr, h, ah: heightOf(m.left), bh: heightOf(m.right),
                 axis, startX, startY, span });
    }
    return { seg, axis };
  }

  // 每个学科「对应的格子」= 它和谁最接近（Jaccard 最大）的那一格，返回可直接喂给
  // togglePinned 的 cell 目标（已按 lo/hi 排好，和 focusTerms 的归一化一致）。
  //
  // 为什么不是它自己那一格：对角线在 focusTerms 里是**取不到**的 —— 那里要求一个术语
  // 同时出现在 lo 和 hi 两个学科里，lo === hi 时 `else if (der.domOf[k] === hi)` 永远
  // 不成立，wj 恒为 0，于是每一行都被 `if (!wi || !wj) continue` 丢掉，L1 是一张空页。
  // 所以「点开一个学科」只能点开它和别人的格子，最自然的就是最强的那一对。
  function bestPartner(i) {
    if (!der || i < 0 || i >= der.nD) return null;
    let best = -1, bestJ = -1;
    for (let k = 0; k < der.nD; k++) {
      if (k === i) continue;
      const v = der.jacc[i * D + k];
      // 平手时取编号小的，保证同一份数据每次都给出同一张表（录帧要可复现）
      if (v > bestJ) { bestJ = v; best = k; }
    }
    if (best < 0) return null;
    return { type: 'cell', i: Math.min(i, best), j: Math.max(i, best) };
  }

  // ---- L1：术语 × 11 学科 -----------------------------------------------------
  function focusTerms() {
    if (!pair) return null;
    const [i, j] = pair;
    if (!der.focus || der.focus.i !== i || der.focus.j !== j) {
      const lo = Math.min(i, j), hi = Math.max(i, j);
      const rows = [];
      for (let t = 0; t < der.nT; t++) {
        const a = der.off[t], b = der.off[t + 1];
        let wi = 0, wj = 0;
        for (let k = a; k < b; k++) {
          if (der.domOf[k] === lo) wi = der.wOf[k];
          else if (der.domOf[k] === hi) wj = der.wOf[k];
        }
        if (!wi || !wj) continue;
        rows.push({ t, wi, wj, sum: wi + wj, min: Math.min(wi, wj) });
      }
      rows.sort((x, y) => (y.sum - x.sum) || (y.min - x.min) || (x.t - y.t));
      let maxSum = 0;
      for (const r of rows) if (r.sum > maxSum) maxSum = r.sum;
      der.focus = { i: lo, j: hi, rows, maxSum };
    }
    return der.focus;
  }

  function layoutL1(g) {
    const f = focusTerms();
    if (!f) { level = 0; layoutL0(g); return; }
    const n = der.nD;
    const gw = n * CELL1;
    const headRows = Math.min(HEAD_MAX, f.rows.length);
    const headH = headRows * HEAD_ROW;
    const gridH = Math.min(460, Math.max(80, g.h - headH - 230));
    const perPage = Math.max(1, Math.floor(gridH / PIX));
    const tailN = Math.max(0, f.rows.length - headRows);
    const pages = Math.max(1, Math.ceil(tailN / perPage));
    if (page >= pages) page = pages - 1;

    const tw = 300 + gw;
    const ox = (g.w - tw) / 2, oy = Math.max(120, (g.h - (headH + gridH)) / 2 - 20);
    const gridX = ox + 300;
    g.l1 = { ox, oy, gridX, gw, headRows, headH, gridH, perPage, pages, tailN, f, cellH: HEAD_ROW, cellW: CELL1 };
    g.mx = gridX; g.my = oy + headH;

    // 头部：每行展开，能读出术语名
    g.head = [];
    for (let r = 0; r < headRows; r++) {
      const row = f.rows[r];
      g.head.push({ r, row, y: oy + r * HEAD_ROW, cells: cellRow(row, gridX, oy + r * HEAD_ROW, HEAD_ROW) });
      g.hits.push({ x: ox, y: oy + r * HEAD_ROW, w: 300 + gw, h: HEAD_ROW, hit: { type: 'head', topic: row.t, i: f.i, j: f.j } });
    }

    // 像素区：每行 1px，超过一屏就分页 —— 每一行仍然可以被单独指认
    const start = headRows + page * perPage;
    const end = Math.min(f.rows.length, start + perPage);
    g.pix = { x: gridX, y: oy + headH, w: gw, h: gridH, start, end, rows: end - start };
    // 逐列合并同桶连续行：行按 sum 降序 ⟹ 同一个 alpha 桶在列里连续
    g.runs = [];
    for (let c = 0; c < n; c++) {
      let k = start;
      while (k < end) {
        const bucket = bucketOf(f.rows[k], f);
        let k2 = k;
        while (k2 + 1 < end && bucketOf(f.rows[k2 + 1], f) === bucket) k2++;
        g.runs.push({
          c, x: gridX + c * CELL1, y: oy + headH + (k - start), w: CELL1, h: (k2 - k + 1),
          bucket, first: k, last: k2,
        });
        k = k2 + 1;
      }
    }
    g.pages = { n: pages, cur: page, perPage, start, end, total: f.rows.length, x: ox, y: oy + headH + gridH + 18 };
    // 分页 chip 的几何在 layout 里定，draw 只照着画 —— 命中框必须和画出来的地方是同一个数
    if (pages > 1) {
      g.pages.chipY = g.pages.y - 10;
      g.pages.prevX = ox + 190;
      g.pages.nextX = ox + 268;
      if (page > 0) g.hits.push({ x: g.pages.prevX - 6, y: g.pages.chipY, w: 70, h: 20, hit: { type: 'page', page: page - 1 } });
      if (page < pages - 1) g.hits.push({ x: g.pages.nextX - 6, y: g.pages.chipY, w: 70, h: 20, hit: { type: 'page', page: page + 1 } });
    }
    g.back = { x: ox, y: oy - 46, h: 24, label: '‹ all pairs' };
    g.back.w = chipW(g.back.label);
    g.hits.push({ x: g.back.x, y: g.back.y, w: g.back.w, h: g.back.h, hit: { type: 'back' } });
  }

  function bucketOf(row, f) {
    return Math.max(0, Math.min(23, Math.floor(24 * Math.log(row.sum + 1) / Math.log(f.maxSum + 1))));
  }

  // 一个术语的 11 维权重向量。术语的弧数 ≤ 11，所以这个数组基本是空的 —— 但长度恒为 nD，
  // 于是列对齐是结构性的，不依赖「这个术语恰好在这几个学科里」。
  function vecOf(t) {
    const v = new Float64Array(der.nD);
    for (let k = der.off[t]; k < der.off[t + 1]; k++) v[der.domOf[k]] = der.wOf[k];
    return v;
  }

  function cellRow(row, x, y, h) {
    const v = vecOf(row.t);
    const out = [];
    for (let d = 0; d < der.nD; d++) {
      out.push({ d, w: v[d], x: x + d * CELL1, y, wd: CELL1, h });
    }
    return out;
  }

  // ---- L2：单词聚焦 ----------------------------------------------------------
  function layoutL2(g) {
    const f = focusTerms();
    const row = f && termIdx >= 0 ? f.rows[termIdx] : null;
    if (!row) { level = 1; layoutL1(g); return; }
    const wmax = Math.max(row.wi, row.wj);
    const barsW = 520;
    const ox = Math.max(80, (g.w - (barsW + 520)) / 2);
    const oy = 200;
    g.l2 = { ox, oy, barsW, row, wmax, bars: [], mini: [] };
    const v = vecOf(row.t);

    for (let d = 0; d < der.nD; d++) {
      const w = v[d];
      const bw = (wmax ? Math.max(1, (w / wmax) * barsW) : 0);
      const y = oy + d * 34;
      g.l2.bars.push({ d, w, x: ox + 150, y, wd: w ? bw : 0, h: 18 });
      g.hits.push({ x: ox, y: y - 6, w: 150 + barsW, h: 30, hit: { type: 'termbar', d } });
    }
    // 迷你矩阵：这个词桥接了哪些对（它同时出现在哪些学科里）
    const doms = [];
    for (let d = 0; d < der.nD; d++) if (v[d]) doms.push(d);
    const MC = 22, mx = g.w - 120 - der.nD * MC, my = oy;
    for (const i of doms) for (const j of doms) {
      g.l2.mini.push({ i, j, x: mx + j * MC, y: my + i * MC, c: MC, on: i !== j });
    }
    g.l2.miniX = mx; g.l2.miniY = my; g.l2.miniC = MC; g.l2.doms = doms;
    g.back = { x: ox, y: oy - 96, h: 24, label: `‹ ${der.dname(f.i)} × ${der.dname(f.j)}` };
    g.back.w = chipW(g.back.label);
    g.hits.push({ x: g.back.x, y: g.back.y, w: g.back.w, h: g.back.h, hit: { type: 'back' } });
  }

  const chipW = (label) => Math.round(label.length * 6.6) + 22;

  // ------------------------------------------------------------------ 命中
  function pick(wx, wy) {
    const g = geo || layout(1600, 900);
    if (!der || !g) return null;
    if (level === 1 && g.pix) {
      const p = g.pix;
      if (wx >= p.x && wx < p.x + p.w && wy >= p.y && wy < p.y + p.h) {
        const k = Math.floor((wy - p.y) / PIX) + p.start;
        const f = g.l1.f;
        if (k >= p.start && k < p.end) {
          const row = f.rows[k];
          const d = Math.floor((wx - p.x) / CELL1);
          return { type: 'prow', topic: row.t, i: f.i, j: f.j, d, rank: k };
        }
      }
    }
    const hits = g.hits || [];
    for (let i = hits.length - 1; i >= 0; i--) {
      const b = hits[i];
      if (wx >= b.x && wx < b.x + b.w && wy >= b.y && wy < b.y + b.h) return { ...b.hit };
    }
    return { type: 'center' };
  }

  function termName(t) { return der ? der.names[t] : ''; }

  function describe(hit) {
    if (!der || !hit || hit.type === 'center') return '';
    const out = [];
    switch (hit.type) {
      case 'cell': {
        if (hit.diag) {
          out.push(`${der.dname(hit.i)} — own vocabulary`);
          out.push(`${fmt(der.topics[hit.i])} distinct topics`);
          return out.join('\n');
        }
        const lo = Math.min(hit.i, hit.j), hi = Math.max(hit.i, hit.j);
        const s = der.shared[lo * D + hi];
        const jv = der.jacc[lo * D + hi];
        out.push(`${der.dname(lo)} × ${der.dname(hi)}`);
        out.push(`${fmt(s)} shared topics`);
        out.push(`Jaccard ${(jv * 100).toFixed(2)}%`);
        out.push(`${fmt(der.topics[lo])} · ${fmt(der.topics[hi])} own topics`);
        out.push('click to open the shared terms');
        return out.join('\n');
      }
      case 'outward':
        return `${der.dname(hit.i)} — outward\n${(der.outward[hit.i] * 100).toFixed(1)}% of its vocabulary is used by another discipline`;
      case 'inward':
        return `${der.dname(hit.i)} — inward\n${(der.inward[hit.i] * 100).toFixed(1)}% of the other disciplines' vocabulary is used here`;
      case 'node':
        return `${der.dname(hit.i)}`;
      case 'head': case 'prow': {
        const t = hit.topic;
        const a = der.off[t], b = der.off[t + 1];
        const parts = [];
        for (let k = a; k < b; k++) parts.push(`${der.dname(der.domOf[k])} ${fmt(der.wOf[k])}`);
        out.push(termName(t));
        out.push(`weight: ${parts.join(' · ')}`);
        if (hit.type === 'prow') out.push(`rank ${hit.rank + 1}`);
        return out.join('\n');
      }
      case 'termbar':
        return `${der.dname(hit.d)}`;
      default:
        return '';
    }
  }

  // ------------------------------------------------------------------ 绘制
  function draw(ctx, w, h, k = 1) {
    const g = layout(w, h);
    ctx.save();
    ctx.textBaseline = 'middle';
    if (!der) { ctx.restore(); return; }
    if (level === 0) drawL0(ctx, g, k);
    else if (level === 1) drawL1(ctx, g, k);
    else drawL2(ctx, g, k);
    ctx.restore();
  }

  const FS = (k, px) => px / k;

  function ink(ctx, text, x, y, color, k, size = LABEL_FONT, weight = 600, align = 'left', halo = true) {
    ctx.font = `${weight} ${FS(k, size)}px "Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textAlign = align;
    if (halo) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3 / k;                     // 屏幕恒定的描边宽度：世界坐标里要除以缩放
      ctx.strokeStyle = 'rgba(10,10,10,0.8)';
      ctx.strokeText(text, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawL0(ctx, g, k) {
    const foc = hover || pinned;
    const hot = !foc ? [] : (foc.type === 'cell' ? [foc.i, foc.j] : (foc.i != null ? [foc.i] : []));
    const dim = (i) => (hot.length && !hot.includes(i) ? 0.35 : 1);

    // 格
    for (const c of g.cells) {
      ctx.globalAlpha = 1;
      if (c.diag) {
        // 对角线不是一对，是实体自己 —— 用它的身份色实心块，和成对的格明显不同
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fillRect(c.x + 3, c.y + 3, CELL - 6, CELL - 6);
        ctx.fillStyle = withAlpha(der.color(c.i), 0.30 * dim(c.i));
        ctx.fillRect(c.x + 3, c.y + 3, CELL - 6, CELL - 6);
      } else {
        ctx.fillStyle = rampColor(c.jacc);
        ctx.globalAlpha = dim(c.i) * dim(c.j);
        ctx.fillRect(c.x + 1, c.y + 1, CELL - 2, CELL - 2);
        if (c.side > 0) {
          ctx.fillStyle = SEQ_CORE;
          ctx.globalAlpha = 0.9 * dim(c.i) * dim(c.j);
          ctx.fillRect(c.inx, c.iny, c.side, c.side);
        }
        ctx.globalAlpha = 1;
      }
    }
    // 数字（格的读者不必去 hover 才知道最大的那几对）
    ctx.globalAlpha = 1;
    for (const c of g.cells) {
      if (c.diag) continue;
      const big = c.shared >= der.maxShared * 0.25;
      ink(ctx, fmt(c.shared), c.x + 5, c.y + 11, big ? INK : INK_FAINT, k, 10, 700, 'left', !big);
    }

    // 树
    for (const t of [g.colTree, g.rowTree]) {
      ctx.strokeStyle = 'rgba(147,161,181,0.55)';
      ctx.lineWidth = 1 / k;
      for (const s of t.seg) {
        ctx.beginPath();
        if (t.axis === 'col') {
          const y = s.startY - s.h * s.span, ya = s.startY - (s.ah || 0) * s.span, yb = s.startY - (s.bh || 0) * s.span;
          ctx.moveTo(s.startX + s.a, ya); ctx.lineTo(s.startX + s.a, y);
          ctx.lineTo(s.startX + s.b, y); ctx.lineTo(s.startX + s.b, yb);
        } else {
          const x = s.startX - s.h * s.span, xa = s.startX - (s.ah || 0) * s.span, xb = s.startX - (s.bh || 0) * s.span;
          ctx.moveTo(xa, s.startY + s.a); ctx.lineTo(x, s.startY + s.a);
          ctx.lineTo(x, s.startY + s.b); ctx.lineTo(xb, s.startY + s.b);
        }
        ctx.stroke();
      }
    }

    // 两条边缘
    for (const b of g.outBars) {
      ctx.globalAlpha = dim(b.j);
      ctx.fillStyle = withAlpha(der.color(b.j), 0.85);
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    for (const b of g.inBars) {
      ctx.globalAlpha = dim(b.i);
      ctx.fillStyle = withAlpha(der.color(b.i), 0.85);
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
    ctx.globalAlpha = 1;

    // 轴标签（名字 + 本侧的边际值，见 layoutL0）
    for (const l of g.rowLabels) {
      ctx.globalAlpha = dim(l.i);
      ink(ctx, l.text, l.x, l.y, INK, k, LABEL_FONT, 600, 'right');
    }
    for (const l of g.colLabels) {
      ctx.save();
      ctx.translate(l.x, l.y);
      ctx.rotate(-Math.PI / 4);
      ctx.globalAlpha = dim(l.j);
      ink(ctx, l.text, 0, 0, INK, k, LABEL_FONT, 600, 'left');
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // 标题放矩阵**下方**：45° 的列标签会一直伸到左上角去，标题放上面必撞（探针量到过）。
    const capY = g.my + der.nD * CELL + 30;
    ink(ctx, `Clustered discipline matrix · ${der.nD} × ${der.nD}`,
      g.mx, capY, INK, k, 12, 650, 'left');
    ink(ctx, 'fill = Jaccard · inset square area = shared topics · column labels carry OUTWARD, row labels carry INWARD · click a cell to open its terms',
      g.mx, capY + 18, INK_DIM, k, 10, 500, 'left');
  }

  function drawL1(ctx, g, k) {
    const L = g.l1, f = L.f;
    ink(ctx, `${der.dname(f.i)} × ${der.dname(f.j)}`, g.back.x + g.back.w + 16, g.back.y + 12, INK, k, 13, 650, 'left');
    ink(ctx, `${fmt(f.rows.length)} shared topics × ${der.nD} disciplines`,
      g.back.x + g.back.w + 16, g.back.y + 30, INK_DIM, k, 10, 500, 'left');
    chip(ctx, g.back, k, hover, pinned);

    // 头部
    for (const row of g.head) {
      const lit = !hover || hover.type !== 'head' || hover.topic === row.row.t;
      ctx.globalAlpha = lit ? 1 : 0.4;
      ink(ctx, `${row.r + 1}`, L.ox + 34, row.y + HEAD_ROW / 2, INK_FAINT, k, 10, 600, 'right');
      ink(ctx, termName(row.row.t), L.ox + 44, row.y + HEAD_ROW / 2, INK, k, 11, 600, 'left', true);
      ink(ctx, `${fmt(row.row.wi)} · ${fmt(row.row.wj)}`, L.ox + 292, row.y + HEAD_ROW / 2, INK_DIM, k, 9, 500, 'right');
      for (const c of row.cells) {
        if (!c.w) { ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(c.x + 1, c.y + 1, c.wd - 2, c.h - 2); continue; }
        ctx.fillStyle = rampWeight(c.w, f.maxSum, c.d === f.i || c.d === f.j);
        ctx.fillRect(c.x + 1, c.y + 1, c.wd - 2, c.h - 2);
      }
      ctx.globalAlpha = 1;
    }

    // 像素区：每行 1px，同桶合并成 run。行按权重降序 ⟹ 同一个 alpha 桶在列里一定连续，
    // 所以每列 ~8 个 run 就能覆盖全部行，而 harness 可以用「铺满」不变量证明没漏没重。
    ctx.fillStyle = `rgb(${SEQ_RGB})`;
    for (const r of g.runs) {
      ctx.globalAlpha = 0.10 + 0.80 * (r.bucket / 23);
      ctx.fillRect(r.x, r.y, r.w - 2, r.h);
    }
    ctx.globalAlpha = 1;
    // 焦点两列描边，读者才知道哪两列是这一对
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1 / k;
    const ci = der.cluster.order.indexOf(f.i), cj = der.cluster.order.indexOf(f.j);
    for (const c of [ci, cj]) ctx.strokeRect(L.gridX + c * CELL1 + 0.5, L.oy + L.headH + 0.5, CELL1 - 1, L.gridH - 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.strokeRect(L.gridX + 0.5, L.oy + L.headH + 0.5, L.gw - 1, L.gridH - 1);

    // 列头
    for (let c = 0; c < der.nD; c++) {
      const d = der.cluster.order[c];
      ctx.fillStyle = withAlpha(der.color(d), 0.9);
      ctx.fillRect(L.gridX + c * CELL1 + 6, L.oy - 14, CELL1 - 12, 8);
      ink(ctx, der.dname(d).slice(0, 9), L.gridX + c * CELL1 + CELL1 / 2, L.oy - 26, INK_DIM, k, 9, 600, 'center');
    }

    // 分页
    const P = g.pages;
    ink(ctx, `rows ${P.start + 1}–${P.end} of ${fmt(P.total)}`, P.x, P.y, INK_DIM, k, 10, 500, 'left');
    if (P.n > 1) {
      for (const [label, x, ok] of [['‹ prev', P.prevX, P.cur > 0], ['next ›', P.nextX, P.cur < P.n - 1]]) {
        ctx.globalAlpha = ok ? 1 : 0.3;
        ink(ctx, label, x, P.y, ok ? INK : INK_FAINT, k, 10, 600, 'left');
        ctx.globalAlpha = 1;
      }
      ink(ctx, `page ${P.cur + 1}/${P.n}`, P.x + 350, P.y, INK_FAINT, k, 10, 500, 'left');
    }
    ink(ctx, 'every shared term is one row — the head is expanded, the rest is 1px per term; hover any pixel',
      P.x, P.y + 20, INK_FAINT, k, 9, 500, 'left');
  }

  function rampWeight(w, max, focal) {
    const t = max ? Math.min(1, w / max) : 0;
    const base = 0.06 + 0.62 * Math.sqrt(t);
    return focal ? `rgba(226,238,255,${Math.max(0.12, base).toFixed(3)})` : `rgba(${SEQ_RGB},${base.toFixed(3)})`;
  }

  function drawL2(ctx, g, k) {
    const L = g.l2;
    ink(ctx, termName(L.row.t), L.ox, L.oy - 60, INK, k, 16, 650, 'left');
    ink(ctx, `appears in ${L.doms.length} of ${der.nD} disciplines · ${fmt(L.row.wi)} · ${fmt(L.row.wj)} in the two disciplines of this pair`,
      L.ox, L.oy - 38, INK_DIM, k, 10, 500, 'left');
    chip(ctx, g.back, k, hover, pinned);

    for (const b of L.bars) {
      ctx.fillStyle = withAlpha(der.color(b.d), 0.85);
      ctx.fillRect(b.x, b.y, Math.max(1, b.wd), b.h);
      ink(ctx, der.dname(b.d), b.x - 10, b.y + b.h / 2, INK, k, 11, 600, 'right');
      ink(ctx, b.w ? fmt(b.w) : '—', b.x + Math.max(1, b.wd) + 8, b.y + b.h / 2, INK_DIM, k, 10, 500, 'left');
    }

    const MC = L.miniC;
    ink(ctx, 'pairs this term bridges', L.miniX, L.miniY - 18, INK_DIM, k, 10, 600, 'left');
    for (const c of L.mini) {
      ctx.fillStyle = c.on ? 'rgba(226,238,255,0.85)' : 'rgba(255,255,255,0.05)';
      ctx.fillRect(c.x + 1, c.y + 1, MC - 2, MC - 2);
    }
    ink(ctx, 'diagonal is the discipline itself', L.miniX, L.miniY + der.nD * MC + 14, INK_FAINT, k, 9, 500, 'left');
  }

  function chip(ctx, c, k, hv, pn) {
    const on = (hv && hv.type === 'back') || (pn && pn.type === 'back');
    ctx.fillStyle = on ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.07)';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1 / k;
    ctx.strokeRect(c.x + 0.5 / k, c.y + 0.5 / k, c.w - 1 / k, c.h - 1 / k);
    ink(ctx, c.label, c.x + 11, c.y + c.h / 2, INK, k, 11, 600, 'left');
  }

  function withAlpha(hex, a) {
    if (typeof hex !== 'string' || hex[0] !== '#' || hex.length < 7) return `rgba(150,182,226,${a})`;
    const r = parseInt(hex.slice(1, 3), 16), g2 = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g2},${b},${a})`;
  }

  // ------------------------------------------------------------------ 图例
  function renderLegend(el) {
    if (!el) return;
    if (!der) { el.innerHTML = '<div class="lrow">sunburst-data.json not loaded</div>'; return; }
    const rows = [];
    rows.push(`<div class="lhd">Disciplines (click to highlight)</div>`);
    rows.push(`<div class="lnote">Fill is <b>Jaccard</b> (how close a pair is), the inset square's <b>area</b> is the number of <b>shared topics</b> — two channels, two quantities. Rows and columns are ordered by <b>hierarchical clustering</b> of ${D} disciplines (average linkage on 1 − Jaccard): the order is derived from the data, the names are always drawn, so identity never rests on colour.</div>`);
    for (let i = 0; i < der.nD; i++) {
      const on = pinned && pinned.i === i;
      rows.push(`<div class="lrow" data-dom="${i}"${on ? ' data-on="1"' : ''}>`
        + `<span class="sw" style="background:${der.color(i)}"></span>`
        + `<b>${der.dname(i)}</b>`
        + `<span class="rnum">${fmt(der.topics[i])} topics · out ${(der.outward[i] * 100).toFixed(0)}% · in ${(der.inward[i] * 100).toFixed(0)}%</span></div>`);
    }
    rows.push(`<div class="lhd">Marginal bars</div>`);
    rows.push(`<div class="lnote"><b>OUTWARD</b> (top) = Σ shared / (10 × topics) — how much of this discipline's vocabulary is used by another.<br><b>INWARD</b> (left) = Σ shared / (Σ other topics) — how much of everyone else's vocabulary is used here. Same numerator, two different denominators, so the two bars answer two different questions.</div>`);
    // 最大的一对，当作行内的排行榜（第二张图放进图例，照哲学模式的先例）
    const pairs = [];
    for (let i = 0; i < der.nD; i++) {
      for (let j = i + 1; j < der.nD; j++) pairs.push({ i, j, s: der.shared[i * D + j], jc: der.jacc[i * D + j] });
    }
    pairs.sort((a, b) => b.jc - a.jc);
    rows.push(`<div class="lhd">Closest pairs (Jaccard)</div>`);
    for (const p of pairs.slice(0, 8)) {
      rows.push(`<div class="lrow"><span class="sw" style="background:${der.color(p.i)}"></span>`
        + `${der.dname(p.i)} × ${der.dname(p.j)}<span class="rnum">${(p.jc * 100).toFixed(2)}% · ${fmt(p.s)} shared</span></div>`);
    }
    rows.push(`<div class="lnote">${der.nD} disciplines · ${(der.nD * (der.nD - 1)) / 2} pairs · ${fmt(der.sumShared)} shared-topic pairs across all of them · ${fmt(der.bridging)} topics appear in more than one discipline.`
      + (der.cross.mismatches ? ` <b>Cross-check FAILED</b> for ${der.cross.mismatches.length} cells.`
        : der.cross.checked ? ` Cross-checked against interdisc-data.json: all ${der.cross.checked} pairs agree.` : '')
      + `</div>`);
    rows.push(`<div class="lnote">Fill is a single-hue sequential ramp; the ${der.nD} discipline hues above are the identity key and never encode the numbers. Those ${der.nD} hues have <b>not</b> been machine-validated for colour-vision separation (the validator run was denied), so every discipline is named on an axis — do not rely on hue alone.</div>`);
    el.innerHTML = rows.join('');
    for (const row of el.querySelectorAll('[data-dom]')) {
      row.onclick = () => {
        const i = Number(row.dataset.dom);
        const h = { type: 'node', i };
        pinned = sameTarget(pinned, h) ? null : h;
        renderLegend(el);
        after();
      };
    }
  }

  return {
    setData, getData,
    getModel: () => (geo ? { ...geo, hits: undefined } : null),
    draw, pick, describe, renderLegend,
    setHover, getHover, togglePinned, getPinned, sameTarget,
    rampColor, getCounts,
    back, bestPartner,
    get nodes() { return der ? der.domRecs : []; },
    get matrix() { return der ? der.shared : null; },
    get clusters() { return der ? der.cluster.order : []; },
    // harness 用的自查出口：名字块和弧的条数必须对上，交叉校验的结果也要能看到，
    // 否则「第 t 行的名字错位」这种事只会安静地画错。
    get diagnostics() {
      if (!der) return null;
      return {
        topicCount: der.nT, nameCount: der.nameCount, topicCountOk: der.nameCount === der.nT,
        arcTriples: sbData.arcs.length / 3, arcTriplesOk: sbData.arcs.length % 3 === 0,
        sumShared: der.sumShared, bridging: der.bridging,
        maxShared: der.maxShared, maxJ: der.maxJ,
        cross: der.cross,
        // 聚类树本身也要能被检查：合并高度必须单调不减（UPGMA 的可约性），
        // 每次合并的簇大小必须是 2..11 且一个不落，叶子序必须是 0..10 的一个排列。
        order: der.cluster.order.slice(),
        mergeHeights: der.cluster.merges.map((m) => m.h),
        mergeSizes: der.cluster.merges.map((m) => m.size),
        // 每次合并的两个孩子各有几个叶子：父的大小必须等于两者之和，这是层次结构本身
        mergeChildren: der.cluster.merges.map((m) => [m.left.leaves.length, m.right.leaves.length]),
        // 每次合并的叶子集合：第一次合并必须正好是 Jaccard 最大的那一对
        mergeLeaves: der.cluster.merges.map((m) => [m.left.leaves.slice(), m.right.leaves.slice()]),
        symmetricOk: der.symmetricOk,
      };
    },
    get level() { return level; },
    get pair() { return pair; },
  };
}
