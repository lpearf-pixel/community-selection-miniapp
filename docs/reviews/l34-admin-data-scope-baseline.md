# L34 自提点 / 配送数据范围基线

## 本阶段目标

L34 在不调整数据库结构的前提下，为后台 Admin 增加轻量数据范围 baseline，避免普通后台角色默认看到所有自提点、社区与配送订单。

## 为什么要做数据范围

L31 已提供轻量角色和权限，L32/L33 增加自提核销、导航与配送预留后，需要进一步约束可见订单范围。权限回答“能否进入功能”，数据范围回答“能看哪些订单”。

## 为什么 L34 不改 DB

本阶段只验证链路与安全边界，范围通过开发/mock header 和 request.adminUser 上下文扩展表达。后续 L35 可把员工与门店/社区绑定数据库化。

## 默认全量规则

只有 super_admin 默认全量。clerk、store_manager、operator、aftersales 如无自提点或社区范围，不默认全量。

## clerk / store_manager 的规则

clerk 需要 pickup_store scope 才能访问自提与配送工作台数据。store_manager 可使用 pickup_store scope 和 community scope，但没有范围时不默认全量。

## scope 类型

- pickup_store scope：通过 `x-admin-pickup-store-id` 或复数 header 表达。
- community scope：通过 `x-admin-community-id` 或复数 header 表达。

## 接口过滤

自提列表、按码查询、核销、概览都在后端按 scope 过滤或校验。配送列表、详情、预留、状态更新同样在后端按 scope 过滤或校验。

## 前端体验与安全边界

前端展示“当前数据范围”，无范围时提示联系管理员，并从 localStorage 带开发/mock header。前端只做体验，后端权限与数据范围校验才是安全边界。

## 本阶段不做

L34 不做完整 RBAC，不做账号管理，不做角色管理页面，不接真实支付/退款/第三方配送接口，不新增奖励结算。
