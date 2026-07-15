# 跨阶段 Verifier 与 E2E 兼容规范

本规范适用于所有 Lxx 阶段开发、回归 verifier、Docker E2E 和阶段报告门禁。

## 1. Verifier 检查业务语义，不绑定实现细节

- 检查权限、data scope、事务、幂等、分页和审计等不变量。
- 禁止只检查局部变量名、临时 helper 名、固定代码排版或函数定义在文件中的绝对位置。
- 实现重构后，旧阶段 verifier 应接受语义等价实现，但不得降低安全和业务约束。
- 检查调用顺序时，必须先截取目标函数或路由区块，不能对整个文件直接 `indexOf`。
- 静态 verifier 读取源文件文本时，`\t`、`\r`、`\n`、反引号和 `${...}` 等源码字符不得通过会被 JavaScript/TypeScript 再解释的普通字符串做整行精确匹配；应使用 `String.raw`、正确的双重转义，或先定位目标行/代码块再检查关键语义片段。
- 新增涉及转义字符的静态断言后，必须在真实目标源文件上直接运行 verifier，不能只凭肉眼判断转义层级。

## 2. Fixture、查询条件与期望结果必须形成显式契约

每个 E2E 场景必须明确记录：

1. fixture 属于哪个 scope；
2. 哪些字段是可搜索字段；
3. 哪些字段只是 CSV 公式注入等安全 fixture；
4. 查询使用哪些筛选条件；
5. 预期命中的具体 ID 集合和数量。

禁止：

- 使用未出现在可搜索字段中的 `runId` 作为 keyword，却断言所有 fixture 都应命中；
- 用 `>= 2` 等魔法数字掩盖 fixture 与查询不一致；
- 将危险 CSV 文本同时假定为普通关键词，除非接口明确支持该字段搜索；
- 先写 success marker，再补真实断言。

分页测试与筛选测试应分开：

- 分页测试使用确定性 scope 和无歧义条件，断言精确 `total`、第一页、第二页和 ID 集合；
- 每种筛选条件单独使用真实可命中的字段验证；
- CSV 安全测试应确保危险 fixture 实际进入导出结果。

## 3. 跨阶段修改的回归要求

当新阶段修改旧阶段已有文件时，开发者必须：

1. 搜索所有旧 verifier 对该文件的引用；
2. 先运行当前阶段 verifier；
3. 再运行被影响的上一阶段 verifier；
4. 最后运行完整 chain；
5. 若旧 verifier 因等价重构失败，应修复 verifier 的语义检查，而不是恢复更差的实现。

## 4. 运行时证据要求

- 静态 verifier 只能证明结构存在，不能替代 API 和数据库运行时检查。
- Docker E2E 必须基于真实 API 响应和 Prisma 状态断言。
- 拒绝、越权和校验失败必须断言无数据库副作用。
- 日志 marker 必须由已经通过的真实变量和断言产生。

## 5. 阶段交付前检查清单

- [ ] fixture-query 期望矩阵已核对；
- [ ] 没有变量名、排版或魔法数量门禁；
- [ ] 涉及源码转义字符的 verifier 已使用 `String.raw`、双重转义或语义化代码块检查；
- [ ] 修改过的旧模块对应旧 verifier 已运行；
- [ ] 分页、筛选、scope、CSV 和并发分别有独立断言；
- [ ] stage report 与当前 head、merge-base 和真实 diff 一致；
- [ ] 完整 chain 与 report publish verifier 均通过。


## 6. Docker API 就绪与网络诊断

- `docker compose exec api ...` 只说明容器可执行命令，不代表 API 端口已经监听。
- 仓库源码以 bind mount 挂载，`git switch`、`git reset` 和批量文件更新会触发 `tsx watch` 重启；Docker E2E 必须先轮询 `/api/health`，不得立即发起业务请求。
- E2E 默认地址应与 Docker healthcheck 保持一致，并允许通过 `API_BASE_URL` 显式覆盖。
- 所有 HTTP transport 错误必须输出 method、完整 URL、超时信息以及底层 cause（如 `ECONNREFUSED`、`ENOTFOUND`），禁止只打印 `fetch failed`。
- 就绪超时后必须提示执行 `docker compose ps` 和 `docker compose logs --tail=200 api`。
- API 就绪等待只能处理启动/重启竞态；若服务持续启动失败，验收仍应失败并保留真实日志，禁止通过跳过 E2E 放行。

## 7. E2E 可重跑与唯一字段规范

- 每次 E2E 运行必须生成独立 run token；token 至少组合时间、进程标识和随机片段，或使用等价的 UUID。
- 所有带唯一约束的 fixture 字段都必须包含 run token，例如 `openid`、`order_no`、`client_request_id`、外部流水号和幂等键。
- 安全测试需要以制表符、`=`、`+`、`-`、`@` 等危险字符开头时，必须保留危险前缀并在后面拼接 run token，禁止把固定危险值直接写入唯一字段。
- 上一次运行中断或失败后留下的数据，不得阻塞下一次运行；E2E 必须能够直接重跑。
- 并发执行两个 E2E 进程时，fixture 不得发生唯一键碰撞。
- 可以增加 best-effort cleanup，但 cleanup 不能成为可重跑的唯一保障；核心保障必须是每次运行的唯一命名空间。
- 出现唯一约束错误时，应先检查 fixture 唯一性契约，不得删除业务唯一索引或降低数据库约束来让测试通过。

