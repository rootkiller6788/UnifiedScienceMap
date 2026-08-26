import fs from 'node:fs';
import path from 'node:path';

const PHYS_ROOT = 'D:/Opencode/git-killer/super-git/physlib';
const OUT = 'web/physlib-preview.json';
const ROOTS = ['Physlib', 'PhyslibAlpha', 'QuantumInfo'];
const PLOT = { left: 70, right: 1530, top: 70, bottom: 830 };

const SUBJECT_ORDER = [
  'Mathematics',
  'ClassicalMechanics',
  'SpaceAndTime',
  'Relativity',
  'Electromagnetism',
  'Optics',
  'FluidDynamics',
  'Thermodynamics',
  'StatisticalMechanics',
  'CondensedMatter',
  'QuantumMechanics',
  'QuantumInfo',
  'QFT',
  'Particles',
  'StringTheory',
  'Cosmology',
  'Units',
  'Control',
  'Meta',
  'PhysicsAlpha',
];

const files = [];
for (const root of ROOTS) collectLeanFiles(path.join(PHYS_ROOT, root), files);

const moduleByPath = new Map();
for (const file of files) {
  const rel = path.relative(PHYS_ROOT, file).replace(/\\/g, '/');
  const mod = rel.replace(/\.lean$/, '').split('/').join('.');
  moduleByPath.set(file, mod);
}

const modules = [...moduleByPath.values()].sort();
const indexByModule = new Map(modules.map((m, i) => [m, i]));
const subjectCounts = new Map();
for (const mod of modules) {
  const subject = moduleSubject(mod);
  subjectCounts.set(subject, (subjectCounts.get(subject) || 0) + 1);
}

const subjects = SUBJECT_ORDER
  .filter((s) => subjectCounts.has(s))
  .concat([...subjectCounts.keys()].filter((s) => !SUBJECT_ORDER.includes(s)).sort());

const subjectCenter = new Map();
subjects.forEach((subject, i) => {
  const t = subjects.length === 1 ? 0.5 : i / (subjects.length - 1);
  const angle = -0.95 + t * 1.9;
  const cx = 1040 + Math.cos(angle) * 380;
  const cy = 430 + Math.sin(angle) * 245;
  subjectCenter.set(subject, { cx, cy });
});

const nodes = {
  label: [],
  kind: [],
  dir: [],
  module: [],
  depth: [],
  x: [],
  y: [],
  year: [],
  source: [],
};
const perSubjectSeen = new Map();

modules.forEach((mod) => {
  const subject = moduleSubject(mod);
  const center = subjectCenter.get(subject);
  const seen = perSubjectSeen.get(subject) || 0;
  perSubjectSeen.set(subject, seen + 1);
  const count = subjectCounts.get(subject);
  const spiral = Math.sqrt(seen / Math.max(1, count));
  const angle = hash01(mod) * Math.PI * 2 + seen * 0.42;
  const radius = 20 + spiral * (48 + Math.sqrt(count) * 5);
  const top = mod.split('.')[0];

  nodes.label.push(moduleLabel(mod));
  nodes.kind.push('module');
  nodes.dir.push(subject);
  nodes.module.push(mod);
  nodes.depth.push(moduleDepth(mod));
  nodes.x.push(clamp(center.cx + Math.cos(angle) * radius, PLOT.left, PLOT.right));
  nodes.y.push(clamp(center.cy + Math.sin(angle) * radius * 0.66, PLOT.top, PLOT.bottom));
  nodes.year.push(top === 'PhyslibAlpha' ? 2026 : top === 'QuantumInfo' ? 2025.6 : 2025.2);
  nodes.source.push(top);
});

const edgeSet = new Set();
for (const file of files) {
  const mod = moduleByPath.get(file);
  const source = indexByModule.get(mod);
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:public\s+)?import\s+([A-Za-z0-9_'.]+)\s*$/);
    if (!m) continue;
    const target = indexByModule.get(m[1]);
    if (target === undefined || target === source) continue;
    edgeSet.add(`${target},${source}`);
  }
}

const edges = [...edgeSet].map((s) => s.split(',').map(Number));
const dirs = subjects.map((name) => {
  const c = subjectCenter.get(name);
  return {
    name,
    count: subjectCounts.get(name),
    cx: c.cx,
    cy: c.cy,
    meanDepthY: meanDepthFor(name, modules),
  };
});

const out = {
  meta: {
    generated: new Date().toISOString(),
    conceptCount: modules.length,
    edgeCount: edges.length,
    dirCount: dirs.length,
    source: 'Physlib module preview',
    layout: 'module-preview',
    yearMin: 2025,
    yearMax: 2026,
  },
  dirs,
  nodes,
  edges,
};

fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT}: ${modules.length} nodes, ${edges.length} edges, ${dirs.length} subjects`);

function collectLeanFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) collectLeanFiles(full, out);
    else if (ent.isFile() && ent.name.endsWith('.lean')) out.push(full);
  }
}

function moduleSubject(mod) {
  const parts = mod.split('.');
  if (parts[0] === 'QuantumInfo') return 'QuantumInfo';
  if (parts[0] === 'PhyslibAlpha') return parts[1] ? alphaSubject(parts[1]) : 'PhysicsAlpha';
  return parts[1] || 'Physics';
}

function alphaSubject(s) {
  if (s === 'Basic') return 'PhysicsAlpha';
  return s;
}

function moduleLabel(mod) {
  const parts = mod.split('.');
  return parts.slice(-2).join('.');
}

function moduleDepth(mod) {
  return Math.min(1, Math.max(0.08, (mod.split('.').length - 2) / 8));
}

function meanDepthFor(subject, modules) {
  const vals = modules.filter((m) => moduleSubject(m) === subject).map(moduleDepth);
  return vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}
