# Linro v1.0.1 文档依据

[English](SOURCES.en-US.md) · [手册](GUIDE.md)

应用行为以随包 v1.0.1 源码为准，不以默认分支 HEAD 或未核验的线上实例作为证据。主要对应关系：

| 主题 | 源码包相对路径 |
| --- | --- |
| 版本与命令 | `package.json`、`package-lock.json`、`packages/shared/src/platform.ts` |
| 部署与公共配置 | `scripts/config-lib.mjs`、`configure.mjs`、`preflight.mjs`、`apps/*/wrangler.jsonc` |
| 管理路由、数据、角色、统计 | `apps/admin/src/worker/{index,api,data,auth,analytics}.ts` |
| JWT、响应、字段、安全策略 | `packages/shared/src/{access,http,validation,policy,destination}.ts` |
| 公开访问与保护 | `apps/redirect/src/`、`packages/shared/src/{browser-check,link-password,redirect-cache,geo,text-response}.ts` |
| 界面、导入导出、语言 | `apps/admin/src/web/` |
| 数据结构与升级 | `migrations/0001_initial.sql` 至 `0004_browser_checks.sql` |
| 发布与验证 | `scripts/package-source.mjs`、`runtime-toolchain.mjs`、`check-deployment.mjs`、`tests/` |

以下官方材料用于平台语义，不能替代本版源码和真实部署验收；平台资料会更新，发布前应再次核实：

[Workers Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) · [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) · [Wrangler Worker 命令](https://developers.cloudflare.com/workers/wrangler/commands/workers/) · [D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/) · [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) · [Access Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)

AGPL 权威文本随包保存于 [LICENSE](../LICENSE)；第三方归属见 [NOTICE](../NOTICE) 与 [许可说明](LICENSING.md)。历史兼容性应以对应版本源码与迁移记录核验。
