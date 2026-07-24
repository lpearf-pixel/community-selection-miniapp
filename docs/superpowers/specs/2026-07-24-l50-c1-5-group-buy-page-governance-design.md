# L50-C1.5 团购管理页结构治理设计

## 目标

在不改变后台团购管理、失败团购人工关闭、退款确认和一键再开团行为的前提下，
将 368 行的 `GroupBuyManagementPage.tsx` 拆成可独立理解的页面编排、团购列表
和人工关闭工作台三个边界。

## 范围

本切片只治理 `apps/admin/src/features/sales/group-buys`：

- `GroupBuyManagementPage.tsx` 保留列表资源状态、重试、AbortController、
  防陈旧关闭工作台请求、全部 API 调用与写操作副作用。
- `GroupBuyListCard.tsx` 负责团购列表卡片、列定义和“一键再开团”入口。
- `GroupBuyClosureWorkbench.tsx` 负责选择团购、关闭动作入口、关闭摘要和
  人工退款订单表格。
- 新增静态结构合同，约束主页面不超过 200 行且不重新内联两个视图。
- 必要时仅调整既有源码合同的证据路径，不删除或放宽断言。

不修改 API、DTO、Prisma、路由、权限、退款规则、关团前置条件、库存回补、
接口调用时序、文案、日期/金额格式、数据库结构、依赖或锁文件。不处理商品页、
提现页、小程序、POS、设备或门店模型。

## 组件边界

### `GroupBuyManagementPage`

唯一的有状态编排组件，继续持有：

- 团购列表的 reducer、重试版本和加载 effect；
- 关闭工作台选择状态、请求 generation、AbortController 和卸载清理；
- `reloadClosureWorkbench` 的陈旧响应保护；
- 标记失败、关闭未支付订单、最终关闭、确认退款和一键再开团写操作；
- mutation 完成后的消息与父级刷新；
- 列表首次加载、错误和刷新状态展示。

### `GroupBuyListCard`

同步展示组件。接收 `GroupBuy[]` 和 `onClone`。列顺序、空值、金额、
人数、数量、状态、截止时间及按钮文案原样迁移。组件不调用 API、不维护状态。

### `GroupBuyClosureWorkbench`

同步展示组件。接收团购列表、`ClosureWorkbenchState` 以及选择、刷新、
标记失败、关闭未支付、最终关闭和确认退款回调。免责声明、选择项标签、
关闭摘要、阻塞原因、人工退款表格和按钮文案原样迁移。组件不调用 API、
不拥有 AbortController，也不改变写操作顺序。

## 数据流与错误处理

用户事件由展示组件回传主页面，再由现有处理器执行。选择团购时仍先同步更新
选择 ref 与页面状态，再发起关闭工作台请求。新选择或卸载仍中止旧请求，
generation 与 groupBuyId 双重校验继续阻止陈旧响应覆盖当前数据。确认退款缺少
成功退款记录时仍通过父级消息提示且不发请求。列表加载错误继续保留本地重试。

## 懒加载决策

本切片不增加 React `lazy`/`Suspense`。两个子组件属于同一工作台的同步界面，
局部懒加载会改变首次显示和操作时序。路由级分包留给独立导航任务。

## 验收

- `GroupBuyManagementPage.tsx` 不超过 200 行。
- 主页面不再内联团购 Table、关闭摘要和人工退款 Table。
- 两个子组件都有明确 typed props，且不调用 API。
- 现有 group-buy API、page-model、A3.2 和 Admin 浏览器合同保持通过。
- Admin 全量测试、严格 TypeScript、生产构建及真实 PostgreSQL/Playwright 门禁通过。
- 最终 diff 不包含 API、Prisma、迁移、依赖、锁文件、商品、提现、小程序或 POS。
