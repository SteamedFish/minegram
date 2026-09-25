# Minegram

Minegram 是一款围绕“有顺序的连续地雷段”设计的网页解谜游戏。每一行和每一列都由连续地雷数量描述，并且每个生成的棋局都会被证明只有一个解。

可玩版本正在实现中。完整的产品契约、生成算法、交付阶段与验证预算见 [`plan/PLAN.md`](plan/PLAN.md)。

## 计划功能

- 自定义棋盘尺寸与地雷密度
- 在 Web Worker 中生成并证明唯一解棋局
- 根据所需逻辑猜测次数划分难度
- 地雷/空白标记、纠错、计分、拖动批量标记与键盘操作
- 响应式且无障碍友好的界面
- GitHub Pages 部署

## Phase 0 基础

仓库现在包含 Node 24+、React、TypeScript 与 Vite 基础工程。当前仅提供 Phase 0 的占位应用外壳，暂未实现游戏算法或视觉设计。

安装依赖并运行可复现检查：

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Vite 的生产环境 base path 为 `/minegram/`，GitHub Pages 工作流会上传生成的 `dist/` 目录。
