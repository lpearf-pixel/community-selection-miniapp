# L21 小程序自提点 / 社区选择与下单体验优化

## 本阶段目标

L21 在 L20 小程序主链路基础上补齐下单前的社区选择、自提点选择、默认用户信息读取、表单校验和订单详情展示优化，减少用户手动输入 `pickup_store_id` / `community_id`。

## 社区选择 API

- `GET /api/communities`
- 仅返回 `status = active` 的社区。
- 支持 `keyword` 搜索社区名称和地址。
- 支持 `page` / `page_size` 分页，`page_size` 最大 100。
- 不返回内部运营字段。

## 自提点选择 API

- `GET /api/pickup-stores`
- `GET /api/pickup-stores/:id`
- 仅返回 `status = active` 的自提点。
- 支持 `keyword` 搜索自提点名称和地址。
- 当前 `PickupStore` 模型没有 `community_id`，因此不新增字段，也不强制按社区过滤。
- 不返回内部字段。

## 小程序 selection storage

新增 `apps/miniapp/utils/selection.js`，使用：

- `selected_community`
- `selected_pickup_store`

提供读取、保存和清理已选位置的工具方法。

## 商品列表社区入口

商品列表顶部展示当前已选社区；未选择时展示“请选择社区”，点击进入社区选择页。未选择社区时仍可浏览商品。

## 商品详情下单参数带入

普通购买会带入当前已选 `community_id`；参与开团时会优先带入团购自带 `community_id`。

## 下单确认页社区 / 自提点选择

确认页读取 URL query、selection storage 和当前用户信息，展示商品信息、购买类型、数量、已选社区、已选自提点、收货人姓名和手机号，并提供“选择社区”“选择自提点”按钮。

## 表单校验

提交前校验：

- 收货人姓名必填。
- 手机号必须满足基本格式。
- 数量必须大于等于 1。
- 必须选择自提点。
- 开团购买必须有 `group_buy_id`。

## 普通购买链路

普通购买提交 `POST /api/orders/normal`，携带商品、用户、数量、自提点、可选社区和收货人信息，成功后调用 `POST /api/payments/mock`。

## 开团购买链路

开团购买提交 `POST /api/orders`，携带团购、用户、数量、自提点、可选社区和收货人信息，成功后调用 `POST /api/payments/mock`。

## 支付、定位和营销边界

- 不接真实微信支付。
- 不调用 `wx.requestPayment`。
- 不调用定位。
- 不新增营销玩法。
- 不新增 DB 字段。
- 不新增 DB 表。

## 合规边界

本阶段只做小程序位置选择和下单体验优化，不新增奖励展示，不新增优 惠能力，不新增会 员能力，不新增裂 变玩法，不新增自动退款、自动打款或自动报税。

## 验收方式

运行 `scripts/verify-l21-miniapp-location-selection-local.ts`，并通过 `scripts/verify-all-local.sh` 串联执行。MVP 发布前仍需人工在微信开发者工具中跑通页面。
