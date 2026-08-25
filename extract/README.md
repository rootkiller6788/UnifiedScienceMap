# 数据提取：数学声明历史地图

从 mathlib4 源码**纯文本**提取数学声明/概念，无需编译 Lean。

## 三个提取器

| 脚本 | 输出 | 用途 |
|---|---|---|
| `extract-decls.mjs` | `web/decls.json` | **声明历史地图**（当前 demo 的数据源，15.3 万节点） |
| `extract-concepts.mjs` | `web/concepts.json` | 概念历史地图（yaml 精选 650 概念，早期 demo，已弃用） |
| `extract-graph.mjs` | `web/graph.json` | 模块 import 依赖图（早期 demo，已弃用） |

## 声明提取器（extract-decls.mjs，当前主力）

```bash
node extract/extract-decls.mjs
```

扫描 `Mathlib/**/*.lean` 的**每一类数学声明**作为节点（≈15.3 万）：

| 类型 | 数量 | 类型权重 T |
|---|---|---|
| theorem | 88,492 | 0.4 |
| lemma | 41,663 | 0.2 |
| def | 19,960 | 0.7 |
| class | 1,519 | 0.85 |
| structure | 1,144 | 0.85 |
| inductive | 164 | 0.9 |
| axiom | 0（数学目录内无命名 axiom） | 1.0 |

### 统一坐标公式（学科簇布局，全部节点同一套计算，无手工坐标）

**X = 学科簇**（网络模式的点团 = 整体模式的圆圈，两种模式对位）：

$$
x_i = \text{学科簇槽位} + \frac{t_i - t_{簇min}}{t_{簇max} - t_{簇min}} \cdot (\text{槽宽}) + \varepsilon_x
$$

- 每个学科一个紧凑横槽，按学科**平均首次进库时间**从左到右排列；槽宽 ∝ √count。
- 簇内节点按其模块时间在槽内铺开（左早右晚）。
- `t_i` = 声明所在模块文件**首次进库的 git 提交时间**（`git log --diff-filter=A`，精确到文件级，8,810 个模块各有独立时间，2021-05 → 2026-08）。

$$
y_i = 0.7\,C(c_i) + 0.2\,D(m_i) + 0.05\,T(k_i) + 0.05\,F(i)
$$

- `C(c_i)` = **社区位置**：学科（顶层目录）内所有节点依赖深度的平均值 → 决定"属于哪片大陆"。基础（Logic/Order/Data/SetTheory 深度 0.30–0.47）在下，抽象构造（Probability/MeasureTheory/AG/Analysis 0.77–0.85）在上。
- `D(m_i)` = **模块依赖深度**：模块 import DAG 的最长路径（`log(1+d)/log(1+d_max)`）。
- `T(k_i)` = **类型权重**（上表）。
- `F(i)` = **确定性局部扰动**（hash ∈ [−0.5,0.5]）。
- 最后 min-max 全局拉伸铺满 16:9 画布。

### 工作流程

1. **扫描源码**：递归遍历所有 `.lean`，剥离块注释 `/- -/` 与行注释 `--`，
   匹配声明（`@[attr]` + `noncomputable/private/mutual/scoped` 修饰 + 7 类关键字 + 名字）。
   - 注释剥离是**关键**：docstring 示例里的伪声明被正确排除。
   - 仅保留以 `Mathlib.` 开头的 import；工具目录（`Control`/`Lean`/`Util`/`Tactic`/`Testing`/`Deprecated`）排除。
2. **首次进库时间**：一条 `git log --reverse --diff-filter=A --format=%at --name-only -- Mathlib/` 拿到全部模块的 add 提交时间。
3. **依赖深度**：Kosaraju 缩点（mathlib 有 1 个 869 模块巨型互导环，先缩点成 7,513 个 SCC）→ 无环图上拓扑 DP 最长路径（最大 134）。
4. **学科簇布局**（x=按时间排的簇槽 + 簇内时间梯度，y=统一深度公式）+ 连线（模块 import 近似，端点=两模块各自第一个声明）。
5. **输出**：列式（SoA）紧凑 JSON。

### 输出格式（web/decls.json）

```jsonc
{
  "meta": {
    "conceptCount": 152942, "edgeCount": 21155, "dirCount": 25,
    "layout": "cluster-formula", "world": { "width": 1600, "height": 900, "pad": 70 },
    "typeWeights": { "theorem": 0.4, "lemma": 0.2, "def": 0.7, "class": 0.85, "structure": 0.85, "inductive": 0.9, "axiom": 1.0 },
    "yearMin": 2021, "yearMax": 2026, "maxDepth": 134
  },
  "dirs": [ { "name": "Algebra", "count": 24218, "cx": 286.1, "cy": 581.4, "meanDepthY": 0.473 } ],
  "nodes": {
    "label": ["add_assoc", "..."],
    "kind": ["lemma", ...],        // theorem|lemma|def|class|structure|inductive|axiom
    "dir": ["Algebra", ...],
    "module": ["Mathlib.Algebra.Group.Defs", ...],
    "depth": [0.35, ...],          // 归一化 y 分量（结构深度）
    "x": [286.1, ...],             // 学科簇内坐标（簇质心 = 整体模式圆圈圆心）
    "y": [581.4, ...],
    "year": [2022.3, ...]          // 文件级首次进库真实年份（hover 直接显示）
  },
  "edges": [ [0, 3509], ... ]
}
```

## 概念提取器（extract-concepts.mjs，已弃用）

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

### 声明提取器（extract-decls.mjs，当前）

| 项 | 值 |
|---|---|
| 声明节点 | 152,942（7 类） |
| 依赖边 | 21,155 |
| 学科 | 25 |
| 类型分布 | theorem 88,492 / lemma 41,663 / def 19,960 / class 1,519 / structure 1,144 / inductive 164 |
| 形式化时间范围 | 2021-05 → 2026-08（文件级首次进库） |
| 最大依赖深度 | 134（缩点后最长路径） |

### 概念提取器（extract-concepts.mjs，已弃用）

| 项 | 值 |
|---|---|
| 概念节点 | 650 |
| 依赖边 | 337 |
| 学科 | 21 |
| 三层分布 | 上层(具体)285 / 中层(基础)71 / 下层(抽象)294 |
| 历史年代范围 | −500 ~ 1950 |
