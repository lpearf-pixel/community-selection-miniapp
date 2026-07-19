# 全局开发要求

本文件是 `docs/plans/next-stage-development-plan.md` 的强制补充。自 L40 起，Codex、人工开发和后续阶段 PR 均必须同时遵守本文件、阶段计划与 `docs/plans/global-risk-register.md`；三者冲突时，以更严格者为准。

## 1. 稳定基线与分支

- 每个新阶段必须从最新 `stable/lxx-business-base` 创建分支，不得从旧业务分支、报告分支或已污染依赖分支继续开发。
- 开发前必须记录基线分支与 commit SHA，并先确认工作区干净。
- 不允许在尚未合并的功能分支上叠加下一阶段功能。
- 阶段 PR 合并后，先建立对应新的稳定分支，再开始下一阶段。

## 2. 依赖与类型系统

- 新功能开发不得顺带升级 React、React DOM、Ant Design、TypeScript、pnpm 或其他基础依赖。
- `package.json` 与 `pnpm-lock.yaml` 默认禁止修改；确需变更时，必须明确标记为依赖治理任务或经人工批准，并说明兼容性、锁定版本与回滚方案。
- 前端核心依赖必须使用经过验证的兼容版本，禁止因 caret 或 latest 导致安装后版本漂移。
- React 运行时主版本必须与 `@types/react`、`@types/react-dom` 主版本一致；全 workspace 不得混用多套 React 类型。
- 禁止通过 `declare module "react"`、`declare module "antd"`、自定义全局 `namespace JSX`、`any` 或强制类型断言掩盖依赖或组件类型问题。
- `strict` 必须保持开启，`noImplicitAny` 不得关闭。
- `skipLibCheck` 只允许用于隔离已确认的第三方声明文件内部冲突；项目自身 `.ts`、`.tsx` 与自有 `.d.ts` 仍必须完整严格检查。
- 每次依赖调整后必须重建 Node 依赖卷并验证容器内实际解析版本，不能只检查宿主机。

当前 Admin 已验证的兼容基线：

- `react`: `18.3.1`
- `react-dom`: `18.3.1`
- `antd`: `5.23.0`
- `@types/react`: `18.3.27`
- `@types/react-dom`: `18.3.7`
- Admin TypeScript：`strict=true`、`noImplicitAny=true`、`skipLibCheck=true`、`jsx=react-jsx`

后续阶段不得擅自改变以上基线。确需调整时，必须先完成独立兼容性验证，并单独提交依赖治理 PR。

## 3. 开发前置检查

每个阶段开始前必须执行：

1. 读取 `docs/plans/next-stage-development-plan.md` 与本文件。
2. 读取 `docs/plans/global-risk-register.md`，确认未解决风险、当前阶段影响与清零计划。
3. 确认当前阶段已在计划中定义，且不提前开发下一阶段。
4. 确认当前稳定分支 Admin typecheck 为零错误。
5. 确认当前稳定分支 Docker API E2E 通过。
6. 确认当前阶段之前的 chain regression 通过。
7. 检查当前分支相对稳定基线是否意外修改：
   - `package.json`
   - `pnpm-lock.yaml`
   - `tsconfig*.json`
   - `**/*.d.ts`
   - Prisma schema 与 migration
8. 发现基础类型、依赖、Docker 或 verify 问题时，必须暂停业务功能开发，先在独立治理任务中解决。

## 4. 新功能开发要求

- 每个 PR 只实现一个阶段，不得混入下一阶段代码、无关重构或依赖升级。
- 新增 Admin 页面或组件后，必须立即运行 Admin 全量 typecheck，不能等阶段末尾再集中修复。
- 新增 API 后，必须补充成功路径、参数缺失、权限、数据范围、敏感字段和幂等边界验证。
- 新增数据库字段必须有 migration、默认值、历史数据兼容说明与回滚说明。
- 金额继续统一使用整数分；不得使用浮点数存储金额。
- 新增验证脚本必须注册到 stage workflow，并保留 L24 到当前阶段的 chain regression。
- 不得为了让 verify 通过而删除检查、降低严格性、吞掉退出码或把新错误登记为历史基线。

## 5. Admin 与前端质量门禁

每个阶段 PR 合并前必须满足：

```bash
docker compose exec admin sh -lc '
cd /app/apps/admin &&
pnpm exec tsc -p tsconfig.json --noEmit --pretty false
'
```

并检查最终配置：

- `strict === true`
- `noImplicitAny !== false`
- `jsx === react-jsx`
- `skipLibCheck === true` 仅用于第三方声明内部冲突

任何以下错误均不得带入稳定分支：

- React 或 React DOM 类型缺失
- JSX namespace 缺失
- `Button`、`Input`、`Card` 等组件不能作为 JSX 组件
- 隐式 `any`
- 新增源码中的 null/undefined 类型不匹配
- 同一 workspace 中 React 类型主版本混用

## 6. Docker 与验证环境

