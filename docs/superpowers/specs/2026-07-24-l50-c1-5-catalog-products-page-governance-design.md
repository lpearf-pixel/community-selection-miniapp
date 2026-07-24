# L50-C1.5 商品目录页结构治理设计

## 目标

在不改变商品目录现有加载、临时编辑、临时上下架和占位保存行为的前提下，
将 353 行的 `CatalogProductsPage.tsx` 拆成页面编排、商品表格和商品表单三个边界。

## 边界

- `CatalogProductsPage.tsx` 保留 reducer、重试、AbortController、分类选项计算、
  编辑商品状态、提示消息以及全部状态更新处理器。
- `CatalogProductsTable.tsx` 负责商品列表、11 列、创建/编辑/上下架入口。
- `CatalogProductForm.tsx` 负责 11 个现有字段和占位保存入口。
- 子组件只接收 typed props 与同步回调，不加载数据、不持有业务状态。
- 主页面不超过 200 行，并以静态结构合同防止视图重新内联。

不修改 API、DTO、分类/商品请求并发时序、金额和单位换算、状态切换规则、
字段默认值、文案、可访问名称、Prisma、依赖、锁文件、团购、提现、小程序或 POS。
本切片不实现真实商品保存接口。

## 数据流

页面继续通过 `loadCatalogProducts` 并发读取分类和商品，并在重试、父级刷新或
卸载时保持原 AbortController 行为。表格事件回传页面，页面继续设置
`editingProduct`、dispatch 临时状态切换并设置原提示。表单字段通过
`onProductChange(patch)` 回传页面合并，固定金额仍按元/分转换，保存仍只显示
原占位提示。

## 验收

- 主页面不超过 200 行，且不内联 Table、Form 或字段控件。
- 列顺序、字段、默认值、转换、文案及临时状态行为不变。
- 现有 catalog API/page-model、Admin 全量测试、严格 TypeScript、构建和真实浏览器门禁通过。
- 最终 diff 仅包含商品 feature、结构合同和本设计/计划。
