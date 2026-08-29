import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'web', 'unified-decls.json');
const OUTPUT = path.join(ROOT, 'web', 'hive-data.json');
const DEPTH_BINS = 32;

const SUBJECT_ORDER_GROUPS = [
  ['Logic', 'Foundations', 'Data', 'Computability', 'Languages', 'Logics', 'Algorithms', 'Crypto'],
  ['Algebra', 'GroupTheory', 'RingTheory', 'LinearAlgebra', 'NumberTheory', 'FieldTheory', 'RepresentationTheory'],
  ['Geometry', 'Topology', 'AlgebraicGeometry', 'AlgebraicTopology', 'CategoryTheory', 'ModelTheory', 'SetTheory', 'Order'],
  ['Analysis', 'MeasureTheory', 'Probability', 'Dynamics', 'InformationTheory', 'Condensed'],
  ['ClassicalMechanics', 'SpaceAndTime', 'Relativity', 'Electromagnetism', 'FluidDynamics', 'Thermodynamics', 'StatisticalMechanics'],
  ['QuantumMechanics', 'QuantumInfo', 'QFT', 'Particles', 'StringTheory', 'Cosmology', 'ClassicalFieldTheory', 'CondensedMatter', 'Units'],
  ['Modules', 'AD', 'Numerics', 'Optimization', 'MachineLearning', 'SpecialFunctions', 'Meta', 'PhysicsAlpha'],
];

const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const { nodes, edges, dirs } = data;
const subjectNames = dirs.map((d) => d.name);
const subjectIndex = new Map(subjectNames.map((name, i) => [name, i]));
const nodeCount = nodes.label.length;
const subjectCount = subjectNames.length;

const depthRaw = new Float64Array(nodeCount);
for (let i = 0; i < nodeCount; i++) {
  depthRaw[i] = rawDepth(i);
}

const transformed = Array.from(depthRaw, (d) => Math.log1p(Math.max(0, d))).sort((a, b) => a - b);
const q02 = quantile(transformed, 0.02);
const q98 = quantile(transformed, 0.98);
const denom = Math.max(1e-9, q98 - q02);

const depthNorm = new Float32Array(nodeCount);
for (let i = 0; i < nodeCount; i++) {
  depthNorm[i] = clamp01((Math.log1p(Math.max(0, depthRaw[i])) - q02) / denom);
}

const subjectStats = Array.from({ length: subjectCount }, (_, i) => ({
  id: i,
  name: subjectNames[i],
  count: 0,
  depthMin: 1,
  depthMax: 0,
  depthSum: 0,
  relationCount: 0,
  densityCounts: new Array(DEPTH_BINS).fill(0),
}));

const nodeSubject = new Uint16Array(nodeCount);
for (let i = 0; i < nodeCount; i++) {
  const si = subjectIndex.get(nodes.dir[i]) ?? 0;
  nodeSubject[i] = si;
  const s = subjectStats[si];
  const d = depthNorm[i];
  s.count++;
  s.depthSum += d;
  if (d < s.depthMin) s.depthMin = d;
  if (d > s.depthMax) s.depthMax = d;
  s.densityCounts[Math.min(DEPTH_BINS - 1, Math.floor(d * DEPTH_BINS))]++;
}

const matrix = Array.from({ length: subjectCount }, () => new Float64Array(subjectCount));
const totals = new Float64Array(subjectCount);
const degrees = new Uint32Array(nodeCount);
const crossDegrees = new Uint32Array(nodeCount);
for (const edge of edges) {
  const source = edge[0];
  const target = edge[1];
  if (source == null || target == null || source < 0 || target < 0 || source >= nodeCount || target >= nodeCount) continue;
  const a = nodeSubject[source];
  const b = nodeSubject[target];
  matrix[a][b] += 1;
  totals[a] += 1;
  subjectStats[a].relationCount++;
  degrees[source]++;
  degrees[target]++;
  if (a !== b) {
    crossDegrees[source]++;
    crossDegrees[target]++;
  }
}

const undirected = new Map();
for (let i = 0; i < subjectCount; i++) {
  for (let j = 0; j < subjectCount; j++) {
    if (i === j) continue;
    const count = matrix[i][j];
    if (!count) continue;
    const a = i < j ? i : j;
    const b = i < j ? j : i;
    const key = `${a}|${b}`;
    let rec = undirected.get(key);
    if (!rec) {
      rec = { sourceIndex: a, targetIndex: b, forward: 0, backward: 0 };
      undirected.set(key, rec);
    }
    if (i === a) rec.forward += count;
    else rec.backward += count;
  }
}