## 9. 持久化 JSON 与幂等比较规范

- PostgreSQL `json` / `jsonb`、ORM 和序列化层不保证对象键顺序与请求输入顺序一致。
- 禁止使用原始 `JSON.stringify(previous) === JSON.stringify(current)` 判断持久化 JSON 的业务等价性。
- 幂等请求必须先把默认值、nullable 字段和枚举状态规范化为固定业务快照，再使用递归深比较或键排序后的 canonical serialization。
- 对象键顺序不应影响幂等结果；数组顺序只有在业务语义定义为有序时才参与比较。
- 同一幂等键和语义等价 payload 必须返回幂等成功；同一幂等键和真实字段差异必须返回 409。
- Docker E2E 必须覆盖数据库 round-trip 后的重复请求，并至少一次使用不同属性插入顺序构造语义相同的 payload。
- 静态 verifier 必须禁止顺序敏感的持久化 JSON 比较，但不能把具体 helper 名作为唯一实现方式；门禁应围绕语义等价、canonicalization 或 deep equality。

## 10. HTTP 文本解码与原始字节验证规范

- `Response.text()`、`TextDecoder` 等文本解码层可能消费 UTF-8 BOM；解码后的首字符不是 `U+FEFF`，不能证明响应缺少 BOM。
- CSV BOM、文件签名、压缩头、图片魔数等传输层属性必须通过 `arrayBuffer()` / 原始字节验证，禁止对解码后的字符串使用 `charCodeAt(0)` 作为字节证据。
- UTF-8 BOM 应精确验证前三个字节为 `0xEF 0xBB 0xBF`；验证后再从 BOM 之后解码正文。
- 调试日志应记录首字节数组和 BOM 判断结果，但不得把完整敏感文件内容写入日志。
- 静态 verifier 必须阻止把文本解码结果冒充原始传输字节证据。

## 11. API 响应契约与跨阶段消费者规范

- API 从裸数组升级为分页 envelope、字段重命名或嵌套结构调整时，必须搜索并更新所有旧阶段 E2E、Admin/小程序客户端、类型定义和 verifier 消费者。
- 测试不得只依赖 TypeScript 泛型“声明”响应形状；必须对运行时 envelope（如 `items`、`total`、`page`、`page_size`）执行断言后再访问记录。
- 分页接口禁止继续对响应根对象调用 `.some()`、`.map()`、`.length` 等数组方法；应明确访问 `response.items`。
- DTO 字段必须使用接口当前公开名称，例如 `tax_record_id`，不得继续假设 Prisma 原始字段 `id`。
- 新阶段改变既有 API shape 时，完整 chain 中所有受影响旧阶段场景都必须真实运行；不能只修改当前阶段 verifier。
- 静态 verifier 应阻止已知旧 shape，但不能把某一个局部变量名作为唯一门禁；重点应是 envelope 与 DTO 的公开契约。



L45 final review markers: `l45_tax_detail_success=true` confirms scoped detail API runtime coverage; `l45_export_limit_guard=true` confirms deterministic export limit guard coverage. None-mode tax review must reject non-zero tax amounts without database side effects, and terminal same-key replay must remain idempotent after paid/rejected status.

## 14. 多重关联字段 Fixture 一致性规范

- 当同一业务关系同时由直接外键和关联表表达时，E2E fixture 必须同步写入两种表示，不能只构造查询侧能看到的一半数据。
- 若生产状态迁移同时校验 `Commission.withdrawal_id`、`Commission.status` 与 `WithdrawalCommission`，fixture 必须在调用迁移前断言三者一致。
- 测试出现“关联状态已变化”时，应先核对 fixture 是否满足生产 where 条件，不得放宽生产并发或状态守卫来迎合不完整 fixture。
- 静态 verifier 应检查关系构造语义；Docker E2E 应在关键状态迁移前输出或断言真实数据库关系。

## 15. 接口契约驱动测试规范

- 新增或修改 API 时，必须同时维护人类可读接口说明书和机器可读接口契约；路由实现、接口文档、契约文件和 E2E 必须在同一个 PR 中更新。
- E2E、集成测试和报告 detector 在编写状态码、方法、路径、并发数量前，必须读取对应机器契约，禁止凭经验硬编码接口行为。
- 测试作者必须先阅读路由实现和接口说明书，再设计 fixture 与断言；测试脚本应在启动时验证契约中的 method/path 与实际目标一致。
- 每个负向用例只允许制造一个失败维度。测试幂等键冲突时，两份 payload 都必须先满足字段、枚举和金额规则；非法 payload 应按接口校验优先级断言 400，而不是误期望 409。
- 接口校验顺序属于公开契约。字段校验、幂等比较、终态检查、乐观锁等优先级变化时，必须同步更新契约、说明书、E2E、stage report detector 和 report publish verifier。
- 静态 verifier 必须检查测试确实读取机器契约，而不能只检查契约文件存在。

