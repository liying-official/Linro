# Linro v1.0.2 文档与源码导航

[English](SOURCES.en-US.md) · [部署指南](GUIDE.md) · [API](API.md)

不确定文档里的某句话从哪里来？先找本版源码，再查 Cloudflare 平台资料。应用的字段、默认值与命令以随包 **v1.0.2** 为准；平台的套餐、界面与限制以当前官方说明为准。

## 在源码里找什么？

| 想知道什么 | 先看这些文件或目录 |
| --- | --- |
| 版本、Node 要求、可执行命令 | `package.json`、`package-lock.json`、`packages/shared/src/platform.ts` |
| 公共配置、默认值、绑定、预检查 | `deployment.example.json`、`scripts/config-lib.mjs`、`scripts/configure.mjs`、`scripts/preflight.mjs` |
| 管理 API 路由与权限 | `apps/admin/src/worker/api.ts`、`auth.ts`，以及同目录的 `*-api.ts` |
| 分页与统计 | `link-list.ts`、`list-pagination.ts`、`analytics.ts`、`analytics-provider.ts`、`analytics-rollup.ts`、`stats-archive.ts` |
| 链接字段、目标和密码规则 | `apps/admin/src/worker/link-fields.ts`、`packages/shared/src/validation.ts`、`policy.ts`、`destination.ts`、`link-password.ts` |
| 公开访问、密码页和浏览器检查 | `apps/redirect/src/`、`packages/shared/src/browser-check.ts`、`radar-asn.ts`、`vpn-latency.ts` |
| 管理界面、导入导出 | `apps/admin/src/web/` |
| 静态演示 | `apps/demo/`，输出 `docs/demo/` |
| 数据库结构与升级 | `migrations/0001_initial.sql` 至 `0006_destination_hosts_and_archive.sql` |
| 离线文档生成 | `scripts/build-docs.mjs`，使用锁定的 Markdown 构建依赖，输出 `docs/index.html` |
| 源码发布与验证 | `scripts/package-source.mjs`、`scripts/runtime-toolchain.mjs`、`scripts/check-deployment.mjs`、`tests/` |

界面主色为天空蓝 `#87CEEB`、白色 `#FFFFFF`，文字使用深色 `#0D394A`；样式来源是 `apps/admin/src/web/styles.css`、`tailadmin/theme.css` 与 `apps/redirect/src/public-pages.ts`。修改配色时同时检查文字对比度和焦点提示。

中英文 Markdown 是文档的编辑源。修改后运行 `npm run build:docs` 生成离线 HTML；不要手工编辑 HTML 里的重复正文。生成器所用 Markdown 解析器只参与文档构建，不进入 Worker 或管理界面运行包。

## Cloudflare 官方资料

| 主题 | 官方入口 |
| --- | --- |
| Worker 域名和证书 | [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) |
| Worker secret | [Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) |
| 运行时兼容行为 | [Compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/) |
| HTTP 请求和连接信息 | [Request](https://developers.cloudflare.com/workers/runtime-apis/request/) |
| WebSocket 与服务端计时 | [WebSocket API](https://developers.cloudflare.com/workers/runtime-apis/websockets/) · [Performance and timers](https://developers.cloudflare.com/workers/runtime-apis/performance/) |
| Access 后台保护 | [Self-hosted applications](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) |
| Access 自动化身份 | [Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/) |
| D1 升级 | [Migrations](https://developers.cloudflare.com/d1/reference/migrations/) |
| D1 行数和空间 | [Pricing](https://developers.cloudflare.com/d1/platform/pricing/) · [Limits](https://developers.cloudflare.com/d1/platform/limits/) |
| KV 用量 | [KV pricing](https://developers.cloudflare.com/kv/platform/pricing/) |
| Analytics 查询令牌与 SQL | [SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/) |
| Radar 令牌与 ASN | [First request](https://developers.cloudflare.com/radar/get-started/first-request/) · [ASN API](https://developers.cloudflare.com/api/resources/radar/subresources/entities/subresources/asns/methods/get/) |
| 限流行为 | [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) |
| 版本上传与上线 | [Versions and deployments](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/) |
| 静态资源计费 | [Workers Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) |

这些资料说明平台机制，不证明某个真实部署已经配置正确。仍需核对自己的账户、绑定、DNS、身份策略和用量。

许可证权威原文见 [LICENSE](./licenses/LICENSE.txt)，第三方归属见 [NOTICE](./licenses/NOTICE.txt)，操作说明见 [LICENSING](LICENSING.md)。