let maxRelationCount = 1;
let maxStrength = 1e-9;
const relations = [];
for (const rec of undirected.values()) {
  const count = rec.forward + rec.backward;
  const denom = Math.sqrt(Math.max(1, totals[rec.sourceIndex]) * Math.max(1, totals[rec.targetIndex]));
  const strength = count / denom;
  const direction = (rec.forward - rec.backward) / Math.max(1, count);
  maxRelationCount = Math.max(maxRelationCount, count);
  maxStrength = Math.max(maxStrength, strength);
  relations.push({
    source: subjectNames[rec.sourceIndex],
    target: subjectNames[rec.targetIndex],
    sourceIndex: rec.sourceIndex,
    targetIndex: rec.targetIndex,
    count,
    strength,
    direction,
  });
}

relations.sort((a, b) => b.strength - a.strength || b.count - a.count);
const normalizedRelations = relations.map((r) => ({
  ...r,
  countNorm: round(Math.log1p(r.count) / Math.log1p(maxRelationCount)),
  strengthNorm: round(r.strength / maxStrength),
  strength: round(r.strength),
  direction: round(r.direction),
}));
markDefaultRelations(normalizedRelations);

const ordered = orderSubjects(subjectStats);
const orderIndex = new Map(ordered.map((s, i) => [s.id, i]));
const maxSubjectCount = Math.max(1, ...subjectStats.map((s) => s.count));
const maxDensity = Math.max(1, ...subjectStats.flatMap((s) => s.densityCounts));
const maxDensityBySubject = subjectStats.map((s) => Math.max(1, ...s.densityCounts));

const subjects = subjectStats.map((s) => {
  const order = orderIndex.get(s.id) ?? s.id;
  const related = normalizedRelations
    .filter((r) => r.sourceIndex === s.id || r.targetIndex === s.id)
    .sort((a, b) => b.strengthNorm - a.strengthNorm || b.count - a.count);
  const internal = matrix[s.id][s.id];
  const external = related.reduce((sum, r) => sum + r.count, 0);
  const relationWeight = related.reduce((sum, r) => sum + r.strength, 0);
  const interdisciplinarity = relationWeight > 0
    ? -related.reduce((sum, r) => {
        const p = r.strength / relationWeight;
        return p > 0 ? sum + p * Math.log(p) : sum;
      }, 0) / Math.log(Math.max(2, subjectCount - 1))
    : 0;
  return {
    id: s.id,
    name: s.name,
    order,
    angle: -Math.PI / 2 + (Math.PI * 2 * order) / subjectCount,
    count: s.count,
    relationCount: s.relationCount,
    cohesion: round(internal / Math.max(1, internal + external)),
    interdisciplinarity: round(interdisciplinarity),
    strongestRelations: related.slice(0, 8).map((r) => ({
      subject: r.sourceIndex === s.id ? r.target : r.source,
      count: r.count,
      strength: r.strength,
      strengthNorm: r.strengthNorm,
    })),
    typeDistribution: typeDistribution(s.id),
    bridgeDeclarations: bridgeDeclarations(s.id),
    depthMin: s.count ? round(s.depthMin) : 0,
    depthMax: s.count ? round(s.depthMax) : 0,
    depthMean: s.count ? round(s.depthSum / s.count) : 0,
  };
});

const axes = subjects.map((s) => {
  const stats = subjectStats[s.id];
  const density = stats.densityCounts.map((count, bin) => ({
    bin,
    depth0: round(bin / DEPTH_BINS),
    depth1: round((bin + 1) / DEPTH_BINS),
    count,
    norm: round(Math.log1p(count) / Math.log1p(maxDensity)),
    localNorm: round(Math.log1p(count) / Math.log1p(maxDensityBySubject[s.id])),
    widthNorm: round(Math.sqrt(Math.log1p(count) / Math.log1p(maxDensityBySubject[s.id]))),
  }));
  return {
    subject: s.name,
    index: s.id,
    order: s.order,
    angle: s.angle,
    count: s.count,
    countNorm: round(Math.log1p(s.count) / Math.log1p(maxSubjectCount)),
    depthMin: s.depthMin,
    depthMax: s.depthMax,
    depthMean: s.depthMean,
    densityMetric: 'widthNorm = sqrt(log1p(binCount) / log1p(subjectMaxBinCount))',
    density,
  };
}).sort((a, b) => a.order - b.order);

const density = axes.flatMap((axis) => axis.density.map((bin) => ({
  subject: axis.subject,
  subjectIndex: axis.index,
  ...bin,
})));

