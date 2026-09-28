// knowledge-coral.js — 知识珊瑚（7B）：用**空间分枝结构**替掉 Sunburst。
//
// 用户的原话：「Hierarchy 本来就是 branching。那为什么非要 Sunburst / Tree / Icicle？」
// 旭日图把一棵树拍成一个圆环 —— 环上相邻的两条弧除了「角度挨着」没有任何关系，分支被摊平了。
// 珊瑚不摊平：它就是把那棵树**真的长出来**。
//
// 数据是真的，不是编的。map_of_science/asset/data.tsv 里一直有第三层：
//
//   Domain(11) → Cluster(85,643) → Concept(274,422)
//
// 每个 cluster 带**真实降维坐标**（x ∈ [−506.5, 565.0]，y ∈ [−621.5, 476.0]）、学科标签、
// 文章数（合计 25,968,533 = meta.totalArticles），以及 1–5 个 key_concepts（共 426,647 对，
// 和旭日图的 arcs 用的是同一套过滤，两边账对得上）。所以草图上那个「Field」就是 cluster，
// Domain → Cluster → Concept 是数据的真实层级，不是为这张图造的。
//
// 但**不能直接把 cluster 当吸引子**：85,643 个 cluster 的平均最近邻距只有 1.18 个 map 单位，
// 糊成一片。必须先聚合。
//
// 生长：分层递归空间殖民。下面几条都是原型阶段**实测**出来的，不是设计时的假设 ——
// 每一条都对应一次失败：
//
//   ① 朴素单层空间殖民会退化成「毛虫」。CELL=9 时最大深度 1,197，CELL=40 时 15。
//      「长脊」是分辨率伪影：吸引子太密，生长锋面永远在外层，只会放射状铺开。
//   ② 纯最近邻版（Runions 原味：吸引子挂到最近的节点、孩子接管）在均匀密场里会蜕化成
//      **一条蛇**：实测 CELL=40 时 depth=59 / tips=16，从根一路爬到图尾把吸引子吃光；
//      而且两个吸引子方向抵消时节点原地打转，跑不完（实测：直接挂死）。
//   ③ 所以用 frontier 变体：INF 以内的活跃吸引子**一起**拉，节点手边还有吸引子就还能长。
//      但要加角度闸门 —— 已经朝某个方向长过孩子的节点，除非剩下的吸引子落在**新方向**
//      （夹角 > ANGLE）才再分叉。没有闸门就是「从根上炸开的一团扇子」（实测：深度 10、
//      979 个叶端的糊块），加上之后才是树（实测：深度 15、23 个叶端、19 个分叉点）。
//      **「被连拉 N 次就算已服务」那条规则是 closest 变体的补丁，不能搬到这里**：
//      frontier 下它等于每 3 轮清空一次邻域，树会塌成 119 个节点（实测）。
//      frontier 的终止性来自闸门 + 每层预算（`!created.length` 就停）。
//   ④ 基部不能取「最低那条带的质心」—— 那条带横跨整张图，质心常落在没有吸引子的空档里，
//      生长第一步就卡死（实测：起手只走 2 个节点、覆盖 1.9%）。改成取最低 20% 带里
//      邻居最多的那个吸引子的邻域质心。
//   ⑤ 递归**只在叶端细分是没用的**：叶端的簇全落在它的 KILL 半径里，细分树在根上就一口
//      吃光，只长出 1 个节点（实测 L1 只比 L0 多 24 个）。必须沿整条骨架铺开 —— 每个节点
//      拿自己那份簇再长一小丛，接在自己身上，自己那份簇清空交给它。这才是"沿枝条长绒毛"，
//      也是节点数从 10² 涨到 10⁴ 的地方。
//
// 参数是扫出来的（不是拍的）：
//   CELL0=40  INF=4×格子  KILL=2×格子  STEP=1×格子  ANGLE=60°  SHRINK=1.6  3 层
//   → 497 个 L0 吸引子、8,614 个节点、1,823 个叶端、1,486 个分叉点、深度 153；
//   覆盖 85,643/85,643 个簇，w(root) = 25,968,533 逐位等于文章总数。setData ≈ 400 ms。
//   SHRINK 再大就回到「毛虫」：实测 SHRINK=3.2 时深度 1,179。
//   **STEP 必须是 1×格子，不能是 2×格子。** 一次迈 80 map 单位时，吸引子在迈完之前
//   来不及把平均方向扭转过来，主干就成了一根根笔直的辐条（截图上像蒲公英，不像珊瑚）。
//   改成 1×格子后节点 3,616 → 8,614、分叉点 608 → 1,486，主干变成有弧度的血管，
//   代价只是 setData 从 230ms 到 400ms。（这一步是**对着截图**定的，不是对着数字。）
//
//   ⑥ **层数是被半径的物理限制钉死的，不是拍脑袋。** 平方和守恒下，一根 R0 粗的根分给
//      n 个叶端，每个叶端最多 R0/√n。实测扫 MAXLEVEL（其余参数不变）：
//        3 层 → 8,614 节点 / 1,823 叶端 · 70% 落在 RMIN · p90 2.63px
//        4 层 → 15,573 节点 / 3,231 叶端 · 79% 落在 RMIN · p90 1.79px
//        6 层 → 32,066 节点 / 6,692 叶端 · **87% 落在 RMIN · p90 只剩 1.36px**
//      也就是说层数每加一层，就有更大比例的枝条被下限夹平 —— 到 6 层时 p90 只有下限的
//      1.13 倍，「粗度」这个读数通道基本死了（画面上就是一片等宽的灰雾）。
//      所以停在 3 层 + R0=44：中位半径 1.20px、最大 44px。
//      这没有改回去的办法：**权重是文章数，分布本来就极度偏斜** —— 全树 70% 的节点、
//      95% 的叶端落在 RMIN 上，粗度真正读得出差别的是主干和前几条主枝（p90 2.63px、
//      p99 6.91px，最粗 44px）。换「簇数」当权重能把偏斜摊平一些，但那是另一个量
//      （见 ⑦）；而真实珊瑚本来就是一根粗主干拖着一片看不见的毛细。
//      （这里原先写的「44% 落在下限 / 中位 1.46px」是**错的**：那组数是光栅原型跑出来的，
//      而原型的 WEIGHT=articles 分支误写成了 sub[i]=1，等于按**节点数**加权。harness 里
//      按文章权重重算，实测 70%。）
//
//   ⑦ **单根基部 ⟹ 总有一支先出生、先长大。** 实测：根有 9 个孩子，最重的一个背着
//      97.4% 的文章（HHI = 0.949），其余 8 个合计 2.6%。换成 Runions 原味的最近邻分配
//      也一样偏（同样一支独大，深度还塌到几十）。所以图例里说的「主枝」不能是根的孩子们 ——
//      它们几乎全是残桩 —— 而是**第一次真正分叉处的那几条**：从根沿最重的孩子往下走，
//      直到有个节点的最重孩子跌破自己的 70%，那里才算叉开。实测要走 **33 层**才到那个点。
//      到那儿也不好看：那个节点自己只背着 8.49% 的文章，4 个孩子是
//      5.81% / 2.63% / 0.04% / 0.00% —— **只有 2 条是实的**（≥1%），另外 2 条合计 0.04%。
//      所以图例报的是「N 条主枝里 M 条是实的、最大一条占 X%」，不写成 11 条势均力敌。
//      更根本的原因是：**权重不在枝头，在干上。** 91.5% 的文章是沿主干一路长出来的绒毛
//      背着的（见文件头 ⑤：每个节点拿自己那份簇再长一小丛），所以「主干分成几条」本来
//      就是对一个连续过程的粗糙概括 —— 这张图能诚实说出的只有这个。
//
// 粗度：r = R0·√(w / w_total)，w = 该子树服务的文章总数。这个式子**本身就是 da Vinci
// 平方和守恒** —— 严格说，守恒定律成立在**没有下限的** ρ = R0·√(W/W_T) 上：
// 逐节点实测 Σ ρ_c² = ρ_p²（自己那份为空，6,940 个节点取等号）、Σ ρ_c² < ρ_p²
// （自己那份非空，1,674 个节点全部严格小于）、**0 处违反**。这个式子不需要再补一次归一化。
// 但画出来的是 r = max(RMIN, ρ)：下限把细枝**往上抬**，所以 Σ r_c² 可以**超过** r_p²
// （实测 1,208 个节点，最大超出 6.04px²）。harness 因此在 ρ 上断言守恒定律，
// 在 r 上只断言「单调」+「超出必伴随着被夹住的子节点」—— 不假装 r 也守恒。
//
// 渲染：枝条是**锥形**的，不是等宽线。所以按「链」（degree-2 的极大路径）切成多边形：
// 左偏移 + 右偏移 + 两端半圆帽，每个颜色合成一个 Path2D 一次 fill。
// 8,614 个节点 → 3,445 条链 → **11 次 fill**（不是一个节点一次 draw）。
// 再走离屏层：光栅化一次，之后每帧只 drawImage（Mycelium 那一课是实测出来的：
// 每帧 565,008 段直画，鼠标一动就整帧重光栅化）。
//
// 三条诚实边界，都写进图例：
//   1. **拓扑是算法长出来的，不是数据的父子关系。** 真实层级是 Domain → Cluster → Concept，
//      但一个 cluster 只有 1–5 个概念、而且概念跨簇共享，直接画出来是张刺猬。
//      数据决定的是**位置、权重、颜色**。
//   2. **吸引子是聚合过的。** 挨得极近的簇合成一个吸引点，权重是它们的和。枝条服务多少篇
//      文章是真的，但「一个吸引点」不等于「一个 cluster」。
//   3. **11 条主枝不会色纯。** 学科在 map 空间里是互相穿插的（实测：按学科分开长，
//      每株只有 1–10 个节点），所以颜色只能来自「这条枝服务了谁」。
//      已知缺口照旧：这 11 个分类色从未过 dataviz 校验器 —— 但珊瑚的身份由位置和粗细承载，
//      不依赖把两个色区分开。

