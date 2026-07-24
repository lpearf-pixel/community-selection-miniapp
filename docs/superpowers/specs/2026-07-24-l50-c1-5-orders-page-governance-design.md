# L50-C1.5 订单页结构治理设计

## 目标

在不改变后台订单业务行为、接口、权限、文案和可访问名称的前提下，将
`OrdersPage.tsx` 从 447 行的多职责组件拆成可独立理解和维护的页面编排、
筛选、列表和详情四个边界。

## 范围

本切片只治理 `apps/admin/src/features/sales/orders`：

- `OrdersPage.tsx` 保留数据加载、查询状态、重试状态、详情加载和写操作编排。
- `OrdersFilters.tsx` 负责筛选控件、查询提交和重置入口。
- `OrdersTable.tsx` 负责订单列、分页展示和订单操作入口。
- `OrderDetailsCard.tsx` 负责订单全链路详情展示。
- 新增静态结构合同，约束主页面不超过 200 行且不重新内联上述三个视图。
- 更新全局 Admin E2E 源码合同，使 B3/C1 证据跟随筛选和表格的新源码边界，
  不降低原有 submit、分页或禁止绕行提交的断言。

不修改 API、DTO、Prisma、路由、权限、脱敏、订单状态机、导出地址、文案、
按钮名称、分页计算或数据库结构。不处理税务、拼团、商品和提现页面。

## 组件边界

### `OrdersPage`

唯一的有状态编排组件。它继续持有：

- `Form.useForm()` 返回的表单实例；
- `query`、`retryVersion`、`selectedOrderContext`；
- `useEffect` 内的订单列表请求和 AbortController；
- 详情、状态更新、自提核销、导出、筛选、重置和翻页处理器；
- 首次加载、错误提示和刷新提示。

### `OrdersFilters`

纯展示组件，通过 props 接收表单实例、`onFinish` 和 `onReset`。原有六个
筛选字段、`aria-label`、Select 选项、输入宽度以及“查询/重置”按钮原样迁移。

### `OrdersTable`

纯展示组件，通过 props 接收订单数据、分页元数据和五个回调：
`onPageChange`、`onLoadContext`、`onMarkOrder`、`onVerifyPickup`。列顺序、
固定列、横向滚动、金额格式化、脱敏字段和六个操作按钮原样迁移。

### `OrderDetailsCard`

纯展示组件，只接收 `AiContext`。订单基础信息、消费额度、三张日志表和全部
中文文案原样迁移。

## 数据流

子组件不调用 API，不拥有服务器状态，也不读取全局权限。用户事件由子组件
回传 `OrdersPage`，再由现有处理器执行。这样拆分只改变源码归属，不改变请求
顺序、刷新机制、错误隔离或父组件回调。

## 懒加载决策

本切片不增加 React `lazy`/`Suspense`。三个子组件与订单页同时需要或体积很小，
单独懒加载会增加异步边界并改变详情点击后的渲染时序。全后台路由级分包应在
导航加载策略任务中统一设计，不在本次结构拆分中局部引入。

## 验收

- `OrdersPage.tsx` 不超过 200 行。
- 主页面不再内联筛选 Form、订单 Table 和详情 Card。
- 三个子组件各自拥有单一职责和明确 props。
- 既有订单 API/page-model 测试保持通过。
- B3/C1 全局源码合同从新组件读取同一行为证据。
- Admin 全量测试、严格 TypeScript、生产构建和浏览器订单流程通过。
- 远端 diff 不包含 API、Prisma、依赖、锁文件、小程序、POS、设备或门店模型。
