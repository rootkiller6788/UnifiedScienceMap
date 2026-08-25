// extract-decls.mjs — 源码驱动提取器 v3：全部声明经公式计算二维坐标，学科聚成簇。
//
// 覆盖 7 类声明：theorem / lemma / def / class / structure / inductive / axiom（≈15.3 万节点）。
//
//   x_i = 学科簇布局（网络模式 = 整体模式的圆圈，点聚成 25 团）：
//        · 每个学科一个紧凑横槽，按学科「平均首次进库时间」从左到右排列；
//        · 槽宽 ∝ sqrt(count)；簇内节点按其模块时间在槽内铺开（左早右晚）+ 扰动；
//        · 簇位置 = 整体模式圆圈位置，两种模式一致。
//
//   y_i = [0.7·C(c_i) + 0.2·D(m_i) + 0.05·T(k_i) + 0.05·F(i)] 映射到画布纵轴
//        C(c_i) = 社区(顶层学科)位置 = 该学科内节点平均依赖深度    ← 决定"属于哪片大陆"
//        D(m_i) = 模块依赖深度 log 归一化                        ← 基础低、构造高
//        T(k_i) = 声明类型权重（axiom 1.0 … lemma 0.2）          ← 对象结构地位
//        F(i)   = 确定性局部扰动 ∈ [-0.5,0.5]                    ← 防重叠/美观，不改结构
//
// 依赖深度：模块 import DAG 的最长路径（拓扑 DP）。
// 全部离线分批计算（Node），浏览器只读坐标 → 15 万节点不卡浏览器。
//
// 用法：node extract/extract-decls.mjs
// 输出：web/decls.json（列式 SoA）

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MATHLIB_DIR = path.join(ROOT, 'Mathlib');
const OUT = path.join(ROOT, 'web', 'decls.json');

// ---- 世界坐标（16:9）----
const W = 1600, H = 900;
const PAD = 70;

// ---- 数学学科目录（排除工具目录）----
const EXCLUDE_DIRS = new Set(['Control', 'Lean', 'Util', 'Tactic', 'Testing', 'Deprecated']);

// ---- 声明类型权重（用户表）----
const TYPE_WEIGHT = {
  theorem: 0.4, lemma: 0.2, def: 0.7, class: 0.85,
  structure: 0.85, inductive: 0.9, axiom: 1.0,
};
const KINDS = Object.keys(TYPE_WEIGHT); // 参与可视化的 7 类

// ---- 确定性 hash（避免用 Math.random，保证可复现）----
function hash(i) {
  let h = Math.imul(i + 1, 2654435761) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h ^= h >>> 13;
  return h / 4294967296; // [0,1)
}

