# L48 安全与隐私收口设计

## 状态与基线

- 阶段：L48
- 稳定基线：`stable/l47-business-base`
- 基线 commit：`a23401df53cfae1cd41fd47f94c59f3f974d1e60`
- 工作分支：`work/l48-security-privacy-hardening`
- 状态：待人工确认

## 背景

L47 只为个人中心和团长中心建立了 header-only 身份解析与异常脱敏。项目内其他当前用户接口仍有四类不一致：

1. `/api/me/**` 部分接口仍允许 query 中的身份字段参与解析。
2. `/api/leaders/me/**` 部分写接口仍使用 body 中的团长 ID 决定归属。
3. 多个路由把任意异常消息直接返回客户端，并把未知错误归类为 400。
4. 默认请求日志可能包含带身份 query 的完整 URL；日志失败兜底还会输出完整异常对象。

L48 在现有架构内统一当前用户身份、错误响应、响应隐私和日志隐私，不实现完整登录协议。

## 方案选择

采用“当前用户接口统一安全边界”方案：统一 `/api/me/**`、`/api/leaders/me/**` 的身份解析、角色检查、错误映射、响应字段和日志规则，并增加静态扫描、单元测试和隔离 E2E。

不采用仅修复已知路由的方式，因为缺少防回退；也不在本阶段引入完整登录、限流、跨域策略或数据库加密，因为范围过大。

## 身份边界

新增共享当前用户身份模块：

```ts
resolveCurrentUser(headers): Promise<CurrentUserIdentity>
requireCurrentLeader(identity): CurrentLeaderIdentity
```

规则：

- 只读取 `x-user-id`、`x-openid`。
- 两者都没有：401。
- 两者同时存在：固定以 `x-user-id` 优先。
- 空白值视为不存在。
- 用户不存在：404。
- 用户状态非 active：403。
- query/body 中的用户或团长身份字段不得参与归属判断。
- 为兼容旧请求，遗留身份字段可以保留，但必须被忽略；query-only/body-only 请求不能建立身份。
- 所有 `/api/leaders/me/**` 必须验证当前用户角色为 leader，否则 403。

任何数据查询和写入都必须使用解析后的 `user.id`。团长奖励转换不得再依赖 body 中的团长 ID，且必须验证 commission 属于当前团长。

### 已知限制

L48 仍把身份 header 视为可信入口，不提供密码学认证。生产部署必须由可信网关或后续 session 层清除客户端自带身份 header 并重新注入服务端确认的身份。L48 报告不得宣称已完成完整认证。

## 路由包装与错误处理

提供轻量包装器：

```ts
withCurrentUser(request, reply, fallbackMessage, handler)
withCurrentLeader(request, reply, fallbackMessage, handler)
```

职责：解析身份、检查角色、调用 handler、输出统一响应、映射错误。

错误规则：

- 明确标记为可公开的 4xx 业务错误：保留状态与安全文案。
- 未标记异常、数据库异常和编程异常：统一 500。
- 500 只返回路由固定 fallback 文案。
- 不返回数据库、连接、堆栈、文件路径或内部异常内容。

禁止继续使用“未知异常默认 400 并直接返回原始 message”的路由模式。

## 迁移范围

L48 verifier 必须扫描代码生成真实路由清单。最低包含：

- `/api/me/center-summary`
- `/api/me/orders`
- `/api/me/orders/:id`
- `/api/me/orders/:id/after-sales`
- `/api/me/orders/:id/pickup-code`
- `/api/leaders/me/center-summary`
- `/api/leaders/me/dashboard`
- `/api/leaders/me/rewards/convert-credit`
- 代码库中其他所有 `/api/me/**`、`/api/leaders/me/**`

迁移完成后，这些路由不得导入旧的 query-capable 身份解析器，不得从 query/body 读取身份决定数据归属。

公开的非 `/me` 下单、开团接口不在本阶段强制迁移，但要在报告中列为后续风险。

## 响应隐私

对当前用户与团长接口响应进行递归检查，禁止原始身份、联系方式、详细地址、账户信息、内部人工流水、内部税务备注、管理员备注和管理员处理人 ID 等字段。

