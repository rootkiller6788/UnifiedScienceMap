# 数据提取：mathlib4 模块依赖图

从 mathlib4 源码**纯文本**提取模块 import 依赖图，无需编译 Lean。

## 运行

```bash
node extract/extract-graph.mjs    # 生成 web/graph.json
node extract/verify.mjs           # 校验并打印统计
```

## 工作原理

- 递归遍历 `Mathlib/**/*.lean`，模块名 = 文件相对路径字符串变换
  （`Mathlib/Topology/Basic.lean` → `Mathlib.Topology.Basic`）。
- 解析行首 `^(?:public |private )?import\s+(Mathlib\.*)`，
  排除外部依赖（`Batteries`/`Lean`/`Aesop`/`Qq`/`Std` 等）。
- 学科分类来自 `branches.mjs`（Mathlib 顶层目录 → 学科大分支 → Okabe-Ito 配色）。

## 输出格式（web/graph.json）

```jsonc
{
  "meta":  { "nodeCount": 8402, "edgeCount": 26108, "branchCount": 13, ... },
  "nodes": [ { "id": "Mathlib.Topology.Basic", "branch": "topology", "depth": 3, "imports": 5 } ],
  "edges": [ { "source": "Mathlib.X", "target": "Mathlib.Y" } ],
  "branchGraph": {
    "nodes": [ { "id": "algebra", "label": "代数", "color": [0,114,178], "count": 2747 } ],
    "edges": [ { "source": "algebra", "target": "category", "weight": 264 } ]
  }
}
```

`edges[].source` 是被 import 的模块，`target` 是 import 它的模块（依赖方向）。

## 数据语义边界

- import 耦合 = **代码组织依赖**（本文件用到了别的文件），
  **不是**「定理 A ⇒ 定理 B」的严格数学推导链。
- 展示的是 mathlib4 的模块结构与耦合关系，够用且诚实。

## 当前统计（2026-08）

| 项 | 值 |
|---|---|
| 模块节点 | 8,402 |
| import 边 | 26,108 |
| 学科 | 13 |
