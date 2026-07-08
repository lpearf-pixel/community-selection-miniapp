# L31 轻量后台访问控制基线

## 本阶段目标

L31 为 Admin 后台建立轻量访问控制基线：定义少量后台角色、少量权限点、静态角色权限映射，并在敏感后台接口接入后端权限校验。它为后续更完整的账号/角色体系做基础，但本阶段不改变数据库结构。

## 为什么 L31 不做完整 RBAC

当前阶段只需要把“谁可以访问敏感后台接口”的后端强校验先补齐，避免把前端菜单或单一 admin 概念当作安全边界。完整 RBAC 会涉及角色表、权限表、账号管理、权限配置和数据范围，本阶段暂不引入这些复杂度。

## 轻量角色清单

- `super_admin`
- `store_manager`
- `clerk`
- `finance`
- `aftersales`
- `operator`

## 轻量权限点清单

- `admin.full_access`
- `operations.view`
- `product.manage`
- `order.view`
- `order.manage`
- `pickup.verify`
- `after_sale.manage`
- `refund.view`
- `refund.manage`
- `finance.view`
- `finance.export`
- `risk.view`
- `staff.manage`
- `system.manage`

## 角色权限映射

- `super_admin`：全部权限。
- `store_manager`：运营查看、订单查看/处理、自提核销、售后处理、商品管理。
- `clerk`：自提核销、订单查看。
- `finance`：财务查看/导出、退款查看/处理、风险查看、订单查看。
- `aftersales`：订单查看、售后处理、退款查看。
- `operator`：运营查看、商品管理、订单查看。

## 后端权限校验设计

新增 `requireAdminPermission(permission)` 作为敏感后台接口的后端 guard。它通过 `resolveAdminAccessContext(request)` 解析当前后台身份，再由 `hasAdminPermission(context, permission)` 判断权限。

解析顺序：

1. 优先使用已有后台 session 上的 `adminUser`。
2. 在非 production 环境允许 `x-admin-role` 与 `x-admin-user-id` 作为 L31 dev/mock baseline。
3. 未提供身份、未知角色、production 环境仅提供 header role 时拒绝访问。
4. 默认不授予 `super_admin`。

失败响应：

- 401：缺少后台身份。
- 403：后台身份存在但权限不足。

## 前端菜单只做体验

前端菜单过滤只适合改善使用体验，例如隐藏财务、退款、风控、运营等入口。它不能作为安全边界，因为用户可以修改 localStorage、请求 header 或直接调用接口。

## 为什么不能依赖前端权限

真正的数据保护必须发生在后端。所有敏感接口都要调用 `requireAdminPermission`，后端权限校验是安全边界，只有后端校验通过后才能返回数据或执行操作。前端权限提示只能减少误点，不能阻止越权请求。

## x-admin-role 只是 dev/mock baseline

`x-admin-role` 与 `x-admin-user-id` 只用于 L31 的本地开发和 mock 验证。production 环境不信任 header role；后续会由后台 session、JWT 或数据库角色替代。

## 后续规划

- L32 再考虑账号/角色表与后台账号管理能力。
- L33 再考虑数据范围，例如门店、社区、业务线范围。

## 数据库变化

- 不改 DB 表。
- 不新增 DB 字段。
- 不新增 migrations。

## 支付/退款与资金边界

- 不接真实微信支付/退款。
- 不自动退款、打款、报税。
- 不新增奖励结算。

## 安全字段边界

后台访问控制不改变既有敏感字段边界：接口不输出完整 `receiver_phone`，不输出内部成本、奖励配置、库存扣减等内部字段；允许继续使用 `receiver_phone_masked` 和 `pickup_store_phone`。