允许明确脱敏字段，例如：

- `receiver_phone_masked`
- `receiver_address_masked`
- `manual_reference_masked`

要求：

- 使用显式 DTO，不直接返回完整数据库对象。
- 金额继续使用整数分。
- 成功和失败响应都纳入隐私扫描。

## 日志隐私

### HTTP 日志

Fastify 请求日志只记录 path，不记录 query string；不记录 body；身份 header、后台令牌和会话 header 必须删除或替换为统一占位符。保留 request id、method、path、statusCode、responseTime。

### 业务日志

强化现有递归脱敏：身份标识、手机号、姓名、地址、账户号、内部人工流水和税务/管理员备注不能原样进入 payload、snapshot 或 message。

### 日志失败兜底

`safeRecordBusinessEvent`、`safeRecordOrderTimeline`、`safeRaiseOpsAlert` 不得再输出完整异常对象。只记录 operation、error name、稳定 error code 和可用的 trace/request id，不记录原始 message、stack 或输入 payload。

## 测试设计

严格 TDD，先 RED 后 GREEN。覆盖：

1. query-only 身份返回 401。
2. header 与 query 冲突时只使用 header。
3. body 中的团长 ID 不能切换账户。
4. 普通用户访问任何 `/api/leaders/me/**` 返回 403。
5. inactive 用户返回 403。
6. 未知数据库异常返回脱敏 500。
7. 当前用户响应不存在禁止字段。
8. 请求日志不包含注入的唯一身份标记、手机号和 query。
9. 业务日志兜底不包含原始异常消息与堆栈。

隔离 Docker E2E 使用确定性 fixture，验证跨账号读取失败、团长只能操作本人 commission、非团长 403、响应隐私扫描和日志唯一敏感标记扫描，并在结束后清理 fixture 与临时日志。

## 验收与防回退

新增：

- `scripts/l48-security-privacy-contract.ts`
- `scripts/verify-l48-security-privacy-hardening-local.ts`
- `scripts/run-l48-security-privacy-docker-e2e-local.ts`
- `scripts/verify-l48-security-privacy-docker-e2e-local.ts`
- L48 stage/report 注册与严格发布验证

Verifier 必须检查：

- 自动枚举所有 `/api/me/**`、`/api/leaders/me/**`。
- 全部使用共享当前用户/团长安全边界。
- 不引用旧 query-capable 身份解析器。
- 不用 query/body 身份决定归属。
- 不直接回传任意异常消息。
- 响应隐私扫描通过。
- 日志唯一敏感标记扫描通过。
- L24–L48 chain、API/Admin typecheck、完整 Docker E2E、合规扫描通过。
- 报告绑定最终 L48 HEAD。

## 范围约束

允许修改 API 当前用户身份、安全错误、日志、相关 service/route、受影响 miniapp 调用、L48 测试/verifier/stage/report 工具和文档。

禁止修改：

- `package.json`
- `pnpm-lock.yaml`
- `prisma/schema.prisma`
- `prisma/migrations/**`
- 真实支付、自动打款、自动报税
- Admin 权限模型
- L49+ 功能
- 业务分支中的 `reports/**`、`.tmp/**`

## 非目标

L48 不实现微信登录换 session、JWT/OAuth、完整 API gateway、限流、跨域重构、数据删除/保留机制、数据库静态加密、密钥轮换、Admin 权限重写，以及公共非 `/me` 接口的完整身份重构。

## 完成标准

只有在以下条件全部满足后才能创建最终 PR：

- 所有当前用户/团长接口统一使用 header-only 身份。
- query/body 身份不能替换当前用户。
- 未知异常均为脱敏 500。
- 响应与日志隐私扫描通过。
- 聚焦测试、API typecheck、隔离 E2E、L24–L48 chain、完整 Docker E2E、Admin typecheck、合规扫描全部通过。
- 无依赖、锁文件、Prisma schema、migration 变化。
- 阶段报告绑定最终业务 HEAD。
- 人工 review 无 Critical/Important 阻塞。
- 最终 PR 不自动合并。
