# L50-C1.5 税务复核页结构治理设计

## 目标

在不改变后台税务复核业务行为、接口、权限、文案和请求时序的前提下，将
`TaxReviewPage.tsx` 从 411 行的多职责组件拆成可独立理解和维护的页面编排、
筛选、列表和详情复核四个边界。

## 范围

本切片只治理 `apps/admin/src/features/finance/tax-review`：

- `TaxReviewPage.tsx` 保留服务器状态、筛选状态、详情请求、提交、导出和错误编排。
- `TaxReviewFilters.tsx` 负责筛选控件、查询入口和导出入口。
- `TaxReviewTable.tsx` 负责税务记录列、分页展示和打开详情入口。
- `TaxReviewDrawer.tsx` 负责详情说明、人工复核表单和保存入口。
- 新增静态结构合同，约束主页面不超过 200 行且不重新内联三个视图。
- 必要时更新既有源码合同的证据路径，但不删除或放宽原有断言。

不修改 API、DTO、Prisma、路由、权限、脱敏、乐观并发、幂等键、导出地址、
按钮名称、分页计算、数据库结构、依赖或锁文件。不处理拼团、商品和提现页面。

## 组件边界

### `TaxReviewPage`

唯一的有状态编排组件。它继续持有：

- `page`、`draftFilters`、`filters`、`queryVersion`；
- `exporting`、`submitting`、`actionError`、`detail`；
- `Form.useForm()` 返回的表单实例；
- `useFeatureResourceLoader` 和列表加载函数；
- 详情请求的 AbortController 与卸载清理；
- 查询、分页、详情、提交、导出和关闭处理器；
- 首次加载、错误提示和刷新提示。

### `TaxReviewFilters`

纯展示组件。通过 props 接收字段 patch 回调、查询回调、导出回调和
`exporting`。筛选控件继续保持原有的非受控行为；四类筛选、日期范围、选项、
宽度、按钮文案和查询时将页码重置为 1 的行为保持不变。

### `TaxReviewTable`

纯展示组件。通过 props 接收 `TaxReviewList`、刷新状态、分页回调和打开详情
回调。列顺序、手机号脱敏展示、金额格式化、税务标签、每页 20 条和操作按钮
原样迁移。

### `TaxReviewDrawer`

纯展示组件。通过 props 接收详情、表单实例、提交状态以及关闭/保存回调。
免责声明、关联订单文本、全部表单字段、校验规则、幂等键、隐藏的
`expected_updated_at` 和双重提交保护保持不变。组件不调用 API。

## 数据流与错误处理

子组件不调用 API、不拥有服务器状态，也不读取全局权限。用户事件由子组件
回传 `TaxReviewPage`，再由现有处理器执行。详情请求仍在下一次打开或卸载时
中止；中止请求不产生错误提示。列表加载错误与详情/保存/导出错误继续使用
两个独立 Alert，保存成功后仍关闭详情并通知父级刷新。

## 懒加载决策

本切片不增加 React `lazy`/`Suspense`。三个子组件属于同一工作台的同步界面，
局部懒加载会改变抽屉打开或首次渲染时序。路由级分包留给独立导航任务统一设计。

## 验收

- `TaxReviewPage.tsx` 不超过 200 行。
- 主页面不再内联筛选区、税务记录 Table 和详情 Drawer。
- 三个子组件各自拥有单一职责和明确的 typed props。
- 既有税务 API 与 A3.4 源码合同保持通过。
- Admin 全量测试、严格 TypeScript、生产构建和真实浏览器税务流程通过。
- 最终 diff 不包含 API、Prisma、迁移、依赖、锁文件、小程序、POS、设备或门店模型。
