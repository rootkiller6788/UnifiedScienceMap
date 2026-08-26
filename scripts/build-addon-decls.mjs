import fs from 'node:fs';
import path from 'node:path';

const MATH_DATA = 'web/decls.json';
const PLOT = { left: 70, right: 1530, top: 70, bottom: 830 };
const DECL_RE = /^\s*(?:private\s+|protected\s+|noncomputable\s+|unsafe\s+|partial\s+)*(theorem|lemma|def|class|structure|inductive|axiom|abbrev|instance)\s+([A-Za-z0-9_'.]+)/;

const CONFIGS = {
  physlib: {
    repo: 'D:/Opencode/git-killer/super-git/physlib',
    roots: ['Physlib', 'QuantumInfo'],
    out: 'web/physlib-decls.json',
    source: (module) => module.startsWith('QuantumInfo') ? 'QuantumInfo' : 'Physlib',
    year: (module) => module.startsWith('QuantumInfo') ? 2025.65 : 2025.25,
    include: () => true,
    subject: (module) => {
      const parts = module.split('.');
      if (parts[0] === 'QuantumInfo') return 'QuantumInfo';
      if (parts[1] === 'Mathematics') return mathematicsSubject(module);
      return parts[1] || 'Physics';
    },
  },
  cslib: {
    repo: 'D:/Opencode/git-killer/super-git/cslib',
    roots: ['Cslib'],
    out: 'web/cslib-decls.json',
    source: 'Cslib',
    year: 2026.1,
    include: () => true,
  },
  scilean: {
    repo: 'D:/Opencode/git-killer/super-git/SciLean',
    roots: ['SciLean'],
    out: 'web/scilean-decls.json',
    source: 'SciLean',
    year: 2025.9,
    include: (module) => {
      const subject = module.split('.')[1] || '';
      return new Set([
        'Modules',
        'Analysis',
        'Data',
        'AD',
        'Algebra',
        'Geometry',
        'Probability',
        'Logic',
        'Numerics',
        'SpecialFunctions',
      ]).has(subject);
    },
  },
};

const MATH_ANCHORS = {
  Algebra: { cx: 286, cy: 581 },
  LinearAlgebra: { cx: 520, cy: 505 },
  Geometry: { cx: 1165, cy: 360 },
  Analysis: { cx: 1050, cy: 610 },
  Topology: { cx: 1240, cy: 650 },
  Probability: { cx: 1375, cy: 760 },
  MeasureTheory: { cx: 1270, cy: 740 },
  InformationTheory: { cx: 1135, cy: 230 },
  Computation: { cx: 650, cy: 610 },
  Dynamics: { cx: 980, cy: 720 },
  Data: { cx: 610, cy: 520 },
  Logic: { cx: 410, cy: 630 },
  SetTheory: { cx: 610, cy: 610 },
  Computability: { cx: 650, cy: 610 },
};

const SUBJECT_ANCHORS = {
  ClassicalMechanics: ['Dynamics', 'Analysis'],
  SpaceAndTime: ['Geometry', 'Topology'],
  Relativity: ['Geometry', 'Analysis'],
  Electromagnetism: ['Geometry', 'Analysis'],
  Optics: ['Geometry', 'Analysis'],
  FluidDynamics: ['Dynamics', 'Analysis'],
  Thermodynamics: ['Probability', 'Analysis'],
  StatisticalMechanics: ['Probability', 'MeasureTheory'],
  CondensedMatter: ['QuantumMechanics', 'Topology', 'Analysis'],
  QuantumMechanics: ['LinearAlgebra', 'Analysis'],
  QuantumInfo: ['InformationTheory', 'LinearAlgebra'],
  QFT: ['Algebra', 'Analysis', 'Geometry'],
  Particles: ['Algebra', 'Geometry'],
  StringTheory: ['Geometry', 'Topology', 'Algebra'],
  Cosmology: ['Relativity', 'Dynamics'],
  Units: ['Data', 'Algebra'],
  Meta: ['Computation', 'Data'],
  ClassicalFieldTheory: ['Dynamics', 'Geometry', 'Analysis'],
  Foundations: ['Logic', 'SetTheory', 'Data'],
  Languages: ['Logic', 'Computability'],
  Computability: ['Computability', 'Logic'],
  Logics: ['Logic', 'SetTheory'],
  MachineLearning: ['Probability', 'Analysis', 'Data'],
  Crypto: ['Computation', 'Algebra'],
  Algorithms: ['Computation', 'Data'],
  AD: ['Analysis', 'LinearAlgebra', 'Computation'],
  Modules: ['Analysis', 'LinearAlgebra', 'Data'],
  Numerics: ['Analysis', 'Computation'],
  SpecialFunctions: ['Analysis'],
};

const name = process.argv[2];
const config = CONFIGS[name];
if (!config) {
  console.error(`Usage: node scripts/build-addon-decls.mjs ${Object.keys(CONFIGS).join('|')}`);
  process.exit(1);
}

const math = fs.existsSync(MATH_DATA) ? JSON.parse(fs.readFileSync(MATH_DATA, 'utf8')) : null;
const mathModuleAnchors = math ? buildMathModuleAnchors(math) : new Map();

const files = [];
for (const root of config.roots) collectLeanFiles(path.join(config.repo, root), files);

const modules = new Map();
for (const file of files) {
  const rel = path.relative(config.repo, file).replace(/\\/g, '/');
  const module = rel.replace(/\.lean$/, '').split('/').join('.');
  if (!config.include(module)) continue;
  const text = fs.readFileSync(file, 'utf8');
  const decls = [];
  const imports = [];
  for (const line of text.split(/\r?\n/)) {
    const imp = line.match(/^\s*(?:public\s+)?import\s+(.+?)\s*$/);
    if (imp) imports.push(...imp[1].trim().split(/\s+/));
    const decl = line.match(DECL_RE);
    if (decl) decls.push({ kind: decl[1], name: normalizeDeclName(module, decl[2]) });
  }
  modules.set(module, { file, subject: moduleSubject(module), imports, decls });
}

const subjectCounts = new Map();
for (const info of modules.values()) {
  if (info.decls.length) subjectCounts.set(info.subject, (subjectCounts.get(info.subject) || 0) + info.decls.length);
}
const subjects = [...subjectCounts.keys()].sort((a, b) => (subjectCounts.get(b) - subjectCounts.get(a)) || a.localeCompare(b));
const subjectCenter = new Map();
for (const subject of subjects) {
  const anchor = anchoredSubjectCenter(subject);
  subjectCenter.set(subject, {
    cx: clamp(anchor.cx + (hash01(config.source + subject + ':cx') - 0.5) * 86, PLOT.left, PLOT.right),
    cy: clamp(anchor.cy + (hash01(config.source + subject + ':cy') - 0.5) * 62, PLOT.top, PLOT.bottom),
  });
}

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
const firstDeclByModule = new Map();
const lastDeclByModule = new Map();
const perSubjectSeen = new Map();

for (const [module, info] of [...modules.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  if (!info.decls.length) continue;
  const center = modulePosition(module, info.subject, info.imports);
  for (let j = 0; j < info.decls.length; j++) {
    const decl = info.decls[j];
    const idx = nodes.label.length;
    if (!firstDeclByModule.has(module)) firstDeclByModule.set(module, idx);
    lastDeclByModule.set(module, idx);

    const localT = info.decls.length === 1 ? 0.5 : j / (info.decls.length - 1);
    const angle = hash01(decl.name) * Math.PI * 2 + j * 0.31;
    const radius = 4 + Math.sqrt(localT) * Math.min(34, 8 + Math.sqrt(info.decls.length) * 3.1);

    nodes.label.push(shortDeclName(decl.name));
    nodes.kind.push(decl.kind);
    nodes.dir.push(info.subject);
    nodes.module.push(module);
    nodes.depth.push(moduleDepth(module, decl.kind));
    nodes.x.push(clamp(center.x + Math.cos(angle) * radius, PLOT.left, PLOT.right));
    nodes.y.push(clamp(center.y + Math.sin(angle) * radius * 0.68, PLOT.top, PLOT.bottom));
    nodes.year.push(configValue(config.year, module));
    nodes.source.push(configValue(config.source, module));
  }
}

const edgeSet = new Set();
for (const [module, info] of modules) {
  for (const imported of info.imports) {
    const a = firstDeclByModule.get(imported);
    const b = firstDeclByModule.get(module);
    if (a !== undefined && b !== undefined && a !== b) edgeSet.add(`${a},${b}`);
  }
}
for (const [module] of modules) {
  const first = firstDeclByModule.get(module);
  const last = lastDeclByModule.get(module);
  if (first === undefined || last === undefined || first === last) continue;
  for (let i = first + 1; i <= last; i++) edgeSet.add(`${i - 1},${i}`);
}

const edges = [...edgeSet].map((s) => s.split(',').map(Number));
const dirs = subjects.map((subject) => {
  const c = subjectCenter.get(subject);
  return {
    name: subject,
    count: subjectCounts.get(subject),
    cx: c.cx,
    cy: c.cy,
    meanDepthY: meanDepthFor(subject),
  };
});

const out = {
  meta: {
    generated: new Date().toISOString(),
    conceptCount: nodes.label.length,
    edgeCount: edges.length,
    dirCount: dirs.length,
    source: `${config.source} source declarations`,
    layout: 'dependency-anchored-preview',
    yearMin: Math.floor(config.year),
    yearMax: Math.ceil(config.year),
  },
  dirs,
  nodes,
  edges,
  externalEdges: buildExternalMathEdges(),
};

fs.writeFileSync(config.out, JSON.stringify(out));
console.log(`wrote ${config.out}: ${nodes.label.length} nodes, ${edges.length} edges, ${dirs.length} subjects, ${out.externalEdges.length} math edges`);

function collectLeanFiles(dir, out) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) collectLeanFiles(full, out);
    else if (ent.isFile() && ent.name.endsWith('.lean')) out.push(full);
  }
}