const D = 11;                                  // 学科数（cluster_category 0–10）

// ------------------------------------------------------ 生长参数（全部实测，见文件头）
const CELL0 = 40;                              // L0 聚合格子（map 单位）
const M_INF = 4;                               // INF = 格子 × 4
const M_KILL = 2;                              // KILL = 格子 × 2
const M_STEP = 1;                              // STEP = 格子 × 1
const ANGLE = 60;                              // 分叉角度闸门（度）
const SHRINK = 1.6;                            // 每层格子缩小倍数
const MAXLEVEL = 3;                            // 递归层数（理由见文件头 ⑥）
const MINREC = 30;                             // 少于这么多簇就不再往下细分
const NODE_CAP = 120000;                       // 硬上限 —— 预算不是优化，是**终止性**

// ------------------------------------------------------ 版式常量（世界坐标 1600×900）
const WORLD_MARGIN = 46;                       // 布局到世界边缘留的余量（给标签）
const MAX_ANISO = 1.6;                         // 各向异性填充上限（和 Mycelium 同一个选择）
const R0 = 44;                                 // 根部半径（世界 px）
const RMIN = 1.2;                              // 最细的枝条半径：显示时还会按 k 缩小，
                                               // 所以不能取亚像素 —— 实测 70% 的节点在这条线上
                                               // （世界坐标）；屏幕上是 0.95px
const CAP_SEGS = 5;                            // 链端半圆帽的分段数
const PICK_R = 16;                             // pick 的命中半径（世界 px）
const LABEL_FONT = 12;

const INK = '#e6edf3';

