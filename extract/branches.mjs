// 学科分支 → 颜色/聚合 映射表。extract 脚本与前端共用。
//
// branch 键 = Mathlib 顶层子目录名；聚合到学科大分支，每个学科一个颜色。
// 颜色取自 Okabe-Ito 色盲安全色板，保证分支区分度。

// Okabe-Ito 色板（RGB 0-255）
const PALETTE = {
  algebra: [0, 114, 178], // 蓝
  topology: [230, 159, 0], // 橙
  analysis: [0, 158, 115], // 绿
  category: [204, 121, 167], // 紫
  numberTheory: [213, 94, 0], // 暗橙
  setTheory: [0, 158, 115], // ——
  logic: [86, 180, 233], // 天蓝
  computation: [240, 228, 66], // 黄
  geometry: [213, 94, 0], // ——
  combinatorics: [230, 159, 0], // ——
  measure: [0, 158, 115], // ——
  base: [120, 120, 120], // 灰（基础/工具）
  other: [169, 169, 169], // 兜底
};

// 学科大分支：branch → { label, color }
const BRANCH_META = {
  algebra: { label: '代数', color: PALETTE.algebra },
  topology: { label: '拓扑', color: PALETTE.topology },
  analysis: { label: '分析', color: PALETTE.analysis },
  category: { label: '范畴论', color: PALETTE.category },
  numberTheory: { label: '数论', color: PALETTE.numberTheory },
  setTheory: { label: '集合论', color: PALETTE.setTheory },
  logic: { label: '数理逻辑', color: PALETTE.logic },
  computation: { label: '计算/信息', color: PALETTE.computation },
  geometry: { label: '几何', color: PALETTE.geometry },
  combinatorics: { label: '组合', color: PALETTE.combinatorics },
  measure: { label: '测度/概率', color: PALETTE.measure },
  base: { label: '基础/工具', color: PALETTE.base },
  other: { label: '其他', color: PALETTE.other },
};

// Mathlib 顶层目录 → 学科大分支
const DIR_TO_BRANCH = {
  // 代数族
  Algebra: 'algebra',
  RingTheory: 'algebra',
  FieldTheory: 'algebra',
  GroupTheory: 'algebra',
  LinearAlgebra: 'algebra',
  RepresentationTheory: 'algebra',
  // 拓扑
  Topology: 'topology',
  AlgebraicTopology: 'topology',
  // 分析
  Analysis: 'analysis',
  Dynamics: 'analysis',
  // 测度与概率
  MeasureTheory: 'measure',
  Probability: 'measure',
  // 范畴论与代数几何
  CategoryTheory: 'category',
  AlgebraicGeometry: 'category',
  Condensed: 'category',
  // 数论
  NumberTheory: 'numberTheory',
  // 集合论
  SetTheory: 'setTheory',
  // 逻辑
  Logic: 'logic',
  ModelTheory: 'logic',
  // 计算/信息
  InformationTheory: 'computation',
  Computability: 'computation',
  // 几何
  Geometry: 'geometry',
  // 组合
  Combinatorics: 'combinatorics',
  // 基础/工具（Data 是核心结构，Order 贯穿全局）
  Data: 'base',
  Order: 'base',
  Control: 'base',
  Util: 'base',
  Lean: 'base',
  Tactic: 'base',
  Testing: 'base',
  Deprecated: 'base',
};

// 模块名第二段（Mathlib.<X>...）→ 学科分支，未命中兜底 other
export function branchOf(moduleName) {
  const segs = moduleName.split('.');
  if (segs[0] !== 'Mathlib' || segs.length < 2) return 'other';
  return DIR_TO_BRANCH[segs[1]] || 'other';
}

export { BRANCH_META, DIR_TO_BRANCH };
