# L50-C1.5 提现页结构治理设计

## 目标

在不改变提现查询、详情加载、人工审核/驳回/标记已处理行为的前提下，将 348 行
`WithdrawalsPage.tsx` 拆成页面编排、人工审核工作台和详情抽屉三个边界。

## 边界

- 主页面保留筛选/分页状态、queryVersion、列表 loader、详情 AbortController、
  prompt 校验、acting/error 状态、全部 API 调用、消息和父级刷新副作用。
- `WithdrawalsWorkbench.tsx` 负责筛选控件、免责声明、列表、分页、状态标签和动作入口。
- `WithdrawalDetailDrawer.tsx` 负责详情 JSON 展示与关闭入口。
- 子组件同步、typed、无 API/状态副作用；主页面不超过 200 行。

不修改接口、DTO、权限/数据范围、脱敏、查询参数、每页 20、动作可用条件、
prompt 文案、成功/错误文案、人工处理规则或请求时序。不增加自动打款、Prisma、
依赖、锁文件、商品、团购、小程序或 POS 变更。

## 验收

结构合同先 RED 后 GREEN；A3.4/API 合同、全仓门禁、真实 PostgreSQL/Playwright
通过；临时 workflow 删除；最终 diff 只含提现 feature 与设计/计划。
