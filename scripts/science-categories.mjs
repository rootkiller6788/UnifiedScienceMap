// map_of_science 的 11 个学科：权威 id 映射 + 各模式用的颜色。
//
// 为什么单独一个文件：这份映射以前内联在 build-science-atlas-data.mjs 里，是**按位置**索引
// cluster_category 整数的数组；而那份名单的排列顺序与数据集的分配完全不同，于是 11 个名字里
// 有 10 个挂到了错误的 id 上 —— 每一簇化学都被标成 "Medicine"，每一簇医学被标成 "Social
// Systems"。现在两个构建脚本共用这一份，并且按 id 键控，顺序漂移不再可能。
//
// 权威定义：map_of_science/tools/3_data_optimization.ipynb 的 cluster_index_to_name()。
// 下面这张表是它的逐字转写，改了就是改了数据集的语义，不是改了显示。

export const CATEGORIES = {
  0:  { name: 'Biology',           atlasColor: '#22ff55' },
  1:  { name: 'Chemistry',         atlasColor: '#ff8a00' },
  2:  { name: 'Computer Science',  atlasColor: '#1e90ff' },
  3:  { name: 'Earth Science',     atlasColor: '#f8ff45' },
  4:  { name: 'Engineering',       atlasColor: '#26fff4' },
  5:  { name: 'Humanities',        atlasColor: '#c74cff' },
  6:  { name: 'Materials Science', atlasColor: '#00d6a0' },
  7:  { name: 'Mathematics',       atlasColor: '#ffff00' },
  8:  { name: 'Medicine',          atlasColor: '#ff1744' },
  9:  { name: 'Physics',           atlasColor: '#7b28ff' },
  10: { name: 'Social Science',    atlasColor: '#b8c2d6' },
};

// atlasColor 保留构建脚本原来那一组十六进制值、按 id 原样钉住，所以这次改动只换**文字**，
// Atlas / UCSD 两个已有模式的观感一像素都不动。这是有意的范围控制：本次要修的是名字错的 bug，
// 不是重做已有模式的配色。（顺带记一笔：11 个分类色在深色底上过不了 dataviz 校验器的
// all-pairs 门 —— 详见下面 NEW_MODES 的说明。已有模式的这个既有限制不在本次范围内。）
// 11 个值与原数组逐位相同（含 id 10 那个灰），所以 Atlas / UCSD 只会变文字。

export const CATEGORY_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// ---------------------------------------------------------------------------
// 三个新模式的配色策略（Sunburst / Interdisc / River）
//
// 结论是量出来的，不是挑出来的。dataviz 校验器（scripts/validate_palette.js）实测：
//
//   * 11 个分类色：**任何排法都过不了**。搜索 72 个色相桶 × 5 个明度层、以「最大化最差
//     相邻对」为目标的搜索，最好的结果是相邻 normal ΔE 14.79 / CVD 5.20，两道门都没过。
//     reference/palette.md 自己也写明「28 对全在场上时没有任何排序能过」，all-pairs 形式的
//     上限是 3 个槽位。11 个学科是 3 个槽位的三倍还多。
//   * 8 个分类色（参考调色板的 8 个 dark 槽）：**相邻对全过**（最差相邻 CVD 8.4 ≥ 8，
//     normal 19.3 ≥ 15）；**all-pairs 全挂**（最差 CVD 1.6，normal 7.1）。所以 8 色只能用在
//     互相**只有相邻**关系的图上 —— 河流图那种上下堆叠的带，正是这种。
//   * 顺序色阶：文档给的蓝色阶步距是 0.047 OKLCH L，而 ordinal 校验要求相邻步 ≥ 0.06，
//     所以深色底上最多只能取到 **6 个**合法步 —— 11 个学科排不下。
//
// 于是三个模式各自取它唯一站得住的编码：
//
//   Sunburst  11 个 domain → **单色**。环 1 的弧长本身就是量级，再用颜色编码同一个量是冗余；
//             身份由**弧上的直接标注 + 弧间缝隙**承载，不经过颜色。
//   Interdisc 11 个节点 → **单色**（网络要 all-pairs 比较，11 个色不可能过门）。
//             边的**宽度 = 共享主题数**、**颜色 = Jaccard**（连续量，用蓝色顺序色阶），
//             两个通道各管一个量，不冗余。
//   River     8 个真实学科 → **参考调色板的 8 个 dark 槽**（相邻对实测全过）；另外 2 条
//             （Other / Unclassified）是聚合出来的，不是实体，用中性灰标出来。
//
// 共同点：**身份从不单独由颜色承载**，每一处颜色旁边都有直接标注或图例文字。这不是退让，
// 是方法本身在 8 色以上的处方。

// 单色模式用的色调：环 1 / 节点用满不透明度，环 2 / 后续用透明度分档编码权重。
export const MONO_TINT = '#3987e5';

// 顺序色阶（单色相，浅→深），用于 Interdisc 的边色（Jaccard）等连续量。
// 取自参考调色板的蓝色阶；顺序编码允许最浅一档贴近底色，所以可以用满 100→700。
export const SEQUENTIAL_BLUE = [
  '#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7',
  '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b',
];

// 参考调色板的 8 个 dark 分类槽，按槽位 1..8。River 的 8 个真实学科按份额降序依次取用。
// 顺序本身就是 CVD 安全机制，不要重排：这个次序是参考调色板 documented 通过全部门的那一个。
export const CATEGORICAL_8_DARK = [
  '#3987e5', // 1 blue
  '#d95926', // 2 orange
  '#199e70', // 3 aqua
  '#c98500', // 4 yellow
  '#d55181', // 5 magenta
  '#008300', // 6 green
  '#9085e9', // 7 violet
  '#e66767', // 8 red
];

// 聚合带（Other / Unclassified）与分隔线用的中性色。用灰是**语义**上的：它们不是学科实体，
// 是两个被声明过的聚合，灰色让它们在河里一眼可辨为「不是一条真实学科」。
export const AGGREGATE_COLORS = {
  other: '#5b5b57',
  unclassified: '#383835',
  rule: 'rgba(255,255,255,0.10)',
};

export function categoryName(id) {
  return CATEGORIES[id]?.name || `Category ${id}`;
}
