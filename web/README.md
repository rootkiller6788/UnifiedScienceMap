# 🧮 数学概念依赖力导向图（web）

mathlib4 模块 import 依赖的可视化 demo：**8,402 个模块 / 26,108 条依赖边 / 13 个学科**。

## 运行

因为 `fetch('graph.json')` 与 Web Worker 都要求 http 环境，**不能直接双击打开 index.html**，需起本地静态服务器：

```bash
# 方式一：Python
python -m http.server 8000 -d web

# 方式二：Node
npx serve web -l 8000
```

然后浏览器打开 `http://localhost:8000`。

## 功能

| 交互 | 说明 |
|---|---|
| 滚轮缩放 | 缩放 → 切换 LOD 层级 |
| 拖拽平移 | 平移画布 |
| 悬停模块 | 高亮该模块及其全部依赖连线 |
| 搜索框 | 按模块名定位（如 `Topology`、`NumberTheory`） |
| 图例 | 点击学科开关该分支显隐 |
| ⟳ 重新布局 | 重新跑力导向仿真 |
| ⤢ 重置视图 | 回到自适应全局视图 |

## LOD 分级（不同尺度显示不同细节）

- **远视图（缩放 < 0.5×）**：只显示 13 个学科聚合大节点 + 学科间依赖（边粗细/透明度反映依赖强度）。
- **近视图（≥ 0.5×）**：显示全部模块节点与 import 连线，按学科着色。
- **深放大（≥ 7×）**：叠加显示模块短名。
- 全程视口裁剪：只绘制落在屏幕内的节点/边，保证流畅。

## 架构

```
web/
├── index.html          # 页面外壳 + HUD + 图例 + 搜索
├── main.js             # 主线程：渲染、缩放/平移、LOD、交互、worker 调度
├── layout-worker.js    # Web Worker：d3-force 力导向布局（不卡 UI）
└── graph.json          # 数据（由 extract/ 生成，勿手改）
```

- **布局**：d3-force（Barnes-Hut 近似斥力），在 Web Worker 中逐帧步进，坐标通过
  `transferable` 缓冲区回传主线程；收敛后缓存到 localStorage，下次秒开。
- **渲染**：Canvas 2D 批量 path 绘制（边单条 path、节点按学科分组），
  预留升级 WebGL 的路径（应对未来几十万声明级节点）。
- **数据**：见 [../extract/README.md](../extract/README.md)。

## 依赖（CDN，无构建步骤）

- `d3-force@3`（Worker 内）、`d3-zoom@3`、`d3-selection@3`（jsdelivr ESM）
- 首次加载需联网拉取 CDN 与 graph.json（3.3 MB）。

## 已知边界

- import 依赖是「代码组织耦合」，不是「定理 ⇒ 定理」推导链（见 extract README）。
- 声明级（定理/定义粒度）图谱是下一步升级：需编译 mathlib 并读 olean 常量依赖。
