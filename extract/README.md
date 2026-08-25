# 数据提取：数学概念历史地图

从 mathlib4 源码**纯文本**提取精选数学概念/定理，无需编译 Lean。

## 两个提取器

| 脚本 | 输出 | 用途 |
|---|---|---|
| `extract-concepts.mjs` | `web/concepts.json` | **概念历史地图**（当前 demo 的数据源） |
| `extract-graph.mjs` | `web/graph.json` | 模块 import 依赖图（早期 demo，已弃用） |

## 概念提取器（extract-concepts.mjs）

```bash
node extract/extract-concepts.mjs
```

### 数据源（三份 yaml 合并）

- `docs/undergrad.yaml` — 本科数学课程体系（学科 → 子领域 → 概念 decl）
- `docs/overview.yaml` — 数学总览主题
- `docs/100.yaml` — Freek Wiedijk「100 定理」清单（带 decl 的部分）

合并后按 `decl` 去重，得到 ~776 个原始概念。

### 工作流程

1. **解析 yaml** 三层结构（学科 → 子领域 → 概念），过滤空值 `''` 与 URL。
2. **扫描源码** `Mathlib/**/*.lean`，一次性建立两个索引：
   - `declToFiles`：声明短名 → 所在模块集合
   - `nsToFiles`：namespace 名 → 所在模块集合
   - 同时收集模块 import 边。
3. **定位**：概念 decl（如 `MulAction.sum_card_fixedBy_eq_card_orbits_mul_card_group`）
   按短名查索引，优先选同时含对应 namespace 的模块。
4. **分类**：给每个概念赋两个坐标语义——`tier`（三层抽象）+ `era`（历史年代）。
   - `tier`：0=具体/离散代数（群环域组合数论几何），1=基础骨架（集合论逻辑范畴论），2=抽象/连续（拓扑分析测度概率动力系统）。
   - `era`：手工映射的学科历史年代（欧氏几何 −300、群论 1830、拓扑 1900、测度 1902、概率 1933、范畴论 1945…）。少数著名定理（勾股定理、素数定理等）按定理名精确覆盖。
5. **确定性布局**：三层水平带（Y）+ 团按 era 排序（X），团内网格打包，无随机、无重叠。

### 输出格式（web/concepts.json）

```jsonc
{
  "meta": {
    "conceptCount": 650, "edgeCount": 337, "branchCount": 21,
    "layout": "map",
    "world": { "width": 1600, "height": 900, "plot": { "left": 95, "right": 1565, "top": 55, "bottom": 845 } },
    "tierLabels": { "0": "具体/离散代数…", "1": "基础通用骨架…", "2": "抽象/连续…" },
    "eraMin": -500, "eraMax": 1950
  },
  "nodes": [
    { "id": 0, "label": "vector space", "decl": "Module", "branch": "Linear algebra",
      "cluster": "Fundamentals", "tier": 0, "era": 1850, "module": "Mathlib.Algebra.Algebra.Basic",
      "x": 1144.7, "y": 78.7 }
  ],
  "edges": [ { "source": "declA", "target": "declB" } ],
  "branches": [ { "name": "Topology", "count": 66, "tier": 2, "era": 1900 } ],
  "tiers": [ { "id": 0, "y": 172 }, { "id": 1, "y": 450 }, { "id": 2, "y": 728 } ]
}
```

## 数据语义边界

- **历史年代 `era` 是近似值**：mathlib 仓库不含数学史年代数据，
  `1000.yaml` 的 `date` 字段是 Lean *形式化*年份（2017–2026），非定理出现年代。
  这里按学科/子领域手工映射年代，用于「时间排名」，非「精确到某定理某年」。
  精确年代可后续接 Wikidata（`1000.yaml` 每个定理带 Q-id）。
- **连线 = 模块 import 近似**：概念 decl 定位到模块，模块间 import 依赖即连线，
  是「代码组织耦合」，非严格「定理 ⇒ 定理」推导链。
- 定位失败的 decl（短名被改写/太泛）会被丢弃，最终 650 节点 vs 776 原始。

## 当前统计（2026-08）

| 项 | 值 |
|---|---|
| 概念节点 | 650 |
| 依赖边 | 337 |
| 学科 | 21 |
| 三层分布 | 上层(具体)285 / 中层(基础)71 / 下层(抽象)294 |
| 历史年代范围 | −500 ~ 1950 |
