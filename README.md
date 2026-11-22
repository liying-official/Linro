# 🔗 Linro

**给长网址做一个好记的入口，用自己的域名管理它。**

当前版本：**v1.0.2** · [English](README.en-US.md)

例如，把 `https://www.example.org/a/long/page` 变成 `https://go.example.com/welcome`。以后目标网页搬家，只要在后台修改目标，已经发出去的短链接就能继续使用。

Linro 是开源的短链接管理工具，运行在你的 Cloudflare 账户里。它有中文和英文界面，适合个人或共享工作区的团队。你不用维护传统服务器，但仍需要配置 Cloudflare、域名和登录权限。

## 可以做什么？

- **管理多个短链域名。** 配置支持 1–50 个公开域名；每个域名可以独立使用相同短码。
- **控制链接怎么打开。** 选择跳转状态码、按地区选择目标，也可以直接显示纯文本。
- **给公开访问加规则。** 设置密码、到期时间、启停状态、授权请求次数上限，以及可选的浏览器检查。
- **和团队一起维护。** 四种角色控制操作权限；应用令牌让脚本自动管理链接。
- **整理已有链接。** 使用 JSON / CSV 导入导出、批量操作和审计记录。
- **按需加功能。** 访问统计、KV 缓存和浏览器时区采集默认不启用，基础部署先保持简单。

> 这是一个**共享工作区**。有读取权限的成员能看到工作区中的链接目标和纯文本内容。公开链接的密码保护不会把这些内容藏起来，也不提供成员之间的数据隔离。[了解权限与安全边界](docs/SECURITY.md)

## 先选一条入门路线

| 你现在想做什么 | 从这里开始 |
| --- | --- |
| 先看看界面，不配置 Cloudflare | [静态演示说明](docs/DEMO.md)：打开演示，输入页面当次显示的体验码 |
| 在自己的电脑上试运行 | [本地体验](docs/GUIDE.md#local)：安装 Node.js ≥22.16.0，按顺序运行几条命令 |
| 用自己的域名正式上线 | [首次部署](docs/GUIDE.md#install)：准备 Cloudflare 账户、一个管理域名和至少一个短链域名 |
| 已经装过旧版本 | [保留数据升级](docs/GUIDE.md#upgrade)：先备份，保留原有资源与密钥 |

GitHub 会把仓库中的 HTML 当作源码显示。在线演示需要仓库维护者启用 GitHub Pages；本地查看方式见[演示说明](docs/DEMO.md)。离线手册可以直接用浏览器打开 `docs/index.html`，支持语言切换、搜索和打印。

## 它是怎么工作的？

把它想成一间有前台和资料柜的小店：

| 部分 | 简单理解 | Cloudflare 资源 |
| --- | --- | --- |
| 管理后台 | 你在这里创建链接、设置规则 | Admin Worker，附带网页界面 |
| 公开入口 | 访客在这里打开短链接 | Redirect Worker |
| 数据库 | 保存链接、域名、成员和规则的资料柜 | 两个 Worker 共用一个 D1 |
| 登录保护 | 先确认谁可以进入后台 | Cloudflare Access |

KV 和 Analytics Engine 是可选服务。默认关闭可选功能能减少额外请求和存储；**不代表 Cloudflare 在任何流量、套餐或用法下都免费**。实际用量与费用以你的账户和[官方计费说明](docs/SOURCES.md)为准。

## 文档入口

| 文档 | 回答什么问题 |
| --- | --- |
| [使用与部署指南](docs/GUIDE.md) | 从零运行、日常使用、配置、备份和排障 |
| [API 参考](docs/API.md) | 让脚本接入时，具体该发送什么请求 |
| [安全说明](docs/SECURITY.md) | 哪些内容受到保护，哪些边界需要自己理解 |
| [数据保留](docs/RETENTION.md) | 怎样先检查占用，再决定是否清理旧记录 |
| [版本与协议](docs/PROTOCOL-v1.0.2.md) | v1.0.2 与已有实例如何兼容 |
| [发布说明](docs/RELEASE.md) | 怎样构建演示、离线文档和干净源码包 |
| [文档依据](docs/SOURCES.md) | 源码位置和 Cloudflare 官方资料 |

## 参与项目

问题和建议请说明版本、你想完成的操作、实际结果，以及已脱敏的错误信息。不要在公开 Issue 中贴密码、令牌、真实业务数据或数据库备份。安全问题请按[私密报告说明](docs/SECURITY.md#reporting)处理。

项目使用 React、TypeScript、Vite 和 Tailwind CSS 构建管理界面，并使用 TailAdmin 与 Recharts 的相关开源内容。

## 许可证

Linro 采用 **[AGPL-3.0-only](LICENSE)**。对外提供修改后的网络服务时，请阅读[许可证与对应源码说明](docs/LICENSING.md)，并提供适用条款要求的源码。第三方署名见 [NOTICE](NOTICE)，MIT 通知见 [TailAdmin](LICENSES/TailAdmin-MIT.txt) 和 [Recharts](LICENSES/Recharts-MIT.txt)。