const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const withAlpha = (hex, a) => {
  const h = String(hex || '#93a1b5').replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

// 整个模块里**没有一处 Math.random** —— 生长必须是输入的纯函数，否则 harness 没法断言
// 「同样的输入 → 逐字节相同的树」。连抖动都没用上：所有位置都来自数据坐标的确定性算术。

// 均匀网格。cell 必须和查询半径同量级 —— 扫描范围是 (2r/cell)² 个格子，
// 传一个大半径（比如 1e12）会当场挂死。要全局最近邻就线性扫。
class Grid {
  constructor(cell) { this.c = Math.max(cell, 1e-6); this.m = new Map(); this.px = []; this.py = []; }
  add(x, y, i) {
    const k = Math.floor(x / this.c) + ':' + Math.floor(y / this.c);
    let a = this.m.get(k); if (!a) { a = []; this.m.set(k, a); }
    a.push(i); this.px[i] = x; this.py[i] = y;
  }
  within(x, y, r) {
    const out = [], c = this.c;
    for (let gx = Math.floor((x - r) / c); gx <= Math.floor((x + r) / c); gx++) {
      for (let gy = Math.floor((y - r) / c); gy <= Math.floor((y + r) / c); gy++) {
        const a = this.m.get(gx + ':' + gy); if (!a) continue;
        for (const i of a) out.push(i);
      }
    }
    return out;
  }
}

// 把一批簇按格子聚合成吸引子。位置 = 格内簇的**文章加权质心**；
// 权重 = 格内文章数之和（全 0 的格子退回计数平均，免得除零）。
function aggregate(cl, idxs, cell) {
  const m = new Map();
  for (const i of idxs) {
    const k = Math.floor(cl.x[i] / cell) + ':' + Math.floor(cl.y[i] / cell);
    let a = m.get(k);
    if (!a) { a = { w: 0, n: 0, sx: 0, sy: 0, wx: 0, wy: 0, members: [] }; m.set(k, a); }
    const w = cl.articles[i];
    a.w += w; a.n++; a.sx += cl.x[i]; a.sy += cl.y[i];
    a.wx += cl.x[i] * w; a.wy += cl.y[i] * w;
    a.members.push(i);
  }
  const out = [];
  for (const a of m.values()) {
    const w = a.w || a.n;
    out.push({ x: (a.w > 0 ? a.wx : a.sx) / w, y: (a.w > 0 ? a.wy : a.sy) / w, w: a.w, n: a.n, members: a.members });
  }
  return out;
}

// 基部：最低 20% 带里**邻居最多**的那个吸引子的邻域质心（理由见文件头 ④）。
function baseOf(atts, span, frac = 0.20) {
  if (!atts.length) return { x: 0, y: 0 };
  let lo = Infinity, hi = -Infinity;
  for (const a of atts) { if (a.y < lo) lo = a.y; if (a.y > hi) hi = a.y; }
  const cut = lo + (hi - lo) * frac;
  const cand = atts.filter((a) => a.y <= cut);
  if (!cand.length) return { x: atts[0].x, y: atts[0].y };
  const g = new Grid(span);
  for (let i = 0; i < cand.length; i++) g.add(cand[i].x, cand[i].y, i);
  let best = 0, bestN = -1;
  for (let i = 0; i < cand.length; i++) {
    const n = g.within(cand[i].x, cand[i].y, span).length;
    if (n > bestN) { bestN = n; best = i; }
  }
  const near = g.within(cand[best].x, cand[best].y, span);
  let sx = 0, sy = 0, sw = 0;
  for (const i of near) { const w = cand[i].w || cand[i].n || 1; sx += cand[i].x * w; sy += cand[i].y * w; sw += w; }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: cand[best].x, y: cand[best].y };
}

// 单层生长。返回局部树：`local[i].att` = 该节点吃到的吸引子下标。
function grow(cl, rootX, rootY, atts, P, nodesUsed) {
  const local = [{ x: rootX, y: rootY, parent: -1, att: [] }];
  const kids = [[]];
  const alive = new Uint8Array(atts.length).fill(1);
  for (let a = 0; a < atts.length; a++) {
    if (Math.hypot(atts[a].x - rootX, atts[a].y - rootY) < P.KILL) { alive[a] = 0; local[0].att.push(a); }
  }
  const COSA = Math.cos(ANGLE * Math.PI / 180);
  const cap = Math.min(NODE_CAP - nodesUsed, Math.max(48, atts.length * 3));
  let rounds = 0, active = [0], hitCap = false;

  while (rounds++ < 4000) {
    if (local.length >= cap) { hitCap = true; break; }
    const ag = new Grid(P.INF);
    for (let a = 0; a < atts.length; a++) if (alive[a]) ag.add(atts[a].x, atts[a].y, a);

    const created = [];
    const still = [];
    for (const ni of active) {
      const n = local[ni];
      const near = ag.within(n.x, n.y, P.INF);
      let dx = 0, dy = 0, cnt = 0;
      for (const a of near) {
        if (!alive[a]) continue;
        const ux = atts[a].x - n.x, uy = atts[a].y - n.y, L = Math.hypot(ux, uy) || 1;
        dx += ux / L; dy += uy / L; cnt++;
      }
      if (!cnt) continue;
      const L = Math.hypot(dx, dy);
      if (!(L > 1e-9)) { still.push(ni); continue; }
      still.push(ni);
      // 角度闸门：已经朝这个方向长过孩子了就不再分叉。这一条是「树」和「糊成一团」的分界。
      const ux = dx / L, uy = dy / L;
      let covered = false;
      for (const c of kids[ni]) {
        const cdx = local[c].x - n.x, cdy = local[c].y - n.y, cdeg = Math.hypot(cdx, cdy) || 1;
        if ((cdx / cdeg) * ux + (cdy / cdeg) * uy > COSA) { covered = true; break; }
      }
      if (covered) continue;
      if (local.length >= cap) { hitCap = true; break; }
      const ci = local.length;
      local.push({ x: n.x + ux * P.STEP, y: n.y + uy * P.STEP, parent: ni, att: [] });
      kids.push([]); kids[ni].push(ci); created.push(ci);
    }
    if (!created.length) break;

    const kg = new Grid(P.KILL);
    for (const ci of created) kg.add(local[ci].x, local[ci].y, ci);
    for (let a = 0; a < atts.length; a++) {
      if (!alive[a]) continue;
      const near = kg.within(atts[a].x, atts[a].y, P.KILL);
      if (near.length) { alive[a] = 0; local[near[0]].att.push(a); }
    }
    active = still.concat(created);
  }
  return { local, kids, hitCap };
}

