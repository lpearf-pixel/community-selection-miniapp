# 05 微信小程序规范

## 小程序定位

小程序是私域成交入口，不是复杂商城。第一版页面要少，但必须能跑通下单、开团、支付、退款和开团服务奖励查看。

## 页面清单

```text
pages/home/index             首页
pages/products/index         商品列表
pages/product-detail/index   商品详情
pages/group-list/index       今日开团
pages/group-detail/index     团购详情
pages/group-create/index     发起开团
pages/order-confirm/index    确认订单
pages/order-list/index       我的订单
pages/order-detail/index     订单详情
pages/refund-apply/index     申请退款
pages/me/index               我的
pages/leader-apply/index     申请成为开团人
pages/leader-groups/index    我的开团
pages/leader-commissions/index 我的奖励
pages/withdraw/index         提现申请
```

## 首页

模块：

- 今日甄选
- 今日开团
- 门店自提说明
- 社区选择
- 商品分类入口

## 商品详情

展示：

- 商品图片
- 商品名称
- 价格
- 规格
- 库存
- 甄选理由
- 自提/配送说明
- 是否支持开团

普通用户页面不要展示诱导性收益文案。

## 今日开团

展示：

- 团购商品
- 当前人数/件数
- 成团条件
- 截止倒计时
- 自提时间
- 参团按钮

## 发起开团

仅 leader 可发起。

如果用户不是 leader，引导到申请页面。

## 订单确认

必须支持：

- 商品信息
- 数量
- 自提/配送选择
- 社区选择
- 自提点选择
- 联系人
- 联系电话
- 地址
- 支付金额

## 支付

开发模式：

- 调用 `/api/pay/wechat/prepay`
- 如果 `MOCK_WECHAT_PAY=true`，显示“模拟支付成功”按钮
- 调用 `/api/pay/mock/success`

生产模式：

- 调用 `wx.requestPayment`

## 我的订单

订单状态必须清晰：

- 待支付
- 已支付
- 备货中
- 待自提
- 已完成
- 退款中
- 已退款

## 退款申请

用户可选择：

- 退款金额
- 退款原因
- 上传图片后续再做，第一版可以不做

## 我的奖励

只对 leader 展示。

展示四类金额：

- 预计奖励
- 待结算奖励
- 可提现奖励
- 已提现奖励

文案统一：开团服务奖励。

禁止出现：

- 返利
- 分销
- 下级
- 团队收益
- 躺赚

## 分享

需要支持：

- 分享团购详情页给微信群
- 分享参数包含 group_buy_id

海报第一版可后置，优先做分享链接。

## 配置

`apps/miniapp/config.js`：

```js
export const API_BASE_URL = 'http://localhost:3000'
```

## 小程序端要求

- 所有 API 调用封装在 `utils/request.js`
- 登录态封装在 `utils/auth.js`
- 金额格式化封装在 `utils/money.js`
- 不在小程序端做关键金额计算，金额以服务端为准