const output = {
  meta: {
    source: 'web/unified-decls.json',
    generatedAt: new Date().toISOString(),
    nodeCount,
    edgeCount: edges.length,
    subjectCount,
    depthBins: DEPTH_BINS,
    semantics: {
      angle: 'subject',
      radius: 'constructionDepth',
      axisWidth: 'nodeDensityAtDepth',
      ribbonWidth: 'relationCount',
      ribbonOpacity: 'sizeNormalizedRelationStrength',
      highlight: 'hoverSelectBridgeOnly',
    },
  },
  subjects,
  axes,
  relations: normalizedRelations,
  density,
  metrics: {
    depth: {
      transform: 'log1p',
      q02: round(q02),
      q98: round(q98),
      bins: DEPTH_BINS,
      normalized: 'clip((log1p(rawDepth)-q02)/(q98-q02),0,1)',
    },
    relations: {
      raw: 'Aij = count of declaration edges between subjects',
      normalized: 'Wij = Aij / sqrt(Ai * Aj)',
      maxCount: maxRelationCount,
      maxStrength: round(maxStrength),
      subjectTotals: Array.from(totals, (v) => Math.round(v)),
      matrix: buildRelationMatrix(matrix, totals),
    },
  },
};

fs.writeFileSync(OUTPUT, JSON.stringify(output));
console.log(`wrote ${path.relative(ROOT, OUTPUT)}`);
console.log(`${nodeCount.toLocaleString()} nodes, ${edges.length.toLocaleString()} edges, ${subjectCount} subjects`);
console.log(`${relations.length.toLocaleString()} subject relations, ${DEPTH_BINS} depth bins`);

function rawDepth(i) {
  const direct = Number(nodes.depth?.[i]);
  if (Number.isFinite(direct) && direct >= 0) return direct;

  const year = Number(nodes.year?.[i]);
  if (Number.isFinite(year)) return Math.max(0, year - 2020);

  const module = String(nodes.module?.[i] || '');
  const parts = module ? module.split('.').length : 1;
  return Math.max(0, parts - 1);
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[Math.min(sorted.length - 1, base + 1)];
  return sorted[base] + (next - sorted[base]) * rest;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function round(v) {
  return Math.round(v * 1e6) / 1e6;
}

function markDefaultRelations(items) {
  const keep = new Set();
  items.slice(0, 80).forEach((r) => keep.add(relationKey(r)));
  for (let subject = 0; subject < subjectCount; subject++) {
    items
      .filter((r) => r.sourceIndex === subject || r.targetIndex === subject)
      .sort((a, b) => b.strengthNorm - a.strengthNorm || b.count - a.count)
      .slice(0, 5)
      .forEach((r) => keep.add(relationKey(r)));
  }
  for (const r of items) r.visibleDefault = keep.has(relationKey(r));
}

function relationKey(r) {
  return `${r.sourceIndex}|${r.targetIndex}`;
}

function typeDistribution(subjectId) {
  const counts = new Map();
  let total = 0;
  for (let i = 0; i < nodeCount; i++) {
    if (nodeSubject[i] !== subjectId) continue;
    const kind = String(nodes.kind?.[i] || 'unknown');
    counts.set(kind, (counts.get(kind) || 0) + 1);
    total++;
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([kind, count]) => ({
      kind,
      count,
      share: round(count / Math.max(1, total)),
    }));
}

function bridgeDeclarations(subjectId) {
  let maxDegree = 1;
  for (const degree of degrees) if (degree > maxDegree) maxDegree = degree;
  const top = [];
  for (let i = 0; i < nodeCount; i++) {
    if (nodeSubject[i] !== subjectId || !degrees[i] || !crossDegrees[i]) continue;
    const crossRatio = crossDegrees[i] / degrees[i];
    const score = Math.sqrt(degrees[i] / maxDegree) * crossRatio;
    if (score <= 0) continue;
    top.push({
      label: nodes.label[i],
      module: nodes.module?.[i],
      kind: nodes.kind?.[i],
      degree: degrees[i],
      crossRatio: round(crossRatio),
      score: round(score),
    });
  }
  return top
    .sort((a, b) => b.score - a.score || b.degree - a.degree)
    .slice(0, 8);
}

function orderSubjects(stats) {
  const byName = new Map(stats.map((s) => [s.name, s]));
  const used = new Set();
  const out = [];

  for (const group of SUBJECT_ORDER_GROUPS) {
    for (const name of group) {
      const subject = byName.get(name);
      if (!subject || used.has(subject.id)) continue;
      used.add(subject.id);
      out.push(subject);
    }
  }

  const remaining = stats
    .filter((s) => !used.has(s.id))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  out.push(...remaining);
  return out;
}

function buildRelationMatrix(matrix, totals) {
  return matrix.map((row, i) => Array.from(row, (count, j) => {
    const denom = Math.sqrt(Math.max(1, totals[i]) * Math.max(1, totals[j]));
    return count
      ? {
          count: Math.round(count),
          strength: round(count / denom),
        }
      : null;
  }));
}
