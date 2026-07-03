# L4 基础管理 Review

## 1. L4 范围

L4 基础管理在保留 L3 商品能力的基础上，补齐后台运营所需的基础团购与订单管理能力：

- 商品管理入口继续可用。
- 新增团购列表与团购详情入口。
- 新增订单列表与订单详情入口。
- 新增订单状态流转。
- 新增分拣单导出入口。

## 2. 当前已完成接口

`apps/api/src/routes/group-buys.ts` 中仍保留并提供以下 L4 相关接口：

- `POST /api/group-buys`：创建团购。
- `GET /api/group-buys`：查询团购列表，并包含商品、社区、开团人信息。
- `GET /api/group-buys/:id`：查询团购详情，并包含订单列表。
- `POST /api/orders`：创建订单。
- `GET /api/orders`：查询订单列表，并包含团购商品、社区、用户等信息。
- `GET /api/orders/:id`：查询订单详情。
- `POST /api/orders/:id/status`：推进订单状态。
- `GET /api/orders/export/picking.csv`：公开兼容版分拣单导出。
- `GET /api/admin/orders/export/picking.csv`：L12 后新增的后台保护版分拣单导出。

## 3. 当前后台页面入口

`apps/admin/src/App.tsx` 中仍保留 L4 后台入口和操作：

- 商品管理。
- 团购管理。
- 订单管理。
- 团购列表。
- 订单列表。
- 订单状态流转按钮：备货中、待自提、已自提、完成。
- 分拣单导出按钮：导出明细分拣单 CSV、导出汇总分拣单 CSV。

## 4. 分拣单导出口径

当前存在两个分拣单导出路径：

- `GET /api/orders/export/picking.csv?format=detail|summary`
  - 公开兼容版。
  - 继续保留以避免破坏早期验收与开发流程。
  - detail 格式导出 `receiver_phone_masked`，不导出完整手机号。
  - 不导出 openid / unionid。

- `GET /api/admin/orders/export/picking.csv?format=detail|summary`
  - L12 后台保护版。
  - 因包含 `receiver_name` 等履约信息，后台页面应优先使用该路径。
  - 需要管理员 session。
  - detail 格式继续手机号脱敏，不导出 openid / unionid。

## 5. L4 与后续 L12 / L13 的兼容关系

L12 增加了履约看板、自提核销、后台保护版分拣单导出与后台一键再开团，但没有移除 L4 的团购、订单、订单状态流转能力。

L13 将库存模型升级为基础库存单位模型，因此 L4 下单验收需兼容当前库存规则：

- `Order.quantity` 仍表示用户购买的销售数量。
- `Product.stock` 表示基础库存单位数量。
- 实际扣减库存为 `Order.quantity * Product.stock_deduct_quantity`。
- `StockLedger(order_lock).quantity` 记录基础库存单位数量。

## 6. 当前风险

- L4 公开版 `GET /api/orders/export/picking.csv` 仍存在，主要用于兼容早期能力和本地开发验收。
- L12 已新增后台保护版 `GET /api/admin/orders/export/picking.csv`。
- 后台页面应优先使用 `/api/admin/orders/export/picking.csv`，避免包含收货人姓名的履约数据走公开路径。

## 7. 验收脚本

新增独立 L4 验收脚本：

- `scripts/verify-l4-admin-basic-local.ts`

覆盖内容：

- 团购创建、列表、详情。
- 订单创建、列表、详情。
- L13 库存单位模型下的下单扣库存与 `StockLedger(order_lock)`。
- MOCK 支付。
- 订单状态流转与时间线 / 业务事件日志。
- 公开版与后台保护版分拣单导出。
- 后台页面 L4 静态入口检查。
- compliance scan。

## 8. 结论

L4 基础管理能力当前通过 review。新增独立验收脚本后，后续 L14.5 模块化重构可更容易发现是否破坏早期团购、订单、后台基础管理与分拣单导出能力。
