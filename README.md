# 🔗 Linro

**部署在 Cloudflare 上的开源短链接与多域名管理平台。**

当前版本：**v1.0.1**。

[English](README.en-US.md) · [部署指南](https://liying-official.github.io/Linro/?lang=zh#install) · [使用文档](https://liying-official.github.io/Linro/?lang=zh) · [API 参考](https://liying-official.github.io/Linro/?lang=zh#api-reference)

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://liying-official.github.io/Linro/?lang=zh#architecture)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://liying-official.github.io/Linro/?lang=zh#architecture)
[![License: AGPL-3.0-only](https://img.shields.io/badge/License-AGPL--3.0--only-blue)](LICENSE)

用自己的域名创建短链接，在一个中英双语后台中管理链接、成员和访问规则。Linro 运行在你的 Cloudflare 账户中，将管理后台与公开跳转分开部署，不需要维护传统服务器。

## ✨ 为什么选择 Linro

- **多个域名，一个后台。** 集中管理最多 50 个公开短链域名，自定义或自动生成短码；相同短码可以在不同域名下独立使用。
- **为团队协作提供权限控制。** Cloudflare Access 保护管理入口，Owner、Admin、Editor、Viewer 四种角色配合带权限范围的应用令牌，支持日常协作与自动化接入。
- **短链接不止能跳转。** 支持 301 / 302 / 307 / 308 跳转，也能直接返回纯文本；跳转链接可按国家或大洲选择目标。
- **每条链接都有自己的访问规则。** 按需设置密码、到期时间、启停状态和授权请求次数上限，而不只是生成一个短地址。
- **批量管理与数据迁移。** 提供批量启停、删除、JSON / CSV 导入导出和操作审计，方便整理与迁移已有链接。
- **可选能力，按需配置。** 接入 KV 路由缓存、Analytics Engine 统计和浏览器时区采集，让部署适应不同使用需求。

> [!NOTE]
> Linro 面向个人及共享工作区中的团队协作，不提供成员之间的数据隔离。有读取权限的成员可查看工作区链接；详细权限与访问边界见[安全说明](docs/SECURITY.md)。

## 🧪 WebGUI Demo / 演示站点

**[打开静态演示站 →](https://liying-official.github.io/Linro/demo/)** · 口令：**`Linro`**

复用当前中英双语管理界面，提供虚构短链、域名、统计和角色切换。操作仅在当前页面内存中模拟，刷新即重置，不连接真实 API。口令用于演示流程，不保护秘密；请勿输入真实信息。[演示说明](docs/DEMO.md)

## 🚀 开始使用

**[打开 HTML 部署指南 →](https://liying-official.github.io/Linro/?lang=zh#install)**

首次安装、Cloudflare 资源配置、多域名接入和可选功能设置，均在双语 HTML 文档中说明。已有实例请阅读[升级指南](https://liying-official.github.io/Linro/?lang=zh#upgrade)。

离线阅读：下载项目或文档包，在浏览器中打开 `docs/index.html`，即可切换语言、搜索和打印。

## 📚 文档

[管理后台使用](https://liying-official.github.io/Linro/?lang=zh#usage) · [配置说明](https://liying-official.github.io/Linro/?lang=zh#configuration) · [成员与权限](https://liying-official.github.io/Linro/?lang=zh#permissions) · [API 参考](https://liying-official.github.io/Linro/?lang=zh#api-reference) · [常见问题](https://liying-official.github.io/Linro/?lang=zh#troubleshooting)

## 🧱 技术栈

Cloudflare Workers · D1 · Access · React · TypeScript · Vite · Tailwind CSS · TailAdmin · Recharts。KV 与 Analytics Engine 为可选服务。

## 🤝 参与项目

欢迎提交问题、功能建议和 Pull Request。涉及凭据或用户数据的安全问题，请使用[安全报告渠道](docs/SECURITY.md#reporting)，不要在公开 Issue 中附上敏感信息。

## 📄 许可证

Linro 采用 **[AGPL-3.0-only](LICENSE)**。cf-links、TailAdmin 和 Recharts 的 MIT 许可通知保留在 [LICENSES](LICENSES/) 中；第三方通知与对应源码说明见 [NOTICE](NOTICE) 和[许可说明](docs/LICENSING.md)。
