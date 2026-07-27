# L52 A3 生产上线包审查记录

## 范围

- 独立生产 Docker Compose，不修改开发 Compose。
- API、Admin/Caddy、运维三类版本化镜像。
- 私网 PostgreSQL、一次性迁移、单 API 实例和 advisory-lock 二次边界。
- 生产 fail-closed 配置、只读支付密钥、HTTPS 和公网冒烟。
- GPG AES-256 加密备份、保留周期、确认式恢复。
- 部署、应用回滚、Ubuntu 手册和购买/拼团验收清单。

## 明确未完成

- 尚未购买或绑定真实服务器与域名。
- 仓库不包含任何真实微信密钥、证书、数据库密码或管理员凭据。
- 尚未执行真实 JSAPI 小额支付、退款、成团、自提和恢复演练。
- Draft PR 与 L52 Runner 通过不等于已上线；只有真实环境验收表完成后才能宣布生产可用。

## 发布判定

代码进入 Ready 前必须满足：

1. 生产聚焦测试全部通过。
2. L52 Runner 的 Compose 渲染、镜像构建、Caddy 校验和迁移通过。
3. 全仓 lint/typecheck/test/build 与 `verify:all` 通过。
4. 独立代码审查没有 Critical/Important。
5. PR head 没有在最终验证后漂移。
