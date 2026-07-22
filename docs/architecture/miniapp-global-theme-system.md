# 小程序全局主题系统

## 目标与范围

L50 将“春华秋实”从首页模板提升为小程序端全局主题。主题覆盖 `apps/miniapp/app.json` 登记的全部 19 个页面、共享组件、品牌素材和导航栏；`apps/admin` 后台管理端不在本阶段范围内。

## 唯一来源

1. `apps/miniapp/themes/<theme-id>/theme.json` 是品牌视觉与导航配置的唯一来源。
2. 页面只能使用 `cq-*` 语义类，不得直接写品牌色、阴影或圆角。
3. 新页面加入 `app.json` 时，根节点必须接入 `cq-page`，加载、空、错状态必须使用统一状态组件，并通过主题门禁。
4. 切换模板只允许执行 `pnpm miniapp:theme:activate <theme-id>`，禁止逐页改色。
5. 首页、子页面、共享组件和导航栏属于同一个主题版本，必须一起激活和验证。
6. 后台管理端不在 L50 范围内，后续单独设计和迁移。

## 分层结构

- `themes/<theme-id>/theme.json`：可序列化的品牌、导航与素材描述。
- `themes/<theme-id>/theme.js`：冻结后的运行时描述，补充目录、文案、状态和图片降级映射。
- `themes/active.generated.js`：活动主题的 CommonJS 入口，由激活器生成。
- `styles/theme-active.generated.wxss`：活动主题的 WXSS 入口，由激活器生成。
- `styles/themes/<theme-id>.wxss`：主题语义变量定义。
- `styles/tokens.wxss`：只消费 `--cq-*` 变量的全局语义类。
- `components/ui/*`：状态、图片与业务状态的共享视觉原语。
- `scripts/miniapp-theme/*`：确定性激活、契约测试与一致性检查。

## 页面规则

页面专属 WXSS 只负责布局、尺寸和排版。颜色、边框、圆角、阴影、按钮、状态、金额和媒体占位必须来自全局语义令牌。业务事件名、页面参数、接口字段与计算规则不得因换肤而改变。

远程合法商品图片优先；缺图、加载失败及旧 `/images/products/placeholder.png` 路径统一切换为活动主题的本地素材。页面不得自行维护另一套图片占位规则。

## 主题切换门禁

每次新增或切换主题必须依次通过：生成文件一致性、主题契约、19 页静态扫描、现有业务测试和微信开发者工具 19/19 路由烟雾测试。任何页面仍写死品牌颜色或未接入 `cq-page`，主题都不算完成。
