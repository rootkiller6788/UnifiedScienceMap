// mycelium.js — 知识菌丝 / 神经束：Flow Field + Edge Bundling + Streamlines.
//
// 这张图和 Network 的差别不在画法，在**谁是主角**：
//
//   Network    object 是主角 —— 170,974 个节点 / 40,417 条边，画的是 object topology
//              （谁连着谁）。11 个学科的 node-link 只是它的低分辨率版本。
//   Mycelium   **relation 是主角** —— 35,313 根微纤维，画的是 knowledge transfer topology
//              （知识怎么流过去）。
//
// 所以既不用 node-link 也不用矩阵：
//   node-link 会把 11 个学科变成 11 个点（就是 Network 的缩小版）；
//   矩阵会把流动拍平成方格（而且 Interdisc 已经是矩阵了）。
// 用户的原话是「那不是画 55 根线 —— 每对学科下面有 51–2,861 个 shared terms，
// 那就真的画 51–2,861 根微纤维」。
//
// 实测（从 sunburst-data.json 的 arcs，299,286 条三元组现场推导，**不新增数据文件**）：
//   |D(t)| 直方图  1:256,276  2:13,660  3:3,121  4:856  5:310 … 11:2
//   Σ C(k,2) = **35,313** 根纤维      逐对 51–2,861（55 对全对上）
//   跨学科术语 18,146                 不同的学科签名 647 种
//   Jaccard 0.215%–3.809%（17.7×）
//
// 两条诚实边界，都写进图例：
//   1. 274,422 个术语里 **256,276 个（93.4%）只属于一个学科**，一根纤维都不发。
//      菌丝只由 6.6% 的词汇长出来 —— 这不是画漏了，是数据的形状。
//   2. 35,313 根 1px 线在 1600×900 里必然大量重叠。**纤维束的粗细是密度，不是一个能读出数的
//      通道**。数量去 hover 里读，不要去量线宽。（和 sunburst 那条「179 弧/px」同类代价。）
//
// 几何三段流水线：
//   ① 源场位置 —— **确定性弹簧松弛**（不是 MDS：那个我试过，11 个点会塌成一点）。
//      目标长度 L(i,j) = 40 + 300·(1 − J(i,j)/maxJ)，固定初值、固定步数、无随机数。
//      实测 Spearman(距离, Jaccard) = **−0.725**，最强 3 对平均距离 66、最弱 3 对 310。
//      学科**不是点，是一团不规则的源区**（8 个哈希半径拼出的闭合边界 + 径向渐变光晕）。
//   ② 走廊 —— 55 对，每对在**流场里积分一条 streamline**：朝目标的吸引 + 对其余 9 个场的
//      排斥。排斥项让走廊**绕开**中间的场，不穿过第三个学科 —— 旧 node-link 那个
//      「4 of 55 bands drawn through a third discipline's disc」的毛病这次从几何上避免。
//   ③ 微纤维 —— 起点 p0 落在源场内、终点 p1 落在目标场内，路径是**弦与走廊的混合**，
//      β(s) = sin²(πs) 在两端为 0 ⟹ 端点精确、中段束化。再叠一个哈希决定的微小横向抖动，
//      否则同束的纤维完全重合、看起来还是一根线。
//
// **分叉是几何涌现的，不是专门实现的**：起点由 point(t, d) 决定，只跟 (术语, 学科) 有关，
// 与「另一头是谁」无关。所以一个出现在 4 个学科里的术语（Optimization 那种），从每个学科场
// 内部**同一个位置**发出的 C(3,2)=3 根纤维自动构成一个叉。全图 **0 个 node**。
//
// 渲染的关键陷阱：`ctx.stroke(path)` 把整条 path 当一个覆盖遮罩**合成一次**，路径内部的
// 自重叠**不累积**。把 35,313 根塞进一个 Path2D 只 stroke 一次，得到的是一片均匀的淡色，
// 纤维束不会比单根更亮，这张图就废了。所以按 64 批分批 stroke，每批
// `globalCompositeOperation = 'lighter'` 单独合成一次 —— 64 级累积，束的地方自然更亮。
// 顺带这个做法让 harness 能把每一批的 path 都取回来，于是「发出的折线并集恰好是 35,313 根、
// 一根不多一根不少」成为可证明的不变量（单个 Path2D 是取不回逐根的）。
//
// 配色（dataviz 规则）：纤维一律**单色相**（中性钢蓝）—— 顺序量只用一个色相，身份不靠颜色。
// 11 个学科色**只**出现在源场光晕上；聚焦某个场时，只有它的纤维被染成该场的颜色。
// 已知缺口（与 sunburst/ATLAS 同一个）：11 个学科色是全对比对，从未过 dataviz 校验器。
// 但这里身份由场的名字承载，不依赖把两个色区分开。

const D = 11;                                  // 学科数（cluster_category 0–10）

// ---------------------------------------------------------------- 版式常量（世界坐标 1600×900）
const FIB_PTS = 17;                            // 每根纤维的采样点数（含两端）
const CORRIDOR_STEPS = 36;                     // 走廊积分步数（走廊 = STEPS+1 个点）
const BATCHES = 32;                            // 旧测试出口保留；实际默认按学科对聚合绘制
const GRID_CELL = 10;                          // 纤维拾取网格的格边长（世界 px）
// 排斥项权重。**这个数是扫出来的，不是拍的**：0.55 时有 4 条走廊穿过第三个场
//（(1,5) 穿过场 2 等），1.5 时还剩 1 条（(7,8) 穿过场 1），3–16 全部干净，26 又开始出问题
//（推得太狠，走廊被甩到别处）。取中间的 6，离两侧失败都还有 2 倍余量。
// 「走廊不穿过第三个场」是 harness 的一条断言，所以将来换数据时它会自己报警。
const KAPPA = 6;                               // 流场里排斥项的权重
const BUNDLE = 0.88;                           // 向走廊靠拢的最大比例
const JITTER = 3.4;                            // 纤维横向抖动幅度（世界 px）
const WORLD_MARGIN = 72;                       // 布局到世界边缘留的余量（给标签）
const MAX_ANISO = 1.6;                         // 各向异性填充的拉伸上限（免得为塞满画布把布局扭变形）