function moduleSubject(module) {
  if (config.subject) return config.subject(module);
  return module.split('.')[1] || config.source;
}

function mathematicsSubject(module) {
  if (/\.(List|Fin|DataStructures)\b/.test(module)) return 'Data';
  if (/\.(Linear|LinearPMap|LinearMaps|Matrix|InnerProductSpace|SchurTriangulation|PiTensorProduct)\b/.test(module)) return 'LinearAlgebra';
  if (/\.(Geometry|Riemannian|PseudoRiemannian|SO3)\b/.test(module)) return 'Geometry';
  if (/\.(Calculus|VariationalCalculus|Distribution|SpecialFunctions|Trigonometry|FDeriv|Gradient|Divergence|Resolvent)\b/.test(module)) return 'Analysis';
  if (/\.(KroneckerDelta|LeviCivita|RatComplexNum|OneParameterSubgroups)\b/.test(module)) return 'Algebra';
  return 'Analysis';
}

function configValue(value, module) {
  return typeof value === 'function' ? value(module) : value;
}

function anchoredSubjectCenter(subject, seen = new Set()) {
  if (MATH_ANCHORS[subject]) return MATH_ANCHORS[subject];
  if (seen.has(subject)) return MATH_ANCHORS.Computation;
  seen.add(subject);
  const anchors = SUBJECT_ANCHORS[subject] || ['Computation'];
  const points = anchors.map((anchor) => anchoredSubjectCenter(anchor, seen));
  return {
    cx: points.reduce((sum, p) => sum + p.cx, 0) / points.length,
    cy: points.reduce((sum, p) => sum + p.cy, 0) / points.length,
  };
}

