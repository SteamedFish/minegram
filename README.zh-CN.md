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

## Phase 1 领域与求解器基础

当前已加入纯 TypeScript 基础层：

- `src/domain/`：按行优先排列的二元棋盘类型、尺寸/坐标校验、有序行/列线索编解码，以及棋盘线索推导。零值 run 会作为 no-op alias 接受；公开的规范化与相等性辅助函数会先把每个 run 校验为非负安全整数，规范化结果则是冻结的正 run 规范形式。
- `src/engine/rng.ts`：带种子的 uint32/浮点/整数随机流，可重启并按标签派生可复现的子流。
- `src/engine/solver/`：按棋盘线长与线索缓存的合法模式、有限域一致性过滤和强制单元传播、确定性的 count-to-two 搜索，以及明确的 `unique` / `multiple` / `none` / `unknown` 结果。
- `src/engine/referenceCounter.ts`：面向最大 4×4 棋盘的独立二元枚举参考计数器，明确暴露 cap、node、time 和 cancellation 状态。

模式物化采用 fail-closed 策略。每条线默认最多保留 10,000 个完整模式和 300,000 个已物化的二元单元；有界 LRU 最多保留 256 个完整条目和 1,000,000 个单元，命中时会刷新顺序，并且只有完整枚举才有资格进入缓存。在完成前停止时不会留下部分枚举数据。模式/单元上限与物化数量都采用非负安全整数校验，零上限仍是有效的 fail-closed 限制；直接预算检查会在比较前校验 context、线长、线索、数量及安全的单元数运算。超过上限会抛出带类型的资源错误，求解器会将其报告为带资源诊断的 `unknown`。取消、零 node/time 预算，以及枚举过程中的协作式时间检查同样会 fail closed；取消与零时间预算会在 preflight 阶段直接返回，不调用用户 clock；部分域绝不会被当作唯一性证明。公开的低层传播接口会在任何修改前校验域尺寸、显式非空整数模式索引和赋值描述符，且只有显式传入 `undefined` 时才会把初始赋值视为省略。

求解器与参考计数器均为 DOM-free 实现。预算耗尽、取消、资源耗尽或不完整搜索都会 fail closed 并返回 `unknown`；只有完整搜索才可能返回 `unique` 或 `multiple`。事务式生成器、游戏 reducer、Worker adapter 和可玩 UI 仍属于后续阶段。

安装依赖并运行可复现检查：

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Vite 的生产环境 base path 为 `/minegram/`，GitHub Pages 工作流会上传生成的 `dist/` 目录。