// ---- 扫描源码：声明 + import ----
function scanSource() {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.lean')) files.push(full);
    }
  };
  walk(MATHLIB_DIR);
  const t0 = Date.now();

  const rel = (p) => path.relative(ROOT, p);
  const modOf = (p) => rel(p).slice(0, -'.lean'.length).replaceAll(path.sep, '.');
  const IMPORT_RE = /^(?:public |private )?import\s+([A-Za-z][A-Za-z0-9_.]*)/;
  const DECL_RE = /^\s*(?:@\[[^\]]*\]\s*)?(?:noncomputable\s+|private\s+|mutual\s+|scoped\s+)*(theorem|lemma|def|abbrev|class|structure|inductive|instance|axiom|opaque)\s+([A-Za-z_][A-Za-z0-9_'-]*)/;

  const decls = [];              // {short, kind, module, dir}
  const moduleImports = new Map(); // module -> Set<module>
  const moduleTimes = new Map();   // module -> 首次进库 unix 秒（git）
  let inBlock = false;
  let logAt = 0;

  for (const p of files) {
    const mod = modOf(p);
    const segs = mod.split('.');
    const dir = segs[0] === 'Mathlib' && segs.length >= 2 ? segs[1] : null;
    const isMath = dir && !EXCLUDE_DIRS.has(dir);

    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }

    for (const raw of text.split(/\r?\n/)) {
      // 剥离块注释与行注释
      let line = raw;
      if (inBlock) {
        const end = line.indexOf('-/');
        if (end === -1) continue;
        line = line.slice(end + 2);
        inBlock = false;
      }
      const blockStart = line.indexOf('/-');
      if (blockStart !== -1) { line = line.slice(0, blockStart); inBlock = true; }
      const lineComment = line.indexOf('--');
      if (lineComment !== -1) line = line.slice(0, lineComment);

      const im = line.match(IMPORT_RE);
      if (im && im[1].startsWith('Mathlib.')) {
        if (!moduleImports.has(mod)) moduleImports.set(mod, new Set());
        moduleImports.get(mod).add(im[1]);
      }
      if (!isMath) continue;
      const dm = line.match(DECL_RE);
      if (dm && TYPE_WEIGHT[dm[1]] !== undefined) {
        decls.push({ short: dm[2], kind: dm[1], module: mod, dir });
      }
    }
    // 分批进度日志（每 1000 文件）
    if ((++logAt) % 1000 === 0) {
      console.log(`  扫描 ${logAt}/${files.length} 文件 · ${decls.length} 声明 · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  }
  console.log(`扫描完成：${decls.length} 个声明，${((Date.now() - t0) / 1000).toFixed(1)}s`);
  return { decls, moduleImports };
}

// ---- git：每个模块文件的首次进库时间 ----
// 一条 git log 命令取全历史 add 记录（8,823 文件，~7.5k 独立时间点）
function loadModuleTimes() {
  const t0 = Date.now();
  const out = execSync(
    'git log --reverse --diff-filter=A --format=%at --name-only -- Mathlib/',
    { cwd: ROOT, maxBuffer: 1e9, encoding: 'utf8' }
  );
  const byFile = new Map();
  let cur = null;
  for (const raw of out.split(/\r?\n/)) {
    const ln = raw.trim();
    if (/^\d+$/.test(ln)) { cur = +ln; continue; }
    if (ln && !byFile.has(ln)) byFile.set(ln, cur);
  }
  const byModule = new Map();
  for (const [file, t] of byFile) {
    if (!file.startsWith('Mathlib/') || !file.endsWith('.lean')) continue;
    byModule.set(file.slice(0, -'.lean'.length).replaceAll('/', '.'), t);
  }
  console.log(`git 首次进库时间：${byModule.size} 个模块（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  return byModule;
}

// ---- 模块依赖深度：import DAG 最长路径 ----
// mathlib 有 1 个 869 模块的巨型互导环（历史遗留），Kahn 会在环上死锁。
// 方案：Kosaraju 缩点 → 在无环缩点图上拓扑 DP → SCC 内成员共享同一深度。
function computeDepths(moduleImports) {
  const t0 = Date.now();
  const all = new Set();
  const deps = new Map();   // m -> Set(它 import 的模块)
  for (const [src, targets] of moduleImports) {
    all.add(src);
    for (const t of targets) { all.add(t); }
    deps.set(src, targets);
  }
  const mods = [...all];

  // ---- Kosaraju（迭代 DFS，避免递归爆栈）----
  const visited = new Set();
  const order = [];
  for (const s of mods) {
    if (visited.has(s)) continue;
    visited.add(s);
    const itFor = (m) => (deps.get(m)?.values() ?? [].values());
    const stack = [[s, itFor(s)]];
    while (stack.length) {
      const top = stack[stack.length - 1];
      const it = top[1];
      let next = it.next();
      while (!next.done && visited.has(next.value)) next = it.next();
      if (next.done) { order.push(top[0]); stack.pop(); }
      else { visited.add(next.value); stack.push([next.value, itFor(next.value)]); }
    }
  }
  // 反向图
  const rev = new Map();
  for (const m of mods) rev.set(m, []);
  for (const [src, targets] of deps) {
    for (const t of targets) rev.get(t).push(src);
  }
  // 第二遍按 order 逆序收集 SCC
  const compId = new Map();
  let cid = 0;
  for (let i = order.length - 1; i >= 0; i--) {
    const s = order[i];
    if (compId.has(s)) continue;
    const stack = [s];
    compId.set(s, cid);
    while (stack.length) {
      const u = stack.pop();
      for (const p of (rev.get(u) || [])) {
        if (compId.has(p)) continue;
        compId.set(p, cid);
        stack.push(p);
      }
    }
    cid++;
  }
  const compOf = (m) => compId.get(m);

  // ---- 缩点图（无环）----
  const compDeps = new Map();   // C -> Set<C'>（import 依赖的缩点，不含自环）
  for (let c = 0; c < cid; c++) compDeps.set(c, new Set());
  for (const [src, targets] of deps) {
    const cs = compOf(src);
    for (const t of targets) {
      const ct = compOf(t);
      if (ct !== cs) compDeps.get(cs).add(ct);
    }
  }
  // 入度 + 反向（C' 被哪些缩点依赖）
  const indeg = new Map();
  for (let c = 0; c < cid; c++) indeg.set(c, 0);
  for (const [cs, set] of compDeps) indeg.set(cs, indeg.get(cs) + set.size);
  const succC = new Map();
  for (let c = 0; c < cid; c++) succC.set(c, []);
  for (const [cs, set] of compDeps) {
    for (const ct of set) succC.get(ct).push(cs); // ct 被 cs 依赖
  }
  // 拓扑最长路径
  const compDepth = new Map();
  const q = [];
  for (let c = 0; c < cid; c++) if (indeg.get(c) === 0) { compDepth.set(c, 0); q.push(c); }
  while (q.length) {
    const c = q.pop();
    const d = compDepth.get(c);
    for (const cs of succC.get(c)) {
      if (d + 1 > (compDepth.get(cs) ?? -1)) compDepth.set(cs, d + 1);
      const nd = indeg.get(cs) - 1;
      indeg.set(cs, nd);
      if (nd === 0) q.push(cs);
    }
  }
  for (let c = 0; c < cid; c++) if (!compDepth.has(c)) compDepth.set(c, 0);

  // 模块深度 = 所属缩点深度
  const depth = new Map();
  let maxD = 0;
  for (const m of mods) {
    const d = compDepth.get(compOf(m)) ?? 0;
    depth.set(m, d);
    if (d > maxD) maxD = d;
  }
  const nSCC = [...new Set([...compId.values()])].length;
  console.log(`依赖深度：${mods.length} 模块 · 缩点 ${cid} · 环 ${cid - nSCC} 个 · 最长路径 ${maxD}（${((Date.now() - t0) / 1000).toFixed(1)}s）`);
  return { depth, maxD };
}

// ---- 统一坐标公式 ----
function layout(nodes, moduleDepth, maxDepth, moduleTimes) {
  // 时间归一化
  const times = [];
  for (const nd of nodes) {
    let t = moduleTimes.get(nd.module);
    if (t == null) t = 1620548370; // 2021-05-09 兜底（无 git 记录时用最早）
    nd.t = t;
    times.push(t);
  }
  let tMin = Infinity, tMax = -Infinity;
  for (const t of times) { if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
  const timeSpan = tMax - tMin || 1;

  // 每个声明的深度归一化
  const depthNorm = (mod) => {
    const d = moduleDepth.get(mod) ?? 0;
    return Math.log(1 + d) / Math.log(1 + maxDepth);
  };

  // 社区(学科)位置 = 该学科节点平均依赖深度
  const dirDepthSum = new Map();
  const dirCount = new Map();
  for (const nd of nodes) {
    dirDepthSum.set(nd.dir, (dirDepthSum.get(nd.dir) ?? 0) + depthNorm(nd.module));
    dirCount.set(nd.dir, (dirCount.get(nd.dir) ?? 0) + 1);
  }
  const communityY = new Map();
  for (const d of dirCount.keys()) communityY.set(d, dirDepthSum.get(d) / dirCount.get(d));

  // 逐节点计算 y（统一公式，无手工坐标）
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    const C = communityY.get(nd.dir);          // 0.7 社区位置
    const D = depthNorm(nd.module);            // 0.2 依赖深度
    const T = TYPE_WEIGHT[nd.kind];            // 0.05 类型权重
    const F = hash(i) - 0.5;                   // 0.05 局部扰动 ∈[-0.5,0.5]
    const yNorm = Math.max(0, Math.min(1, 0.7 * C + 0.2 * D + 0.05 * T + 0.05 * F));
    nd._yNorm = yNorm;
  }
  // 全局拉伸：把 yNorm 的 min-max 铺满画布纵带
  let yLo = Infinity, yHi = -Infinity;
  for (const nd of nodes) { if (nd._yNorm < yLo) yLo = nd._yNorm; if (nd._yNorm > yHi) yHi = nd._yNorm; }
  const ySpan = yHi - yLo || 1;

  // ---- X：学科簇布局（网络模式往整体模式"凑"）----
  //   每个学科一个紧凑横槽，按学科「平均首次进库时间」从左到右排列；
  //   槽宽 ∝ sqrt(count)（大的学科稍宽）；簇内节点按其模块时间在槽内铺开（左早右晚）+ 扰动。
  //   于是网络模式呈现 25 团点簇，位置与整体模式的圆圈聚合一致。
  const dirTimeSum = new Map();
  for (const nd of nodes) dirTimeSum.set(nd.dir, (dirTimeSum.get(nd.dir) ?? 0) + nd.t);
  const dirMeanT = new Map();
  for (const d of dirCount.keys()) dirMeanT.set(d, dirTimeSum.get(d) / dirCount.get(d));

  const dirSqrt = new Map();
  let totalSqrt = 0;
  for (const d of dirCount.keys()) { const w = Math.sqrt(dirCount.get(d)); dirSqrt.set(d, w); totalSqrt += w; }
  const usable = (W - PAD * 2) * 0.92;               // 留 8% 作簇间间隔
  const gap = (W - PAD * 2) * 0.08 / dirCount.size;
  const slot = new Map();
  let cursor = PAD;
  const sortedDirs = [...dirCount.keys()].sort((a, b) => dirMeanT.get(a) - dirMeanT.get(b));
  for (const d of sortedDirs) {
    const width = (dirSqrt.get(d) / totalSqrt) * usable;
    slot.set(d, [cursor, cursor + width]);
    cursor += width + gap;
  }

  // 簇内时间范围（簇内 X 时间梯度）
  const dirTMin = new Map(), dirTSpan = new Map();
  for (const d of sortedDirs) {
    let mn = Infinity, mx = -Infinity;
    for (const nd of nodes) if (nd.dir === d) { if (nd.t < mn) mn = nd.t; if (nd.t > mx) mx = nd.t; }
    dirTMin.set(d, mn); dirTSpan.set(d, (mx - mn) || 1);
  }

  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i];
    const yn = (nd._yNorm - yLo) / ySpan;
    nd.y = (H - PAD) - yn * (H - PAD * 2);   // yn=1(高级构造)在上(小y)，0(基础)在下(大y)
    const [lo, hi] = slot.get(nd.dir);
    const tn = Math.max(0, Math.min(1, (nd.t - dirTMin.get(nd.dir)) / dirTSpan.get(nd.dir)));
    nd.x = Math.max(PAD, Math.min(W - PAD, lo + tn * (hi - lo) + (hash(i) - 0.5) * 4));
    nd.year = 1970 + nd.t / 31557600;        // 真实年份（float），hover 直接显示，不再由 x 反推
  }

  // dir 聚合信息（远视图 LOD + 图例）
  const agg = new Map();
  for (const nd of nodes) {
    if (!agg.has(nd.dir)) agg.set(nd.dir, { n: 0, sx: 0, sy: 0, sd: 0 });
    const a = agg.get(nd.dir);
    a.n++; a.sx += nd.x; a.sy += nd.y; a.sd += nd._yNorm;
  }
  const dirs = [...agg.keys()].sort().map((d) => {
    const a = agg.get(d);
    return { name: d, count: a.n, cx: a.sx / a.n, cy: a.sy / a.n, meanDepthY: a.sd / a.n };
  });

  return { dirs, tMin, tMax, maxDepth };
}

// ---- 连线：模块 import 近似（端点 = 两模块各自第一个声明）----
function buildEdges(nodes, moduleImports) {
  const firstByModule = new Map();
  nodes.forEach((nd, i) => { if (!firstByModule.has(nd.module)) firstByModule.set(nd.module, i); });
  const edgeSet = new Set();
  const edges = [];
  for (const [src, targets] of moduleImports) {
    const s = firstByModule.get(src);
    if (s == null) continue;
    for (const tgt of targets) {
      const t = firstByModule.get(tgt);
      if (t == null || t === s) continue;
      const k = s < t ? s + '|' + t : t + '|' + s;
      if (edgeSet.has(k)) continue;
      edgeSet.add(k);
      edges.push([s, t]);
    }
  }
  return edges;
}

// ---- 主流程（分批日志）----
function main() {
  const t0 = Date.now();
  console.log('① 扫描源码（分批）…');
  const { decls, moduleImports } = scanSource();

  console.log('② git 首次进库时间…');
  const moduleTimes = loadModuleTimes();

  console.log('③ 依赖深度（拓扑 DP）…');
  const { depth: moduleDepth, maxD } = computeDepths(moduleImports);

  // 过滤：声明必须属于数学目录 + 有类型权重
  const nodes = decls.filter((d) => TYPE_WEIGHT[d.kind] !== undefined);

  console.log('④ 统一坐标公式…');
  const { dirs, tMin, tMax, maxDepth } = layout(nodes, moduleDepth, maxD, moduleTimes);

  console.log('⑤ 连线…');
  const edges = buildEdges(nodes, moduleImports);

  const byKind = {};
  for (const nd of nodes) byKind[nd.kind] = (byKind[nd.kind] || 0) + 1;

  const out = {
    meta: {
      generated: new Date().toISOString(),
      conceptCount: nodes.length,
      edgeCount: edges.length,
      dirCount: dirs.length,
      source: 'Mathlib source (theorem+lemma+def+class+structure+inductive+axiom)',
      layout: 'cluster-formula',
      formula: 'x=学科簇(按首次进库时间排列, 簇内左早右晚); y=0.7·communityDepth+0.2·moduleDepth+0.05·typeWeight+0.05·jitter',
      world: { width: W, height: H, pad: PAD },
      typeWeights: TYPE_WEIGHT,
      yearMin: new Date(tMin * 1000).getUTCFullYear(),
      yearMax: new Date(tMax * 1000).getUTCFullYear(),
      yearMinExact: tMin,
      yearMaxExact: tMax,
      maxDepth,
    },
    dirs,
    nodes: {
      label: nodes.map((n) => n.short),
      kind: nodes.map((n) => n.kind),
      dir: nodes.map((n) => n.dir),
      module: nodes.map((n) => n.module),
      depth: nodes.map((n) => n._yNorm), // 保留归一化 y 分量备用
      x: nodes.map((n) => Math.round(n.x * 10) / 10),
      y: nodes.map((n) => Math.round(n.y * 10) / 10),
      year: nodes.map((n) => Math.round(n.year * 10) / 10),
    },
    edges,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`✔ 写入 ${OUT}`);
  console.log(`  节点: ${nodes.length.toLocaleString()} · 连线: ${edges.length} · 学科: ${dirs.length}`);
  console.log(`  类型分布: ${Object.entries(byKind).map(([k, c]) => `${k}=${c.toLocaleString()}`).join('  ')}`);
  console.log(`  时间范围: ${out.meta.yearMin} ~ ${out.meta.yearMax} · 最长依赖深度: ${maxDepth}`);
  console.log(`  总耗时: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main();
