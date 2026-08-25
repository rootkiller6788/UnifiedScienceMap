// verify.mjs — 校验 web/graph.json 的结构与统计信息。
// 用法：node extract/verify.mjs [路径，默认 web/graph.json]
// 用于 CI 或手动确认提取结果正确。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = process.argv[2] ?? path.resolve(__dirname, '..', 'web', 'graph.json');

const g = JSON.parse(fs.readFileSync(p, 'utf8'));
const errors = [];

// 节点检查
if (!Array.isArray(g.nodes)) errors.push('nodes 缺失');
const ids = new Set(g.nodes.map((n) => n.id));
if (ids.size !== g.nodes.length) errors.push('节点 id 不唯一');
for (const n of g.nodes) {
  if (typeof n.id !== 'string' || !n.id.startsWith('Mathlib.')) errors.push(`非法节点 id: ${n.id}`);
  if (typeof n.branch !== 'string') errors.push(`节点缺 branch: ${n.id}`);
  if (typeof n.depth !== 'number') errors.push(`节点缺 depth: ${n.id}`);
}

// 边检查
if (!Array.isArray(g.edges)) errors.push('edges 缺失');
const seen = new Set();
for (const e of g.edges) {
  if (!ids.has(e.source) || !ids.has(e.target)) errors.push(`边引用缺失节点: ${e.source} -> ${e.target}`);
  const k = e.source + '|' + e.target;
  if (seen.has(k)) errors.push(`重复边: ${k}`);
  seen.add(k);
}

// 学科层检查
if (!Array.isArray(g.branchGraph?.nodes) || !Array.isArray(g.branchGraph?.edges)) {
  errors.push('branchGraph 缺失');
} else {
  const bid = new Set(g.branchGraph.nodes.map((n) => n.id));
  for (const e of g.branchGraph.edges) {
    if (!bid.has(e.source) || !bid.has(e.target)) errors.push(`学科边引用缺失: ${e.source} -> ${e.target}`);
    if (typeof e.weight !== 'number') errors.push(`学科边缺权重: ${e.source} -> ${e.target}`);
  }
}

// 统计
const byBranch = {};
for (const n of g.nodes) byBranch[n.branch] = (byBranch[n.branch] || 0) + 1;
const sizeMB = (fs.statSync(p).size / 1048576).toFixed(1);

console.log(`✔ 数据源: ${p}（${sizeMB} MB）`);
console.log(`  节点: ${g.nodes.length}  边: ${g.edges.length}`);
console.log(`  学科层: ${g.branchGraph?.nodes.length ?? 0} 节点 / ${g.branchGraph?.edges.length ?? 0} 边`);
console.log(`  学科分布:`);
for (const [b, c] of Object.entries(byBranch).sort((a, b) => b[1] - a[1])) console.log(`    ${b}: ${c}`);

if (errors.length) {
  console.error('\n✘ 校验失败:');
  for (const e of errors.slice(0, 20)) console.error('  - ' + e);
  process.exit(1);
}
console.log('\n✔ 校验通过');
