# 小程序全局主题切换与 19 页验收

主题切换是构建期操作。禁止在页面 WXSS 中逐页改品牌色、圆角、阴影或媒体占位；主题描述、导航和全局语义变量必须通过同一个激活入口生成。

## 切换步骤

在仓库根目录严格按顺序执行：

```bash
pnpm miniapp:theme:activate chunhuaqiushi
pnpm miniapp:theme:check
pnpm test:miniapp:theme
pnpm verify:miniapp:theme
pnpm e2e:miniapp:theme
```

前四项验证生成文件、主题契约、共享组件与 19 页静态规则；最后一项需要 Mac、Docker Desktop、已登录且开启服务端口的微信开发者工具，以及本机真实 `project.config.json`。

## 完成标准

新主题只有在 19/19 路由均找到可见 `cq-page` 根节点、没有 `MiniProgramError`、每页截图非空且人工抽查商品列表、确认订单、售后详情和团长提现通过后，才算完成。新增页面进入 `app.json` 后也必须自动进入同一门禁。

自动化证据写入：

```text
/tmp/chunhuaqiushi-miniapp-theme-<timestamp>/
  automation.log
  route-results.json
  devtools.log
  01-pages-index-index.png
  ...
  19-pages-leader-withdrawals-index.png
```

详情页优先使用首页与订单列表发现的真实测试数据 ID；也可以通过 `MINIAPP_E2E_PRODUCT_ID`、`MINIAPP_E2E_GROUP_BUY_ID` 和 `MINIAPP_E2E_ORDER_ID` 显式指定。团长页默认使用 `leader-openid`，可通过 `MINIAPP_E2E_LEADER_OPENID` 覆盖。
