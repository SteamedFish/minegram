# Minegram

Minegram 是一款围绕“有顺序的连续地雷段”设计的网页解谜游戏。每一行和每一列都由连续地雷数量描述，并且每个生成的棋局都会被证明只有一个解。

可玩版本正在实现中。完整的产品契约、生成算法、交付阶段与验证预算见 [`plan/PLAN.md`](plan/PLAN.md)。

## 计划功能

- 自定义棋盘尺寸与地雷密度
- 在纯引擎中生成并证明唯一解的确定性棋局（Worker 集成仍属于后续阶段）
- 根据精确的最低猜测次数分析难度
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

求解器与参考计数器均为 DOM-free 实现。预算耗尽、取消、资源耗尽或不完整搜索都会 fail closed 并返回 `unknown`；只有完整搜索才可能返回 `unique` 或 `multiple`。

## Phase 2 确定性生成器与难度

`src/engine/generator/` 提供 DOM-free 的 `normalizeGenerationSettings` 与 `generateMinegramPuzzle` API。设置支持每边 1–24 格、最多 576 格、0–100 的整数密度、默认 `starter`、字符串/数字 seed，以及正安全整数 `maxAttempts`。24 格上限来自求解器每条线段的模式枚举容量，而非搜索预算：25×25 及更大的棋盘无论节点预算或时间预算如何，都会以 `resource-limit` 失败关闭。地雷数量为 `clamp(round(rows * columns * density / 100), max(rows, columns), rows * columns)`。

每个 root 都派生独立的 seeded stream，先生成 Fisher–Yates 随机布局，再生成低 run 数的连续行结构化 fallback，并进行有界列覆盖修复。当下限雷数等于棋盘较长边时，确定性的 seeded matching 会为较长边每条线各放一颗雷，并覆盖另一边的每条线，因此矩形最小数量候选在 solver gate 前仍具备可行的行/列覆盖。候选必须拥有精确目标数量、每行每列至少一颗地雷、由棋盘推导的线索，以及返回解与候选一致的完整 `unique` 证明。随后生成器复用这一个已证明且不可变的 witness 来重放前缀：每个被接受的事件都记录前缀子集、精确 witness、线索、唯一性证明和解身份。交付前始终执行新的独立唯一性证明。生成调用默认使用 3,000 ms 的 wall-clock deadline；候选与最终证明共享 `maxSolverNodes` 节点预算（默认 100,000），精确难度分析使用独立的 generation-wide `maxDifficultyNodes` 预算（默认 2,000）。所有工作共享 deadline 与取消信号，任何预算耗尽都会 fail closed。

`src/engine/solver/difficulty.ts` 在强制传播后使用有界 decision-threshold search 计算精确的最坏情况最低二元格猜测次数；只有阈值被证明时才返回 known，取消、时间、节点或资源限制都会返回带类型的 unknown。只有两个分支都继续存在时才计为一次猜测；立即矛盾的分支推断成本为零。`starter=0`、`steady=1..2`、`challenging=3..5` 是精确难度带；`expert` 是 `>=6` 的下界。分析或生成预算未知时一律 fail closed。普通固定 seed 的 15×15/60% 有确定性 smoke 路径；病态 30×30 设置可能返回明确的 `resource-limit`，不会接受未经证明的棋盘。Phase 2 的 parent Oracle gate 已通过且没有阻塞项。在有界的 6×6–10×10 生成搜索以及对唯一 3×3/4×4 棋盘的穷举检查中，尚未观察到 nonstarter 难度带；因此请求 nonstarter 设置时会返回文档化的 typed `difficulty-not-found`，而不会放宽唯一性要求。

游戏 reducer、Worker adapter 与可玩 UI 仍属于后续阶段。

安装依赖并运行可复现检查：

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Vite 的生产环境 base path 为 `/minegram/`，GitHub Pages 工作流会上传生成的 `dist/` 目录。
