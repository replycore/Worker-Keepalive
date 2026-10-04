# Worker-Keepalive

站点保活监控：定时探测 URL 是否存活，挂了就推送告警。Cloudflare Worker + D1，单文件部署，自带 Web 管理面板，手机电脑都能用。

## 预览

| | 浅色 | 深色 |
|---|---|---|
| 电脑端登录 | ![电脑端登录（浅色）](docs/screenshots/pc-login.png) | ![电脑端登录（深色）](docs/screenshots/pc-login-dark.png) |
| 电脑端概览 | ![电脑端概览（浅色）](docs/screenshots/pc-overview.png) | ![电脑端概览（深色）](docs/screenshots/pc-overview-dark.png) |
| 移动端登录 | ![移动端登录（浅色）](docs/screenshots/mobile-login.png) | ![移动端登录（深色）](docs/screenshots/mobile-login-dark.png) |
| 移动端概览 | ![移动端概览（浅色）](docs/screenshots/mobile-overview.png) | ![移动端概览（深色）](docs/screenshots/mobile-overview-dark.png) |

## 部署

**方式一：复制代码**

1. 复制 `worker.js`（Vue + 样式已内联，零外部依赖）
2. Cloudflare → Workers → 粘贴 → 部署
3. 绑定 D1，变量名必须叫 `DB`（表自动建）
4. 加 Cron Trigger（如 `*/5 * * * *`），设好环境变量后重新部署

**方式二：wrangler**

```bash
git clone https://github.com/replycore/Worker-Keepalive.git
cd Worker-Keepalive
npx wrangler d1 create keepalive-db   # database_id 填入 wrangler.toml
npx wrangler secret put ADMIN_USER
npx wrangler secret put ADMIN_PASS
npx wrangler deploy
```

| 变量 | 说明 | 默认 |
|---|---|---|
| `ADMIN_USER` / `ADMIN_PASS` | Root 账号密码 | `admin` / `admin` |
| `LOG_LEVEL` | 日志范围：`all` / `failed` / `off` | `failed` |

首次部署后立刻改掉默认密码。

**方式三：GitHub Actions 自动部署**

仓库已内置 CI（`.github/workflows/ci.yml`）与发布流水线（`deploy.yml`）：

- 每次 push / PR 自动跑：`npm ci` → `npm test` → `npm run build`，并校验 `worker.js` 已重新打包（改了源码没打包会失败）
- 发 Release（或在 Actions 页手动触发）自动部署到 Cloudflare：需在仓库 Settings → Secrets 配置 `CLOUDFLARE_API_TOKEN`（要有 Workers 部署 + D1 读写权限）；`production` 环境可在 Environments 里加人工审批
- 多环境：`wrangler.toml` 已预置 `[env.staging]` / `[env.production]`，手动部署用 `npx wrangler deploy --env staging`（先 `npx wrangler d1 create keepalive-db-staging` 建库并填 `database_id`）

## 使用

1. 「通知渠道」添加推送方式（Telegram / Bark / PushPlus / 钉钉 / 飞书 / 邮件等 10 种）
2. 「保活任务」添加网址，勾选通知渠道
3. 点右上角「💾 保存配置」——增删改后都要点保存，否则刷新丢失

只在状态变化时推送（挂了告警、恢复通知），不会重复轰炸。点 ⚡ 可手动立即探测一次。

## 多账号

- Root 可建子账号，各账号的任务、渠道、日志完全隔离、互不可见
- 删除子账号会同时清除它的全部数据，保存前二次确认
- 子账号可看帐户额度，不可改 Cloudflare API 配置

## 帐户额度与 D1 额度告警

「账号」页填 Cloudflare Account ID + API Token（需要"帐户分析"读取权限），「运行概览」显示 Workers / D1 真实用量。

配好通知渠道后，可在「账号」页开启 **📊 D1 额度告警**：每天北京时间 8 点检查一次 D1 用量（读取 / 写入 / 存储），超过设定阈值（默认 80%）推送告警、回落后推送恢复，只在状态变化时通知。

## 常见问题

- 页面一直转圈：8 秒后会出红色提示，刷新重试
- `D1 database not bound`：D1 变量名必须是 `DB`
- 要对外暴露：在前面加 Cloudflare Access

## 改代码后重新打包

```bash
npm i && npm run build
```

## 测试

```bash
npm test   # node:test，覆盖纯函数（阶梯日志、会话令牌、b64u、字段映射、用量聚合、safeJson）
```
