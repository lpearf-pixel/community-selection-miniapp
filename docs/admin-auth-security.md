# 后台管理员登录与二次验证设计

L11 第一版实现账号密码 + TOTP 的后台登录体系，保留 `ADMIN_AUTH_MODE=token/session` 兼容短期令牌模式；生产建议使用 `session`，并逐步关闭简单令牌入口。

## 第一层：密码 + TOTP

- 管理员密码只保存 bcrypt hash，不保存明文。
- TOTP secret 使用服务端密钥加密保存，设置阶段只展示一次。
- recovery codes 只展示一次，数据库仅保存 hash，使用后立即作废。
- session token 仅保存 hash，浏览器侧使用 httpOnly Cookie，预留 SameSite 与 Secure。
- 连续失败登录会触发短时间拒绝。

## 第二层：Passkey / WebAuthn

Passkey 放到 L12 之后评估，不在 L11 实现；当前 schema 仅保留 `passkey_enabled` 等扩展空间。

## 第三层：mTLS + VPN / IP 白名单

客户端证书、VPN 与 IP 白名单应放在 Nginx / Caddy / 网关层处理，应用只接收已通过边界校验的请求；当前 schema 预留 `mtls_subject` 便于后续审计绑定。

## 不推荐方案

SMS OTP 不作为后台首选二次验证方式，仅可作为后续低权限辅助找回方案评估。

## 审计要求

提现审核、税务复核、标记提现已处理、告警处理、商品上下架和订单状态变更等后台敏感操作必须写入 `AdminAuditLog`，便于回溯操作人、时间、来源 IP 与操作对象。