- 以 Docker 内验证结果作为统一准入标准，避免宿主机与 Linux 容器依赖差异。
- 清理依赖问题时，只删除 Node 依赖与 pnpm store 相关 volume，不得误删 PostgreSQL 数据卷。
- Docker API E2E 必须使用确定性 fixture；涉及 Admin 审核身份时，必须预置真实存在的 AdminUser，不得删除外键或把审计字段置空来绕过。
- verify 命令必须正确传递失败退出码；使用 `sh` 时不得调用不支持的 `set -o pipefail`，需要 pipefail 时使用 `bash`。

## 7. 阶段合并门禁

每个阶段合并前必须全部通过：

1. 本阶段 verifier。
2. raw compliance scan。
3. Docker API E2E。
4. Admin 全量 typecheck。
5. L24 到当前阶段 chain regression。
6. stage workflow 最终输出通过。
7. `reports/` 未进入业务 PR。
8. 没有密钥、token、`.env`、`.git-credentials`。
9. 没有未批准的依赖或锁文件变更。
10. 没有提前开发下一阶段。

任何一项失败，都不得以“历史问题”“环境问题”或“后续再修”为由合并；必须先分类并修复。只有已经由稳定基线证明存在、且有明确清零计划的历史问题，才可在人工批准后临时记录，但 Release Candidate 前必须清零。

## 8. 计划与 PR 描述

后续 Codex 提示词和 PR 描述必须明确包含：

- 基线分支与 commit SHA。
- 本 PR 只实现哪个阶段。
- 是否修改依赖、锁文件、DB schema、migration。
- Admin typecheck、Docker API E2E、阶段 verifier 与 chain regression 的实际结果。
- 不提交 `reports/`。
- 不提前开发下一阶段。

## 9. 当前治理结论

L39 验证治理已确认以下组合可通过完整验证：

- Admin strict typecheck 通过。
- raw compliance scan 通过。
- L39 verifier 通过。
- Docker API E2E 通过。
- L24-L39 chain regression 通过。
- stage workflow 通过。

后续阶段必须保持这套质量门禁，新增功能不得破坏该基线。
## 10. 阶段开发故障复盘与强制规则

### 10.1 Prisma migration

- Docker、CI、部署等非交互环境只能使用 `prisma migrate deploy`，禁止在容器启动链中使用 `prisma migrate dev`。
- `migrate dev` 仅用于人工生成 migration。
- schema 修改必须同时提交正式 migration。
- 已应用 migration 文件不得改名、删除或修改内容，避免 checksum 冲突；后续修复必须新增 follow-up migration。
- 新增 nullable unique 字段前必须检查重复的非空值。
- 如存在重复，只允许确定性修正幂等键，禁止删除财务账本记录或修改金额、方向、余额。
- 禁止通过 `migrate reset`、删除 PostgreSQL volume 或重建数据库解决开发迁移问题。

### 10.2 Docker 启动

- API Docker 默认端口为 13080。
- Docker health、E2E、stage workflow 必须使用同一 API_BASE_URL。
- 容器启动链中的 migration 必须可在非交互环境退出。
- migration 成功后必须继续验证 seed、API server 和 health endpoint。

### 10.3 Verifier 设计

- verifier 必须验证真实业务语义，不得依赖业务源码中的中文注释、兼容关键字或固定文本。
- 禁止为了通过 verifier 向业务源码添加无业务意义的注释。
- 业务逻辑被移动或抽取后，历史 verifier 应跟随真实实现位置。
- 奖励计算必须通过运行时 fixture 验证：商品金额参与、商品退款参与、配送费不参与、配送费退款不改变奖励。
- verifier 不得仅凭某个普通业务词判断失败，例如业务状态 `failed`。
- 成功 marker 只能在对应运行时断言全部通过后输出。
- 禁止通过 `main()` 外部 `console.log`、固定字符串或伪 fixture 输出制造 passed 证据。
- 报告生成器不得仅凭成功 marker 判断业务通过；marker 必须由真实测试场景产生。
- verifier 应检查 success marker 是否位于真实执行路径中。
- 静态源码检查不能替代关键财务、权限、幂等和状态机运行时测试。

### 10.4 Report generator

- 新阶段注册必须同时覆盖：stage boolean、manifest、changed files、API extraction、DB extraction、checklist、verify scripts、verify result detection、report base branch/commit/title。
- 所有 stage dispatch 外层条件必须包含新阶段。
- 报告 helper 的函数名必须通过静态检查和实际 `report:stage` 执行验证，避免调用不存在的函数。
- report API 权限必须来自 manifest 或真实路由配置，不得输出 public/admin session/unknown 等误导信息。
- 发布报告的 source commit 必须与 PR head 一致。

### 10.5 兼容 API

- 旧路由、别名路由和兼容接口必须与新标准接口复用同一权限、data scope、幂等和审计 helper。
- 禁止旧接口绕过新接口的权限限制。
- 对全局批处理、结算、释放、backfill、导出等操作，普通 permission 不足以授权，必须额外验证全局 data scope。
- scoped Admin 不得触发全局状态变化。

### 10.6 PR 元数据

- PR 标题、描述、测试结果、阶段名和最终业务规则必须一致。
- 需求从 T+7 调整为 T+3 后，代码、文档、verifier、manifest、报告和 PR 元数据必须同步修改。
- 已应用 migration 的历史目录名可以保留，但必须在 review 文档中说明，不得修改已应用 migration。
