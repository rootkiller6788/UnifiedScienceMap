// extract-graph.mjs
// 从 mathlib4 源码纯文本提取模块 import 依赖图 → web/graph.json
//
// 用法：node extract/extract-graph.mjs
// 输出：web/graph.json（nodes / edges / branchGraph）
//
// 不编译任何 Lean 代码。模块名 = 文件相对路径字符串变换。
// 依赖关系来自行首 `(public |private )?import Mathlib.*`，排除外部包。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { branchOf, BRANCH_META } from './branches.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MATHLIB_DIR = path.join(ROOT, 'Mathlib');
const OUT = path.join(ROOT, 'web', 'graph.json');

// 行首 import 正则：可选 public/private 前缀，只匹配大写开头的模块名，
// 行首锚点过滤注释与 docstring 里的「import」字样；允许行尾注释。
const IMPORT_RE = /^(?:public |private )?import\s+([A-Za-z][A-Za-z0-9_.]*)(?:\s*--.*)?$/;

/** 递归收集所有 .lean 文件相对路径 */
function collectLeanFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectLeanFiles(full));
    else if (entry.name.endsWith('.lean')) out.push(path.relative(ROOT, full));
  }
  return out;
}

/** 相对路径 → 模块名：Mathlib/Topology/Basic.lean → Mathlib.Topology.Basic */
function moduleNameOf(rel) {
  return rel.slice(0, -'.lean'.length).replaceAll(path.sep, '.');
}

const SEP = '|'; // 边去重键分隔符（模块名不含 |）

function main() {
  const files = collectLeanFiles(MATHLIB_DIR);
  const nodes = [];
  const edges = [];
  const edgeSet = new Set();
  const nodeByMod = new Map();
  const branchCount = Object.fromEntries(Object.keys(BRANCH_META).map((k) => [k, 0]));

  for (const rel of files) {
    const mod = moduleNameOf(rel);
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    } catch {
      continue; // 不可读文件跳过
    }
    const branch = branchOf(mod);
    nodes.push({ id: mod, branch, depth: mod.split('.').length });
    nodeByMod.set(mod, nodes.length - 1);

    let importCount = 0;
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(IMPORT_RE);
      if (!m) continue;
      const target = m[1];
      if (!target.startsWith('Mathlib.')) continue; // 排除外部依赖包
      const key = target + SEP + mod;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      edges.push({ source: target, target: mod }); // 被 import → 依赖方向
      importCount++;
    }
    nodes[nodes.length - 1].imports = importCount;
  }

  // 分支统计（真实出现的分支，用于前端配色兜底）
  for (const n of nodes) if (n.branch in branchCount) branchCount[n.branch]++;

  // ---- 聚合层：学科 → 学科 依赖图（供远视图 LOD）----
  const branches = Object.keys(BRANCH_META);
  const branchAdj = Object.fromEntries(branches.map((b) => [b, {}]));
  for (const e of edges) {
    const sb = nodes[nodeByMod.get(e.source)].branch;
    const tb = nodes[nodeByMod.get(e.target)].branch;
    if (sb === tb) continue;
    const k = sb + SEP + tb;
    const aggr = (branchAdj[sb] ||= {});
    aggr[k] = (aggr[k] || 0) + 1;
  }
  const branchNodes = branches
    .filter((b) => branchCount[b] > 0)
    .map((b) => ({ id: b, label: BRANCH_META[b].label, color: BRANCH_META[b].color, count: branchCount[b] }));
  const branchEdges = [];
  for (const [sb, aggr] of Object.entries(branchAdj)) {
    for (const [k, w] of Object.entries(aggr)) {
      const [, tb] = k.split(SEP);
      branchEdges.push({ source: sb, target: tb, weight: w });
    }
  }

  const graph = {
    meta: {
      generated: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: edges.length,
      branchCount: branchNodes.length,
      source: 'mathlib4 module import graph',
    },
    nodes,
    edges,
    branchGraph: { nodes: branchNodes, edges: branchEdges },
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(graph));
  console.log(`✔ 写入 ${OUT}`);
  console.log(`  节点: ${nodes.length}  边: ${edges.length}  学科: ${branchNodes.length}`);
  console.log(
    '  学科分布: ' +
      branchNodes.map((b) => `${b.label}(${b.count})`).join(', ')
  );
}

main();
