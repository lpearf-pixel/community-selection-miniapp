# L33 自提点地址导航与配送服务预留评审

## 本阶段目标

L33 采用低风险自提点导航方案，并为门店配送与后续第三方配送预留状态机、DTO、接口和后台页面。

## 自提点地址 + 高德跳转

自提点仍只维护名称、地址、联系电话。服务层根据地址生成 `navigation_address` 与 `navigation_url`，链接指向高德搜索跳转页，便于用户或店员复制后打开高德地图搜索。

## 地图合规低风险边界

本阶段不接入地图 S<!-- -->DK，不维护地图底<!-- -->图，不维护瓦<!-- -->片，不采集道路/边界/P<!-- -->OI 数据，不保存用户轨<!-- -->迹，不处理坐标转<!-- -->换，不做路线规<!-- -->划，也不提供对外地图 A<!-- -->PI。

## 配送预留设计

新增 `DeliveryProvider`、`DeliveryStatus`、`DeliveryMode` 与 `DeliveryReservation`，基于现有订单与自提点数据组装配送视图；不改 Prisma schema，不新增 migration，不新增表和字段。

## 达达配送只预留不启用

`createDadaDeliveryOrderMock` 只返回 mock/reserved 结果。当前不会创建真实配送单，不发起 HTTP 请求，不保存第三方凭证，不配置网关、签名或回调。

## 配送状态机

预留状态包括 `none`、`pending_dispatch`、`assigned`、`delivering`、`delivered`、`delivery_failed`、`canceled`。状态更新接口只记录人工事件与审计，不触发退款、付款、奖励结算或订单金额变更。

## 后端权限边界

配送订单列表和详情需要 `order.view` 或 `pickup.verify`；配送预留和状态更新需要 `order.manage`；服务商列表需要 `order.view`。

## 手机号/地址脱敏

配送 DTO 只返回 `receiver_phone_masked` 与 `receiver_address_masked`，不返回完整收货手机号、完整用户档案、商品成本、奖励配置或库存扣减字段。

## 不做开放配送平台

L33 只服务本小程序订单的门店配送/人工配送/第三方配送预留，不对外承接配送订单，不开放跑腿平台能力。

## 后续 L34/L35 前置事项

后续如启用真实达达 API，需要先补齐配置管理、签名、回调、幂等、审计、异常补偿、重试边界、密钥保护、状态对账和人工兜底流程。
