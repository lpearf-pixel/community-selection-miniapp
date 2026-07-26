# 全局风险台账

本文件记录跨阶段、已确认但经人工批准延期处理的产品与工程风险。它是 `docs/plans/global-development-requirements.md` 和 `docs/plans/next-stage-development-plan.md` 的强制补充；后续阶段开始、PR review、Release Candidate 验收和生产发布前均必须检查本台账。

## 1. 状态与处理规则

- `已接受延期`：风险真实存在，负责人已明确同意不阻断当前阶段，但必须按验收条件后续清零。
- `处理中`：已有独立修复分支或 PR，尚未完成验收。
- `已解决`：修复、负向回归和适用的 Docker/数据库验证均已通过，并记录解决 commit 或 PR。
- Important 风险最迟必须在 Release Candidate 或真实生产发布前清零，不得因已记录而长期豁免。
- Minor 风险必须进入后续 verifier、并发测试或工程治理计划；若实际影响扩大，应立即提升等级。
- 阶段自动报告中的“暂无自动发现”仅表示对应自动检查未命中，不等于全局零风险；对外结论必须同时引用本台账。

## 2. L48 后续优化风险

登记日期：2026-07-19  
来源：L48 最终人工 review  
L48 reviewed head：`c4cd5ae755777d32db54c0e4be6d2941e270eebf`  
L48 merge commit / `stable/l48-business-base`：`42b60954999fe46b3cfb0cd2365ca02b48a78440`  
处理决定：负责人已接受延期，不阻断 PR #80 合并；以下项目不得被描述为“零残余风险”。

### GR-SEC-001：非标准手机号脱敏失败时可能返回原值

- 等级：Important
- 状态：已接受延期
- 证据位置：`apps/api/src/modules/user-orders/user-order-service.ts`、`apps/api/src/services/logging-service.ts`
- 风险：当前基于 `String.replace()` 的大陆手机号格式替换在输入不匹配时会返回原字符串。订单只要求收货电话非空，因此座机、国际号码、短号或畸形值可能以 `receiver_phone_masked` 名义返回或写入业务日志。
- 当前保护：标准大陆手机号可正常脱敏；HTTP 日志已排除 headers、query、body、cookie、session 和 IP。
- 后续优化：改为显式格式匹配；未识别格式统一返回 `***` 或 `[FILTERED]`，禁止 fail-open。
- 清零标准：补充座机、国际号码、短号、畸形号码及嵌套日志 payload 的负向测试；API、业务日志和 Docker E2E 均不得出现原值。

### GR-PRIV-002：业务日志脱敏未覆盖 `admin_note` / `adminNote`

- 等级：Important
- 状态：已接受延期
- 证据位置：`apps/api/src/services/logging-service.ts`、`apps/api/src/modules/group-buy/group-buy-expiry-service.ts`
- 风险：中央 sanitizer 已覆盖 `admin_remark`，但未覆盖真实调用路径使用的 `admin_note` / `adminNote`，内部管理员备注可能进入结构化 payload 或自由文本日志。
- 当前保护：其他已登记的敏感 key 和文本模式会被过滤。
- 后续优化：在结构化 key 与自由文本两条路径统一覆盖 snake_case、camelCase 变体。
- 清零标准：使用真实调用点字段名补充顶层、嵌套对象、数组和自由文本回归；验证日志只保留过滤占位符。

### GR-FIN-003：提现幂等键复用时未校验请求语义一致

- 等级：Important
- 状态：已清零
- 证据位置：`apps/api/src/modules/withdrawal/leader-withdrawal-command.ts`、`apps/api/src/modules/withdrawal/leader-withdrawal-executor.ts`、`apps/api/src/modules/withdrawal/withdrawal-domain-ownership.integration.test.ts`
- 风险：同一 leader 重用 `client_request_id` 时，接口可直接返回旧提现记录，而不比较本次佣金集合或金额。不同 payload 可能收到误导性的幂等成功结果。该行为在 L48 稳定基线之前已存在，但仍属于财务正确性风险。
- 清零结论：命令层规范化佣金 ID 集合，执行器在快速命中与 `P2002` 并发恢复路径都比较 leader、佣金集合及已落账金额；原命令可精确重放，佣金集合或显式金额漂移返回公开 `409`。
- 回归保护：单元测试覆盖快速命中和并发恢复的语义冲突，真实 PostgreSQL 验证同 key 重放、变更金额冲突及并发佣金争用，且冲突不产生额外 Withdrawal、关联、账本、审计或事件记录。