function modulePosition(module, subject, imports) {
  const center = subjectCenter.get(subject);
  const importedMathCenter = importedMathAnchor(imports);
  const seen = perSubjectSeen.get(subject) || 0;
  perSubjectSeen.set(subject, seen + 1);
  const count = Math.max(1, subjectCounts.get(subject));
  const spiral = Math.sqrt(seen / count);
  const angle = hash01(module) * Math.PI * 2 + seen * 0.23;
  const radius = 16 + spiral * (74 + Math.sqrt(count) * 1.25);
  const local = {
    x: clamp(center.cx + Math.cos(angle) * radius, PLOT.left, PLOT.right),
    y: clamp(center.cy + Math.sin(angle) * radius * 0.66, PLOT.top, PLOT.bottom),
  };
  if (!importedMathCenter) return local;
  const pull = 0.58;
  return {
    x: clamp(local.x * (1 - pull) + importedMathCenter.x * pull, PLOT.left, PLOT.right),
    y: clamp(local.y * (1 - pull) + importedMathCenter.y * pull, PLOT.top, PLOT.bottom),
  };
}

function buildMathModuleAnchors(data) {
  const anchors = new Map();
  const counts = new Map();
  for (let i = 0; i < data.nodes.module.length; i++) {
    const module = data.nodes.module[i];
    let a = anchors.get(module);
    if (!a) {
      a = { first: i, x: 0, y: 0 };
      anchors.set(module, a);
      counts.set(module, 0);
    }
    a.x += data.nodes.x[i];
    a.y += data.nodes.y[i];
    counts.set(module, counts.get(module) + 1);
  }
  for (const [module, a] of anchors) {
    const count = counts.get(module) || 1;
    a.x /= count;
    a.y /= count;
  }
  return anchors;
}

function importedMathAnchor(imports) {
  const points = [];
  for (const imported of imports) {
    const anchor = mathModuleAnchors.get(imported);
    if (anchor) points.push(anchor);
    if (points.length >= 8) break;
  }
  if (!points.length) return null;
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

function buildExternalMathEdges() {
  if (!mathModuleAnchors.size) return [];
  const edges = [];
  for (const [module, info] of modules) {
    const target = firstDeclByModule.get(module);
    if (target === undefined) continue;
    const seen = new Set();
    for (const imported of info.imports) {
      if (!imported.startsWith('Mathlib.') || seen.has(imported)) continue;
      seen.add(imported);
      const source = mathModuleAnchors.get(imported)?.first;
      if (source !== undefined) edges.push({ sourceRepo: 'mathlib', source, target });
      if (seen.size >= 6) break;
    }
  }
  return edges;
}

function normalizeDeclName(module, raw) {
  if (raw.includes('.')) return raw;
  return `${module}.${raw}`;
}

function shortDeclName(name) {
  return name.split('.').slice(-2).join('.');
}

function moduleDepth(module, kind) {
  const kindWeight = { theorem: 0.4, lemma: 0.25, def: 0.7, abbrev: 0.55, instance: 0.6, class: 0.85, structure: 0.85, inductive: 0.9, axiom: 1 }[kind] || 0.5;
  return Math.min(1, Math.max(0.08, module.split('.').length / 10 * 0.75 + kindWeight * 0.25));
}

function meanDepthFor(subject) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < nodes.label.length; i++) {
    if (nodes.dir[i] !== subject) continue;
    sum += nodes.depth[i];
    count++;
  }
  return sum / Math.max(1, count);
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
