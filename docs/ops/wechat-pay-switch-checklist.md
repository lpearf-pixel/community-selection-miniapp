# WECHAT_PAY_MODE 从 mock 切到 wechat 的人工 Checklist

1. 确认 `WECHAT_PAY_MODE=wechat`、`MOCK_WECHAT_PAY=false`。
2. 确认 `WECHAT_APP_ID`、`WECHAT_MCH_ID`、`WECHAT_MCH_SERIAL_NO`、`WECHAT_API_V3_KEY`、`WECHAT_PRIVATE_KEY_PATH`、`WECHAT_PAY_NOTIFY_URL` 已配置。
3. 确认证书与私钥文件只在服务器受控目录，权限最小化。
4. 确认 Nginx HTTPS 可访问微信支付回调地址。
5. 确认测试订单金额为小额，先走内部体验用户。
6. 确认支付回调验签、解密、金额校验未完成前，不允许自动改订单为已支付。
7. 切换后观察 BusinessEventLog、Payment、Order 状态和告警中心。
8. 如出现异常，立即切回 `WECHAT_PAY_MODE=mock` 并保留日志。