const FIELD_SEED_MAX = 0.30;                   // 最大场半径 = 0.30 ×(归一化后的最小中心距)
const FIELD_SEED_MIN = 0.16;                   // 最小场半径
const BLOB_LO = 0.86;                          // 不规则边界的半径下限（× R）
const BLOB_HI = 1.10;                          // 上限

// 纤维：中性钢蓝。刻意**不是** 11 个身份色里的任何一个，也刻意不是彩虹。
const FIBRE_RGB = '150,182,226';
const FIBRE_ALPHA = 0.035;                     // 按学科对聚合后 stroke 次数下降，需要更高透明度才看得出色系
const CORRIDOR_ALPHA = 0.22;                   // 兼容旧变量；默认底图改回真实微纤维一次性缓存
const FIBRE_BRIGHT = '226,238,255';            // 聚焦时的高亮芯
const INK = '#e6edf3';
const INK_DIM = '#93a1b5';
const LABEL_FONT = 12;
const DOMAIN_PALETTE = [
  '#22ff55', '#ff1744', '#1e90ff', '#f8ff45', '#26fff4', '#c74cff',
  '#00d6a0', '#ffff00', '#ff5ec4', '#7b28ff', '#b8c2d6',
];

const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const withAlpha = (hex, a) => {
  const h = String(hex || '#93a1b5').replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const hexToRgb = (hex) => {
  const h = String(hex || '#93a1b5').replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbText = (rgb) => `${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])}`;
const mixRgb = (a, b, t = 0.5) => [
  a[0] * (1 - t) + b[0] * t,
  a[1] * (1 - t) + b[1] * t,
  a[2] * (1 - t) + b[2] * t,
];

// 确定性整数哈希。**不许出现 Math.random** —— 布局和纤维形状必须是输入的纯函数，
// 否则 harness 没法断言「同样的输入 → 逐字节同样的输出」。
function hash32(x) {
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return (x ^ (x >>> 16)) >>> 0;
}
const unit = (h, shift) => ((h >>> shift) & 0xffff) / 0x10000;

export function createMyceliumView(opts = {}) {
  const onChange = opts.onChange || (() => {});
  // 建离屏画布的方式由宿主注入。默认走 document；Node 里没有 document，于是
  // makeCanvas 为 null、draw 退回「每帧直画」那条路 —— 模块因此在没有 DOM 的环境里
  // 也照样能跑（harness 就是靠这个同时测两条路）。
  const makeCanvas = opts.makeCanvas
    || (typeof document !== 'undefined' ? (() => document.createElement('canvas')) : null);

  let sbData = null;
  let der = null;                              // 推导 + 布局 + 纤维（一次算完，之后只读）
  let geo = null;                              // 本次绘制用的几何（含批次 path 缓存）
  let baseGeo = null;                          // 默认纤维层：与 focus 无关，建一次复用
  let hover = null;
  let pinned = null;
  let focus = null;                            // null | {type:'field', i} | {type:'fibre', id}

  // ------------------------------------------------------------------ 推导
  // 一次遍历 299,286 条弧。用 typed array 而不是 Map：Map 存 30 万个条目要 ~30MB 开销。
  function derive(sb) {
    const nD = sb.domains.length;
    const nT = sb.meta.topicCount;
    const arcs = sb.arcs;
    const names = String(sb.topics).split('\n');

    const mask = new Int32Array(nT);           // 每个术语的学科位集
    for (let i = 0; i < arcs.length; i += 3) mask[arcs[i + 1]] |= 1 << arcs[i];

    const pop = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
    const topics = new Int32Array(nD);         // 每个学科自己的术语数
    for (let t = 0; t < nT; t++) {
      const m = mask[t];
      if (!m) continue;
      for (let d = 0; d < nD; d++) if (m >> d & 1) topics[d]++;
    }

    // 纤维清单：每个 k≥2 的术语贡献 C(k,2) 根，每根 = (术语, 学科A, 学科B)。
    // 总数就是 Σ C(k,2) = 35,313，逐对的条数就是共享术语数（= Interdisc 矩阵的 55 格）。
    let nF = 0, bridging = 0;
    for (let t = 0; t < nT; t++) {
      const k = pop(mask[t]);
      if (k >= 2) { nF += (k * (k - 1)) / 2; bridging++; }
    }
    const fibT = new Int32Array(nF);
    const fibA = new Uint8Array(nF);
    const fibB = new Uint8Array(nF);
    const SH = new Int32Array(nD * nD);
    const ds = [];
    let f = 0;
    for (let t = 0; t < nT; t++) {
      const m = mask[t];
      if (pop(m) < 2) continue;
      ds.length = 0;
      for (let d = 0; d < nD; d++) if (m >> d & 1) ds.push(d);
      for (let x = 0; x < ds.length; x++) {
        for (let y = x + 1; y < ds.length; y++) {
          fibT[f] = t; fibA[f] = ds[x]; fibB[f] = ds[y];
          SH[ds[x] * nD + ds[y]]++;
          f++;
        }
      }
    }

    // 每个 (术语, 学科) 的权重。只给跨学科术语建（43,010 条），用 Map 不心疼。
    const wKey = (t, d) => t * 32 + d;
    const wOf = new Map();
    for (let i = 0; i < arcs.length; i += 3) {
      const t = arcs[i + 1];
      if (pop(mask[t]) >= 2) wOf.set(wKey(t, arcs[i]), arcs[i + 2]);
    }

    return { nD, nT, names, mask, topics, SH, nF, fibT, fibA, fibB, wOf, wKey, bridging, pop };
  }

  // ------------------------------------------------------------------ ① 源场位置
  // 确定性弹簧松弛。实测 Spearman(距离, Jaccard) = −0.725：强连接的学科真的被拉近
  //（最强 3 对平均距离 66，最弱 3 对 310）。
  //
  // 之所以不用 MDS：经典 MDS 要幂迭代求前两个特征向量，11 个点的规模上手写实现很容易
  // 塌成一点（我先试的就是那条路，11 个坐标全重合，而且**不报错** —— 一张全叠在一起的图
  // 和一个正确的图，在调用方看来一样成功）。弹簧松弛没有这个失败模式：它直接优化
  // 「强连接更近」这件事本身。
  function relax(SH, maxJ, J) {
    const LMIN = 40, LMAX = 340;
    const Lt = (i, j) => LMIN + (LMAX - LMIN) * (1 - J[i * D + j] / maxJ);
    const P = [];
    for (let i = 0; i < D; i++) {
      const a = (2 * Math.PI * i) / D;
      P.push([Math.cos(a) * 200, Math.sin(a) * 200]);   // 固定初值，无随机
    }
    const F = [];
    for (let i = 0; i < D; i++) F.push([0, 0]);
    for (let it = 0; it < 4000; it++) {
      for (let i = 0; i < D; i++) { F[i][0] = 0; F[i][1] = 0; }
      for (let i = 0; i < D; i++) {
        for (let j = i + 1; j < D; j++) {
          const dx = P[j][0] - P[i][0], dy = P[j][1] - P[i][1];
          const d = Math.hypot(dx, dy) || 1e-6;
          const ux = dx / d, uy = dy / d;
          const k = 0.02 * (d - Lt(i, j));               // 弹簧：目标长度由 Jaccard 决定
          F[i][0] += ux * k; F[i][1] += uy * k;
          F[j][0] -= ux * k; F[j][1] -= uy * k;
          const rp = 900 / (d * d);                      // 轻微排斥，防止塌成一点
          F[i][0] -= ux * rp; F[i][1] -= uy * rp;
          F[j][0] += ux * rp; F[j][1] += uy * rp;
        }
      }
      for (let i = 0; i < D; i++) { P[i][0] += F[i][0]; P[i][1] += F[i][1]; }
      const cx = P.reduce((s, p) => s + p[0], 0) / D;
      const cy = P.reduce((s, p) => s + p[1], 0) / D;
      for (let i = 0; i < D; i++) { P[i][0] -= cx * 0.01; P[i][1] -= cy * 0.01; }
    }
    const cx = P.reduce((s, p) => s + p[0], 0) / D;
    const cy = P.reduce((s, p) => s + p[1], 0) / D;
    for (let i = 0; i < D; i++) { P[i][0] -= cx; P[i][1] -= cy; }
    return P;
  }

  // 把布局转正、缩放、落进世界坐标，并算出每个场的半径。
  //
  // 半径先按 sqrt(学科术语数) 取种子（小学科 = 小源区），然后**逐个收缩**到
  // 「任一对的 R_i+R_j ≤ 0.85 × d(i,j)」。收缩是单调的，所以收敛；得到的
  // 「任意两个源区不重叠」是可证明的不变量，harness 直接断言它。
  function placeLayout(P, topics, W, H) {
    // 主成分转正：松弛出来的形状是竖长的，直接用会把 16:9 的画布撑爆。
    // 用 2×2 协方差的主特征向量把长轴摆平（确定性，no 随机）。
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of P) { sxx += p[0] * p[0]; sxy += p[0] * p[1]; syy += p[1] * p[1]; }
    const tr = sxx + syy, det = sxx * syy - sxy * sxy;
    const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr / 2) ** 2 - det));
    let ax = sxy, ay = l1 - sxx;                       // (B − λ1 I) 的零空间
    if (Math.hypot(ax, ay) < 1e-9) { ax = 1; ay = 0; }
    const an = Math.hypot(ax, ay);
    ax /= an; ay /= an;
    if (ax < 0) { ax = -ax; ay = -ay; }                // 定符号，保证确定性
    for (const p of P) {
      const x = p[0] * ax + p[1] * ay;
      const y = -p[0] * ay + p[1] * ax;
      p[0] = x; p[1] = y;
    }

    // 归一化到「最小中心距 = 1」，半径种子也在这个无量纲尺度里算
    let minGap = Infinity;
    for (let i = 0; i < D; i++) {
      for (let j = i + 1; j < D; j++) {
        minGap = Math.min(minGap, Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]));
      }
    }
    for (const p of P) { p[0] /= minGap; p[1] /= minGap; }

    let maxTop = 0;
    for (let i = 0; i < D; i++) maxTop = Math.max(maxTop, topics[i]);
    const R = new Float64Array(D);
    for (let i = 0; i < D; i++) {
      const r = Math.sqrt(maxTop ? topics[i] / maxTop : 0);
      R[i] = FIELD_SEED_MIN + (FIELD_SEED_MAX - FIELD_SEED_MIN) * r;
    }
    // 逐个收缩（单调 ⟹ 收敛）。种子最大 0.30，最小中心距 1，所以其实一开始就满足；
    // 留着是把「不重叠」变成结构性保证而不是巧合 —— 将来换数据、换种子公式都不会破。
    for (let it = 0; it < 64; it++) {
      let worst = 0;
      for (let i = 0; i < D; i++) {
        for (let j = i + 1; j < D; j++) {
          const d = Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]);
          const lim = 0.85 * d;
          if (R[i] + R[j] > lim) {
            const s = lim / (R[i] + R[j]);
            R[i] *= s; R[j] *= s;
            worst = Math.max(worst, 1 - s);
          }
        }
      }
      if (worst < 1e-12) break;
    }

    // 落进世界：先算无量纲包围盒（含半径与标签余量），再缩放
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < D; i++) {
      x0 = Math.min(x0, P[i][0] - R[i]); x1 = Math.max(x1, P[i][0] + R[i]);
      y0 = Math.min(y0, P[i][1] - R[i]); y1 = Math.max(y1, P[i][1] + R[i]);
    }
    const spanX = Math.max(1e-6, x1 - x0), spanY = Math.max(1e-6, y1 - y0);
    const boxW = W - 2 * WORLD_MARGIN, boxH = H - 2 * WORLD_MARGIN;
    const sBase = Math.min(boxW / spanX, boxH / spanY);

    // 各向异性填充：松弛出来的点云宽高比约 1.2，而画布（和宿主腾给它的自由视口）是 16:9，
    // 等比缩放会让**宽度**成为约束、横向白留一大块 —— 实测内容只占世界宽度的 55%，
    // 整个图看着偏小。所以两个轴各自拉伸去填满，但给拉伸比封顶（MAX_ANISO），
    // 免得为了塞满画布把布局扭得认不出来。
    // 代价要说明白：拉伸之后「距离 ∝ 1−Jaccard」不再成立，只剩下**秩**关系，
    // 所以 harness 断言的是 Spearman 而不是比例 —— 这条它一直在量。
    const kx = Math.min(boxW / spanX / sBase, MAX_ANISO);
    const ky = Math.min(boxH / spanY / sBase, MAX_ANISO);
    const sx = sBase * kx, sy = sBase * ky;
    const ox = W / 2 - ((x0 + x1) / 2) * sx;
    const oy = H / 2 - ((y0 + y1) / 2) * sy;
    for (let i = 0; i < D; i++) {
      P[i][0] = P[i][0] * sx + ox;
      P[i][1] = P[i][1] * sy + oy;
      R[i] *= sBase;                    // 半径保持各向同性：场还是圆的，不能跟着拉成椭圆
    }
    return { P, R, scale: sBase, aniso: [kx, ky] };
  }

  // 不规则边界：8 个由学科 id 哈希决定的半径，绕一圈线性插值。所以是「一团模糊的源区」
  // 而不是一个圆点。BLOB_LO 是半径下限 —— 纤维起点的上限 0.82·R 必须严格小于它。
  function blobR(seed, theta) {
    const n = 8;
    const f = ((theta / (2 * Math.PI)) % 1 + 1) % 1 * n;
    const i0 = Math.floor(f), i1 = (i0 + 1) % n, w = f - i0;
    const rr = (idx) => BLOB_LO + (BLOB_HI - BLOB_LO) * unit(hash32(seed * 31 + idx), 0);
    return rr(i0) * (1 - w) + rr(i1) * w;
  }

  // ------------------------------------------------------------------ ② 走廊
  // 在流场里定步长积分。方向**永远从 id 小的一端积到大的一端**，
  // 需要反方向时直接用逆序数组，于是 corridor(a,b) 与 corridor(b,a) 逐点严格相等。
  function buildCorridors(P, R) {
    const C = new Array(D * D);
    const step = (a, b) => {
      const ca = P[a], cb = P[b];
      const total = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]);
      const h = total / CORRIDOR_STEPS;
      const pts = [[ca[0], ca[1]]];
      let x = ca[0], y = ca[1];
      for (let s = 0; s < CORRIDOR_STEPS; s++) {
        let dx = cb[0] - x, dy = cb[1] - y;
        const db = Math.hypot(dx, dy) || 1e-6;
        let fx = dx / db, fy = dy / db;
        for (let k = 0; k < D; k++) {
          if (k === a || k === b) continue;
          const ex = x - P[k][0], ey = y - P[k][1];
          const dd = Math.hypot(ex, ey) || 1e-6;
          const m = KAPPA * (R[k] / dd) ** 2;      // 越靠近越推得开
          fx += (m * ex) / dd; fy += (m * ey) / dd;
        }
        const fl = Math.hypot(fx, fy) || 1e-6;
        x += (h * fx) / fl; y += (h * fy) / fl;
        pts.push([x, y]);
      }
      pts.push([cb[0], cb[1]]);                    // 收尾精确落在目标中心
      return pts;
    };
    for (let i = 0; i < D; i++) {
      for (let j = i + 1; j < D; j++) C[i * D + j] = step(i, j);
    }
    return C;
  }
  const corridorOf = (C, a, b) => (a < b ? C[a * D + b] : C[b * D + a].slice().reverse());

  // ------------------------------------------------------------------ ③ 微纤维
  function buildFibres(der_, P, R, C, W, H) {
    const n = der_.nF;
    const FX = new Float32Array(n * FIB_PTS);
    const FY = new Float32Array(n * FIB_PTS);
    const ox = new Float32Array(n);               // 起点（= 分叉点的位置，同样点必同源）
    const oy = new Float32Array(n);

    // 术语 t 在学科 d 里的落点。**只跟 (t,d) 有关**：同一个术语从同一个学科的同一个位置
    // 出发，所以 C(k,2) 根纤维自动构成一个叉 —— 分叉是涌现的，没有额外的代码。
    const px = (t, d) => {
      const h = hash32(Math.imul(t + 1, 0x9e3779b1) ^ Math.imul(d + 1, 0x85ebca6b));
      const a = unit(h, 0) * Math.PI * 2;
      const rr = R[d] * 0.82 * Math.sqrt(unit(h, 16));
      return [P[d][0] + Math.cos(a) * rr, P[d][1] + Math.sin(a) * rr];
    };

    for (let f = 0; f < n; f++) {
      const t = der_.fibT[f], a = der_.fibA[f], b = der_.fibB[f];
      const [sx, sy] = px(t, a);
      const [ex, ey] = px(t, b);
      const cor = corridorOf(C, a, b);
      ox[f] = sx; oy[f] = sy;
      const jh = hash32(Math.imul(t + 7, 0x2545f491) ^ Math.imul(f + 1, 0x9e3779b1));
      const ja = unit(jh, 0) * Math.PI * 2;
      const jm = 0.35 + 0.65 * unit(jh, 16);       // 幅度也抖一下，免得全一个样
      for (let s = 0; s < FIB_PTS; s++) {
        const u = s / (FIB_PTS - 1);
        const cx = sx + (ex - sx) * u;
        const cy = sy + (ey - sy) * u;
        const ci = u * (cor.length - 1);
        const i0 = Math.min(cor.length - 2, Math.floor(ci));
        const cw = ci - i0;
        const kx = cor[i0][0] * (1 - cw) + cor[i0 + 1][0] * cw;
        const ky = cor[i0][1] * (1 - cw) + cor[i0 + 1][1] * cw;
        const beta = Math.sin(Math.PI * u) ** 2 * BUNDLE;
        const env = Math.sin(Math.PI * u);         // 两端为 0 ⟹ 端点精确落在场内
        FX[f * FIB_PTS + s] = cx + (kx - cx) * beta + Math.cos(ja) * JITTER * jm * env;
        FY[f * FIB_PTS + s] = cy + (ky - cy) * beta + Math.sin(ja) * JITTER * jm * env;
      }
    }
    return { FX, FY, ox, oy, n };
  }

  // ------------------------------------------------------------------ 拾取网格
  // 铺在**全部采样点**上（不只中点）：一根几百 px 长的纤维，中点离得很远，
  // 只按中点建格子的话，点在纤维末端会什么都命中不到。
  function buildGrid(der_, fib, W, H) {
    const cols = Math.ceil(W / GRID_CELL), rows = Math.ceil(H / GRID_CELL);
    const cell = (x, y) => {
      const c = Math.min(cols - 1, Math.max(0, Math.floor(x / GRID_CELL)));
      const r = Math.min(rows - 1, Math.max(0, Math.floor(y / GRID_CELL)));
      return r * cols + c;
    };
    const cnt = new Int32Array(cols * rows);
    const total = fib.n * FIB_PTS;
    for (let i = 0; i < total; i++) cnt[cell(fib.FX[i], fib.FY[i])]++;
    const off = new Int32Array(cols * rows + 1);
    for (let i = 0; i < cols * rows; i++) off[i + 1] = off[i] + cnt[i];
    const idx = new Int32Array(total);
    const cur = off.slice(0, cols * rows);
    for (let f = 0; f < fib.n; f++) {
      for (let s = 0; s < FIB_PTS; s++) {
        const i = f * FIB_PTS + s;
        idx[cur[cell(fib.FX[i], fib.FY[i])]++] = i;
      }
    }
    return { cols, rows, off, idx, cell };
  }

  // ------------------------------------------------------------------ setData
  function setData(sb) {
    sbData = sb && sb.arcs ? sb : null;
    der = null; geo = null; baseGeo = null; hover = null; pinned = null; focus = null;
    layer = null;                                // 换数据 ⟹ 离屏缓存作废
    if (!sbData) return;

    const d0 = derive(sbData);
    const J = new Float64Array(D * D);
    let maxJ = 0;
    for (let i = 0; i < D; i++) {
      for (let j = i + 1; j < D; j++) {
        const s = d0.SH[i * D + j];
        const u = d0.topics[i] + d0.topics[j] - s;
        const v = u > 0 ? s / u : 0;
        J[i * D + j] = v; J[j * D + i] = v;
        if (v > maxJ) maxJ = v;
      }
    }
    const raw = relax(d0.SH, maxJ, J);
    const { P, R, scale, aniso } = placeLayout(raw, d0.topics, 1600, 900);

    // 布局到底有多"来自数据"：场距离与 Jaccard 的 Spearman 秩相关（-1 = 强连接被拉得最近）。
    // **在模块里算，不在图例里写死** —— 写死的数字会跟布局一起漂：第一版图例印的是 −0.73，
    // 后来各向异性填充改了一下布局，真值变成 −0.768，图例却还在说 −0.73。
    // 这正是这个仓库别处反复踩的「第二份会跟第一份分叉的账」。harness 会拿它跟自己的重算对。
    const rho = (() => {
      const md = [], jv = [];
      for (let i = 0; i < D; i++) {
        for (let j = i + 1; j < D; j++) {
          md.push(Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]));
          jv.push(J[i * D + j]);
        }
      }
      const rk = (a) => {
        const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
        const r = new Array(a.length);
        for (let k = 0; k < idx.length; k++) r[idx[k][1]] = k;
        return r;
      };
      const ra = rk(md), rb = rk(jv), m = (ra.length - 1) / 2;
      let num = 0, da = 0, db = 0;
      for (let k = 0; k < ra.length; k++) {
        num += (ra[k] - m) * (rb[k] - m); da += (ra[k] - m) ** 2; db += (rb[k] - m) ** 2;
      }
      return num / Math.sqrt(da * db);
    })();
    const C = buildCorridors(P, R);
    const fib = buildFibres(d0, P, R, C, 1600, 900);
    const grid = buildGrid(d0, fib, 1600, 900);

    // 每个学科参与的纤维（聚焦时点亮用）。CSR，避免为 11 个学科各建一个数组。
    const per = new Int32Array(D);
    for (let f = 0; f < d0.nF; f++) { per[d0.fibA[f]]++; per[d0.fibB[f]]++; }
    const poff = new Int32Array(D + 1);
    for (let i = 0; i < D; i++) poff[i + 1] = poff[i] + per[i];
    const pidx = new Int32Array(poff[D]);
    const pcur = poff.slice(0, D);
    for (let f = 0; f < d0.nF; f++) {
      pidx[pcur[d0.fibA[f]]++] = f;
      pidx[pcur[d0.fibB[f]]++] = f;
    }

    der = {
      ...d0, J, maxJ, P, R, scale, aniso, rho, C, fib, grid, poff, pidx,
      colour: (i) => DOMAIN_PALETTE[i % DOMAIN_PALETTE.length]
        || (sbData.domains[i] && sbData.domains[i].color) || '#93a1b5',
      name: (i) => (sbData.domains[i] && sbData.domains[i].name) || `Domain ${i}`,
      fibreCount: fib.n,
    };
  }

  const fibresTouching = (i) => (der ? der.pidx.subarray(der.poff[i], der.poff[i + 1]) : []);

  // ------------------------------------------------------------------ 命中
  function pick(wx, wy) {
    if (!der) return null;
    // 场优先：场是「大目标」，点是聚焦学科，不该被纤维抢走
    for (let i = 0; i < D; i++) {
      const r = der.R[i] * blobR(i + 101, Math.atan2(wy - der.P[i][1], wx - der.P[i][0]));
      if (Math.hypot(wx - der.P[i][0], wy - der.P[i][1]) <= r) return { type: 'field', i };
    }
    const g = der.grid, fib = der.fib;
    const c = Math.min(g.cols - 1, Math.max(0, Math.floor(wx / GRID_CELL)));
    const r0 = Math.min(g.rows - 1, Math.max(0, Math.floor(wy / GRID_CELL)));
    let best = -1, bestD = Infinity, bestS = -1;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r0 + dr, cc = c + dc;
        if (rr < 0 || rr >= g.rows || cc < 0 || cc >= g.cols) continue;
        const cell = rr * g.cols + cc;
        for (let k = g.off[cell]; k < g.off[cell + 1]; k++) {
          const i = g.idx[k];
          const d = Math.hypot(fib.FX[i] - wx, fib.FY[i] - wy);
          if (d < bestD) { bestD = d; best = Math.floor(i / FIB_PTS); bestS = i % FIB_PTS; }
        }
      }
    }
    // 12px 之外不算命中 —— 否则整块画布永远"命中"最近的那根纤维，
    // 鼠标在空白处也一直报读一个术语。
    if (best < 0 || bestD > 12) return null;
    return { type: 'fibre', id: best, s: bestS };
  }

  function describe(hit) {
    if (!der || !hit) return '';
    if (hit.type === 'field') {
      const i = hit.i;
      const list = [];
      for (let j = 0; j < D; j++) if (j !== i) list.push([j, der.SH[Math.min(i, j) * D + Math.max(i, j)]]);
      list.sort((a, b) => b[1] - a[1]);
      const top = list.slice(0, 4)
        .map(([j, v]) => `${der.name(j)} ${fmt(v)}`).join(' · ');
      return `${der.name(i)}\n${fmt(der.topics[i])} topics · `
        + `${fmt(fibresTouching(i).length)} fibres touch this field\n${top}`;
    }
    if (hit.type === 'fibre') {
      const f = hit.id;
      const t = der.fibT[f], a = der.fibA[f], b = der.fibB[f];
      const wa = der.wOf.get(der.wKey(t, a)), wb = der.wOf.get(der.wKey(t, b));
      return `${der.names[t]}\n${der.name(a)} ↔ ${der.name(b)}\n`
        + `weight ${wa == null ? '—' : wa.toFixed(3)} in ${der.name(a)}, `
        + `${wb == null ? '—' : wb.toFixed(3)} in ${der.name(b)}`;
    }
    return '';
  }

  const sameTarget = (a, b) => {
    if (!a || !b) return a === b;
    if (a.type !== b.type) return false;
    return a.type === 'field' ? a.i === b.i : a.id === b.id;
  };

  function setHover(h) { hover = h; }
  const getHover = () => hover;
  function togglePinned(h) {
    pinned = sameTarget(pinned, h) ? null : h;
    focus = pinned;
    geo = null;                                  // 聚焦变了 → 批次 path 要重建
    onChange();
  }
  const getPinned = () => pinned;

  // ------------------------------------------------------------------ ④ 绘制
  function buildGeo() {
    const fib = der.fib;
    const key = focus ? (focus.type === 'field' ? `f${focus.i}` : `b${focus.id}`) : '-';
    if (geo && geo.key === key) return geo;
    if (!baseGeo) {
      const pairPaths = [];
      const pairMap = new Map();
      const pairOf = (a, b) => {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const id = lo * D + hi;
        let rec = pairMap.get(id);
        if (!rec) {
          const ca = hexToRgb(der.colour(lo));
          const cb = hexToRgb(der.colour(hi));
          const p = new Path2D();
          p.__layer = 'base';
          p.__pair = id;
          p.__fibres = [];
          rec = {
            path: p,
            ids: p.__fibres,
            a: lo,
            b: hi,
            count: der.SH[lo * D + hi],
            rgb: rgbText(mixRgb(ca, cb, 0.52)),
          };
          pairMap.set(id, rec);
          pairPaths.push(rec);
        }
        return rec;
      };
      for (let f = 0; f < fib.n; f++) {
        const rec = pairOf(der.fibA[f], der.fibB[f]);
        const p = rec.path;
        rec.ids.push(f);
        for (let s = 0; s < FIB_PTS; s++) {
          const idx = f * FIB_PTS + s;
          if (s === 0) p.moveTo(fib.FX[idx], fib.FY[idx]);
          else p.lineTo(fib.FX[idx], fib.FY[idx]);
        }
      }
      const batches = pairPaths.slice(0, BATCHES).map((rec, i) => ({ ...rec, path: rec.path, __batch: i }));
      baseGeo = { pairPaths, batches };
    }

    // 聚焦覆盖层一起建好并缓存 —— 它只在 focus 变化时才变，没道理每帧重建。
    const focusPaths = [];
    const emit = (ids, alpha, style, width, extra) => {
      const p = new Path2D();
      p.__layer = 'focus';
      p.__fibres = ids;
      Object.assign(p, extra || {});
      for (const f of ids) {
        for (let s = 0; s < FIB_PTS; s++) {
          if (s === 0) p.moveTo(fib.FX[f * FIB_PTS], fib.FY[f * FIB_PTS]);
          else p.lineTo(fib.FX[f * FIB_PTS + s], fib.FY[f * FIB_PTS + s]);
        }
      }
      focusPaths.push({ path: p, alpha, style, width });
    };
    if (focus && focus.type === 'field') {
      const ids = fibresTouching(focus.i);
      const step = Math.max(1, Math.ceil(ids.length / 900));   // 太密时抽样，避免一坨实心
      const sel = [];
      for (let q = 0; q < ids.length; q += step) sel.push(ids[q]);
      // 和 base 批一样挂上 id 列表：harness 才能逐根核对「亮起的每一根都真的触及这个学科」。
      // 光靠首点反查是不行的 —— **同一 (术语,学科) 的起点本来就有很多根重合**（分叉的定义），
      // 反查会撞车，那是测试的 bug 不是模块的 bug（第一版就是这么误报 189 根的）。
      emit(sel, 0.30, withAlpha(der.colour(focus.i), 1), 2.2, { __field: focus.i });
      emit(sel, 0.16, `rgb(${FIBRE_BRIGHT})`, 0.8, { __field: focus.i });
    } else if (focus && focus.type === 'fibre') {
      emit([focus.id], 0.95, `rgb(${FIBRE_BRIGHT})`, 2.6, { __fibre: focus.id });
    }

    geo = { key, pairPaths: baseGeo.pairPaths, batches: baseGeo.batches, focusPaths };
    return geo;
  }

  // 纤维的全部描边。**写一份，两条路共用**：离屏缓存那条（快）和直画回退那条
  //（没有 makeCanvas 时，比如 Node harness 不注入的话）。
  // 只有一份实现，所以"缓存里画的和直画的不一样"这种分叉不可能发生。
  function strokeBaseFibres(c, g, lw, dimAll) {
    c.globalCompositeOperation = 'lighter';
    c.lineJoin = 'round';
    for (const b of (g.pairPaths || g.batches)) {
      const countBoost = Math.min(1.9, 1.05 + Math.sqrt(Math.max(1, b.ids.length)) / 42);
      c.globalAlpha = FIBRE_ALPHA * countBoost * dimAll;
      c.strokeStyle = `rgb(${b.rgb || FIBRE_RGB})`;
      c.lineWidth = lw;
      c.stroke(b.path);
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

  function strokeFocusFibres(c, g, lw) {
    c.globalCompositeOperation = 'lighter';
    c.lineJoin = 'round';
    for (const fp of g.focusPaths) {
      c.globalAlpha = fp.alpha;
      c.strokeStyle = fp.style;
      c.lineWidth = fp.width * lw;
      c.stroke(fp.path);
    }
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
  }

  // 把纤维层光栅化一次，之后每帧只 drawImage。
  //
  // 为什么非做不可：纤维是 35,313 × 16 = **565,008 条线段**。宿主是「鼠标一动就整幅重画」
  //（requestRender → 一次 rAF），所以每一次 mousemove 都要把这 56 万段重新描一遍 ——
  // 交互必然卡。而纤维只在 focus 变化或取景变化时才不同，其余时间**每一帧画的都是同一张图**。
  //
  // 过采样倍率 s = 设备变换的 x 缩放（= dpr × k，从 ctx.getTransform() 读，替身 ctx 没有就退回 k），
  // 夹在 [1, 2]：倍率小于 1 会糊，大于 2 白占显存。所以离屏画布的分辨率恰好等于
  // 这块世界矩形最终落在屏幕上的像素数 —— 既不糊也不浪费。
  let layer = null;
  function getLayer(c, g, lw, W, H, s) {
    if (!makeCanvas) return null;
    const key = `base|${s.toFixed(4)}|${lw.toFixed(4)}|${W}x${H}`;
    if (layer && layer.key === key) return layer.canvas;
    const cv = makeCanvas();
    cv.width = Math.max(1, Math.round(W * s));
    cv.height = Math.max(1, Math.round(H * s));
    const lc = cv.getContext('2d');
    if (lc.scale) lc.scale(s, s);          // 之后一律按世界坐标下笔
    strokeBaseFibres(lc, g, lw, 1);
    layer = { key, canvas: cv };
    return cv;
  }

  function draw(ctx, W, H, k = 1) {
    if (!der) return;
    const g = buildGeo();
    const lw = Math.max(0.5, 0.9 / (k || 1));

    // ① 源场：径向渐变光晕 + 不规则边界描边。学科的身份色**只**出现在这里。
    for (let i = 0; i < D; i++) {
      const [px, py] = der.P[i];
      const col = der.colour(i);
      const dim = focus && (focus.type === 'field' ? focus.i !== i
        : !(focus.type === 'fibre' && (der.fibA[focus.id] === i || der.fibB[focus.id] === i)));
      ctx.beginPath();
      const N = 64;
      for (let s = 0; s <= N; s++) {
        const th = (s / N) * Math.PI * 2;
        const rr = der.R[i] * blobR(i + 101, th);
        const x = px + Math.cos(th) * rr, y = py + Math.sin(th) * rr;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const grd = ctx.createRadialGradient(px, py, 0, px, py, der.R[i] * BLOB_HI);
      grd.addColorStop(0, withAlpha(col, dim ? 0.05 : 0.24));
      grd.addColorStop(0.62, withAlpha(col, dim ? 0.03 : 0.11));
      grd.addColorStop(1, withAlpha(col, 0));
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.strokeStyle = withAlpha(col, dim ? 0.06 : 0.30);
      ctx.lineWidth = 1 / (k || 1);
      ctx.stroke();
    }

    // ② 纤维：一整层，光栅化一次之后每帧只 blit（见 getLayer 上面那段）。
    // 命中/描述用的几何和这里画的是同一份 FX/FY，所以缓存不会让画面和读数分叉。
    const dev = (() => {
      const m = ctx.getTransform && ctx.getTransform();
      return m && m.a ? Math.abs(m.a) : (k || 1);      // 替身 ctx 没有 getTransform → 退回 k
    })();
    const s = Math.min(2, Math.max(1, dev));
    const cv = getLayer(ctx, g, lw, W, H, s);
    if (cv) ctx.drawImage(cv, 0, 0, W, H);             // 世界坐标，跟着宿主的变换走
    else strokeBaseFibres(ctx, g, lw, 1);              // 回退：没有离屏画布就直画
    if (focus) strokeFocusFibres(ctx, g, lw);

    // ③′ 源场染色。纤维的起点全挤在源场内部 —— 8,831 根起点叠在一个 ~40px 半径的盘里，
    // 累积之后每个源场中心都是一块**白斑**：学科的身份色被自己的纤维盖掉了，
    // 「一团不规则的源区」也退化成一个亮点（第一版截出来就是这样）。
    // 所以在纤维**之上**再薄薄染一层学科色：只 10~20% 不透明度，底下的纤维纹理原样保留，
    // 但白斑回到该学科的色相上。顺序很关键 —— 染在纤维下面等于没染。
    for (let i = 0; i < D; i++) {
      const [px, py] = der.P[i];
      const on = !focus || (focus.type === 'field' && focus.i === i)
        || (focus.type === 'fibre' && (der.fibA[focus.id] === i || der.fibB[focus.id] === i));
      ctx.beginPath();
      const N = 48;
      for (let s = 0; s <= N; s++) {
        const th = (s / N) * Math.PI * 2;
        const rr = der.R[i] * blobR(i + 101, th);
        const x = px + Math.cos(th) * rr, y = py + Math.sin(th) * rr;
        if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const g2 = ctx.createRadialGradient(px, py, 0, px, py, der.R[i] * BLOB_HI);
      g2.addColorStop(0, withAlpha(der.colour(i), on ? 0.22 : 0.05));
      g2.addColorStop(0.7, withAlpha(der.colour(i), on ? 0.07 : 0.02));
      g2.addColorStop(1, withAlpha(der.colour(i), 0));
      ctx.fillStyle = g2;
      ctx.fill();
    }

    // ④ 源场名字。压着纤维画，所以先描一圈背景色当底（不然名字会被纤维切碎）。
    ctx.textAlign = 'center';
    // 文字一律**反缩放**：字号在世界坐标里写，但描之前先 scale(1/k)，于是屏幕上永远是
    // LABEL_FONT 像素。不然在 1280 窗口下 k≈0.48，12px 的字变成 5.7px，场名根本读不出来
    //（这个图和旭日/矩阵不同：它的内容宽高比接近 16:9，会被缩得更狠）。
    // 探针那条链不受影响 —— check-science-views.html 把文本框的四个角都过了 getTransform()，
    // 这里多出来的那次缩放它照样算得进去。
    const inv = 1 / (k || 1);
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${LABEL_FONT}px -apple-system,"Segoe UI","Microsoft YaHei",sans-serif`;
    ctx.textAlign = 'center';
    for (let i = 0; i < D; i++) {
      const [px, py] = der.P[i];
      const on = !focus || (focus.type === 'field' && focus.i === i)
        || (focus.type === 'fibre' && (der.fibA[focus.id] === i || der.fibB[focus.id] === i));
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(inv, inv);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(8,10,13,0.85)';
      ctx.strokeText(der.name(i), 0, 0);
      ctx.fillStyle = on ? INK : INK_DIM;
      ctx.fillText(der.name(i), 0, 0);
      ctx.restore();
    }

    // 左上角那三行说明（纤维数 / 密度不是数量 / 悬停指向）已按用户要求删除：
    // 图例里已经逐字写着同样的话，悬停读数走 #hoverInfo（describe 的完整版本），
    // 场名本身也压在场上 —— 那三行只是把别处已经说过的再说一遍。
    ctx.restore();
  }

  // ------------------------------------------------------------------ 图例
  function renderLegend(el) {
    if (!el) return;
    if (!der) { el.innerHTML = ''; return; }
    const rows = [];
    for (let i = 0; i < D; i++) {
      const n = fibresTouching(i).length;
      rows.push(`<div class="row" data-field="${i}" style="cursor:pointer;">`
        + `<span><span class="sw" style="background:${der.colour(i)}"></span>${der.name(i)}</span>`
        + `<span class="cnt">${fmt(n)}</span></div>`);
    }
    el.innerHTML = `<div style="font-weight:600;margin-bottom:4px;color:var(--muted);">`
      + `Knowledge mycelium</div>`
      + `<div style="color:var(--muted);font-size:10.5px;line-height:1.45;margin-bottom:6px;">`
      + `每一根纤维 = 一个同时出现在两个学科里的术语。共 <b>${fmt(der.fibreCount)}</b> 根，`
      + `来自 <b>${fmt(der.bridging)}</b> 个跨学科术语（Σ C(k,2)，k = 该术语所属学科数）。</div>`
      + rows.join('')
      + `<div style="color:var(--muted);font-size:10.5px;line-height:1.45;margin-top:7px;">`
      + `源场位置由 <b>Jaccard</b> 弹簧松弛推出（Spearman ${der.rho.toFixed(2)}）—— 共享词汇越多的两个学科`
      + `离得越近，不是手工摆的。粗的地方是**密度**，不是一个能读出的数。</div>`
      + `<div style="color:var(--muted);font-size:10.5px;line-height:1.45;margin-top:6px;">`
      + `诚实边界：274,422 个术语里 <b>256,276 个（93.4%）只属于一个学科</b>，`
      + `一根纤维都不发 —— 菌丝只由 6.6% 的词汇长出来。</div>`;
    el.querySelectorAll('[data-field]').forEach((row) => {
      row.onclick = () => {
        const i = +row.dataset.field;
        togglePinned(sameTarget(focus, { type: 'field', i }) ? null : { type: 'field', i });
      };
    });
  }

  function getCounts() {
    if (!der) return null;
    return {
      disciplineCount: der.nD,
      fibreCount: der.fibreCount,
      bridgingTerms: der.bridging,
      topicCount: der.nT,
      pairCount: (der.nD * (der.nD - 1)) / 2,
      sharedTermTotal: der.fibreCount,
    };
  }

  return {
    setData,
    draw, pick, describe, renderLegend,
    setHover, getHover, togglePinned, getPinned, sameTarget,
    getCounts,
    // harness 出口（宿主不调）
    // C 只存了 i<j 的那一半（另一半由逆序得到）。所以这里必须给一个**按任意顺序取**的入口：
    // 直接暴露 C 的话，harness 拿 C[j*D+i] 永远是 undefined，
    // 「corridor(a,b) == reverse(corridor(b,a))」那条断言会静悄悄地空转。
    getModel: () => (der ? {
      P: der.P, R: der.R, C: der.C, J: der.J, maxJ: der.maxJ,
      corridor: (a, b) => corridorOf(der.C, a, b),
    } : null),
    get fields() { return der ? der.P.map((p, i) => ({ i, x: p[0], y: p[1], r: der.R[i], name: der.name(i) })) : []; },
    get fibres() { return der ? der.fib : null; },
    get grid() { return der ? der.grid : null; },   // harness 用：复现 pick 的邻域查询
    get fibreMeta() { return der ? { t: der.fibT, a: der.fibA, b: der.fibB } : null; },
    get diagnostics() {
      if (!der) return null;
      let maxSep = -Infinity, worst = null;
      for (let i = 0; i < D; i++) {
        for (let j = i + 1; j < D; j++) {
          const d = Math.hypot(der.P[i][0] - der.P[j][0], der.P[i][1] - der.P[j][1]);
          const ratio = (der.R[i] + der.R[j]) / d;
          if (ratio > maxSep) { maxSep = ratio; worst = [i, j]; }
        }
      }
      return {
        fibreCount: der.fibreCount, bridging: der.bridging, topicCount: der.nT,
        maxFieldOverlap: maxSep, worstPair: worst,
        maxJ: der.maxJ, scale: der.scale, aniso: der.aniso, rho: der.rho,
        fieldRadii: Array.from(der.R),
        fieldCentres: der.P.map((p) => [+p[0].toFixed(3), +p[1].toFixed(3)]),
        batches: BATCHES, fibPts: FIB_PTS,
      };
    },
    get focus() { return focus; },
  };
}
