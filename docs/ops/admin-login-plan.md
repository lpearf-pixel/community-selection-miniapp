# 管理后台正式登录方案设计

L11 已将 `ADMIN_TOKEN` 简单保护升级为 `ADMIN_AUTH_MODE=token/session` 双模式：开发环境可短期使用 token，生产建议使用 session 登录。

- 第一版已实现管理员账号密码、TOTP、recovery codes 与短期会话。
- 后台请求通过 httpOnly Cookie 或 Bearer session token 识别管理员。
- 管理员操作写入 `AdminAuditLog`，用于回溯操作人、来源 IP 与操作对象。
- 高风险操作继续保留二次确认流程：提现审核、标记已处理、税务复核、告警关闭。
- Passkey / WebAuthn 放到 L12 后续阶段评估。
- mTLS、VPN 与 IP 白名单放在 Nginx / Caddy / 网关层处理。
