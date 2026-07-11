# Admin TypeScript 与严格 verify 体系治理复盘

## 范围

本次治理暂停 L40 业务开发，只处理 Admin TypeScript 全局 JSX 类型错误与 stage verify 分类能力；未新增 API、数据库字段、migration、支付/退款/配送接口或 L40 页面功能。

## 根因结论

Admin 全局 JSX 错误的真实根因是 `apps/admin/src/types.d.ts` 中存在本地 ambient override：

- `declare module 'react'` 覆盖了官方 React 类型，导致 JSX 运行时与组件返回类型退化为 `unknown`。
- `declare module 'react/jsx-runtime'` 覆盖了 React JSX runtime，令 JSX 元素推断为 `unknown`。
- `declare module 'antd'` 手写声明了 `Button`、`Input`、`Card`、`Form`、`Table` 等组件，props 使用 `{ [key: string]: unknown }`，从而触发 `Record<string, unknown>` 不能赋给 Ant Design 组件 props、`data-*` 属性的 `unknown` 不能赋给 `string` 等系统性错误。
- `declare namespace JSX { interface IntrinsicElements { [elemName: string]: unknown } }` 污染全局 JSX 命名空间，使 JSX 元素和 Intrinsic 属性检查偏离 React 官方类型。

这些错误同时出现在大量历史页面，说明它不是单页业务代码问题，而是 Admin 全局类型源被本地声明污染。

## 版本与类型解析记录

受当前执行环境限制，本机没有可用 Docker CLI，且 pnpm 由 Corepack 拉取 `pnpm@9.15.4` 时被网络代理阻断，因此无法在本环境完成容器内版本命令。根据仓库依赖声明，本基线期望版本范围为：

- React：`^19.0.0`
- React DOM：`^19.0.0`
- Ant Design：`^5.23.0`
- TypeScript：`^5.7.3`
- `@types/node`：`^22.10.5`

实际 TypeScript 解析应回到官方包类型：

- `react` / `react/jsx-runtime`：由安装后的 React 19 / React 类型入口提供。
- `react-dom/client`：由 React DOM 官方类型入口提供。
- `antd`：由 Ant Design 5 官方类型入口提供。
- `vite/client`：由 Admin tsconfig 的 `types` 显式包含。

## 是否存在多份 React 类型

仓库本身未在 `package.json` 中直接声明 `@types/react` 或 `@types/react-dom`。由于本环境无法完成依赖安装与 `pnpm why`，未能验证容器中是否存在多份 React 类型。治理后的配置通过删除本地 React override，并且不把 `react` / `react-dom` 放入 `compilerOptions.types` 白名单，避免把 React 类型包误当作必须存在的全局 `@types/*` 入口。

## 是否存在本地 JSX / antd override

存在，位置为 `apps/admin/src/types.d.ts`。本次已删除 `react`、`react-dom/client`、`react/jsx-runtime`、`antd` 和全局 `JSX.IntrinsicElements` 的手写声明，仅保留 Vite 环境变量接口。

## 最终修复方式

1. 删除本地 React / JSX runtime / Ant Design ambient module override，让官方类型生效。
2. Admin tsconfig 仅显式包含 `vite/client`，不把 React 类型包作为 `compilerOptions.types` 白名单项，让 TypeScript 按默认 node_modules 规则解析 React / Ant Design 类型。
3. 将 `skipLibCheck` 设为 `false`，避免用跳过库检查掩盖类型冲突。
4. 新增结构化 verification result 模型，区分阶段、合规安全、新增类型、历史基线类型、环境错误。
5. 新增 Admin type baseline diff 工具：默认只比较当前错误与基线；新增错误阻塞，基线错误报告但不自动隐藏，`--update-baseline` 才能显式更新基线。
6. L50 / Release Candidate 继续要求 full typecheck 零错误；publish 禁止 `--typecheck-mode=off`。

## 为什么不使用 any / skipLibCheck

本问题是全局类型源污染。如果使用 `any`、手写 antd shim 或 `skipLibCheck`，只能降低检查强度，无法恢复 React 19、Ant Design 5 与 TypeScript 的官方类型契约。本次治理删除污染源并开启库检查，保持严格性。

## baseline-aware verify 设计

新增 `scripts/lib/verification-result.ts`，统一错误分类：

- `stage`：本阶段业务 verifier 错误，阻塞。
- `security`：安全与合规错误，始终阻塞。
- `new-type-error`：本 PR 新增 TypeScript 错误，阻塞。
- `baseline-type-error`：历史基线 TypeScript 错误，过渡期报告但不阻塞业务 PR。
- `environment`：Docker、依赖解析、命令执行等环境错误，阻塞。

新增 `scripts/verify-admin-type-baseline-local.ts`：

- 运行 Admin 全量 typecheck。
- 规范化 TypeScript 错误，去掉行列号，保留文件路径、错误码与摘要。
- 当前错误与 `scripts/baselines/admin-typecheck-errors.txt` 比较。
- 新增错误阻塞。
- 已知基线错误报告。
- 消失的基线错误作为改善输出。
- 默认禁止自动更新基线，只有 `--update-baseline` 才写入。

当前目标是 Admin typecheck 零错误，因此基线文件保持为空；若未来出现错误，baseline 工具会把所有错误视为新增并阻塞。

## stage-workflow 使用方式

- `--typecheck-mode=full`：直接运行 Admin full typecheck，任何错误阻塞。
- `--typecheck-mode=baseline`：运行 baseline diff，新增错误阻塞，历史基线错误仅报告。
- `--typecheck-mode=off`：仅供本地诊断；publish 模式禁止。
- 默认策略：L40-L49 使用 baseline；L50 及 Release Candidate 使用 full。

后续业务阶段应优先使用 full typecheck；如确有历史基线，业务 PR 可使用 baseline 模式，但安全合规错误和新增 TypeScript 错误始终阻塞。