// ===========================================================================
export function createCoralView(opts = {}) {
  const onChange = opts.onChange || (() => {});
  // 宿主注入 makeCanvas；Node 里没有 document 就走直画回退（harness 两条路都测）。
  const makeCanvas = opts.makeCanvas
    || (typeof document !== 'undefined' ? (() => document.createElement('canvas')) : null);

  let der = null;          // 全部派生结果
  let focus = null;        // null | {type:'discipline', i} | {type:'node', i}
  let hover = null;
  let pinned = null;
  let layer = null;        // 基础层离屏缓存
  let litLayer = null;     // 聚焦高亮层离屏缓存

  // --------------------------------------------------------------- 建树
  function buildTree(cl, N) {
    const X = [], Y = [], PARENT = [], KIDS = [], OWN = [], W = [], DOM = [], DEPTH = [];
    let count = 0;
    const pushNode = (x, y) => {
      X.push(x); Y.push(y); PARENT.push(-1); KIDS.push([]); OWN.push([]); W.push(0); DOM.push(-1); DEPTH.push(0);
      return count++;
    };

    const all = new Array(N);
    for (let i = 0; i < N; i++) all[i] = i;

    const recurse = (seed, clusters, cell, level) => {
      const atts = aggregate(cl, clusters, cell);
      if (!atts.length) return;
      const P = { INF: cell * M_INF, KILL: cell * M_KILL, STEP: cell * M_STEP };
      const t = grow(cl, X[seed], Y[seed], atts, P, count);

      const idmap = new Array(t.local.length);
      idmap[0] = seed;
      for (let i = 1; i < t.local.length; i++) {
        idmap[i] = pushNode(t.local[i].x, t.local[i].y);
        PARENT[idmap[i]] = idmap[t.local[i].parent];
        KIDS[idmap[t.local[i].parent]].push(idmap[i]);
      }

      // 吸引子归给吃到它的节点；没吃到的挂到**最近的**节点 —— 保证「一个簇都没丢」。
      // 这里必须线性扫局部树（只有几十个节点）：走 Grid 传大半径会挂死。
      const owner = new Int32Array(atts.length).fill(-1);
      for (let i = 0; i < t.local.length; i++) for (const a of t.local[i].att) owner[a] = i;
      for (let a = 0; a < atts.length; a++) {
        if (owner[a] >= 0) continue;
        let best = -1, bd = Infinity;
        for (let i = 0; i < t.local.length; i++) {
          const dx = t.local[i].x - atts[a].x, dy = t.local[i].y - atts[a].y, d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = i; }
        }
        owner[a] = best;
      }
      for (let a = 0; a < atts.length; a++) {
        if (owner[a] < 0) continue;
        const g = idmap[owner[a]];
        for (const m of atts[a].members) OWN[g].push(m);
      }

      if (level >= MAXLEVEL) return;
      for (let i = 0; i < t.local.length; i++) {
        const g = idmap[i];
        if (OWN[g].length < MINREC) continue;
        const mine = OWN[g];
        OWN[g] = [];                    // 交给自己长出来的那一丛，权重不会两头都算
        recurse(g, mine, cell / SHRINK, level + 1);
      }
    };

    const A0 = aggregate(cl, all, CELL0);
    const root = baseOf(A0, CELL0 * 6);
    const rootIdx = pushNode(root.x, root.y);
    recurse(rootIdx, all, CELL0, 0);

    // 自底向上：w = 自己那份簇的文章数 + 子节点的 w
    const order = [];
    const stack = [0];
    while (stack.length) { const i = stack.pop(); order.push(i); for (const c of KIDS[i]) stack.push(c); }
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k];
      let w = 0;
      for (const c of OWN[i]) w += cl.articles[c];
      for (const c of KIDS[i]) w += W[c];
      W[i] = w;
    }
    for (const i of order) DEPTH[i] = PARENT[i] < 0 ? 0 : DEPTH[PARENT[i]] + 1;

    // 颜色：节点的颜色 = 它**子树**里文章权重最大的那个学科（逐节点自底向上）
    const acc = new Array(count);
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k];
      const m = new Map();
      for (const c of OWN[i]) m.set(cl.dom[c], (m.get(cl.dom[c]) || 0) + cl.articles[c]);
      for (const c of KIDS[i]) {
        const cm = acc[c];
        if (cm) for (const [d, w] of cm) m.set(d, (m.get(d) || 0) + w);
      }
      let bd = -1, bw = -1;
      // Map 迭代顺序 = 插入顺序 = 确定的；同权重取学科下标小的，重跑逐位相同。
      for (const [d, w] of m) if (w > bw || (w === bw && d < bd)) { bw = w; bd = d; }
      DOM[i] = bd < 0 ? 0 : bd;
      acc[i] = m;
    }
    return { X, Y, PARENT, KIDS, OWN, W, DOM, DEPTH, count };
  }

  // --------------------------------------------------------------- 链分解
  //
  // degree-2 的极大路径切成一条「链」。链的颜色 = 末端节点的颜色（更深的子树主学科更具体）；
  // 颜色一变就切断，所以每条链只有一个颜色 —— 11 种颜色只需要 11 次 fill。
  function buildChains(t) {
    const chains = [];
    const push = (from, to) => {
      const idx = [from, to];
      let cur = to;
      const col = t.DOM[to];
      while (t.KIDS[cur].length === 1 && t.DOM[t.KIDS[cur][0]] === col) { cur = t.KIDS[cur][0]; idx.push(cur); }
      chains.push({ idx, colour: col });
      for (const c of t.KIDS[cur]) push(cur, c);
    };
    for (const c of t.KIDS[0]) push(0, c);
    return chains;
  }

  // 把一条链写成**锥形多边形**（左偏移 + 右偏移 + 两端半圆帽）。
  // 拐点用斜接（miter）而不是简单法线偏移，否则急转弯处会缺一块。
  function emitChain(path, t, chains, ci, kx, ky, ox, oy) {
    const idx = chains[ci].idx;
    const n = idx.length;
    if (n < 2) return 0;
    const px = new Float64Array(n), py = new Float64Array(n), pr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const g = idx[i];
      px[i] = ox + t.X[g] * kx;
      py[i] = oy - t.Y[g] * ky;      // map 的 y 向上、画布 y 向下 → 翻过来，基部落在底部
      pr[i] = Math.max(RMIN, R0 * Math.sqrt(t.W[g] / t.W[0]));
    }
    const lx = new Float64Array(n), ly = new Float64Array(n), rx = new Float64Array(n), ry = new Float64Array(n);
    let u0x = 0, u0y = 0, v1x = 0, v1y = 0;
    for (let i = 0; i < n; i++) {
      let ux, uy, vx, vy;
      if (i === 0) { ux = px[1] - px[0]; uy = py[1] - py[0]; }
      else { ux = px[i] - px[i - 1]; uy = py[i] - py[i - 1]; }
      if (i === n - 1) { vx = px[n - 1] - px[n - 2]; vy = py[n - 1] - py[n - 2]; }
      else { vx = px[i + 1] - px[i]; vy = py[i + 1] - py[i]; }
      let ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      let vl = Math.hypot(vx, vy) || 1; vx /= vl; vy /= vl;
      if (i === 0) { u0x = ux; u0y = uy; }
      if (i === n - 1) { v1x = vx; v1y = vy; }
      const n1x = -uy, n1y = ux, n2x = -vy, n2y = vx;
      let mx = n1x + n2x, my = n1y + n2y;
      let den = 1 + (n1x * n2x + n1y * n2y);
      if (!(den > 0.25)) { mx = n1x; my = n1y; den = 1; }   // 接近 180° 折返 → 退回单法线
      const s = pr[i] / den;
      lx[i] = px[i] + mx * s; ly[i] = py[i] + my * s;
      rx[i] = px[i] - mx * s; ry[i] = py[i] - my * s;
    }
    // 半圆帽：从一侧绕过端点到另一侧，中途**必须经过端点处的切向**（否则会绕错半边）。
    const cap = (cxp, cyp, r, fromX, fromY, fx, fy) => {
      const a0 = Math.atan2(fromY - cyp, fromX - cxp);
      const af = Math.atan2(fy, fx);
      let dd = 2 * (af - a0);
      while (dd > Math.PI) dd -= 2 * Math.PI;
      while (dd <= -Math.PI) dd += 2 * Math.PI;
      for (let s = 1; s <= CAP_SEGS; s++) {
        const a = a0 + dd * s / CAP_SEGS;
        path.lineTo(cxp + Math.cos(a) * r, cyp + Math.sin(a) * r);
      }
    };
    path.moveTo(lx[0], ly[0]);
    for (let i = 1; i < n; i++) path.lineTo(lx[i], ly[i]);
    cap(px[n - 1], py[n - 1], pr[n - 1], lx[n - 1], ly[n - 1], v1x, v1y);
    for (let i = n - 2; i >= 0; i--) path.lineTo(rx[i], ry[i]);
    cap(px[0], py[0], pr[0], rx[0], ry[0], -u0x, -u0y);
    path.closePath();
    return n;
  }

  // --------------------------------------------------------------- 数据入口
  function setData(coral, sunburst) {
    layer = null; litLayer = null; focus = null; hover = null; pinned = null;
    if (!coral || !coral.meta || !coral.meta.clusterCount || !coral.cl) { der = null; onChange(); return; }

    const N = coral.meta.clusterCount;
    const cl = { x: coral.cl.x, y: coral.cl.y, dom: coral.cl.dom, articles: coral.cl.articles };
    const cats = coral.categories || [];
    const names = cats.map((c, i) => c.name || `Discipline ${i}`);
    const cols = cats.map((c) => c.color || '#93a1b5');
    // 术语名只在 describe 里用（一个簇的那几个概念）—— 从旭日图的词表借，
    // 不在珊瑚的数据文件里再抄一份 274,422 个字符串。
    const topicNames = sunburst && typeof sunburst.topics === 'string' ? sunburst.topics.split('\n') : null;
    const off = coral.cOff, cIdx = coral.cIdx;

    const t = buildTree(cl, N);
    const chains = buildChains(t);
    const totalArticles = t.W[0];

    // 节点 → 它落在哪条链上。悬停时要按链描边，逐次 indexOf 扫 1.1 万条链太贵。
    const chainOf = new Int32Array(t.count).fill(-1);
    for (let c = 0; c < chains.length; c++) for (const g of chains[c].idx) chainOf[g] = c;

    // 仿射：map → 世界。y 翻过来，基部落在底部。
    let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    for (let i = 0; i < t.count; i++) {
      if (t.X[i] < bx0) bx0 = t.X[i]; if (t.X[i] > bx1) bx1 = t.X[i];
      if (t.Y[i] < by0) by0 = t.Y[i]; if (t.Y[i] > by1) by1 = t.Y[i];
    }
    const spanX = Math.max(1e-6, bx1 - bx0), spanY = Math.max(1e-6, by1 - by0);
    const boxW = 1600 - 2 * WORLD_MARGIN, boxH = 900 - 2 * WORLD_MARGIN;
    const ky = boxH / spanY;
    const kx = Math.min(boxW / spanX, ky * MAX_ANISO);
    const ox = (1600 - spanX * kx) / 2 - bx0 * kx;
    const oy = (900 + spanY * ky) / 2 + by0 * ky;   // 见 emitChain 里的翻转

    // 拾取网格（世界坐标）
    const grid = new Grid(PICK_R * 2);
    const gx = new Float64Array(t.count), gy = new Float64Array(t.count);
    for (let i = 0; i < t.count; i++) {
      gx[i] = ox + t.X[i] * kx;
      gy[i] = oy - t.Y[i] * ky;
      grid.add(gx[i], gy[i], i);
    }

    // 每个学科自己的簇质心（世界坐标）—— 标签画在这里。
    // 这直接对应那条诚实边界：11 个学科的簇**互相穿插**，不是一个学科一块地。
    const lab = [];
    for (let d = 0; d < D; d++) {
      let sx = 0, sy = 0, sw = 0, n = 0;
      for (let i = 0; i < N; i++) if (cl.dom[i] === d) { const w = cl.articles[i] || 1; sx += cl.x[i] * w; sy += cl.y[i] * w; sw += w; n++; }
      if (!n) continue;
      lab.push({ d, n, x: ox + (sx / sw) * kx, y: oy - (sy / sw) * ky });
    }

    // 统计
    let tips = 0, forks = 0, maxDepth = 0, covered = 0;
    for (let i = 0; i < t.count; i++) {
      if (!t.KIDS[i].length) tips++; else if (t.KIDS[i].length > 1) forks++;
      if (t.DEPTH[i] > maxDepth) maxDepth = t.DEPTH[i];
      covered += t.OWN[i].length;
    }
    const perDom = new Array(D).fill(0);
    for (let i = 0; i < N; i++) perDom[cl.dom[i]]++;
    // 每个学科的**枝条**数（和上面的簇数不是一个量）—— 图例点一个学科时说明的是这个
    const domNodes = new Array(D).fill(0);
    for (let i = 0; i < t.count; i++) domNodes[t.DOM[i]]++;

    // 半径：r = R0·√(w / w_total)。这式子本身就是平方和守恒（w 可加），不用再归一化。
    const radOf = (i) => Math.max(RMIN, R0 * Math.sqrt(t.W[i] / totalArticles));

    // 「主枝」= 从根往下走、走到**第一次真正分叉**处的那几条。不能拿根的孩子们充数：
    // 实测根有 9 个孩子，最重的一个背着 97.4%，另外 8 个合计 2.6%（见文件头 ⑦）。
    // 沿**最重的孩子**一直往下走，走到「最重的孩子不再占绝对多数」为止 —— 那里才是主干
    // 真正分成几条主枝的地方（实测要走 33 层）。根这一层不能停：停在这里就是 1 条 97.4%
    // 加 8 条残桩。
    // 但**度数 1 的节点是主干在延续，不是分叉**：不跳过它，这条走到哪里就取决于 STEP
    // （实测 M_STEP 从 2 改到 1 时这条链长了 27 节，于是「主枝」只剩 1 条 —— 一个纯粹的
    // 伪影，跟形状无关）。所以度数为 1 就一直往下，只在「真分叉 + 最重的孩子 < 70%」处停。
    let spine = 0;
    for (let guard = 0; guard < 4096; guard++) {
      const k = t.KIDS[spine];
      if (!k.length) break;                       // 走到叶端（理论上不会）
      if (k.length === 1) { spine = k[0]; continue; }
      let best = k[0];
      for (const c of k) if (t.W[c] > t.W[best]) best = c;
      if (t.W[best] < 0.7 * t.W[spine]) break;    // 真正的分叉点
      spine = best;
    }
    // 兜底：主干一路走到叶端（或还真是一根到底）时，退回根的孩子 —— 图例总要有个说法。
    const limbs = (t.KIDS[spine].length >= 2 ? t.KIDS[spine] : t.KIDS[0])
      .slice().sort((a, b) => t.W[b] - t.W[a]);

    der = {
      t, chains, chainOf, cl, N, names, cols, topicNames, off, cIdx,
      gx, gy, grid, lab,
      ox, oy, kx, ky,
      totalArticles, tips, forks, maxDepth, covered, perDom, domNodes, radOf,
      spine, limbs,
      name: (i) => names[i] || `Discipline ${i}`,
      colour: (i) => cols[i] || '#93a1b5',
    };
    onChange();
  }

  // --------------------------------------------------------------- 拾取
  function pick(wx, wy) {
    if (!der) return null;
    const cand = der.grid.within(wx, wy, PICK_R);
    let best = -1, bd = PICK_R * PICK_R;
    for (const i of cand) {
      const dx = der.gx[i] - wx, dy = der.gy[i] - wy, d = dx * dx + dy * dy;
      if (d <= bd) { bd = d; best = i; }
    }
    return best < 0 ? null : { type: 'node', i: best };
  }

  function describe(hit) {
    if (!der || !hit) return '';
    if (hit.type === 'discipline') {
      const i = hit.i;
      return `${der.name(i)} · ${fmt(der.perDom[i])} 个簇 · ${fmt(der.domNodes[i])} 段枝条以它为主色`;
    }
    if (hit.type !== 'node') return '';
    const i = hit.i;
    const { t } = der;
    const w = t.W[i];
    const kind = t.KIDS[i].length === 0 ? '叶端' : (t.KIDS[i].length > 1 ? `分叉点（${t.KIDS[i].length} 支）` : '枝条');
    const share = der.totalArticles > 0 ? (w / der.totalArticles) * 100 : 0;
    return `${der.name(t.DOM[i])} · ${kind} · 第 ${t.DEPTH[i]} 层 · 服务 ${fmt(w)} 篇文章（${share.toFixed(1)}%）· 半径 ${der.radOf(i).toFixed(2)}px`;
  }

  const sameTarget = (a, b) => {
    const ka = !a ? 'null' : a.type + ':' + a.i;
    const kb = !b ? 'null' : b.type + ':' + b.i;
    return ka === kb;
  };

  function setHover(h) { hover = h; }
  const getHover = () => hover;
  function togglePinned(h) {
    pinned = sameTarget(pinned, h) ? null : (h || null);
    focus = pinned;
    layer = null; litLayer = null;
    onChange();
  }
  const getPinned = () => pinned;

  // 一个节点是否被点亮
  function isLit(i) {
    if (!focus) return true;
    if (focus.type === 'discipline') return der.t.DOM[i] === focus.i;
    if (focus.type === 'node') {
      // 根到该节点的路径
      let cur = focus.i;
      while (cur >= 0) { if (cur === i) return true; cur = der.t.PARENT[cur]; }
      return false;
    }
    return true;
  }

  // --------------------------------------------------------------- 绘制
  function basePath(colour) {
    const path = new Path2D();
    const { t, chains, ox, oy, kx, ky } = der;
    for (let c = 0; c < chains.length; c++) {
      if (colour != null && chains[c].colour !== colour) continue;
      emitChain(path, t, chains, c, kx, ky, ox, oy);
    }
    return path;
  }

  function paintBase(c, dim) {
    for (let d = 0; d < D; d++) {
      const path = basePath(d);
      c.fillStyle = dim ? withAlpha(der.colour(d), 0.16) : der.colour(d);
      c.fill(path);
    }
  }

  function paintLit(c) {
    if (!focus) return;
    const { t, chains, ox, oy, kx, ky } = der;
    const path = new Path2D();
    for (let ci = 0; ci < chains.length; ci++) {
      let lit = false;
      for (const g of chains[ci].idx) if (isLit(g)) { lit = true; break; }
      if (!lit) continue;
      emitChain(path, t, chains, ci, kx, ky, ox, oy);
    }
    c.fillStyle = der.colour(focus.type === 'discipline' ? focus.i : t.DOM[focus.i]);
    c.fill(path);
    const hv = hover && hover.type === 'node' ? der.chainOf[hover.i] : -1;
    if (hv >= 0 && !sameTarget(hover, focus)) {
      const p2 = new Path2D();
      emitChain(p2, t, chains, hv, kx, ky, ox, oy);
      c.fillStyle = withAlpha(INK, 0.85);
      c.fill(p2);
    }
  }

  // 离屏层：光栅化一次，之后每帧只 drawImage。
  // Mycelium 那一课是实测出来的：每帧 565,008 段直画，鼠标一动就整帧重光栅化。
  function getLayer(c, W, H, s, dim) {
    if (!makeCanvas) return null;
    const key = `${W}x${H}|${s.toFixed(4)}|${dim ? 1 : 0}|${der.chains.length}|${der.t.count}`;
    if (layer && layer.key === key) return layer.canvas;
    const cv = makeCanvas();
    cv.width = Math.max(1, Math.round(W * s));
    cv.height = Math.max(1, Math.round(H * s));
    const lc = cv.getContext('2d');
    if (lc.scale) lc.scale(s, s);
    paintBase(lc, dim);
    layer = { key, canvas: cv };
    return cv;
  }

  function getLitLayer(c, W, H, s) {
    if (!makeCanvas || !focus) return null;
    const key = `${W}x${H}|${s.toFixed(4)}|${focus.type}:${focus.i}`;
    if (litLayer && litLayer.key === key) return litLayer.canvas;
    const cv = makeCanvas();
    cv.width = Math.max(1, Math.round(W * s));
    cv.height = Math.max(1, Math.round(H * s));
    const lc = cv.getContext('2d');
    if (lc.scale) lc.scale(s, s);
    paintLit(lc);
    litLayer = { key, canvas: cv };
    return cv;
  }

  function draw(ctx, W, H, k = 1) {
    if (!der) return;
    // 过采样：跟着当前变换走（缩放后要重新光栅化，否则放大就是糊的），夹在 [1,2]。
    const dev = (() => {
      const m = ctx.getTransform && ctx.getTransform();
      return m && m.a ? Math.abs(m.a) : (k || 1);
    })();
    const s = Math.min(2, Math.max(1, dev));
    const dim = !!focus;

    const cv = getLayer(ctx, W, H, s, dim);
    if (cv) ctx.drawImage(cv, 0, 0, W, H);
    else paintBase(ctx, dim);

    const lv = getLitLayer(ctx, W, H, s);
    if (lv) ctx.drawImage(lv, 0, 0, W, H);
    else paintLit(ctx);

    drawLabels(ctx, W, H, k);
    drawHoverOverlay(ctx, k);
  }

  function drawLabels(ctx, W, H, k) {
    const inv = 1 / (k || 1);
    ctx.save();
    ctx.font = `${LABEL_FONT}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const L of der.lab) {
      if (focus && focus.type === 'discipline' && focus.i !== L.d) continue;
      const a = focus ? 0.95 : 0.72;
      ctx.save();
      ctx.translate(L.x, L.y);
      ctx.scale(inv, inv);
      ctx.fillStyle = withAlpha('#0b1017', 0.55);
      ctx.fillText(der.name(L.d), 0.6, 0.6);
      ctx.fillStyle = withAlpha(der.colour(L.d), a);
      ctx.fillText(der.name(L.d), 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  // 悬停高亮：不重建层（那是每帧都做的事），只给那一条链描边。
  // 聚焦时 paintLit 已经画过一遍了，这里不重复画。
  function drawHoverOverlay(ctx, k) {
    if (!der || focus || !hover || hover.type !== 'node') return;
    const { t, chains, ox, oy, kx, ky } = der;
    const ci = der.chainOf[hover.i];
    if (ci < 0) return;
    const p = new Path2D();
    emitChain(p, t, chains, ci, kx, ky, ox, oy);
    ctx.save();
    ctx.strokeStyle = withAlpha(INK, 0.9);
    ctx.lineWidth = 1 / (k || 1);
    ctx.stroke(p);
    ctx.restore();
  }

  // --------------------------------------------------------------- 图例
  function renderLegend(el) {
    if (!el) return;
    if (!der) { el.innerHTML = ''; return; }
    const rows = [];
    for (let d = 0; d < D; d++) {
      rows.push(`<div class="row" data-disc="${d}" style="cursor:pointer;">`
        + `<span><span class="sw" style="background:${der.colour(d)}"></span>${der.name(d)}</span>`
        + `<span class="cnt">${fmt(der.perDom[d])}</span></div>`);
    }
    // 「几条主枝」不能只报个数：实测 4 条里只有 2 条是实的，另外 2 条合计 0.04%。
    // 只写「4 条主枝」读起来像 4 条势均力敌的枝 —— 那是这张图最容易骗人的地方。
    // 而且这 4 条加起来也只有 8.5%：**权重不在枝头，在干上**，91.5% 的文章是沿主干
    // 一路长出来的绒毛背着的。这条必须写出来，否则「主枝」会被读成「文章的去处」。
    const shares = der.limbs.map((i) => der.t.W[i] / der.totalArticles);
    const solid = shares.filter((s) => s >= 0.01).length;
    const tail = shares.slice(solid).reduce((a, b) => a + b, 0);
    const shareSum = shares.reduce((a, b) => a + b, 0);
    el.innerHTML = `<div style="font-weight:600;margin-bottom:4px;color:var(--muted);">`
      + `Knowledge coral</div>`
      + `<div style="color:var(--muted);font-size:10.5px;line-height:1.45;margin-bottom:6px;">`
      + `一株，单根基部，<b>${fmt(der.limbs.length)}</b> 条主枝`
      + `（= 第一次真正分叉处的分支）；<b>${fmt(der.t.count)}</b> 段枝条服务 `
      + `<b>${fmt(der.covered)}</b> 个簇。粗度 ∝ √(子树文章数)。</div>`
      + rows.join('')
      + `<div style="color:var(--muted);font-size:10.5px;line-height:1.45;margin-top:7px;">`
      + `诚实边界 ①：<b>拓扑是算法长出来的，不是数据的父子关系</b>。真实层级是 `
      + `Domain → Cluster → Concept，但一个 cluster 只有 1–5 个概念、概念还跨簇共享，`
      + `直接画出来是张刺猬。数据决定的是位置、权重、颜色。</div>`
      + `<div style="color:var(--muted);font-size:10.5px;line-height:1.45;margin-top:6px;">`
      + `诚实边界 ②：吸引子是**聚合**过的（挨得极近的簇合成一个吸引点，权重是它们的和），`
      + `所以「一个吸引点」不等于「一个 cluster」；枝条服务多少篇文章是真的。</div>`
      + `<div style="color:var(--muted);font-size:10.5px;line-height:1.45;margin-top:6px;">`
      + `诚实边界 ③：<b>主枝不会色纯</b> —— 学科在 map 空间里互相穿插，没有哪条枝是`
      + `「一个学科的」；颜色只能来自「这条枝服务了谁」，所以相邻的枝常常是同一个颜色。</div>`
      + `<div style="color:var(--muted);font-size:10.5px;line-height:1.45;margin-top:6px;">`
      + `诚实边界 ④：主干走到第 <b>${fmt(der.t.DEPTH[der.spine])}</b> 层才真正分叉，分成 `
      + `<b>${fmt(der.limbs.length)} 条</b>，但只有 <b>${fmt(solid)} 条是实的</b>`
      + `（每条 ≥1%，最大一条占 ${(shares.length ? shares[0] * 100 : 0).toFixed(1)}%），`
      // 剩下的残桩真的接近 0（实测 0.04%），toFixed(1) 会印成「0.0%」——
      // 看起来像没算，其实是算了的。小到这个量级就多给一位。
      + `其余 ${fmt(der.limbs.length - solid)} 条合计只占 `
      + `${(tail * 100) < 0.1 ? (tail * 100).toFixed(2) : (tail * 100).toFixed(1)}%。`
      + `而这 ${fmt(der.limbs.length)} 条加起来也只有 `
      + `<b>${(shareSum * 100).toFixed(1)}%</b> —— 剩下的文章是**沿主干**一路长出来的绒毛`
      + `背着的。单根基部 ⟹ 总有一条先出生、先长大；这里画的是它真实的样子，`
      + `不是平均分好的 11 条。</div>`;
    el.querySelectorAll('[data-disc]').forEach((row) => {
      row.onclick = () => {
        const i = +row.dataset.disc;
        togglePinned(sameTarget(focus, { type: 'discipline', i }) ? null : { type: 'discipline', i });
      };
    });
  }

  // --------------------------------------------------------------- 计数
  function getCounts() {
    if (!der) return null;
    return {
      disciplineCount: D,
      clusterCount: der.N,
      conceptPairs: der.cIdx.length,
      nodeCount: der.t.count,
      chainCount: der.chains.length,
      tipCount: der.tips,
      forkCount: der.forks,
      articleTotal: der.totalArticles,
      coveredClusters: der.covered,
      unservedClusters: der.N - der.covered,
    };
  }

  return {
    setData, draw, pick, describe, renderLegend,
    setHover, getHover, togglePinned, getPinned, sameTarget,
    getCounts, drawHoverOverlay,
    // harness 出口（宿主不调）
    getModel: () => (der ? {
      X: der.t.X, Y: der.t.Y, PARENT: der.t.PARENT, KIDS: der.t.KIDS, OWN: der.t.OWN,
      W: der.t.W, DOM: der.t.DOM, DEPTH: der.t.DEPTH, count: der.t.count,
      chains: der.chains, grid: der.grid, gx: der.gx, gy: der.gy,
      ox: der.ox, oy: der.oy, kx: der.kx, ky: der.ky,
      totalArticles: der.totalArticles, N: der.N, off: der.off, cIdx: der.cIdx,
      cl: der.cl, rad: der.radOf, chainOf: der.chainOf, lab: der.lab,
    } : null),
    get diagnostics() {
      if (!der) return null;
      return {
        nodeCount: der.t.count, chainCount: der.chains.length,
        tipCount: der.tips, forkCount: der.forks, maxDepth: der.maxDepth,
        rootKids: der.t.KIDS[0].length,
        spineDepth: der.t.DEPTH[der.spine],
        limbCount: der.limbs.length,
        limbShare: der.limbs.map((i) => der.t.W[i] / der.totalArticles),
        coveredClusters: der.covered, clusterCount: der.N,
        totalArticles: der.totalArticles,
        rootRadius: der.radOf(0), minRadius: RMIN,
        aniso: der.kx / der.ky, scale: der.ky,
        cell0: CELL0, angle: ANGLE, shrink: SHRINK, maxLevel: MAXLEVEL, minRec: MINREC,
      };
    },
    get fields() {
      return der ? der.lab.map((L) => ({ i: L.d, x: L.x, y: L.y, name: der.name(L.d), colour: der.colour(L.d), clusters: L.n })) : [];
    },
    get focus() { return focus; },
  };
}