### GR-OBS-004：错误码日志策略是宽格式匹配而非严格 allow-list

- 等级：Important
- 状态：已接受延期
- 证据位置：`apps/api/src/modules/current-user/current-user-security.ts`、`apps/api/src/services/logging-service.ts`
- 风险：任意大写字母、数字和下划线组成的字符串都可能被当作稳定错误码记录；形似 `DATABASE_PASSWORD` 的未知值也会原样进入日志。
- 当前保护：错误 message、stack、原始 error 和输入 payload 已被排除；不符合宽格式的 code 会映射为 `UNKNOWN`。
- 后续优化：集中维护严格策略，只允许已知 Prisma `P####`、明确批准的 Node/system code 和受约束的数字码，其余全部映射为 `UNKNOWN`。
- 清零标准：正向覆盖批准码族，负向覆盖 secret-shaped 大写字符串、超长值和带分隔符值；两套日志边界共用同一实现。

### GR-TEST-005：L48 静态 verifier 对未来身份回归覆盖不足

- 等级：Minor
- 状态：已接受延期
- 证据位置：`scripts/verify-l48-security-privacy-hardening-local.ts`
- 风险：verifier 对所有 current-user 路由接受任一身份 wrapper，因此未来 `/api/leaders/me/**` 误用 `withCurrentUser` 仍可能通过；它也未普遍拒绝从 `request.query` 或 `request.body` 读取身份/owner 字段。
- 当前保护：目前 14 条生产路由使用正确 wrapper，权限与 owner scope 的运行时 E2E 已通过。
- 后续优化：leader 路径必须绑定 `withCurrentLeader`；检测身份形态的 query/body 读取；优先基于 AST 或运行时 route inventory，而非文件级子字符串。
- 清零标准：对 wrapper 降级、query identity、body identity 三类 mutation fixture 均能稳定失败，同时当前正确路由全部通过。

### GR-TEST-006：L43 兼容性检查仍可被文件级字符串或注释满足

- 等级：Minor
- 状态：已接受延期
- 证据位置：`scripts/verify-l43-reward-ledger-t3-refund-deduct-local.ts`
- 风险：当前 normalized conversion 实现正确，但 verifier 的文件级字符串匹配可能被无关或注释中的片段满足，不能强证明调用链真实传递幂等键。
- 当前保护：L43 verifier 与 L24–L48 chain 当前均通过，实际实现已使用 normalized `clientRequestId`。
- 后续优化：检查 conversion route 与 ledger call 的 AST；最低限度也应限定路由代码块并先剥离注释。
- 清零标准：注释伪造、断开声明、错误参数传递 mutation fixture 均失败，真实实现通过。

### GR-TEST-007：奖励转换并发安全缺少真实数据库回归

- 等级：Minor
- 状态：已接受延期
- 证据位置：`apps/api/src/routes/leader-reward-conversion-security.test.ts`、Prisma `TaxRecord` 唯一约束
- 风险：当前安全性依赖 `TaxRecord(source_type, source_id)` 唯一约束及“先创建 TaxRecord、再写 ledger”的事务顺序；单元测试 mock 事务，未直接证明两个不同 request ID 并发转换同一佣金时的数据库行为。
- 当前保护：PostgreSQL 唯一约束会让竞争事务以 `P2002` 失败，并回滚同一事务内的后续副作用；人工 review 未认定为现存重复入账缺陷。
- 后续优化：增加隔离 PostgreSQL 并发场景，或引入显式条件 claim 使不变量更直接。
- 清零标准：一个佣金、两个不同 request ID 并发时只允许一次转换成功；credit、debit、TaxRecord 和状态变化各仅一份，失败事务无残留副作用。

## 3. 后续阶段要求

- L49 开始前必须把本文件列入阶段输入，并为 Important 项明确 owner、目标 PR 和回滚方式。
- 任何涉及日志、身份、提现、奖励转换或历史 verifier 的改动都必须复查对应风险，不得只验证 happy path。
- 风险解决后必须在原条目记录解决 PR、commit、验证命令和结果；不得直接删除历史条目。
