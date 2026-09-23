# Linro v1.0.1 使用与部署手册

[English](GUIDE.en-US.md) · [README](../README.md) · [API](API.md)

<a id="guide"></a>

## 01 · 阅读指南与版本边界

版本边界：本手册描述 Linro v1.0.1 源码包中的实现。文末“依据”采用源码包相对路径，不指向会漂移的 HEAD。部署命令是操作者步骤，不代表该实例已经部署、测试通过或完成许可合规。

本手册描述 Linro v1.0.1 的部署、配置、权限与 API。命令和字段以对应版本源码为准；发布测试记录不能代替对实际实例的生产验收。

| 你要完成的事情 | 阅读位置 |
| --- | --- |
| 从零部署 | [首次安装](#install) → [首次使用](#usage) → [上线验收](#acceptance) |
| 已有实例升级，保留数据库和 secrets | [保留配置升级](#upgrade)，不要直接套用首次安装流程 |
| 调整域名、缓存、统计或浏览器检查 | [配置字典](#configuration) → [可选功能](#features) |
| 添加成员、分配权限、接入自动化 | [用户与权限](#permissions) → [API 通用约定](#api-conventions) |
| 编写调用程序 | [数据模型](#models) → [管理 API](#api-reference) → [调用示例](#examples) |
| 排查公开访问或维护数据库 | [公开访问协议](#public-api) → [备份恢复](#operations) → [故障排查](#troubleshooting) |

**所有命令默认在解压后的项目根目录执行。** 例如该目录同时包含 `package.json`、`deployment.example.json`、`apps/`、`migrations/`。`admin.example.com`、`go.example.com`、所有 `YOUR_…`、`<…>`、示例 UUID 都是占位值，必须替换；示例密钥不是实际凭据。代码块标明 Bash 或 PowerShell，不要混用续行语法。Windows 下使用 `curl.exe`，避免旧版 PowerShell 的 `curl` 别名。

本文不核定当前 Cloudflare 套餐价格、免费额度、控制台新版本界面或计划可用性；涉及这些内容时，应以实际账户为准。项目材料中的许可说明仅作为项目标记和操作约定呈现，不在本文扩展为法律结论。

<a id="architecture"></a>

## 02 · 项目结构与工作原理

<a id="section-2-1"></a>

### 2.1 部署结构

Linro 是带简体中文 / 英语管理界面的短链接管理平台。它部署为两个 Cloudflare Worker，共享一个 D1 数据库。管理界面是 React + Vite 构建的静态资源，由 **Admin Worker 的 Static Assets** 提供；该版本不要求另建 Pages 项目。

```text
管理员浏览器 / 自动化客户端
            │
            ▼
管理域名 → Cloudflare Access → Admin Worker → D1
                                  │           ▲
                                  ├─ ASSETS   │
                                  ├─ AE 查询  │
                                  └─ Cron归档 ┘

公开访客 → 短链域名 → Redirect Worker → D1最新状态核验
                             │
                             ├─ 可选KV路由缓存（不是授权来源）
                             ├─ 可选密码 / 浏览器检查
                             ├─ 地区分流 → 301 / 302 / 307 / 308
                             ├─ 或直接返回纯文本200
                             └─ 可选Analytics Engine事件写入
```

| 组件 | 职责 | 不负责的事情 |
| --- | --- | --- |
| Admin Worker | Access JWT 复核、角色与 scope、API、GUI、审计、统计查询与归档 | 不承担公开短链访问；不代理目标网站 |
| Redirect Worker | 短码查找、保护策略、分流、纯文本响应、限额、事件写入 | 不向访客提供管理权限；不获取目标页面内容 |
| D1 / `DB` | 用户、域名、链接、token 哈希、设置、审计、日统计 | 不保存 Worker 根 secret |
| KV / `REDIRECT_CACHE` | 可选路由数据缓存；命中后仍读 D1 | 不是备份、严格计数器或无数据库降级通道 |
| Analytics Engine | 采样事件及查询 | 不是精确 UV 系统，不负责权限或额度判断 |
| Cloudflare Access | 管理域名的外层身份验证 | Access 放行不等于已成为 Linro 用户 |

管理域名与短链域名必须分开。**Cloudflare Custom Domain 绑定**负责把请求送到 Redirect Worker；**Linro 的域名记录**负责在 D1 中允许该主机下的业务链接。两者缺一不可。GUI 添加域名不会自动创建 DNS 或 Worker Custom Domain。

当前管理 UI 使用 TailAdmin React 的 MIT 布局与组件适配、Recharts 图表和 Tailwind CSS；依赖中不包含 ApexCharts。配色为天蓝 #87CEEB、白色 #FFFFFF、文字 #0D394A，支持简体中文和 English。许可文本随源码保存在 LICENSES/。

<a id="section-2-2"></a>

### 2.2 当前协议标识

| 对象 | v1.0.1 标识 |
| --- | --- |
| 管理 API 前缀 | `/Linro/v1` |
| 应用令牌 | `Linro_` + 43 位 base64url 随机串 |
| 浏览器写请求 CSRF 头 | `X-Linro-CSRF: 1` |
| 本地开发认证头 | `X-Linro-Dev` |
| 密码解锁 | `/__Linro_unlock/:slug` |
| 浏览器检查 | `/__Linro_browser/:slug` |
| 公开样式 / 脚本 | `/__Linro_assets/password.css`、`/__Linro_assets/browser.js` |
| 生产访客 Cookie | `__Host-Linro_unlock_*`、`__Host-Linro_browser_*` |
| 开发访客 Cookie | `Linro_unlock_*`、`Linro_browser_*` |
| 内部参数 | `_Linro_check`、`_Linro_lang` |
| JSON 导出格式名 | `linro` |

URL 路径、短码、令牌和 Cookie 名称区分大小写；HTTP 请求头名称不区分大小写。客户端应使用本节列出的 Linro 协议标识；应用令牌必须使用创建时返回的完整值，不可通过修改字符串前缀迁移。

<a id="section-2-3"></a>

### 2.3 源码导航

| 路径 | 内容 |
| --- | --- |
| `apps/admin/src/worker/index.ts` | 管理入口、同源限制、鉴权、静态资源、Cron |
| `apps/admin/src/worker/api.ts` | 25 个管理 API 方法 / 路径组合 |
| `apps/admin/src/worker/auth.ts` | 用户解析、RBAC、token scopes、归属和 CSRF |
| `apps/admin/src/worker/data.ts` | 链接输入、公开返回对象、审计 |
| `apps/admin/src/worker/analytics.ts` | AE 查询、筛选、D1 日归档 |
| `apps/admin/src/web/` | 管理 GUI、导入导出、语言与表单 |
| `apps/redirect/src/` | 公开访问、密码页、浏览器检查页 |
| `packages/shared/src/` | 类型、校验、密码、时区、缓存、安全策略 |
| `scripts/config-lib.mjs`、`configure.mjs`、`preflight.mjs` | 配置生成与本地预检查 |
| `migrations/0001` 至 `0004` | 数据结构和规则修订触发器 |

**依据：** `package.json`；`apps/admin/src/worker/index.ts`；`apps/redirect/src/index.ts`；`docs/PROTOCOL-v1.0.1.md`。

<a id="install"></a>

## 03 · 首次安装：从源码到 Cloudflare

<a id="section-3-1"></a>

### 3.1 准备与操作边界

准备 Cloudflare 账户、用于管理端和公开端的独立域名、通过 Access 登录的真实邮箱、本机 Node.js / npm，以及部署目标账户所需权限。项目声明 **Node.js ≥22.16.0**；源码锁定 Wrangler **4.132.0**。完整源码 ZIP 包含 `package-lock.json`，优先使用 `npm ci`，安装时保留随包锁文件，不要重建依赖树。

| 命令类别 | 是否修改云端 |
| --- | --- |
| `npm ci`、`check`、`build`、`test`、`configure`、`preflight` | 不部署业务；主要读写本机文件，安装依赖需要网络 |
| `deploy:dry-run`、`versions upload --dry-run` | 不发布生产流量；不是完整线上验收 |
| `wrangler login` | 为本机授权，不是 Linro 管理端登录 |
| `d1 create`、远程迁移 / SQL 导入 | 会创建或修改云端数据库 |
| `deploy`、`versions deploy`、`secret put` | 会改变云端服务；两个 Worker 不是原子更新 |
| D1 远程导出 | 读取云端业务数据，材料提示可能短暂影响查询 |

示例采用分步执行，每一步成功后再继续。不要把远程建库、迁移、secret 轮换与发布合并成未经检查的一键脚本。

<a id="section-3-2"></a>

### 3.2 解压、检查版本与安装依赖

解压 ZIP 并进入 `Linro-v1.0.1`。检查根目录确实属于本版：

```bash
node --version
npm --version
node -p "require('./package.json').name + ' ' + require('./package.json').version"
npm ci
npm run toolchain:versions
npm run check
npm run build
```

期望项目元数据为 `linro 1.0.1`。`toolchain:versions` 用项目 Wrangler 依赖树输出 Wrangler / Miniflare / workerd 等版本；它不会自动改用全局 Miniflare 或下载替代工具。依赖安装失败应检查网络、操作系统原生包和锁文件，而不是删除锁文件或执行强制自动升级。

Linux（或已安装 GNU coreutils 的 macOS）有 `sha256sum` 时，可在项目根校验源码清单：

```bash
sha256sum -c MANIFEST.sha256
```

<a id="section-3-3"></a>

### 3.3 登录并确认部署账户

```bash
npx wrangler --version
npx wrangler login
npx wrangler whoami
```

确认 Wrangler 为项目锁定版本，`whoami` 的 Account ID 是目标账户。Account ID、Zone ID、Access AUD、D1 Database ID 是不同值。创建 D1 前明确账户，避免默认账户选错：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = Read-Host "目标 Cloudflare Account ID"
```

```bash
read -r -p "目标 Cloudflare Account ID: " CLOUDFLARE_ACCOUNT_ID
export CLOUDFLARE_ACCOUNT_ID
```

不要把部署凭据放入 Worker vars、前端或源码仓库。部署登录与进入 Linro 后台的 Access 身份相互独立。

<a id="section-3-4"></a>

### 3.4 创建一个正式 D1 数据库

仅对真正的首次安装执行创建；已有数据库请转到[保留配置升级](#upgrade)。

```bash
npx wrangler d1 list
npx wrangler d1 create linro
npx wrangler d1 info linro
```

记录真实 `database_name` 和 `database_id`。两个 Worker 必须指向同一库，不要给管理端与跳转端各建一个库。若创建过程询问是否直接修改配置，可拒绝自动改写，随后统一生成两端配置。

不要把本地开发库全量导入正式库来“保留本地 Owner”。正式 Owner 必须由真实 Access 登录建立。

<a id="section-3-5"></a>

### 3.5 先保护整个管理域名

在 Cloudflare Zero Trust 的 Access Applications 中创建 Self-hosted 管理应用。项目材料所列控制台名称可能随界面版本变化；关键是以下配置语义：

| Access 项 | 填写 / 检查 |
| --- | --- |
| 主机名 | `admin.example.com`，替换为真实管理域名 |
| Path | 留空，覆盖整个主机，而不是只保护 `/Linro/*` |
| 人类登录策略 | Allow，精确指定 Owner / 成员邮箱或受控身份组 |
| 登录方式 | 使用实际已配置的邮件 OTP 或 IdP |
| 公开短链域名 | 不加入此管理应用；检查泛域名策略是否误覆盖 |
| 禁止做法 | 不设置 Bypass，不以 Everyone 放开后台 |

保存同一应用的 `access_issuer`、`access_aud` 和首位 `owner_email`。Issuer 形如 `https://your-team.cloudflareaccess.com`，不带尾斜线；AUD 不是 Application ID 或 API token。

Worker 会再次校验 `Cf-Access-Jwt-Assertion`。管理静态资源必须保持 `assets.run_worker_first: true`，不能绕过 Worker 自身鉴权。`workers_dev` 与 `preview_urls` 均保持 `false`。

创建 Access 应用需要 Zero Trust 管理权限；Wrangler 的 Workers 部署授权不等于 Access 创建权限。可在控制台单独创建应用，在“其他设置 → AUD 标签”读取此应用的 Audience。

<a id="section-3-6"></a>

### 3.6 填写首次部署配置

先保护已有文件，避免覆盖：

```powershell
if (Test-Path .\deployment.json) { throw "deployment.json 已存在，请审阅而非覆盖" }
Copy-Item .\deployment.example.json .\deployment.json
```

```bash
test ! -e deployment.json && cp deployment.example.json deployment.json
```

下面是**首次基础部署建议示例**。它刻意把 `browser_timezone_enabled` 设为 `false`，与包内默认 `true` 不同，目的是在尚未配置浏览器检查 secret 时先跑通普通跳转；并不是修改源码默认值。已有实例应保留实际配置，不套用此示例。

```json
{
  "account_id": "YOUR_CLOUDFLARE_ACCOUNT_ID",
  "database_id": "YOUR_D1_DATABASE_UUID",
  "database_name": "linro",
  "admin_worker_name": "linro-admin",
  "redirect_worker_name": "linro-redirect",
  "admin_host": "admin.example.com",
  "redirect_hosts": ["go.example.com"],
  "access_issuer": "https://your-team.cloudflareaccess.com",
  "access_aud": "YOUR_ACCESS_APPLICATION_AUD",
  "owner_email": "owner@example.com",
  "analytics_enabled": false,
  "analytics_dataset": "linro_clicks",
  "browser_timezone_enabled": false,
  "cloudflare_device_type_enabled": false,
  "auth_rate_namespace": "21001",
  "write_rate_namespace": "21002",
  "redirect_rate_namespace": "21003",
  "redirect_rate_limit": 300,
  "password_rate_namespace": "21004",
  "password_rate_limit": 5,
  "redirect_cache_namespace_id": "",
  "redirect_cache_ttl": 300,
  "query_forward_allowlist": [
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"
  ],
  "private_target_allowlist": [],
  "expired_link_status": 404,
  "source_url": ""
}
```

该 JSON 仍包含不可部署的占位值。`source_url` 应填写你已经发布、与运行版本对应的公共源码地址；保留为空会触发预检查提醒，而不是自动上传源码。不要填后台域名或短链地址冒充源码入口。

生成并审阅：

```bash
npm run configure
npm run preflight
```

`configure` **会覆盖** `apps/admin/wrangler.jsonc` 与 `apps/redirect/wrangler.jsonc`。它不会创建 Access、D1、域名业务记录或 secrets。不要对经过手工调整的生产配置直接运行后不检查差异。

```bash
node -e "const fs=require('node:fs');for(const f of ['apps/admin/wrangler.jsonc','apps/redirect/wrangler.jsonc']){const c=JSON.parse(fs.readFileSync(f,'utf8'));console.log(JSON.stringify({file:f,name:c.name,account:c.account_id,db:c.d1_databases,routes:c.routes,workers_dev:c.workers_dev,preview_urls:c.preview_urls,assets:c.assets},null,2));}"
```

检查名称、Account ID、D1 ID、域名、资源目录和安全入口。`preflight` 只是本地配置检查，不证明远程身份策略、DNS、TLS、secret 或数据库可用。

<a id="section-3-7"></a>

### 3.7 应用迁移并部署

先确认待迁移清单：

```bash
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
```

本版需要四个迁移：

| 文件 | 作用 |
| --- | --- |
| `0001_initial.sql` | 基础表、索引、保留最后一个启用 Owner 的触发器 |
| `0002_link_controls.sql` | 地区规则、密码校验串、访问上限、计数、规则修订 |
| `0003_text_responses.sql` | 纯文本模式及正文，扩展修订触发器 |
| `0004_browser_checks.sql` | `block_vpn`，再次扩展修订触发器 |

确认目标库正确后执行远程迁移，已有数据的库必须先备份：

```bash
npm run db:migrate
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
```

不要直接逐个重复执行 SQL 文件，不要删除迁移记录来绕过错误。迁移失败立即停止发布。

执行本地发布检查：

```bash
npm run check
npm run test
npm run test:runtime
npm run build
npm run test:browser
npm run deploy:dry-run
```

`test:browser` 需要真实 Chrome / Chromium 可执行环境；工具缺失或测试失败不等于通过。`test:runtime` 使用项目工具链执行原生 workerd 测试，不能用普通 Node 模拟完全替代。

正式发布：

```bash
npm run deploy
```

**脚本实际顺序：** `preflight → build → test → test:runtime → deploy:admin → deploy:redirect → verify:deployment`。该脚本**不自动执行数据库迁移，也不包含 `test:browser`**；必须先完成上面的相应步骤。已有实例升级时，另按第 8 章核对并保留实际配置。

浏览器测试前请显式指定已安装的浏览器。Linux / GitHub Ubuntu runner 使用 CFL_CHROMIUM_PATH=/usr/bin/google-chrome；Windows PowerShell 使用 $env:CFL_CHROMIUM_PATH 指向实际 Chrome 或 Edge 可执行文件，再运行 npm run test:browser。保留浏览器沙箱，缺少浏览器不能当作测试通过。

若发布已经生成 Version ID，但探活返回 ENOTFOUND，先核对 Custom Domain 与本机/公共 DNS。新域名可能仍受 NXDOMAIN 缓存影响；等待解析更新后只重跑 npm run verify:deployment，不要循环重新发布、解绑或关闭 TLS 校验。

<a id="section-3-8"></a>

### 3.8 首次登录与基本验收

打开管理域名，经 Access 用 `owner_email` 对应的真实邮箱登录。在用户表为空时，系统才会自动创建首位 Owner。已经存在用户时，修改 `owner_email` 不会替换原 Owner。

进入“域名 / Domains”添加 `go.example.com` 的业务记录，再创建一条专用测试短链：`slug=install-check`，普通公开目标、`query_mode=discard`、`cache_ttl=0`、暂不加密码 / 上限 / VPN 检查。

```bash
npm run verify:deployment
curl -sS -D - -o /dev/null https://go.example.com/install-check
curl -sS https://go.example.com/health
```

Windows 可将 `curl` 改为 `curl.exe`，输出丢弃使用 `-o NUL`。不要加 `-L` 自动跟随第三方目标来替代首跳检查。期望首跳是所配置的状态码和正确 `Location`；公开 `/health` 返回 `status:ok`、`version:1.0.1`，但不检测 D1。

随后按[上线验收](#acceptance)检查权限、错误路径及可选功能。基础服务通过后再依次启用密码、浏览器检查、KV 和统计，方便定位配置问题。

**依据：** `package.json`；`package-lock.json`；`scripts/configure.mjs`；`scripts/config-lib.mjs`；`scripts/preflight.mjs`；`README.md`；四个迁移文件。

<a id="configuration"></a>

## 04 · 配置字典

<a id="section-4-1"></a>

### 4.1 三个配置层级

| 层级 | 管理方式 | 示例 |
| --- | --- | --- |
| 部署层 | 私有 `deployment.json` → `configure` → 两端 Wrangler 配置 | 域名、D1、Access、限流、KV、统计、浏览器采集 |
| Worker secret 层 | Wrangler `secret put` 或既有受控 secret 管理 | `LINK_PASSWORD_SECRET`、`BROWSER_CHECK_SECRET`、`ANALYTICS_API_TOKEN` |
| 应用数据层 | GUI / 管理 API，保存在 D1 | 链接、用户、域名记录、域名默认状态码、`site_name` |

**Owner 角色不等于 Cloudflare 部署管理员。** GUI 不提供修改 Worker 绑定、根 secret、Access AUD、参数白名单、统计开关或采集开关的 API。`PATCH /settings` 只能写 `site_name`。

<a id="section-4-2"></a>

### 4.2 `deployment.json` 完整字段

以下默认值来自 **v1.0.1 配置生成器**，不是本手册首次安装建议值，也不代表已有实例的实际配置。

| 字段 | 类型 / 默认值 | 约束与说明 |
| --- | --- | --- |
| `account_id` | string，必填 | 实际 32 位小写十六进制 Account ID，不能全零 |
| `database_id` | string，必填 | 实际 D1 UUID；两个 Worker 共享 |
| `database_name` | string，`linro` | 1–51 位小写字母、数字、连字符，首位须字母或数字 |
| `admin_worker_name` | string，`linro-admin` | 1–63 位小写字母、数字、连字符；已有实例应明确保留原名 |
| `redirect_worker_name` | string，`linro-redirect` | 约束同上；不得与管理 Worker 同名 |
| `admin_host` | string，必填 | 小写 DNS 主机名，≤253 字符，不含协议、端口、路径或尾点；不得用 IPv4 地址 |
| `redirect_hosts` | string[]，必填 | 1–50 个不重复的小写 DNS 主机名；不能等于管理主机 |
| `access_issuer` | string，必填 | `https://<team>.cloudflareaccess.com`，无尾斜线 |
| `access_aud` | string，必填 | 同一后台 Access 应用 AUD，16–256 位字母 / 数字 / `_` / `-`；拒绝明显占位值 |
| `owner_email` | string，必填 | 首位 Owner 的 Access 邮箱，≤254 字符；生成变量时转小写 |
| `analytics_enabled` | boolean，`false` | 两端统计开关；开启时生成写入 binding 和管理端 Cron |
| `analytics_dataset` | string，`linro_clicks` | 1–64 位，字母或 `_` 开头，仅字母 / 数字 / `_`；不要为品牌更名误换现有数据集 |
| `browser_timezone_enabled` | boolean，`true` | 全局浏览器时区采集；需要 `BROWSER_CHECK_SECRET`，会改变普通 GET 流程 |
| `cloudflare_device_type_enabled` | boolean，`false` | 仅在确认平台可信地产生 / 覆盖设备头后启用；不是普通 UA 分类开关 |
| `auth_rate_namespace` | 数字字符串，`21001` | `AUTH_LIMITER`；四个 namespace 必须不同，1–10 位正整数形式 |
| `write_rate_namespace` | 数字字符串，`21002` | `WRITE_LIMITER`；不要与其他实例误共享 |
| `redirect_rate_namespace` | 数字字符串，`21003` | `REDIRECT_LIMITER` |
| `redirect_rate_limit` | integer，`300` | 1–100000；60 秒窗口；不是每日账户额度或全球原子配额 |
| `password_rate_namespace` | 数字字符串，`21004` | `PASSWORD_LIMITER`，独立于其他三个 |
| `password_rate_limit` | integer，`5` | 1–30；60 秒窗口；实际 key 为来源 IP 哈希而非短码 |
| `redirect_cache_namespace_id` | string，`""` | 空值不绑定 KV；启用需实际非全零 32 位小写十六进制 namespace ID |
| `redirect_cache_ttl` | integer，`300` | 60–86400 秒；KV 条目生存配置，不是客户端缓存 TTL |
| `query_forward_allowlist` | string[]，默认五个 UTM 键 | 最多 32 个不重复精确小写键，格式 `[a-z][a-z0-9_]{0,63}`；敏感键禁止 |
| `private_target_allowlist` | string[]，`[]` | 最多 32 个规范精确主机 / IP 字面量，JSON ≤4096 字符；无协议、端口、通配符或 CIDR |
| `expired_link_status` | number，`404` | 只接受 `404` 或 `410` |
| `source_url` | string，`""` | ≤2048 字符的公共 HTTPS 源码地址，无凭据、查询、片段、空白、反斜线；不能为本部署后台或短链主机 |

默认查询参数白名单为 `utm_source`、`utm_medium`、`utm_campaign`、`utm_term`、`utm_content`。不是任意 `utm_*` 通配匹配。

`admin_worker_name` 与 `redirect_worker_name` 虽未列入原始 `deployment.example.json`，但由源码明确支持。生成器在已有配置与输入 **Account ID、D1 ID 都相同**时，会尝试继承原 Worker 名；新目录中的公共模板不具备真实线上信息，因此升级时仍应显式填写原名。

不要添加 `default_redirect_code`、`auth_rate_limit`、`write_rate_limit` 等不存在的部署字段并期待生效：域名默认状态码通过域名 API 设置；生成器固定 AUTH 为 300 / 60 秒、WRITE 为 120 / 60 秒。生成器并不严格拒绝所有未知顶层键，拼写错误可能被忽略；以本表和生成结果为准。

<a id="section-4-3"></a>

### 4.3 生成后的绑定与变量

| 名称 | Admin | Redirect | 用途 |
| --- | --- | --- | --- |
| `DB` | 必需 | 必需 | 同一 D1 数据库；迁移目录均指向根 `migrations/` |
| `ASSETS` | 必需 | 无 | 管理前端；目录 `apps/admin/dist`；SPA fallback + Worker 优先 |
| `AUTH_LIMITER` | 300 / 60秒 | 无 | API 和管理 `/health` 的来源 IP 哈希桶，鉴权前执行 |
| `WRITE_LIMITER` | 120 / 60秒 | 无 | 非 GET/HEAD API 请求按用户 ID + token ID / browser 限制 |
| `REDIRECT_LIMITER` | 无 | 默认300 / 60秒 | 公开请求来源 IP 桶；在 D1 查询前执行 |
| `PASSWORD_LIMITER` | 无 | 默认5 / 60秒 | 密码验证尝试，跨短码共享同 IP 桶 |
| `REDIRECT_CACHE` | 可选 | 可选 | 两端同一 KV namespace，必须同时配置或同时省略 |
| `ANALYTICS` | 无 | 统计开启时生成 | Analytics Engine 写入绑定 |
| Cron | 统计开启时 `*/15 * * * *` | 无 | 增量归档，不是实时每15分钟快照 |

| 运行时变量 | 来源 / 说明 |
| --- | --- |
| `ENVIRONMENT` | 生产生成器固定 `production`；本地初始化为 `development` |
| `ADMIN_ORIGIN` | `https://` + `admin_host`，两端一致 |
| `ACCESS_ISSUER` / `ACCESS_AUD` / `BOOTSTRAP_OWNER_EMAIL` | 仅管理端用于 Access / 首位 Owner |
| `CLOUDFLARE_ACCOUNT_ID` / `ANALYTICS_DATASET` | 管理端 AE 查询目标 |
| `ANALYTICS_ENABLED` | 两端字符串 `"true"` / `"false"` |
| `BROWSER_TIMEZONE_ENABLED` / `CLOUDFLARE_DEVICE_TYPE_ENABLED` | 两端字符串布尔 |
| `QUERY_FORWARD_ALLOWLIST` / `PRIVATE_TARGET_ALLOWLIST` | 两端 JSON 数组字符串 |
| `EXPIRED_LINK_STATUS` / `REDIRECT_CACHE_TTL` | 两端字符串数字 |
| `SOURCE_URL` | 两端公共源码入口；空值时不附加源码 Link 头 |

生成器还固定 `compatibility_date: "2026-09-15"`、`workers_dev: false`、`preview_urls: false`、`observability.enabled: false`。已有实例可能具有更多手工设置；生成器不是任意线上配置的无损往返转换器。

<a id="section-4-4"></a>

### 4.4 Secret 字典与安全保管

| Secret / 凭据 | 保存位置 | 有效格式 / 用途 | 变更影响 |
| --- | --- | --- | --- |
| `LINK_PASSWORD_SECRET` | 两端同值 Worker secret | 43–128 位 base64url 字符；推荐随机32字节后 base64url | 丢失 / 更换会影响既有密码验证，不只是 Cookie 失效 |
| `BROWSER_CHECK_SECRET` | 按部署约定两端同值 | 43–128 位 base64url 字符；与密码根 secret 独立 | 更换使旧短期浏览器证明失效，不改变 D1 密码校验串 |
| `ANALYTICS_API_TOKEN` | 仅 Admin Worker secret | 目标账户的 Analytics 查询凭据 | 影响查询和 Cron；不是公开跳转认证 |
| `LOCAL_DEV_TOKEN` | 仅 `.local/.dev.vars` | 本地初始化生成；用于回环地址开发认证 | 不可带入生产配置 |
| Access Service Token | 调用端私密存储 | Client ID + Client Secret；通过 Access 外层 | 不替代 Linro Bearer token |
| Linro 应用 token | 调用端私密存储 | 完整 `Linro_…`，D1 只存其哈希 | 撤销 / 过期 / 所属用户停用后失效 |

**首次生成根 secret：** 在私人终端生成一次并存入密码管理器，不把生成值写入文档、聊天、仓库或公开终端日志。

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

对一个用途生成的值，下面两次交互输入必须相同。另一个用途应生成不同值。

```bash
npx wrangler secret put LINK_PASSWORD_SECRET --config apps/admin/wrangler.jsonc
npx wrangler secret put LINK_PASSWORD_SECRET --config apps/redirect/wrangler.jsonc

npx wrangler secret put BROWSER_CHECK_SECRET --config apps/admin/wrangler.jsonc
npx wrangler secret put BROWSER_CHECK_SECRET --config apps/redirect/wrangler.jsonc
```

这些命令应在首次基础 Worker 已存在时按需执行。项目安装材料指出 `secret put` 会产生并部署新版本，应作为线上变更登记；不要对已有实例例行重新生成根 secret。`preflight` 和 `/session.features.*_configured` 都不能证明远程两端 secret 相等。

<a id="section-4-5"></a>

### 4.5 查询转发与目标安全策略

目标必须是显式绝对 `http://` 或 `https://` URL，≤4096 字符，不含 URL 凭据、空白、控制字符或反斜线。API 不抓取目标页面。后台主机及任一已登记短链主机不能成为目标，以阻止内部链式跳转；默认拒绝本地 / 私有目标，只有部署者审阅后的精确主机例外可放行。该校验不做 DNS 解析，因此不应将它描述成完整 DNS 重绑定防御。

| `query_mode` | 行为 |
| --- | --- |
| `discard` | 忽略访客传入查询，保留目标 URL 原有查询 |
| `merge` | 只合并白名单中的来访键；目标已经具有同名键时目标值优先 |
| `replace` | 清空目标原查询，再放入白名单过滤后的来访查询；过滤后为空也会清空旧查询 |

例如目标 `https://example.org/page?a=1&utm_source=fixed`，访客参数 `utm_source=new&utm_medium=email&token=secret`：

| 模式 | 结果 |
| --- | --- |
| discard | `https://example.org/page?a=1&utm_source=fixed` |
| merge | `https://example.org/page?a=1&utm_source=fixed&utm_medium=email` |
| replace | `https://example.org/page?utm_source=new&utm_medium=email` |

认证、会话、密码、回跳等敏感键禁止进入白名单。源码可识别的敏感目标必须使用 `discard`，写入否则报 `unsafe_query_mode`；旧库同类记录在公开读取时按 `discard` 处理，不自动改库。内部 `_Linro_check` / `_Linro_lang` 不透传给目标。组合后跳转 URL 最大 8192 字符。

公开配置示例将 source_url 留空，避免将某个仓库首页误当成实际部署的对应源码。面向网络使用前，发布实际运行版本的完整对应源码，并将 source_url 设为可公开访问的固定提交或版本源码入口。格式校验和非空值不证明公开可访问、源码完整或已经履行许可证要求；自行核验并保留原许可与通知。

<a id="section-4-6"></a>

### 4.6 参数变更方式

更改普通部署项后，按“备份现有配置 → 修改受控输入 → 生成并检查差异 → preflight → 构建 / 测试 / dry-run → 部署 → 线上验收”操作。修改短链内容、启停、密码或次数上限应优先使用 GUI / API，以保留版本锁和审计。

删除或停用链接不能撤销用户此前已缓存的旧跳转响应。开启任何保护前，应关注旧 `cache_ttl` 和已发出的客户端缓存。KV 的最新 D1 核验也无法强制客户端重新请求已经缓存的结果。

**依据：** `scripts/config-lib.mjs`；`scripts/configure.mjs`；`scripts/preflight.mjs`；`packages/shared/src/policy.ts`、`destination.ts`、`validation.ts`；`link-password.ts`；`browser-check.ts`。

<a id="section-4-7"></a>

### 4.7 配置多个短链域名

Linro 支持一个管理域名加 1–50 个公开短链域名。所有公开域名可以绑定到同一个 Redirect Worker，并与 Admin Worker 共享同一个 D1 数据库和既有 secrets；不用为每个域名新建 Worker 或数据库。admin_host 是单个字符串，本版不提供多个管理域名入口。

示例包含同一 Zone 的子域名 go.example.com、另一 Zone 的子域名 s.example.net，以及顶级域名 example.org。使用你在同一 Cloudflare 账户中管理、已激活的 Zone，并确认部署凭据有权限管理目标域名。域名必须互不重复且不等于管理域名，只填写小写主机名，不带协议、路径、端口或通配符。1–50 是 Linro 配置校验范围，不是 Cloudflare 套餐额度承诺。

步骤一：新安装可从下列完整示例填写 deployment.json；已有实例只把新增主机合并到自己的 redirect_hosts，保留全部原域名、Worker 名称、Account ID、D1、KV、统计、限流、Access 和功能开关。不要用示例覆盖生产配置，也不要重设根 secret。

```json
{
  "account_id": "YOUR_CLOUDFLARE_ACCOUNT_ID",
  "database_id": "YOUR_D1_DATABASE_UUID",
  "database_name": "linro",
  "admin_host": "admin.example.com",
  "redirect_hosts": [
    "go.example.com",
    "s.example.net",
    "example.org"
  ],
  "access_issuer": "https://your-team.cloudflareaccess.com",
  "access_aud": "YOUR_ACCESS_APPLICATION_AUD",
  "owner_email": "owner@example.com",
  "analytics_enabled": false,
  "analytics_dataset": "linro_clicks",
  "auth_rate_namespace": "21001",
  "write_rate_namespace": "21002",
  "redirect_rate_namespace": "21003",
  "redirect_rate_limit": 300,
  "query_forward_allowlist": [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content"
  ],
  "private_target_allowlist": [],
  "expired_link_status": 404,
  "password_rate_namespace": "21004",
  "password_rate_limit": 5,
  "redirect_cache_namespace_id": "",
  "redirect_cache_ttl": 300,
  "cloudflare_device_type_enabled": false,
  "browser_timezone_enabled": false,
  "source_url": "",
  "admin_worker_name": "linro-admin",
  "redirect_worker_name": "linro-redirect"
}
```

[下载多域名配置示例（必须填写真实资源信息）](examples/deployment.multidomain.example.json)

步骤二：若 deployment.json 是完整、受控的配置源，先备份两端配置，再运行 configure 与 preflight，审阅差异。生成的 Redirect routes 必须包含全部要保留的主机，且每项 custom_domain 为 true；管理端仍只绑定 admin_host。若线上有生成器不支持的手工配置，应在部署专用配置中保留这些项，按第08章核对后再部署。

```bash
npm run configure
npm run preflight
npm run deploy:dry-run
```

```json
{
  "routes": [
    {
      "pattern": "go.example.com",
      "custom_domain": true
    },
    {
      "pattern": "s.example.net",
      "custom_domain": true
    },
    {
      "pattern": "example.org",
      "custom_domain": true
    }
  ]
}
```

步骤三：把这些 Custom Domains 部署到原 Redirect Worker。首次安装按第03章完成迁移、构建、检查及 npm run deploy。对于已有实例，代码无需更新时，可在已审阅的真实配置上单独运行下面的 triggers deploy。该命令会同步配置中的触发器，不是只追加单个域名；省略旧主机或旧 Cron 可能改变现有服务，必须先检查完整列表。仅 versions upload / versions deploy 不会新增域名绑定。

```bash
npx wrangler triggers deploy --config apps/redirect/wrangler.jsonc
```

Cloudflare Custom Domains 负责把主机绑定到 Worker，并管理相应 DNS / 证书。遇到已有 CNAME 或同名业务冲突时先查明现有用途，不要直接删除记录或随意添加指向 workers.dev 的 CNAME。等待证书生效后再验证 HTTPS。

[Cloudflare Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) · [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)

步骤四：以交互式 Owner / Admin 登录 Linro，在“域名”页面分别添加三个相同主机名。这一步创建 D1 业务域名记录，Cloudflare 绑定不会自动替你创建它们。反过来，只在 GUI 添加域名也不会创建 DNS 或 Worker 绑定。若目标主机已被现有链接当作跳转目标，新增业务域名可能返回 hostname_is_destination，应先审阅并处理相关目标。

也可用交互式管理 API：为每个域名提交 POST /Linro/v1/domains，正文如下，随后以返回的 id 作为新链接的 domain_id。应用令牌没有 domains:write，不能用于这一步。

```json
{
  "hostname": "s.example.net",
  "name": "Secondary short domain",
  "enabled": true,
  "default_redirect_code": 302
}
```

步骤五：在每个域名下单独创建一个无密码、无 VPN 限制、无限次数、cache_ttl=0 的专用验收链接。相同 slug 可出现在不同域名，但记录互相独立；为一个域名创建 welcome 不会自动生成其他域名的 welcome。已有链接不会自动迁移或变成域名别名。

```bash
curl --silent --show-error https://go.example.com/health
curl --silent --show-error --head https://go.example.com/install-check
curl --silent --show-error https://s.example.net/health
curl --silent --show-error --head https://s.example.net/install-check
curl --silent --show-error https://example.org/health
curl --silent --show-error --head https://example.org/install-check
```

逐域名确认：health 为 HTTP 200 且 version=1.0.1；install-check 的首跳状态与 Location 正确。不要加 -L；Windows 使用 curl.exe。health 不读 D1，因此 health200而短链404时应检查 GUI 域名记录及对应短码。HEAD 会消耗有限次数链接的名额，所以只对上述无限次数验收记录操作。最后验证管理域名仍受 Access 保护，公开域名未被管理端 Access 策略误覆盖。

后续移除域名时，先处理它名下的业务链接，再分别修改 D1 域名记录和 Cloudflare 绑定。不要删掉其他域名或共享数据库；在 GUI 停用域名只控制业务可用性，不会自动解除平台绑定。

<a id="features"></a>

## 05 · 可选功能与行为说明

<a id="section-5-1"></a>

### 5.1 KV 路由缓存

不配置 `redirect_cache_namespace_id` 就完全不使用 KV；配置后两端自动绑定同一 `REDIRECT_CACHE`。首次可用项目 Wrangler 创建 namespace，并把返回的真实 ID 填入部署配置：

```bash
npx wrangler kv namespace create REDIRECT_CACHE --config apps/redirect/wrangler.jsonc
```

该命令会创建云端资源。已有实例应复用原 namespace，而不是重建。随后生成、检查并部署两端配置。

**KV 命中不是零 D1 查询。** 命中后仍查询最新链接 / 域名启用状态、版本、规则修订、密码、上限、计数、模式、VPN 标志以及目标是否被登记为短域名。过期或不匹配条目回到权威 D1 路径；KV 读取失败 / 超时会尝试回退 D1，但 D1 故障不会用旧缓存直接放行。

KV 保存路由字段，不保存密码校验串、根 secret、计数、用户资料、浏览器证明或纯文本正文。纯文本行不缓存。业务数据和审计先提交 D1，KV 维护为尽力操作；缓存维护失败不代表业务写入已回滚。

`redirect_cache_ttl` 控制 KV；单链接 `cache_ttl` 控制访客客户端缓存。两者不是同一个开关。是否节省整体资源需要实际测量，不能仅凭绑定 KV 承诺提高免费配额承载量。

<a id="section-5-2"></a>

### 5.2 密码保护

仅使用密码功能时才需要配置 `LINK_PASSWORD_SECRET`。每条链接密码为 12–128 个 UTF-16 代码单元，UTF-8 编码最多512字节，无控制字符；不自动去掉首尾空格。

| 编辑操作 | API 语义 |
| --- | --- |
| 保留已有密码 | PATCH 中省略 `password` |
| 设置 / 更换密码 | `password` 为新的有效字符串 |
| 明确移除密码 | `password: null` |
| 空字符串 | 不是“保留”或“清除”；直接调用 API 会校验失败 |

未经解锁的 GET 返回200密码页，无目标 `Location`；错误密码 POST 返回401页面；正确密码 POST 返回同域同短码303并设置最长900秒 Cookie。密码体不会转发到外部目标，之后的 GET 重新检查最新规则。编辑规则会使旧修订绑定的 Cookie 失效。

密码用于公开访客访问控制，**不隐藏已经授权的后台成员可读到的目标 URL 或纯文本正文**。数据库保存校验串而非密码明文；GUI / API / JSON / CSV 不返回校验串。

项目实现为 PBKDF2-SHA256、随机盐和独立 HMAC pepper；配置的根 secret 必须与 SQL 备份分别安全保管。根 secret 丢失后不能从数据库恢复密码明文。

首次写入密码 secret 后刷新管理页面以重新读取会话能力，确认“设置新密码”可用。两个 Worker 的根 secret 必须一致；已有实例保留原值。

<a id="section-5-3"></a>

### 5.3 浏览器时区采集与疑似 VPN 检查

| 全局 `browser_timezone_enabled` | 单链 `block_vpn` | GET 访问行为 |
| --- | --- | --- |
| false | false | 不发起时区采集；仍执行原密码、启停、期限、限额 |
| true | false | 需要浏览器检查流程以采集时区，但不因时区不一致 / unknown 本身拦截 |
| false | true | 仍强制浏览器检查；全局关闭不关闭此单链保护 |
| true | true | 采集并执行疑似 VPN / unknown 拒绝策略 |

凡流程需要检查而未配置有效 `BROWSER_CHECK_SECRET`，公开端会返回503，不静默降级。启用单链 `block_vpn` 时，Admin 也检查 secret 配置格式。

浏览器通过 JavaScript 报告 `Intl.DateTimeFormat().resolvedOptions().timeZone`，服务端与 `request.cf.timezone` 在同一运行时规范化后比较时区标识；不是比较当前 UTC 偏移。源码将平台 `request.cf.country === 'T1'` 作为 Tor 信号。客户端普通自填请求头不作为该平台元数据。

**该功能不是可靠的 VPN 证明或身份认证。** 自报时区不可信，旅行、手动设置、IP 地理信息偏差都可能误拦；同一时区也不能排除代理。缺失 / 无效时区归类 `unknown`，并不自动计为 VPN，但开启单链阻止时仍拒绝。

浏览器检查正常路径：200检查页 → 同源表单 POST → 200 JSON 成功响应及短期 Cookie → 同短码普通导航 → 最新 D1 检查 → 最终3xx或文本200。挑战 / 证明最长120秒且签发不续期，绑定链接、修订、主机、查询及当前网络元数据摘要。完成后 Cookie 被清除；纯文本最终 URL 带完成标记，刷新该 URL 可能提示重新打开原短链。

单链未开启 `block_vpn` 时，HEAD 保留原直接响应规则，不为了全局采集而执行 JavaScript；开启时，缺有效证明的 HEAD 返回403、无目标。无 JavaScript / Cookie 客户端不能被保证完成检查路径；要保留直接响应兼容性，应使用“全局 false + 单链 false”，而不是绕过现有保护。

<a id="section-5-4"></a>

### 5.4 地区分流、纯文本与访问次数

地区分流优先级为 **国家 → 大洲 → 默认目标**，来源为 `request.cf`。每条链接最多32条规则，同一 `kind+code` 不可重复。大洲代码是 `AF / AN / AS / EU / NA / OC / SA`。所有候选 URL 都应用同样的目标安全策略；地区分流不是认证。

纯文本模式使用 `response_mode: "text"` 与 `text_content`，最大16384 UTF-16代码单元、32768 UTF-8字节，至少一个代码单元；不作为 HTML 渲染。它强制 `query_mode=discard`，不能保留非空地区规则，不要求目标 URL。密码、过期、启停、次数上限、浏览器检查仍生效。最终 GET 返回200 `text/plain; charset=utf-8`，HEAD 同状态 / 响应头但无正文。

`max_redirects: null` 表示不限次数；整数1–1000000000表示上限。只有配置上限时才递增 `redirect_count`；**最终获准 GET 和 HEAD 各扣一次**。它不是人数、PV完整历史或 Analytics 点击数。密码页、浏览器检查页、内部303、检查成功JSON200和静态资源不扣此额度，但仍消耗请求和相关限流资源。

改变上限不会清零已用计数。重置须在 PATCH 同时传当前 `version` 和 `reset_redirect_count: true`。耗尽返回403纯文本，无目标；并发最后一个名额通过 D1 条件 UPDATE 控制。服务端提交后连接中断可能保守占用名额，不自动退款或重试计数。

<a id="section-5-5"></a>

### 5.5 Analytics Engine 与 Cron

先跑通基础服务。按项目安装材料准备目标账户的只读 Analytics 查询凭据，权限项为 Account Analytics Read，并只写入 Admin secret：

```bash
npx wrangler secret put ANALYTICS_API_TOKEN --config apps/admin/wrangler.jsonc
```

把 `analytics_enabled` 改为 `true`，保留正确 `analytics_dataset`，检查生成结果：Redirect 增加 `ANALYTICS`，Admin 增加 `*/15 * * * *` Cron；随后部署并分别验收事件写入、实际 SQL 查询和日归档。

真正成功 GET 才记录点击：最终跳转或最终文本200；HEAD、密码页面及中间检查成功响应不计点击。策略最终拒绝会写入单独的 VPN / unknown 事件，`double1=0`，不会增加成功点击曲线。日志是采样加权估计，不去重为人数；机器人成功 GET 也可能计入。

`/stats` 每次依次执行8个 AE 查询，不会因上游429自动重试；任一维度失败不显示部分结果冒充完整结果。GUI 请求本身设有20秒等待预算，而每个上游查询有10秒预算，慢查询可能表现为前端超时，不等于零访问。

Cron 归档的是 **UTC 前两个完整日期**，每次最多处理400个“链接 / 日期”组，超出保存游标继续，UPSERT 与游标一起提交。今天的事件不应立即出现在日归档；这不是任意历史区间的完整回填任务，也没有公开“立即归档”API。

```bash
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT key,value,updated_at FROM settings WHERE key LIKE 'analytics_rollup_%';"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT link_id,date,clicks,updated_at FROM daily_stats ORDER BY date DESC LIMIT 10;"
```

关闭统计不会自动清除旧数据。AE 写入失败不会阻止已经授权的公开业务响应；查询未配置时 `/stats` 返回200且 `available:false`，不能当成零点击。系统健康中的 `configured_not_probed` 仅说明配置存在。

Analytics Engine 字段布局保持兼容：IP 参考时区不是浏览器时区。旧事件缺少浏览器时区字段时归为 none，不把 IP 值补成浏览器值。趋势分组的 UTC 也不是访问者时区。blob5 只保留既有浏览器族，不用它判断设备或 VPN。以下是字段位置，不是独立用户计数。

```text
index1: link ID
blob1: hostname
blob2: slug
blob3: Cloudflare country
blob4: referrer hostname only
blob5: legacy browser family
blob6: Cloudflare IP reference timezone
blob7: mobile / pc / none
blob8: redirect / text
blob9: normalized browser timezone / none
blob10: tor / timezone_mismatch / match / unknown
blob11: success / vpn_blocked / unknown_blocked

double1: final successful GET = 1; terminal policy denial = 0
double2: final HTTP status
double3: suspected VPN
double4: suspected VPN blocked
double5: unknown timezone blocked
double6: unknown timezone allowed successfully
double7: Cloudflare Tor marker
```

每次 /stats 是8条顺序请求：总量、趋势、热门、国家、来源、浏览器时区、IP时区、设备。它们不是同一原子快照，也不自动重试429。原始 IP、完整 UA、挑战、Cookie、密码、目标 URL 与文本正文不写入这些 AE 事件；来源仅保留主机名。

<a id="section-5-6"></a>

### 5.6 设备类型、源码入口与外层限流

设备类型默认 `none`。只有部署者确认 `CF-Device-Type` 由平台可信地产生并覆盖来访值，才能启用 `cloudflare_device_type_enabled`。当前映射：`mobile / tablet → mobile`，`desktop → pc`，其他 / 缺失 → `none`；此文不承诺任意套餐已具备该头的可信生成条件。

`source_url` 按项目许可文档用于展示对应源码入口。它影响管理 / 公开保护页页脚与响应 `Link` 头，不改变短链目标，不代理或抓取源码。填写 URL 不证明源码内容完整或地址可达，需实际检查。

建议按实际账户能力，为公开主机上的 POST /__Linro_unlock/ 路径增加独立 WAF 速率限制，作为 Worker PASSWORD_LIMITER 的补充。Worker 使用来源 IP 的 SHA-256 哈希作为 key，默认配置为每个 key、每个 Cloudflare 位置 5 次 / 60 秒；这是平台尽力计数，不是连接级计数，也不是全球严格配额。四种限流使用独立 namespace；重复 namespace 可能与同账户其他实例共享计数。不要将 GET、静态资源、后台 API 或正常浏览器检查 POST 混入极低的密码尝试桶。WAF 可用字段、动作、窗口及费用须按部署账户核实。

**依据：** `packages/shared/src/redirect-cache.ts`；`link-password.ts`；`browser-check.ts`；`apps/redirect/src/index.ts`；`apps/admin/src/worker/analytics.ts`；`apps/admin/src/web/client.ts`；`README.md`。

WAF 匹配表达式示例仅覆盖实际公开域名上的密码解锁 POST。先替换示例主机，再按账户可用功能配置计数键、阈值和动作；不能承诺免费计划支持。它不是全球单一原子计数器，项目不自动调用 Cloudflare 账户创建规则。

```text
(http.host eq "go.example.com" and http.request.method eq "POST" and starts_with(http.request.uri.path, "/__Linro_unlock/"))
```

<a id="permissions"></a>

## 06 · 用户、角色与权限

<a id="section-6-1"></a>

### 6.1 两层身份验证

生产环境的每个管理请求都先受 Cloudflare Access 保护，Worker 再校验 `Cf-Access-Jwt-Assertion` 的签名、issuer、audience 和时间约束。仅在请求中伪造邮箱头不能登录。Access 放行的真人还必须存在于 Linro `users` 表且处于启用状态；只有空用户表下匹配 `BOOTSTRAP_OWNER_EMAIL` 的首次登录可以自动建立 Owner。

初次有效登录会绑定 Access 的 `sub`。以后相同邮箱但不同 `sub` 不会自动替换绑定。迁移身份提供方导致 subject 变化时，先核对身份并备份，再进行受控数据库维护；本版本没有“重绑身份”或“修改用户邮箱”API。

自动化采用 **Access 的有效认证 + Linro 应用令牌**，不是两者任选一个。Service Token 用来通过外层 Access，`Authorization: Bearer Linro_…` 决定内部操作用户与 scope。Linro 不直接以 `CF-Access-Client-Id` / `CF-Access-Client-Secret` 作为自己的用户身份，也不允许只携带应用令牌绕过 Access JWT 校验。

自动化接入补充：在保护整个管理主机的同一 Access 应用中，为指定 Service Token 添加独立的 Service Auth 策略（Include → Service Token → 选定令牌），保留真人 Allow 策略。仅创建 Service Token 而未纳入该应用策略，不能使请求通过。每个自动化请求发送 CF-Access-Client-Id、CF-Access-Client-Secret 和 Linro Bearer token；不要用 Bypass，也不要把真人 Allow 策略当成 Service Auth。 [Cloudflare Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)（2026-09-23）

<a id="section-6-2"></a>

### 6.2 交互式会话角色矩阵

此表适用于正常 Access 浏览器会话；本地开发会话另见运维章节。

| 能力 | Viewer | Editor | Admin | Owner |
| --- | --- | --- | --- | --- |
| 读取团队全部链接，包括目标、纯文本内容和说明 | ✓ | ✓ | ✓ | ✓ |
| 读取全部域名及团队统计 | ✓ | ✓ | ✓ | ✓ |
| 新建链接 | — | ✓ | ✓ | ✓ |
| 修改、删除、启停本人创建的链接 | — | ✓ | ✓ | ✓ |
| 修改、删除、启停其他成员的链接 | — | — | ✓ | ✓ |
| 管理域名记录 | — | — | ✓ | ✓ |
| 查看审计日志 | — | — | ✓ | ✓ |
| 新建、修改、停用用户及分配角色 | — | — | — | ✓ |
| 读取 / 修改站点设置，执行 D1 健康检查 | — | — | — | ✓ |
| 管理自己的应用令牌 | ✓，限本人角色可用 scope | ✓ | ✓ | ✓ |
| 查看其他用户的完整应用令牌或短链密码 | — | — | — | — |

**这是共享工作区，不是数据隔离的多租户系统。** Viewer 的“只读”不代表只能看到自己创建的链接；后台读取权限可看到他人的目标 URL、纯文本内容、标题和描述。公开链接的密码保护只保护访客访问，不隐藏后台有权读取的数据。不要将需要成员间隔离的秘密放进同一工作区。

Owner 不等于 Cloudflare 账户管理员。Linro GUI 不能创建 Worker、修改 DNS、读取根 secrets、配置 Access 或调整平台套餐。

<a id="section-6-3"></a>

### 6.3 Scope 与应用令牌

| Scope | Viewer | Editor | Admin | Owner | 能否授予应用令牌 |
| --- | --- | --- | --- | --- | --- |
| `links:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `domains:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `analytics:read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `links:write` | — | ✓ | ✓ | ✓ | ✓ |
| `links:delete` | — | ✓ | ✓ | ✓ | ✓ |
| `domains:write` | — | — | ✓ | ✓ | — |
| `audit:read` | — | — | ✓ | ✓ | — |
| `users:write` | — | — | — | ✓ | — |
| `settings:write` | — | — | — | ✓ | — |

令牌最终权限是 **令牌保存的 scopes ∩ 令牌允许的五种 scopes ∩ 用户当前角色 scopes**。用户被降级后不能继续使用旧 token 的高权限；被停用后其 token 认证也失败。令牌过期或撤销会被拒绝。

**所有应用令牌，包括 Owner / Admin 创建的 token，都只能修改 token 所属用户创建的链接。** 读取仍按团队共享。约束依据 `created_by = user.id`，不是“由哪一个 token 创建”：同一用户的两个写 token 能操作该用户创建的同一批链接。为 CI 或集成服务隔离写入责任时，应建立独立的 Linro 用户，不应只换一个 token 名称。

`created_by = null` 的历史链接不属于普通用户；本版本没有转移所有权接口，交互式 Owner / Admin 仍可维护。新增链接的创建者由服务端认证身份写入，不能在 POST 自行指定。

令牌管理必须使用交互式会话：token 不能创建、枚举或撤销 token，包括它自己。每个用户最多允许50条尚未撤销的记录；已经过期但尚未撤销的记录也计入这个数量。此检查不是并发强一致的全局配额承诺。有效期必须为创建时起至少60秒、至多365天。完整 token 仅在创建响应显示一次，数据库存储 SHA-256 哈希。

<a id="section-6-4"></a>

### 6.4 成员管理流程

Owner 在“用户”中先建立邮箱与角色，再确保该成员同时满足外层 Access 策略。两边任一缺失都不能正常进入管理台。成员首次登录后绑定其身份 subject；不需要另设 Linro 用户密码。

停用成员：读取当前用户 `version` → PATCH `enabled: false`。角色调整：读取最新 `version` → PATCH `role`。系统通过数据库触发器保证至少保留一个启用的 Owner；停用或降级最后一名启用 Owner 返回409 `last_owner`。确需交接时，先创建并验证另一名 Owner 能登录，再处理原 Owner。

应用没有删除用户、全局列出其他用户 tokens、密码找回、邮件邀请发送、组织 / 项目级 ACL 或单链接成员授权接口。用户停用并不自动停用其已有公开链接；需要由有权的管理员另行处理这些链接。

**依据：** `apps/admin/src/worker/auth.ts`；`packages/shared/src/access.ts`；`apps/admin/src/worker/api.ts`；`migrations/0001_initial.sql` 的用户约束与 Owner 触发器。

<a id="usage"></a>

## 07 · 管理界面与日常使用

<a id="section-7-1"></a>

### 7.1 导航与首次创建

本版管理界面及公开保护页的普通正文与说明文字使用 #0D394A；天空蓝 / 白色布局和焦点样式由各自源码样式表定义。该外观说明不是浏览器显示一致性或无障碍认证承诺。

管理界面提供简体中文 / 英语。页面包括总览、链接、域名、统计、用户、应用令牌、审计和设置；菜单随 scope 显示，但服务器仍逐请求检查权限，隐藏菜单本身不是安全边界。

首次使用时，Owner / Admin 在“域名”添加已绑定到 Redirect Worker 的公开主机，例如 `go.example.com`，不带协议、端口和路径。创建链接时选择域名、填写目标 URL；测试阶段使用302、`cache_ttl: 0`，便于避免客户端长期记住早期错误目标。正式选择301 / 308前，应理解客户端可能保留永久跳转；后续修改 Worker 不能收回已经缓存在访客客户端的响应。

保存成功后复制 `short_url`。同一域名中 slug 唯一且区分大小写；不同域名可使用相同 slug。留空 slug 可自动生成8位随机短码，不提供“预测下一个短码”或可枚举的公开目录。

域名停用会使该域名下所有链接不可公开访问。默认跳转码只影响未显式指定跳转码的新建链接，不批量修改已有链接。已有链接的域名可通过链接 PATCH 调整，但新的域名和 slug 组合仍须唯一。

<a id="section-7-2"></a>

### 7.2 编辑、批量操作与状态

编辑与删除使用乐观锁 `version`。出现冲突时，刷新并比较当前记录，再决定是否重新提交；不要无条件替换为最新 version 重放旧表单。

状态筛选包含 `all`、`active`、`disabled`、`expired`、`exhausted`。一个链接可能同时过期、被停用或耗尽，因此这些非 active 分类不是互斥分区；不能直接将各状态数量相加当成总数。

清空密码用 `password: null`；不提交 password 表示保留原密码。将链接改为纯文本时清空 `geo_rules: []` 并提供 `text_content`；从纯文本改回跳转时必须提供有效 `target_url`。不要把所有只读字段原样复制回 PATCH。

批量启停 / 删除每次 API 最多10项，每项独立报告结果，不保证整批成功或整批回滚。GUI 提示部分失败时，核对失败项的权限和版本，而不是重复处理全部项目。

<a id="section-7-3"></a>

### 7.3 JSON / CSV 导出

GUI 导出会分页读取 **整个共享工作区**，不是仅导出当前搜索条件或勾选项。每页100条，最多10,000条；过程检查数量和重复 ID，但不是数据库事务快照，导出期间频繁写入仍应重新核验结果。

JSON 格式外层含 `format: "linro"`、`version: "1.0.1"`、`exported_at`、`domains`、`settings.site_name` 和 `links`。链接包含只读的 ID、所有者、版本、计数和时间戳，便于查看，但导入时不原样恢复这些字段。密码哈希与密码明文都不导出。

CSV 的18个列名按源码顺序如下。_cf_links_csv 是保留的导出转义标记，不应因 Linro 品牌更名而手动替换。

```text
_cf_links_csv,hostname,slug,target_url,title,description,redirect_code,query_mode,enabled,expires_at,cache_ttl,geo_rules,password_protected,max_redirects,redirect_count,response_mode,text_content,block_vpn
```

CSV 采用项目导出器生成的格式，包含 BOM、引用转义及公式样式文本防护。保留导出器生成的字段和安全标记，使用项目导入器解析；不要按逗号简单切分包含引号或换行的内容。

<a id="section-7-4"></a>

### 7.4 导入与迁移

GUI 可读取 JSON 数组、含 `links` 数组的 JSON 或 CSV；单文件最多2 MiB，1–5,000行。兼容 YOURLS 的 `keyword → slug`、`url → target_url`、`title`。它不是任意 YOURLS 数据库、插件配置或访问日志迁移器。

先建立目标域名。记录中的 `hostname` 优先匹配现有域名；未提供时使用界面所选域名。GUI 将文件中的布尔文本转换为 API 所需的布尔值 / 数字，不能据此认为直接 API 也接受 `"false"` 字符串。

导入器先检查整份输入并规划分块，再按 **每块最多10条、序列化 JSON 最多262,144字节** 调用 `/links/import`。每个请求原子提交，但多个请求之间不是单一事务：后续块失败时，前面已经成功的链接会保留。重试前检查冲突短码，避免重复创建。

导出文件中 `password_protected: true` 的记录不能无声降级为无密码导入；GUI 要求给该记录提供新密码。原密码无法从导出恢复。直接写集成客户端时，也必须由调用方维护这一安全约定，不能简单丢掉保护标记后当作普通链接创建。

导入不会恢复用户、tokens、完整设置、域名资源、原始 `created_by`、计数、审计或日统计；新链接归属于当前操作用户。**JSON / CSV 导出不是 D1 灾难恢复备份。**

**依据：** `apps/admin/src/web/App.tsx` 的导航、链接表单与导入导出处理；`apps/admin/src/web/csv.ts`；`apps/admin/src/web/client.ts`；`apps/admin/src/worker/api.ts`。

<a id="upgrade"></a>

## 08 · 已有实例的保留配置升级

<a id="section-8-1"></a>

### 8.1 备份与范围

升级前保存当前配置、域名、版本 ID、部署流量、Cron、绑定及 secret 名称，并导出 D1。复用原 Worker 名称和资源 ID，保留根 secrets。本文不包含任何真实账户快照。

```bash
npx wrangler d1 export DB --remote --config apps/admin/wrangler.jsonc --output pre-upgrade-database.sql
```

迁移检查：先确认账户、数据库和备份，再列出全部待应用迁移，确认后才执行远程写入，执行后再次列出待应用项。不要只按迁移文件名或版本号猜测状态。

```bash
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
npm run db:migrate
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
```

以下诊断语句只读：核验迁移记录、字段、实际规则修订触发器和外键。已有数据库只应用待执行项，不重复 seed、不新建替代库。npm run deploy 不自动创建数据库，也不自动执行迁移；两个 Worker 的发布不是原子操作。

```bash
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT name FROM d1_migrations ORDER BY id;"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT name,type FROM pragma_table_info('links');"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='links_rule_revision';"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "PRAGMA foreign_key_check;"
```

<a id="section-8-2"></a>

### 8.2 审阅并上传版本

下列配置路径必须包含已审阅的真实生产设置，而非发布包占位值。先完成本节前述数据库迁移核对，再构建和上传。这里演示人工分版本发布，不等同于 npm run deploy：后者按 Admin → Redirect 顺序部署，并另做公开探活。--keep-vars 不等于无损保留所有配置；本地显式变量、绑定、静态资源和运行时设置仍需与既有实例逐项比较。版本上传本身不切换生产流量。

```bash
npm run check
npm run build
npm test
npm run test:runtime
npm run test:browser
npm run deploy:dry-run
npx wrangler versions upload --config apps/admin/wrangler.jsonc --keep-vars --tag v1.0.1
npx wrangler versions upload --config apps/redirect/wrangler.jsonc --keep-vars --tag v1.0.1
```

<a id="section-8-3"></a>

### 8.3 核对与切流

分别记录上传返回的新版本 UUID。切流前比较新旧绑定、变量和运行时设置，并确认静态资源更新。下面命令中的占位值必须替换为对应 Worker 的 UUID。先 Redirect、后 Admin；两端不是原子切换。

```bash
npx wrangler versions deploy YOUR_REDIRECT_VERSION_UUID@100 --config apps/redirect/wrangler.jsonc --yes
npx wrangler versions deploy YOUR_ADMIN_VERSION_UUID@100 --config apps/admin/wrangler.jsonc --yes
```

纯代码升级不应额外同步触发器；只有计划变更域名或 Cron 时，才按4.7节审阅完整列表后同步。本版源码包含0001–0004共四份迁移；是否有待应用项必须查询真实数据库，不能据版本号推断，更不能清库或重复执行初始化来代替迁移。两个 Worker 非原子切换期间，客户端和两端协议必须兼容；需要时安排维护窗口。

<a id="section-8-4"></a>

### 8.4 升级后验收

检查两端版本和流量、登录后的GUI、管理服务健康、每个短链域名的health及专用验收链接。对比域名、绑定、用户、链接配置与数据库迁移记录；正常请求计数和最后活动时间可变化。接口客户端改用 /Linro/v1、X-Linro-* 和新签发的 Linro_ 令牌；不能只改旧令牌字符串的前缀。旧访客Cookie需要重新获得，保留原根secret时已有短链密码继续有效。

<a id="section-8-5"></a>

### 8.5 回滚

先确认旧版本仍兼容当前数据库和secrets，再将两端切回保存的旧版本ID。代码回滚不会回滚数据库；不要为了回滚代码覆盖新增业务数据。

```bash
npx wrangler versions deploy YOUR_OLD_REDIRECT_VERSION_UUID@100 --config apps/redirect/wrangler.jsonc --yes
npx wrangler versions deploy YOUR_OLD_ADMIN_VERSION_UUID@100 --config apps/admin/wrangler.jsonc --yes
```

<a id="api-conventions"></a>

## 09 · API 通用约定

<a id="section-9-1"></a>

### 9.1 地址、认证与浏览器调用

管理 API 基础地址为 `https://admin.example.com/Linro/v1`。后续接口表中的路径均相对此地址。主机、大小写与路径需准确匹配；不额外加结尾 `/`。`GET /Linro/v1` 本身不是资源索引，未知接口或不支持的方法返回404 `api_not_found`。

| 请求头 | 使用情境 |
| --- | --- |
| `Accept: application/json` | 管理客户端建议始终发送；不能改变错误认证重定向为成功 JSON |
| `Content-Type: application/json` | 带 JSON 正文的管理写请求必需，可附 `charset=utf-8` |
| `Authorization: Bearer Linro_…` | 自动化应用令牌，必须是创建时得到的完整值 |
| `Cf-Access-Jwt-Assertion` | 生产 Worker 要求有效 Access JWT；正常经 Access 认证后传入，不要伪造 |
| `CF-Access-Client-Id`、`CF-Access-Client-Secret` | 自动化访问外层 Access 的凭据，与 Linro token 不同 |
| `Origin: https://admin.example.com` | 交互式 Access 写请求必须完全匹配；正常浏览器由浏览器发送 |
| `X-Linro-CSRF: 1` | 交互式 Access 写请求必需；读取不要求 |
| `X-Linro-Dev` | 仅受限本地开发模式，不应加入生产调用 |

Access 真人写请求还拒绝 `Sec-Fetch-Site: cross-site`。应用 token 和开发认证不是环境自动附带的 Cookie，不走同一 CSRF 检查；但 `/Linro` API 的入口仍拒绝 **显式提供且不等于 ADMIN_ORIGIN 的 Origin**，包括字符串 `null` 和空值。服务端 token 请求可省略 Origin，不能随意填写第三方网站 Origin。

本版本不提供跨域开放 CORS、公共 OPTIONS 预检协议或 JSONP。外站浏览器脚本不能靠 bearer token 直接绕过同源限制。生产自动化应运行在可信服务器；只读 token 也不宜嵌入公开网页源码。

浏览器带有 Authorization 时会优先进入 token 分支；错误或格式不符的 Authorization 不会退回真人 Cookie 登录。因此交互式用户管理示例中不要同时塞入应用 token。

<a id="section-9-2"></a>

### 9.2 成功、错误与响应头

成功默认200；创建资源 / 导入成功201。管理 JSON 统一封装：

```json
{"ok":true,"data":{"deleted":true}}
```

失败示例，`request_id` 每次请求不同：

```json
{"ok":false,"error":{"code":"version_conflict","message":"This item changed. Refresh before saving again.","request_id":"example-request-id"}}
```

`data` 可以是对象、数组或接口定义的结构，不能假设全部有 `items`。错误正文 `message` 为源码中的英文说明，程序应依据 HTTP 状态和 `error.code` 判断。所有经过 Worker 安全包装的响应都有 `X-Request-Id`；提交故障时带上该值，而非 token 或密码。

管理 API 使用 `Cache-Control: no-store`。安全包装还设置 CSP、nosniff、拒绝嵌入、Referrer-Policy 等；HTTPS 响应设置 HSTS。应用限流429带 `Retry-After: 60`。被外层 Access / 平台提前处理的响应可能是302或 HTML，未必包含 Linro JSON / 请求 ID，应先检查状态和 Content-Type。

<a id="section-9-3"></a>

### 9.3 正文、分页、时间与并发

管理 JSON 正文上限 **262,144字节**，以实际流式读取字节数为准，不信任伪造的 Content-Length；根值须是对象，不允许数组、null 或损坏 UTF-8。JSON 字段按具体接口校验，普通写对象会拒绝未声明字段。批量请求不要超过单次条数 / 字节限制。

数值应传 JSON 数字，不是字符串。布尔配置业务字段通常接受 `true / false / 1 / 0`，但 `reset_redirect_count` 只接受布尔值。字符串限制主要按 JavaScript 字符串长度计；另有明确 UTF-8 字节限制的密码、文本与正文须同时满足。

时间字段 `created_at`、`updated_at`、`expires_at`、`revoked_at` 都是 Unix **秒**，不是毫秒；导出包 `exported_at` 是 ISO 字符串，归档 `date` 是 UTC 日历日期。`null` 含义随字段变化，例如链接永不过期、没有次数上限或撤销密码，不能统一解释为“不修改”。

分页 `page` 默认1、范围1–100000；`limit` 默认25、范围1–100。链接与审计返回 `total`；归档没有 `total`；域名、用户、令牌和设置直接返回数组，不使用这套分页。

链接、域名、用户的 PATCH 要传当前 `version`；链接 / 域名 DELETE 用 `?version=…`。读到的版本过旧返回409，删除不存在资源通常404。令牌撤销不需要 version；设置修改没有 version，采用最后写入生效。公开成功次数更新不等同于后台编辑版本更新，`rule_revision` 用于访客保护凭据与路由规则的独立失效控制。

没有 Idempotency-Key 实现。POST 超时可能已提交，不能盲目重试；应按业务 slug / ID 查询并核对。分页不是快照，跨请求读写没有自动跨资源事务。

<a id="section-9-4"></a>

### 9.4 HEAD 与健康路径

管理路由匹配明确的 HTTP 方法。虽然最外层会去掉 HEAD 正文，**`HEAD /Linro/v1/links` 并不自动等价 GET**，会404。Admin 的独立 `/health` 支持 GET / HEAD 且需要认证；Owner 的 `/Linro/v1/system/health` 是 GET 并查询 D1；公开 Redirect `/health` 是另一端的浅健康。三者不要混用。

**依据：** `apps/admin/src/worker/index.ts`；`auth.ts`；`api.ts`；`packages/shared/src/http.ts`。

<a id="models"></a>

## 10 · 数据模型与字段规则

<a id="section-10-1"></a>

### 10.1 Link 写入字段

POST `/links` 与 `/links/import` 的每个条目共支持下列16个业务字段；PATCH `/links/:id` 支持这些字段，再加 `version` 与 `reset_redirect_count`。标为“创建必需”的字段在 PATCH 时可省略以保留当前值。

| 字段 | 类型 / 约束 | 创建默认与更新语义 |
| --- | --- | --- |
| `domain_id` | 字符串，最多36字符；须对应现有域名 ID | 创建必需；允许选择已停用域名，但其链接不会公开可用 |
| `slug` | 1–64位 ASCII 字母、数字、`_`、`-` | 创建省略或空串时自动生成8位；更新不能用空串重新随机 |
| `target_url` | 有效 HTTP / HTTPS URL，最多4096字符 | redirect 模式创建必需；text 模式不用此目标 |
| `title` | 字符串，最多200字符 | 默认空串；PATCH 省略保留 |
| `description` | 字符串，最多2000字符 | 默认空串；允许正常多行文本 |
| `redirect_code` | 数字 `301 / 302 / 307 / 308` | 创建默认采用所选域名的 default_redirect_code；更新省略保留 |
| `query_mode` | `discard / merge / replace` | 默认 discard；text 模式强制 discard |
| `enabled` | 布尔或数字0 / 1 | 默认1；API 输出为数字 |
| `expires_at` | Unix秒整数1–253402300799，或 null | 默认 null；源码允许过去时间，此时会表现为过期 |
| `cache_ttl` | 整数0–3600，秒 | 默认0；这是公开客户端缓存，不是 KV TTL |
| `geo_rules` | 数组，0–32条；序列化长度最多65536字符 | 默认空数组；PATCH 省略保留，传 `[]` 清空 |
| `password` | null 或12–128字符且最多512 UTF-8字节的字符串 | 省略：创建无密码 / 更新保留；null：移除；字符串：重新设定 |
| `max_redirects` | null 或整数1–1000000000 | null 为无限；更改上限不会重置 redirect_count |
| `response_mode` | `redirect / text` | 默认 redirect；切换模式须同时满足目标 / 文本 / 地区规则约束 |
| `text_content` | 非空字符串，最多16384字符、32768 UTF-8字节 | text 模式必需；redirect 模式归一化为空串 |
| `block_vpn` | 布尔或数字0 / 1 | 默认0；从未启用变为启用须已配置浏览器检查根 secret |

PATCH 额外字段：`version` 为当前正整数版本；`reset_redirect_count` 为布尔值，true 才清零，省略 / false 不清零。客户端应只发送希望修改的字段，避免把 null 当作通用的“保持不变”。

URL 校验拒绝非法控制字符、反斜杠、用户名 / 密码、非 HTTP(S) scheme 等；还须通过管理主机 / 已管理短链主机环路与私有目标策略检查。允许的目标不是“服务端已经实际请求验证成功”的保证，源码不抓取目标网页，也不执行 DNS 解析来证明域名绝不解析到私网。

slug 禁用保留字，比较保留字时不区分大小写：`admin`、`api`、`linro`、`health`、`assets`、`robots`、`favicon`、`cdn-cgi`、`.well-known`，以及 `__linro_` 前缀；其中含点的值本身也不符合普通 slug 字符规则。有效业务 slug 的唯一约束区分大小写。

密码不会 trim，因此前后空格属于密码内容；不要在日志或 URL 查询参数中传密码。根 secret 未配置或格式不正确时，新增 / 重设密码会失败，不会存明文回退。文本允许 TAB / CR / LF，但拒绝其他受限控制字符和不合法的 Unicode 往返值；不作为 HTML 渲染。

<a id="section-10-2"></a>

### 10.2 GeoRule

```json
[
  {"kind":"country","code":"JP","target_url":"https://www.example.org/ja/"},
  {"kind":"continent","code":"EU","target_url":"https://www.example.org/eu/"}
]
```

每项只允许 `kind`、`code`、`target_url`。`kind` 是 country 或 continent；code 大写两字母。continent 固定为 `AF / AN / AS / EU / NA / OC / SA`，country 校验大写形式并拒绝 `XX`，不是完整 ISO 国家列表的查表校验；不要提交不存在的国家代码。相同 `kind:code` 不能重复。匹配优先级国家 → 大洲 → 默认 target_url，与用户提交数组中的国家 / 大洲先后无关。

<a id="section-10-3"></a>

### 10.3 PublicLink 读取对象

API 里的“PublicLink”指经过脱敏的管理接口对象，不代表可以匿名读取。它包含上述业务配置，但 **不包含 `password` 或 `password_hash`**，另包含：

| 字段 | 含义 |
| --- | --- |
| `id` | 链接 UUID |
| `hostname`、`short_url` | 域名及短链地址；生产 short_url 为 HTTPS |
| `password_protected` | 布尔值，是否存在密码保护 |
| `created_by` | 创建者用户 UUID，历史记录可能 null |
| `created_at`、`updated_at` | Unix秒 |
| `version` | 后台编辑乐观锁版本 |
| `rule_revision` | 链接规则修订号；用于缓存 / 访客证明失效，不作为 PATCH version 替代品 |
| `redirect_count` | 有次数上限时成功业务请求的受控计数；不是总点击统计 |
| `remaining_redirects` | 无限时 null，否则 `max(0, max_redirects - redirect_count)` |
| `domain_enabled` | 链接列表查询附带的域名状态；其他读取响应不保证带此字段 |

`enabled`、`block_vpn` 为0 / 1；`geo_rules` 已解析为数组，而不是数据库中的 JSON 字符串。text 模式的 API `target_url` 是空串；数据库内部兼容用的 `about:blank` 不用于跳转或对外抓取。

以下为 **结构示例，不是实际线上记录**；后续文档统一用 domain / link / user / token 四种示例 ID：

```json
{
  "id":"22222222-2222-4222-8222-222222222222",
  "domain_id":"11111111-1111-4111-8111-111111111111",
  "hostname":"go.example.com",
  "slug":"welcome",
  "short_url":"https://go.example.com/welcome",
  "target_url":"https://www.example.org/start",
  "title":"欢迎页",
  "description":"部署验收示例",
  "redirect_code":302,
  "query_mode":"discard",
  "enabled":1,
  "expires_at":null,
  "cache_ttl":0,
  "geo_rules":[],
  "password_protected":false,
  "max_redirects":null,
  "redirect_count":0,
  "remaining_redirects":null,
  "response_mode":"redirect",
  "text_content":"",
  "block_vpn":0,
  "created_by":"33333333-3333-4333-8333-333333333333",
  "created_at":1789776000,
  "updated_at":1789776000,
  "version":1,
  "rule_revision":1
}
```

<a id="section-10-4"></a>

### 10.4 Domain、User、Token、Setting 与 Audit

| 模型 | API 字段与特殊含义 |
| --- | --- |
| Domain | `id, hostname, name, enabled, default_redirect_code, created_at, updated_at, version`；GET 列表另加 `link_count`。hostname 创建后不能 PATCH |
| User | `id, email, display_name, role, enabled, created_at, updated_at, version`；不会返回 `access_sub`；email 创建后不能 PATCH |
| Token 列表项 | `id, name, prefix, scopes, expires_at, revoked_at, created_at`；**scopes 为数据库 JSON 字符串**，如 `"[\"links:read\"]"`，需 JSON.parse |
| Token 创建结果 | `id, token, name, scopes, expires_at, shown_once`；这里 **scopes 是数组**，完整 token 仅返回这一次 |
| Setting | `key, value, updated_at`；GET 返回所有设置，包括可能存在的归档游标；只有 `site_name` 能通过 PATCH 修改 |
| Audit | `id, user_id, actor_email, action, resource_type, resource_id, details, request_id, created_at`；**details 为 JSON 字符串**，不是直接嵌套对象 |
| DailyStat | `link_id, date, clicks, updated_at`，列表额外带 `slug, hostname`；clicks 为采样加权值，允许非整数 |

站点名1–80字符且不能仅空白；域名显示名最多100字符可空；用户显示名最多100字符可空；token 名1–100字符且不能仅空白。用户 role 必须小写 `viewer / editor / admin / owner`。源码 token 表没有 `last_used_at` 字段，也没有相应更新接口，不应从历史材料中的通用描述推导出此功能。

审计保存创建、编辑、删除、启停、导入、token 撤销等行为；敏感 URL 的 query / fragment 会脱敏，文本只记录长度，密码只记录是否保护。读取审计不是读取密码或恢复正文的渠道，也不应假设它是平台完整访问日志。

**依据：** `packages/shared/src/platform.ts`；`http.ts`；`validation.ts`；`geo.ts`；`text-response.ts`；`apps/admin/src/worker/data.ts`；`api.ts`；四份 D1 迁移。

<a id="api-reference"></a>

## 11 · 管理 API 完整参考

本章按源码列出 **25个“方法 + 路径”组合**。所有响应均套用第09章 JSON envelope；以下 `data` 结构不重复写外层。`L` 表示 PublicLink，`D` 表示 Domain，`U` 表示 User。`{id}` 必须替换为实际 UUID，不能带花括号。

<a id="section-11-1"></a>

### 11.1 GET /session — 当前会话

**权限：** 任意已认证会话，包括应用 token；无额外 scope。无参数。

**200 data：** `user: U`、`scopes: string[]`、`source_url: string`、`auth_kind: access|token|local`、`site_name: string`、`analytics_configured: boolean`、`link_write_scope: owned|workspace`、`version: "1.0.1"`，以及：

```json
{
  "features":{
    "browser_timezone_collection_enabled":false,
    "browser_checks_configured":true,
    "redirect_cache":false,
    "cache_consistency":"d1-guarded",
    "passwords_configured":true,
    "text_responses":true,
    "device_header_enabled":false
  },
  "security":{
    "queryKeys":["utm_source","utm_medium","utm_campaign","utm_term","utm_content"],
    "expiredStatus":404
  }
}
```

这是字段结构示例，开关以实际配置为准。session 不返回私有目标白名单、Access 凭据、根 secret 或 token 明文；site_name 用于显示工作空间名称。

<a id="section-11-2"></a>

### 11.2 GET /summary — 总览计数

**权限：** `links:read`。无参数。

**200 data 示例：** `{"links":6,"active":5,"expired":1,"domains":2}`。读取整个共享工作区。active 同时要求链接与域名启用、未过期、未耗尽；expired 独立按过期时间计数，不保证与 disabled 等互斥。

<a id="section-11-3"></a>

### 11.3 GET /links — 列出链接

**权限：** `links:read`。

| 查询参数 | 规则 |
| --- | --- |
| `page`、`limit` | 通用分页，默认1 / 25，limit最多100 |
| `q` | 可选，最多120字符；匹配 slug、title、target_url，不搜索 text_content / description |
| `domain_id` | 可选域名 ID，按该域名过滤 |
| `status` | `all / active / disabled / expired / exhausted`；省略等价不筛选 |

**200 data：** `{"items":[L],"total":6,"page":1,"limit":25}`，按 created_at 降序、id 降序。不存在的 domain_id 过滤通常得到空列表，不自动触发资源404。错误：400 `search_too_long / invalid_status / invalid_field`；权限不足403。

```http
GET /Linro/v1/links?status=active&limit=25&page=1&q=welcome
```

<a id="section-11-4"></a>

### 11.4 POST /links — 创建链接

**权限：** `links:write`。正文为第10章 Link 写入字段。

```json
{
  "domain_id":"11111111-1111-4111-8111-111111111111",
  "slug":"welcome",
  "target_url":"https://www.example.org/start",
  "title":"欢迎页",
  "redirect_code":302,
  "query_mode":"discard",
  "cache_ttl":0,
  "block_vpn":false
}
```

**201 data：** 完整 L。created_by 自动设为当前用户；省略 slug 时自动短码遇唯一性冲突最多尝试5轮。显式 slug 冲突返回409 `conflict`，不擅自换短码。参数违规400；所选域名不存在400 `domain_not_found`；保护根 secret 未配置时503。写入与成功审计在同一 D1 batch 中提交；KV 更新不是成功写入的授权条件。

<a id="section-11-5"></a>

### 11.5 GET /links/{id} — 读取单条链接

**权限：** `links:read`。无正文；**200 data：** L。不存在404 `not_found`。后台所有已授权读取者可见该对象，不因 created_by 不同隐藏记录；密码验证器不返回。

<a id="section-11-6"></a>

### 11.6 PATCH /links/{id} — 更新链接

**权限：** `links:write`，同时符合链接所有权规则。正文必需 version，其余字段部分更新。

```json
{"version":1,"target_url":"https://www.example.org/new","title":"新版入口","cache_ttl":0}
```

清零计数示例：`{"version":2,"reset_redirect_count":true}`。删除密码示例：`{"version":3,"password":null}`。以上版本仅示意，应分别先读取当前值，不是固定顺序操作脚本。

**200 data：** 更新后的 L。不存在返回 404；版本冲突返回 409 version_conflict；不满足链接归属限制返回 403 link_owner_required；非法字段返回 400。修改域名或 slug 时先提交 D1，再尽力清理旧 KV 路由；这不是跨 D1/KV 的原子事务，旧 KV 命中仍须通过最新 D1 校验。已经缓存或正在传输的响应无法立即撤回。

<a id="section-11-7"></a>

### 11.7 DELETE /links/{id} — 删除链接

**权限：** `links:delete` + 所有权约束。查询必需 `version`；无 JSON 正文。

```http
DELETE /Linro/v1/links/22222222-2222-4222-8222-222222222222?version=1
```

**200 data：** `{"deleted":true}`。不存在404，版本冲突409，跨所有者403。D1 daily_stats 随链接外键级联删除；AE 已写出的历史事件不由本路由清除，不能把删除链接理解成所有存储的历史数据立即消失。

<a id="section-11-8"></a>

### 11.8 POST /links/import — 原子小批量导入

**权限：** `links:write`。顶层只允许 `links`，数组1–10项，每项采用创建字段，不接收导出对象中的只读字段。

```json
{
  "links":[
    {"domain_id":"11111111-1111-4111-8111-111111111111","slug":"intro","target_url":"https://www.example.org/intro","redirect_code":302},
    {"domain_id":"11111111-1111-4111-8111-111111111111","slug":"notice","response_mode":"text","text_content":"维护已完成。","geo_rules":[]}
  ]
}
```

**201 data：** `{"imported":2,"ids":["22222222-2222-4222-8222-222222222222","55555555-5555-4555-8555-555555555555"]}`。先归一化所有条目，再事务提交本次 batch；任一验证或唯一性冲突使本请求不部分导入。错误400 `invalid_import` / 字段错误、409冲突、413超限。此路由不是 CSV 文件上传接口，不接受 multipart 或 JSON 外层 `domains/settings`。

<a id="section-11-9"></a>

### 11.9 POST /links/bulk — 部分成功批量启停 / 删除

**权限：** action 为 enable / disable 时 `links:write`；delete 时 `links:delete`。每项仍检查所有权。正文顶层仅 action、items；items为1–10个含 id 与 version 的对象，不能重复 ID。

```json
{"action":"disable","items":[{"id":"22222222-2222-4222-8222-222222222222","version":1}]}
```

**200 data 示例：** `{"results":[{"id":"22222222-2222-4222-8222-222222222222","ok":false,"conflict":true}]}`。成功项 `ok:true`；跨所有者失败附 `forbidden:true`；不存在或版本变更通常附 `conflict:true`。200只代表批量请求正常完成，不代表全部项目成功。非法动作、空数组、重复 ID 等在执行前400；逐项成功没有统一事务回滚。

<a id="section-11-10"></a>

### 11.10 GET /domains — 域名列表

**权限：** `domains:read`。无分页 / 正文；**200 data：** `D[]`，按 hostname 排序，每项附 `link_count`。包含停用域名。不存在单独的 `GET /domains/{id}`，需要从列表查找。

<a id="section-11-11"></a>

### 11.11 POST /domains — 新建域名记录

**权限：** `domains:write`，当前角色集合仅交互式 Admin / Owner 能满足。

```json
{"hostname":"go.example.com","name":"官方短链","enabled":true,"default_redirect_code":302}
```

仅允许 hostname、name、enabled、default_redirect_code。hostname 必需且通过主机名校验，name默认空、enabled默认1、跳转码默认301。**201 data：** D，不保证附 link_count。

域名重复409 `conflict`；管理主机400 `admin_hostname`；如果现有链接的默认或地区目标已指向准备加入的主机，返回409 `hostname_is_destination`，应先迁移到最终目标，避免形成受管理短链环路。成功只创建 D1 记录，不创建 Cloudflare 资源。

<a id="section-11-12"></a>

### 11.12 PATCH /domains/{id} — 更新域名记录

**权限：** `domains:write`。仅允许 version、name、enabled、default_redirect_code。

```json
{"version":1,"name":"公共入口","enabled":true,"default_redirect_code":302}
```

**200 data：** 更新后的 D。hostname 不可修改；传入会400 `unknown_field`。404不存在、409版本冲突。停用域名影响其下全部链接；更改默认跳转码不会重写现有链接。

<a id="section-11-13"></a>

### 11.13 DELETE /domains/{id} — 删除域名记录

**权限：** `domains:write`。必需查询 `version`；**200 data：** `{"deleted":true}`。仍有链接引用时409 `in_use`，不是自动级联删除。先显式移动 / 删除链接再删除域名。该操作不自动解除平台 Custom Domain / DNS。

<a id="section-11-14"></a>

### 11.14 GET /stats — Analytics Engine 实时查询

**权限：** `analytics:read`。

| 查询参数 | 规则 |
| --- | --- |
| `days` | 默认7，整数1–90；查询最近相应天数的时间窗口，输出以 UTC 表示 |
| `link_id` | 单个小写标准 UUID；可省略 |
| `link_ids` | 逗号分隔1–50个小写标准 UUID；与 link_id 互斥 |

link_id 或 link_ids 各自不允许重复出现，且两者不能同时使用；选择参数不能传空串、空列表或尾部逗号。days 按首个值解析，并未实施重复参数拒绝；调用端仍应只传一次。50项限制在去重前检查，之后去重。两个 ID 参数均省略表示整个工作区。显式选择有任一链接不存在，404 `stats_link_not_found`；不会静默扩大到全部链接，即使统计未配置也先核验选择范围。

未配置时 **200 data**：

```json
{"available":false,"reason":"Analytics Engine is disabled or the Analytics Read secret is not configured.","sampled":true,"link_ids":null}
```

配置完整且查询成功时 data 包含：

| 字段 | 结构 / 解释 |
| --- | --- |
| `available, sampled, timezone, days, link_ids` | true、true、UTC、窗口天数、null或实际选择数组 |
| `clicks` | 成功业务 GET 的采样加权总数，不是 UV |
| `timeline` | `[{date, clicks}]`，按日期；没有事件的日期不承诺补零 |
| `top` | `[{link_id, hostname, slug, clicks}]`，最多50条 |
| `countries` | `[{country, clicks}]`，最多20项 |
| `referrers` | `[{referrer, clicks}]`，最多20项，仅来源主机维度 |
| `timezones` | `[{timezone, clicks}]`，浏览器自报时区，缺失归为 none |
| `ip_timezones` | `[{timezone, clicks}]`，Cloudflare IP 地理时区 |
| `devices` | `[{device, clicks}]`，device 为 mobile / pc / none |
| `suspected_vpn_visits`、`suspected_vpn_successes` | 疑似事件与其中成功访问估计 |
| `blocked_vpn_visits`、`unknown_timezone_blocks` | VPN策略拒绝与未知时区拒绝估计 |
| `unknown_timezone_successes`、`tor_visits` | 未知时区成功与 Tor 相关事件估计 |
| `vpn_scope` | `terminal_successes_and_policy_denials_not_unique_users` |
| `success_scope` | `authorized_get_redirect_or_text` |
| `dimension_sources` | 见下方来源字段，不代表浏览器自报内容可信 |

```json
{
  "dimension_sources":{
    "timezone":"javascript_client_reported",
    "ip_timezone":"cloudflare_ip_geolocation",
    "device":"cloudflare_generated_header",
    "browser_timezone":"javascript_client_reported_untrusted",
    "tor":"cloudflare_request_cf_country_T1",
    "device_header_enabled":false
  }
}
```

上游非成功 HTTP 状态、无合法 data 数组或非法计数映射502 `analytics_query_failed`；网络 / 超时或 JSON 解码异常可能进入通用500，不能把所有失败都标为“未配置”。不自动重试八个查询。

<a id="section-11-15"></a>

### 11.15 GET /stats/archive — D1 日归档

**权限：** `analytics:read`。支持 page、limit 和与 /stats 相同的 link_id / link_ids；**不实现 days 日期筛选**。

**200 data：** `{"items":[DailyStat],"sampled":true,"page":1,"limit":25,"link_ids":null,"dimension_detail_available":false}`。没有 total；按 date 降序、link_id 排序。只含已写入 D1 且链接仍存在的日计数，不含国家、设备、时区或 VPN 历史维度，也不是 /stats 的自动透明备用数据源。AE关闭后仍可读取已有归档。

<a id="section-11-16"></a>

### 11.16 GET /users — 用户列表

**权限：** `users:write` + 交互式会话，即 Owner。无分页；**200 data：** `U[]`，按 created_at。没有 GET /users/{id}。应用 token 无权调用，即使属于 Owner。

<a id="section-11-17"></a>

### 11.17 POST /users — 创建用户

**权限：** Owner 交互式会话。

```json
{"email":"editor@example.com","display_name":"内容维护","role":"editor"}
```

仅 email 必需；display_name 默认空，role 默认 viewer，新用户默认启用。不能传 enabled、access_sub、version、id。**201 data：** U。邮箱重复409；非法角色400 `invalid_role`。此操作不发送邮件、不创建 Access 策略，成员还需满足外层认证条件。

<a id="section-11-18"></a>

### 11.18 PATCH /users/{id} — 修改 / 停用用户

**权限：** Owner 交互式会话。仅允许 version、display_name、role、enabled。

```json
{"version":1,"role":"viewer","enabled":false}
```

**200 data：** 更新后的 U。不能修改 email 或 access_sub。不允许停用或降级最后一个启用的 Owner，返回 409 last_owner；版本冲突返回 409 version_conflict；用户不存在返回 404。没有 DELETE 用户路由。停用用户会阻止该用户及其令牌的后续认证，但不会自动删除其公开链接。

<a id="section-11-19"></a>

### 11.19 GET /tokens — 本人令牌列表

**权限：** 任意交互式会话，限本人；不要求某个额外 scope。无分页。**200 data：** Token 列表项数组，按 created_at 降序，包含已撤销记录。

```json
[{
  "id":"44444444-4444-4444-8444-444444444444",
  "name":"只读巡检",
  "prefix":"Linro_ABCDEF",
  "scopes":"[\"links:read\",\"domains:read\"]",
  "expires_at":1792368000,
  "revoked_at":null,
  "created_at":1789776000
}]
```

prefix 仅为展示前缀，不能用作完整 token。这里 scopes 为 JSON 字符串；不返回 token_hash、完整 token、其他用户 ID 或最后使用时间。

<a id="section-11-20"></a>

### 11.20 POST /tokens — 创建本人应用令牌

**权限：** 交互式会话；scopes 必须属于当前角色可授予的五种非管理权限。

```json
{"name":"只读巡检","scopes":["links:read","domains:read"],"expires_at":1792368000}
```

示例 expires_at 仅用于展示，实际调用应动态取 `Math.floor(Date.now()/1000) + 30*86400` 等合规未来时间；服务端要求创建时起至少60秒、至多365天，超界返回400 invalid_field。scopes 原数组长度1–5，非法项 / 越权项403 `invalid_scopes`，合法重复项去重。name 不能为空白；已有50条或更多未撤销记录时，继续创建返回409 `token_limit`。

**201 data：** `id, token, name, scopes: string[], expires_at, shown_once: true`。立即安全保存完整 token，不写 URL、公开页面或日志。创建完成后再次 GET 列表无法找回它，只能撤销并创建新 token。

<a id="section-11-21"></a>

### 11.21 DELETE /tokens/{id} — 撤销本人令牌

**权限：** 交互式会话，且 token 属于本人。无 version、无正文。**200 data：** `{"revoked":true}`。已撤销 / 不存在 / 其他人的 token 都返回404 `not_found`；不是可无限重复取得200的幂等响应设计。token 不能调用此接口撤销自身。

<a id="section-11-22"></a>

### 11.22 GET /audit — 审计列表

**权限：** `audit:read`，即交互式 Admin / Owner。支持 page、limit；不实现 user_id、action 或日期服务端筛选。

**200 data：** `{"items":[Audit],"total":100,"page":1,"limit":25}`，按 created_at 降序、id 降序。details 是 JSON 字符串，需显式解析；日志细节已有脱敏，不能用于恢复密码、完整 URL 秘密参数或纯文本正文。

<a id="section-11-23"></a>

### 11.23 GET /settings — 全部设置

**权限：** `settings:write` + 交互式会话，即 Owner。无分页；**200 data：** Setting 数组，按 key 排序。可能包括 `analytics_rollup_…` 内部记录，不要将全部 GET 结果原样 PATCH 回去。

<a id="section-11-24"></a>

### 11.24 PATCH /settings — 修改站点名

**权限：** Owner 交互式会话。只接受 `site_name`：

```json
{"site_name":"Linro team links"}
```

**200 data：** `{"site_name":"Linro team links"}`。长度1–80字符且非纯空白；无 version，并发更新最后写入生效。不能用此接口修改 Access、KV、analytics_enabled、时区开关、根 secrets 或 Cloudflare 资源。

<a id="section-11-25"></a>

### 11.25 GET /system/health — Worker 与 D1 健康

**权限：** `settings:write`，实际可用者为 Owner。无参数。执行 D1 `SELECT 1` 后：

```json
{"worker":"ok","database":"ok","analytics":"configured_not_probed","version":"1.0.1"}
```

未配置统计时 analytics 为 `disabled_or_incomplete`。**configured_not_probed 不是 AE SQL 实测成功。** D1异常不会返回上述成功对象；未经映射的异常进入500 `internal_error`。这个接口不是公开探针。

**依据：** 本章逐项对应 `apps/admin/src/worker/api.ts`；字段转换在 `data.ts`；所有权 / scope 在 `auth.ts`；统计结构在 `analytics.ts`。未列出的 PUT、用户删除、域名单独读取、token刷新、手动归档、所有权转移、API批量导出等功能不应假设存在。

<a id="public-api"></a>

## 12 · 公开跳转、密码与浏览器检查协议

<a id="section-12-1"></a>

### 12.1 路由一览

以下路径位于 **Redirect Worker 的短链域名**，不带 `/Linro/v1`。它们不是后台管理接口，不使用应用 token 作为短链解锁凭据。

| 方法 | 路径 | 正常结果与用途 |
| --- | --- | --- |
| GET / HEAD | `/` | 200纯文本品牌提示，不列出链接，也不自动跳到后台 |
| GET / HEAD | `/health` | 200裸 JSON `{"status":"ok","version":"1.0.1"}`；不查 D1 |
| GET / HEAD | `/robots.txt` | 200文本 `User-agent: *`、`Disallow: /`；不是访问控制 |
| GET / HEAD | `/__Linro_assets/password.css` | 密码 / 检查页面样式，no-store |
| GET / HEAD | `/__Linro_assets/browser.js` | 浏览器检查脚本，no-store |
| GET / HEAD | `/{slug}` | 根据保护流程返回页面、跳转、文本或拒绝 |
| POST | `/__Linro_unlock/{slug}` | 同源密码表单；成功303回同一短码 |
| POST | `/__Linro_browser/{slug}` | 同源浏览器检查表单；成功200 JSON或303回同一短码 |

内部 POST 路径使用其他方法时405、`Allow: POST`，即使短码不存在也先统一处理，不以数据库查询泄露状态。其他路径不支持 POST / PUT / DELETE，返回405、`Allow: GET, HEAD`。路径大小写有意义；旧品牌内部路径不作为兼容别名保留。

公开 REDIRECT_LIMITER 在 health、资源与业务查询前运行；缺少生产限流绑定或其执行异常可返回503。因此公开 health200只证明该端浅层处理与版本，不证明域名已登记到 D1、目标可用、AE可查或密码流程正常。

<a id="section-12-2"></a>

### 12.2 普通链接与 HEAD

有效跳转链接最终返回配置的301 / 302 / 307 / 308及 Location；有效文本链接最终返回200、`text/plain; charset=utf-8`，无目标 Location。未找到、链接或域名停用返回404；过期按 `EXPIRED_LINK_STATUS` 返回404或410；次数耗尽403，无目标。

保护顺序概要：方法检查 → 外层 Worker 限流 → 最新链接 / 域名读取 → 启用 / 过期 / 数据合法性 → 已耗尽 / Tor策略预检 → 密码 → 浏览器检查 → 最终目标与规则复核 → 原子名额消耗 → 最终业务响应与可选成功统计。校验失败不会通过缓存回退为无保护跳转。

**HEAD 不是无副作用的额度探针。** 若它已经满足全部保护并到达最终跳转 / 文本响应，有限次数链接的 HEAD 与 GET 都消耗一次名额；HEAD 不写成功点击统计，并由最外层去掉正文。密码页 HEAD 不解锁、不扣次数。block_vpn 链接缺少有效证明时 HEAD 返回403；仅全局采集开启、单链接 block_vpn 关闭时 HEAD 可跳过时区采集。

公开成功默认禁止 CDN 缓存。只在无密码、无地区分流、无次数上限、无浏览器流程的普通跳转中，才按 link.cache_ttl 允许私有客户端缓存；带保护的跳转 no-store，文本始终 no-store。不要在外层添加 Cache Everything 来覆盖这些响应。

<a id="section-12-3"></a>

### 12.3 密码表单协议

首次 GET 受保护链接返回200 HTML密码页，无目标 Location。页面表单 action 是同源 `/__Linro_unlock/{slug}`；POST 的正文类型必须为 `application/x-www-form-urlencoded`，只允许一个 password 字段，流式正文最多8192字节。不得发送 JSON，不要把密码放在查询参数或日志中。

来源校验要求能够证明同源：存在 Sec-Fetch-Site 时须为 same-origin；显式 Origin 须匹配完整 origin。Origin 缺失或字符串 null 仅在 Sec-Fetch-Site 明确 same-origin 时才可能通过；显式其他 origin 即使伪称 same-origin 也被拒绝。常规浏览器表单会携带相应元数据，第三方跨站页面不能借此获得解锁。

密码错误返回401 HTML密码页，不返回目标；成功返回303到原短码和原查询参数，并设置 `__Host-Linro_unlock_*` Cookie。有效期900秒，绑定链接、主机和规则版本；生产为 Secure、HttpOnly、Path=/、SameSite=Lax。中间303不扣次数、不记成功点击，下一次 GET 重新检查全部条件；即使链接设为307 / 308，也不会把密码 POST 正文转发给目标。

对无密码链接 POST 解锁不执行通用登录，返回405。修改规则、重设密码或移除密码会影响旧 Cookie 的有效性；新协议 Cookie 名与旧版不同。

<a id="section-12-4"></a>

### 12.4 浏览器检查协议

当全局 `BROWSER_TIMEZONE_ENABLED=true` 或单链接 `block_vpn=1` 时，GET 可能先返回浏览器检查页。页面采集浏览器 `Intl` 时区字符串，而 IP时区来自 Cloudflare 的 request.cf；这是弱信号与策略判断，不是权威 VPN 识别或设备身份验证。

浏览器将页面给出的挑战和时区通过同源 POST 提交到 `/__Linro_browser/{slug}`。仅允许两个表单字段 `challenge` 和 `timezone`，必须各一次；正文类型仍是 `application/x-www-form-urlencoded`，最大4096字节；challenge 非空且最多2200字符，timezone 最多64字符，可空但按 unknown 处理。

请求的 **Accept 只决定成功表示，不改变正文格式或认证**：

| Accept | 成功表示 |
| --- | --- |
| 明确接受 `application/json` 且 q有效并大于0 | 200，`{"ok":true,"data":{"next":"/welcome?_Linro_check=1"}}`；无 Location |
| 未明确接受 JSON、通配或 JSON q=0 | 303，Location 指向相同的同源 next 路径 |

两种成功响应都设置短期 `__Host-Linro_browser_*` Cookie、no-store、`Vary: Accept`，均不扣次数、不记成功点击。next 仅包含同源短码及清理后的查询，**不向 POST 返回最终目标 URL**；内置 JS 使用普通页面导航继续访问，避免 CSP `form-action 'self'` 在后续跨站表单跳转链中造成问题。旧式表单303仍存在，但不保证禁用 JavaScript 的浏览器能完成所有跨站后续行为。

挑战有效窗口为120秒；签发证明不延长原挑战窗口。证明与链接规则、主机、查询及来访网络上下文绑定。恢复 GET 必须同时具有恰好一个 `_Linro_check=1` 与有效 Cookie；只有 marker、只有 Cookie、Cookie 被阻止、挑战过期或期间链接发生变化，都不能跳过检查。最终响应会清除该证明 Cookie，但源码没有服务端一次性消费表，不能称为绝对防重放的一次性凭证。

block_vpn开启时，Tor / 时区不匹配或 unknown 会拒绝；未开启时全局采集主要用于记录，可允许 unknown。拒绝返回403且无目标和成功 Cookie。人工篡改表单时区不能被理解为可靠地证明“未使用 VPN”；此功能的可信度边界应在对外告知中保留。

<a id="section-12-5"></a>

### 12.5 查询参数与公开错误

`_Linro_check` 是内部恢复标记，`_Linro_lang` 用于内部语言选择，不能作为普通营销参数透传。最终目标参数由 query_mode 与部署白名单共同决定，见配置章节；访问 URI 或最终组合 URL 过长可能414。

公开响应可能为 HTML、纯文本或 JSON，**不是全部套用管理 API envelope**：直接拒绝通常纯文本，密码错误是 HTML；表单解析等抛出的 HttpError 可能返回标准 JSON错误；未处理的公开异常转成503纯文本及 Retry-After。探针应先看状态与 Content-Type。

| 状态 | 常见公开情形 |
| --- | --- |
| 200 | 根路径 / health / 资源；密码页或浏览器检查页；最终文本；浏览器 POST JSON成功 |
| 301 / 302 / 307 / 308 | 最终跳转，不代表目标网站随后成功 |
| 303 | 解锁 / 浏览器检查中间同源恢复，不是最终点击 |
| 400 / 415 | 表单 / 格式 / HTTPS问题；不同来源校验也可返回403 |
| 401 | 密码错误页面 |
| 403 | 次数耗尽、来源无效、浏览器策略拒绝 / 证明不足 |
| 404 / 410 | 不存在、停用或过期 |
| 405 | 方法错误或对不适用链接调用内部 POST |
| 414 | URI / 目标组合过长 |
| 429 | 限流；Retry-After通常60秒 |
| 503 | D1 / 根 secret / 限流绑定 / 规则数据故障，或最终校验前规则变更 |
| 508 | 最终检测到直接跳转环路 |

**依据：** `apps/redirect/src/index.ts`；`public-pages.ts`；`browser-page.ts`；`unlock-origin.ts`；`packages/shared/src/browser-check.ts`；`link-password.ts`。

<a id="examples"></a>

## 13 · 可直接改值使用的调用示例

<a id="section-13-1"></a>

### 13.1 Bash：读取会话与新建链接

以下环境变量属于 **调用客户端**，不是 deployment.json 字段。先在私有终端 / CI secret 中设置管理 origin、Access服务凭据和 Linro token。不要提交凭据到仓库。token 需有 links:read、domains:read；创建示例还需 links:write。外层 Access 必须已经允许所用服务身份。

```bash
export LINRO_ADMIN_ORIGIN='https://admin.example.com'
# 下列三个值通过你的秘密管理工具注入，示例不提供真实凭据：
# CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, LINRO_API_TOKEN
: "${CF_ACCESS_CLIENT_ID:?请设置 Access Client ID}"
: "${CF_ACCESS_CLIENT_SECRET:?请设置 Access Client Secret}"
: "${LINRO_API_TOKEN:?请设置 Linro 应用令牌}"

curl --silent --show-error --fail-with-body --max-time 20 \
  --dump-header session-headers.txt \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $LINRO_API_TOKEN" \
  -H 'Accept: application/json' \
  "$LINRO_ADMIN_ORIGIN/Linro/v1/session"
```

不要加 `-L` 自动把认证请求跟随到未知重定向主机。curl 的 `--fail-with-body` 主要对 HTTP 4xx / 5xx 失败；Access302仍可能退出0，必须检查响应头与 JSON结构。`session-headers.txt` 含会话相关响应元数据，按私有诊断文件保存。

```bash
# 先获取真实域名 ID，不是 DNS 名称。
curl --silent --show-error --fail-with-body --max-time 20 \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $LINRO_API_TOKEN" \
  -H 'Accept: application/json' \
  "$LINRO_ADMIN_ORIGIN/Linro/v1/domains"

# 编辑 domain_id 并确保短码未被占用；此命令会创建真实业务记录。
cat > create-link.json <<'JSON'
{
  "domain_id":"11111111-1111-4111-8111-111111111111",
  "slug":"docs-example",
  "target_url":"https://www.example.org/docs",
  "redirect_code":302,
  "cache_ttl":0,
  "block_vpn":false
}
JSON

curl --silent --show-error --fail-with-body --max-time 20 \
  -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $LINRO_API_TOKEN" \
  --data-binary @create-link.json \
  "$LINRO_ADMIN_ORIGIN/Linro/v1/links"
```

修改用 `-X PATCH` 与带 version 的 JSON；删除用 `-X DELETE` 和 version 查询。不要把 POST 响应中的整个 L 对象直接作为 PATCH 正文。创建请求超时先按 slug 查询结果，不能无条件重发。

<a id="section-13-2"></a>

### 13.2 PowerShell：读取与乐观锁修改

凭据从当前环境读取；PowerShell示例使用 Invoke-RestMethod，限制不跟随302，错误原样终止。此例会修改指定链接的标题，先替换 id 并确认属于当前用户可写范围。

```powershell
$ErrorActionPreference = 'Stop'
$Origin = 'https://admin.example.com'
$Required = 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'LINRO_API_TOKEN'
foreach ($Name in $Required) {
    if (-not [Environment]::GetEnvironmentVariable($Name)) {
        throw "缺少环境变量：$Name"
    }
}
$Headers = @{
    'CF-Access-Client-Id' = $env:CF_ACCESS_CLIENT_ID
    'CF-Access-Client-Secret' = $env:CF_ACCESS_CLIENT_SECRET
    'Authorization' = "Bearer $($env:LINRO_API_TOKEN)"
    'Accept' = 'application/json'
}
$Id = '22222222-2222-4222-8222-222222222222'
$Uri = "$Origin/Linro/v1/links/$Id"
$Current = Invoke-RestMethod -Uri $Uri -Headers $Headers -Method Get `
    -MaximumRedirection 0 -TimeoutSec 20
if ($Current.ok -ne $true -or -not $Current.data.version) {
    throw '未收到有效的 Linro 链接对象。'
}
$Body = @{ version = $Current.data.version; title = '更新后的标题' } |
    ConvertTo-Json -Compress
$Updated = Invoke-RestMethod -Uri $Uri -Headers $Headers -Method Patch `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($Body)) `
    -MaximumRedirection 0 -TimeoutSec 20
$Updated.data | Select-Object id, slug, title, version
```

读取与写入之间仍可能被其他人更新而409，这是预期保护，不应自动忽略。客户端 / shell 版本差异不是本项目代码的一部分；请在目标客户端环境验证示例。

<a id="section-13-3"></a>

### 13.3 浏览器：创建交互式专用资源

在已经登录的 **管理域名页面**开发者控制台执行。它使用当前同源 Access Cookie，不带应用 token；下例将真实创建一个7天有效、只读的本人 token。输出只在私有环境查看，并立即保存到秘密管理工具。

```javascript
(async () => {
  const response = await fetch('/Linro/v1/tokens', {
    method: 'POST',
    credentials: 'same-origin',
    redirect: 'manual',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Linro-CSRF': '1'
    },
    body: JSON.stringify({
      name: 'docs-readonly',
      scopes: ['links:read', 'domains:read'],
      expires_at: Math.floor(Date.now() / 1000) + 7 * 86400
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    throw new Error('未收到 JSON：检查 Access 登录状态与同源页面。');
  }
  const result = await response.json();
  if (!response.ok || result.ok !== true) {
    throw new Error(result.error?.code || `HTTP ${response.status}`);
  }
  window.prompt('完整 token 仅显示一次；安全保存后关闭此框。', result.data.token);
})().catch(error => console.error(error.message));
```

用户管理可用同样的 fetch 结构调用 `/users`，但必须是 Owner；替换为 `{"email":"editor@example.com","role":"editor"}`。不要在任意外站控制台运行，也不要复制不理解的脚本或打印完整认证 Cookie。

<a id="section-13-4"></a>

### 13.4 Node.js：有边界的只读客户端

保存为 `linro-read.mjs`，用项目所需的 Node22环境运行。仅读取，不自动重试写入，不跟随重定向，不把秘密或原始错误正文打印到日志。

```javascript
const required = name => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
};

async function main() {
  const origin = new URL(required('LINRO_ADMIN_ORIGIN'));
  if (origin.protocol !== 'https:' || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('LINRO_ADMIN_ORIGIN must be an HTTPS origin only.');
  }
  const token = required('LINRO_API_TOKEN');
  if (!/^Linro_[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error('Invalid Linro token format.');
  }
  const headers = {
    'Accept': 'application/json',
    'Authorization': `Bearer ${token}`,
    'CF-Access-Client-Id': required('CF_ACCESS_CLIENT_ID'),
    'CF-Access-Client-Secret': required('CF_ACCESS_CLIENT_SECRET')
  };
  async function get(path) {
    const url = new URL(`/Linro/v1${path}`, origin);
    const response = await fetch(url, {
      headers, redirect: 'manual', signal: AbortSignal.timeout(20000)
    });
    const requestId = response.headers.get('x-request-id') || 'unavailable';
    if (response.status >= 300 && response.status < 400) {
      throw new Error(`Authentication redirect (${response.status}); not followed.`);
    }
    if (!(response.headers.get('content-type') || '').includes('application/json')) {
      throw new Error(`Non-JSON response (${response.status}); request_id=${requestId}`);
    }
    const result = await response.json();
    if (!response.ok || result.ok !== true) {
      throw new Error(`${result.error?.code || 'http_error'} (${response.status}); request_id=${requestId}`);
    }
    return result.data;
  }
  const session = await get('/session');
  console.log({ version: session.version, scope: session.link_write_scope });
  const links = await get('/links?limit=10&page=1');
  console.log({ total: links.total, displayed: links.items.length });
  // 不在默认日志输出短链目标、纯文本内容或任何 token。
}
main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Client failed.');
  process.exitCode = 1;
});
```

以上示例根据本版接口编写。示例中的创建 / 更新调用会写数据，使用前改成专用验收记录，不要直接指向现有业务链接。

<a id="operations"></a>

## 14 · 备份、本地开发与运维

<a id="section-14-1"></a>

### 14.1 备份集合

完整恢复需要 D1 SQL、当时的源码和锁文件、两端配置 / 版本 / 绑定 / 触发器信息，以及妥善保管的根 secrets。D1导出包含用户与业务数据、token哈希、链接密码哈希、审计和统计；不包含 LINK_PASSWORD_SECRET、BROWSER_CHECK_SECRET 或 ANALYTICS_API_TOKEN。KV是可重建缓存，不能代替 D1。AE事件不是 D1导出的组成部分。

```bash
# 项目封装会输出 Linro-backup.sql；重复执行前先归档旧文件。
npm run backup

# 或指定新的备份文件名，先确认账户与数据库指向。
npx wrangler d1 export DB --remote --config apps/admin/wrangler.jsonc --output Linro-backup-before-change.sql
```

导出期间可能影响数据库可查询性；应安排适当窗口，不能保证任意时刻零影响。备份后做校验摘要、加密存储与离线恢复演练。不要把 SQL、deployment.json、`.dev.vars`、Cloudflare settings快照或日志中的敏感内容放到公开 docs目录。

<a id="section-14-2"></a>

### 14.2 恢复纪律

优先把备份导入 **隔离的恢复数据库**验证 schema、业务数量、外键、规则触发器与密码能力，不先覆盖在线库。以下命令是有写入影响的恢复演练模板，数据库必须是新建的隔离恢复库；不要填正在服务的 DB ID。

```bash
# YOUR_ISOLATED_RECOVERY_DB_ID 必须是隔离恢复库，不是现有生产库。
npx wrangler d1 execute YOUR_ISOLATED_RECOVERY_DB_ID --remote --config apps/admin/wrangler.jsonc --file Linro-backup-before-change.sql
```

实际 SQL备份可能包含建表与迁移记录，先检查内容再决定是否需要另外应用迁移，避免重复执行初始化。不能把 CSV导入当成原身份、token、计数和密码的完整恢复。恢复验证通过后，再制定维护窗口、绑定切换及回退方案；本手册不执行这些动作。

代码回滚、数据库恢复、secret轮换是三个不同操作。丢失密码根 secret 时不能从哈希恢复原密码；不能通过降低校验参数或删除保护字段“修好”可访问性。对规则数据损坏的503，应修复数据来源并验证，不应降级为任意跳转。

<a id="section-14-3"></a>

### 14.3 本地开发

本地配置位于 `.local/`，数据库状态位于 `.local/state`，两个本地 Worker 共享该状态；不会因为执行本地迁移自动迁移云端。初始化保留已有本地 token、根 secrets 和数据；这些值绝不能复制到生产。关闭 / 开启本地KV不等于重建本地 D1。

```bash
npm ci
npm run local:init
# 需要测试本地KV路径时改用：npm run local:init -- --kv
npm run build:web
npm run db:migrate:local
npm run db:seed:local
npm run dev:admin
# 另一个终端、相同项目目录：npm run dev:redirect
```

管理端为 http://127.0.0.1:8787，跳转端为 http://127.0.0.1:8788。将初始化打印的开发 token 输入本地 GUI；开发认证只允许明确的 development 与回环地址环境，不能通过修改生产 ENVIRONMENT 绕过 Access。

本地模式可用于界面 / 数据 / 表单功能验证，但不能证明真实Cloudflare IP国家、IP时区、可信设备头、跨地域限流行为或正式DNS/TLS已经满足预期。

<a id="section-14-4"></a>

### 14.4 常用脚本速查

| 命令 | 作用 / 注意事项 |
| --- | --- |
| `npm run configure -- --config deployment.json` | 生成两端配置；先保留并核对旧配置 |
| `npm run preflight` | 本地配置校验；不验证线上 secret / DNS / 数据库表 |
| `npm run check` | 两端与界面 TypeScript 检查 |
| `npm run build` | check、Worker编译、Web构建 |
| `npm test` | Worker编译及普通测试集合 |
| `npm run test:browser` | Worker编译与串行浏览器安全回归 |
| `npm run test:runtime` | 运行时版本、canary与workerd回归 |
| `npm run deploy:dry-run` | 两端打包预演，不是生产验收 |
| `npm run db:migrate` | preflight后向正式D1应用迁移，远程写入 |
| `npm run deploy` | preflight→build→test→runtime→Admin部署→Redirect部署 / 探活；不自动跑browser测试或DB迁移 |
| `npm run verify:deployment` | HTTPS只读公开探活，检查status及版本；不修DNS、不自动重新部署 |
| `npm run audit:links -- --input private-export.json --config deployment.json` | 对私有导出做只读策略审阅；不改链接，不输出密码 / 文本正文 |
| `npm run package:source` | 按项目脚本制作源码目录；公开前仍检查配置与秘密排除情况 |
| `npm run backup` | 导出正式D1到固定文件名，注意覆盖与保管 |

独立只读跳转检查：先创建专用无限次数、无密码、无 VPN 限制、cache_ttl=0 的 /docs 链接，目标为 https://example.org/docs、状态码301。下面工具发送 GET 和 HEAD，但不跟随目标；全局浏览器采集启用时 GET 会进入检查页，不能用该直接跳转工具验收受检查的链接。仅在隔离验收配置中关闭采集，或使用真实浏览器完成流程；不要为测试关闭生产保护。

```bash
node scripts/smoke.mjs --short-url https://go.example.com/docs --expected-location https://example.org/docs --code 301
```

统计凭据轮换坚持先验证、后删除：新凭据应具有目标账户的最小查询权限，先用受控输入运行 scripts/verify-analytics-token.mjs 检查，再更新 Admin secret 并验收查询与 Cron。管理凭据时使用显式 ID，不按控制台列表行号删除。verify:deployment 不做自动重部署；错误时保留已脱敏证据再排查。

<a id="section-14-5"></a>

### 14.5 日常观察与诊断边界

公开探活可指定主机与地址族：

```bash
npm run verify:deployment -- --url https://go.example.com/health --expected-version 1.0.1
npm run verify:deployment -- --url https://go.example.com/health --family 4
# 需要单独观察IPv6且本机具备IPv6连通时：--family 6
```

脚本默认最多12轮、轮间5秒、每请求10秒超时；通常要求连续两轮健康，配置为只尝试1轮时只需一轮。它不跟随重定向、不禁用证书验证、不回退HTTP。失败时先保留HTTP状态、TLS信息、时间和请求ID，不能循环部署或例行解绑域名来“刷绿”。

包内 observability默认关闭，应用错误日志刻意不记录正文和秘密；需要进一步日志时在可控环境启用并检查脱敏。不要为了排障把 Authorization、Access JWT、完整 Cookie、密码POST正文或私有SQL发到公开 issue。数据库维护前检查待执行语句和备份；不存在自动清理审计 / 归档的公开API。

**依据：** `package.json`；`scripts/local-init.mjs`；`scripts/local-wrangler.mjs`；`scripts/check-deployment.mjs`；`scripts/security-audit.mjs`；`README.md`；本版源码脚本与迁移。

<a id="acceptance"></a>

## 15 · 上线验收清单

以下为 **部署者执行的验收计划**，不是本次代为完成的线上检查。对涉及计数、创建或删除的测试使用独立验收记录；不要用现有密码、生产有限次数链接或不明外部目标做破坏性探测。

| 层级 | 检查方式 | 通过标准 / 不能据此推导的结论 |
| --- | --- | --- |
| 配置 | configure后核对两端名称、D1、域名、Access、绑定及secret存在性 | 真实资源指向正确；preflight绿色不替代线上核验 |
| 数据 | 查看迁移记录、必需列、规则修订及Owner触发器 | 四份迁移已按目标库需要应用；保留业务数据 |
| 部署版本 | 核对两个Worker实际当前版本、部署流量与资源 | 上传版本不等于已经切流；两端分别确认 |
| 外层入口 | 未登录访问GUI和管理API | 先进入Access认证或拒绝，不直接泄露管理数据 |
| 首次Owner | 通过指定邮箱登录空用户表实例 | Owner自动建立；其他邮箱不能抢占bootstrap |
| 管理深健康 | Owner调用GET /system/health | Worker和D1均ok；AE字段仅表示配置状态 |
| 公开浅健康 | 每个短链域名GET /health | HTTPS有效、200、version为1.0.1；不代表D1和所有业务流程正常 |
| 普通跳转 | 专用302链接，禁止自动跟随到目标 | Location准确、缓存头正确；链接无保护时不应无故503 |
| 文本模式 | 专用纯文本链接 | 200 text/plain，无Location，内容不是HTML执行，no-store |
| 密码保护 | 专用已知密码：缺Cookie、错密码、正确密码、重新GET | 保护页无目标，错密码401，成功同源303，再完成最终响应；POST正文不发到目标 |
| 浏览器检查 | 全局采集与block_vpn各组合，允许Cookie与JS | 根据策略返回检查页或业务响应；验证JSON恢复路径和新资源加载 |
| 规则更新 | 用专用记录改变目标 / 保护后重试旧证明 | 旧规则证明不应继续授权旧目标；不承诺撤销已发出的响应 |
| 次数限制 | 建立低上限测试链接并观察GET / HEAD | 每个最终授权请求消耗名额，耗尽403；不能把HEAD当免费检查 |
| 成员权限 | Viewer / Editor / Admin / Owner及独立测试token | 符合第06章矩阵，特别是跨所有者写拒绝与共享读取 |
| API保护 | 旧/api、旧token格式、跨源Origin、错误version | 404 / 401 / 403 / 409等按对应检查发生，不能以GUI隐藏代替测试 |
| 统计 | 新测试事件 → /stats → 后续UTC归档 | 分开核验写入、查询、Cron；中间页面不增加成功点击，采样数据不是精确UV |
| 备份 | 隔离恢复演练与秘密配套核验 | SQL可恢复且根secret可用；CSV不是完整备份 |

对“错密码 / 错证明 / 越权 / 限流”的验证应该控制频率并仅针对自己的专用记录。实际采样、分布式限流与平台运行时行为仍需真实部署验证；本地mock不能证明所有边缘节点行为。

<a id="troubleshooting"></a>

## 16 · 常见故障与错误码

<a id="section-16-1"></a>

### 16.1 按症状排查

| 症状 | 首先检查 | 不应采用的处理 |
| --- | --- | --- |
| GUI能打开但显示登录失效，API返回HTML / 302 | Access会话、完整域名保护、Origin、客户端是否误跟随跳转 | 不将HTML解析失败解释为“链接为空”；不暴露管理API绕过Access |
| Access已放行但Linro403 | 用户是否启用、邮箱是否预先登记、access_sub是否变化 | 不信任来访者自带邮箱头，不直接删除Owner保护 |
| 首次Owner没有自动创建 | 用户表是否真正为空、邮箱大小写归一化后是否匹配bootstrap | 不清空已有用户表强行重新初始化 |
| 带token的脚本仍401 | 两层认证、token完整前缀 / 长度、过期 / 撤销、用户是否停用 | 不只发送Access服务凭据，不手工修改旧token前缀 |
| Owner token不能改别人的链接 | 所有token均是owned写范围；需交互式Owner或对应专用用户 | 不把token升级成管理scope或移除created_by检查 |
| 页面提示版本冲突 | 最新version与提交字段差异 | 不自动重放陈旧整个对象 |
| 公开域名health200，短码404 | D1域名记录、slug大小写、域名 / 链接启用、过期策略 | 不把health当作DB查询证明，不靠重建DNS解决业务记录错误 |
| 一开启时区采集就大量503 | Redirect的BROWSER_CHECK_SECRET是否配置且合法、两端版本一致 | 不把新root替换为原密码root，不在代码中回退到无检查跳转 |
| 密码原来能用，升级后全部失败 | 原LINK_PASSWORD_SECRET是否被保留、数据库哈希是否一致 | 不随机生成root替换旧root，不删除密码字段恢复可访问性 |
| 浏览器检查反复出现或403 | Cookie被阻止、挑战过期、重复marker、规则变化、网络上下文变化、两端静态资源版本 | 不仅靠添加`_Linro_check=1`绕过验证；不把所有误拒绝称为VPN实锤 |
| 无JavaScript浏览器无法最终跨站跳转 | 原生form303与CSP限制；使用项目正常JS导航流程验收 | 不全局移除CSP来隐藏回归 |
| KV已配置但D1依旧被查询 | 当前实现就是d1-guarded缓存 | 不声称KV命中免D1；不把失联时缓存当授权来源 |
| 统计“未配置” / 为空 / 报错 | 分别检查available、开关、dataset、账户ID、Admin查询secret及实际事件 | 不把available:false或查询失败显示成零点击 |
| /stats慢，GUI20秒报错 | 8个顺序查询与上游每次10秒超时预算 | 不自动高频重试扩大上游429 |
| 归档没有今天数据 / 没有时区明细 | 前两个完整UTC日的Cron策略、游标、既有daily_stats | 不期待归档接口补齐AE全部历史维度 |
| 删除域名409 | 尚有链接引用；先移动或按授权删除 | 不手动禁用外键约束 |
| TLS / 自定义域名异常 | 检查SNI、DNS、证书和平台状态，保留探活证据 | 不禁用TLS验证，不例行解绑重绑或循环发布 |

<a id="section-16-2"></a>

### 16.2 管理错误码速查

这里列出主要可操作错误，不保证所有公开文本响应都带 error.code；同一请求通常先返回最先触发的认证 / 校验错误。

| HTTP | error.code | 含义与处理 |
| --- | --- | --- |
| 400 | `invalid_json`、`empty_body` | JSON必须为有效UTF-8对象，正文不能为空 |
| 400 | `unknown_field` | 删除未声明或只读字段；不要原样回传GET对象 |
| 400 | `invalid_field` | 数字范围、类型、版本或通用字符串不合法 |
| 400 | `invalid_slug` | slug格式 / 保留字不合法 |
| 400 | `invalid_url`、`invalid_hostname`、`invalid_email` | 按模型规则提交URL、主机名、邮箱 |
| 400 | `invalid_code`、`invalid_query_mode` | 选择支持的数字跳转码或query枚举 |
| 400 | `internal_target`、`private_target`、`redirect_chain` | 目标是后台、未经准许的私有地址或已管理短链域名；改为已审阅的最终目标 |
| 400 | `unsafe_query_mode` | 敏感认证 / 重置 / 跳转目标须使用discard |
| 400 | `domain_not_found`、`admin_hostname` | 选择现有业务域名，不能用管理域名 |
| 400 | `invalid_geo_rules`、`duplicate_geo_rule` | 地区规则结构、数量、代码或重复项错误 |
| 400 | `invalid_response_mode`、`invalid_text_content`、`text_geo_conflict` | 正文类型 / 长度不合法，或text仍保留geo规则 |
| 400 | `invalid_block_vpn`、`invalid_link_password` | 保护字段类型或密码约束不满足 |
| 400 | `invalid_status`、`search_too_long` | 列表过滤器或关键词过长 |
| 400 | `invalid_link_id` | 统计选择为空、格式错误、超出50项、重复参数或混用两种选择参数 |
| 400 | `invalid_import`、`invalid_batch`、`invalid_action`、`duplicate_item` | 导入 / 批量请求结构与条数错误 |
| 400 | `invalid_role`、`invalid_name` | 用户角色或站点 / token名称错误 |
| 400 | `https_required` | 生产管理请求必须HTTPS |
| 401 | `access_required` | Worker未收到有效的Access入口认证头 |
| 401 | `invalid_access_token` | Access JWT签名、算法、claim、时间、issuer或aud不满足 |
| 401 | `invalid_token` | 应用token格式、存在性、过期 / 撤销状态、用户状态不满足 |
| 401 | `local_token_required` | 仅本地：开发token缺失或错误 |
| 403 | `user_not_allowed`、`human_identity_required` | 用户未启用 / 身份不匹配，或服务身份缺少Linro token |
| 403 | `forbidden`、`invalid_scopes` | 当前scope不足，或创建token试图越权 |
| 403 | `interactive_only` | 当前使用token调用了交互式专用接口 |
| 403 | `link_owner_required` | Editor / token试图写其他用户创建的链接 |
| 403 | `cross_origin`、`csrf` | 来源或CSRF头不符合要求 |
| 404 | `not_found`、`api_not_found` | 资源不存在，或路径 / 方法不受支持 |
| 404 | `stats_link_not_found` | 统计选中的至少一个链接已不存在 |
| 409 | `conflict` | slug、hostname或email唯一性冲突 |
| 409 | `version_conflict` | 乐观锁冲突；刷新比较再提交 |
| 409 | `in_use` | 外键仍引用资源或引用目标已不存在 |
| 409 | `last_owner` | 操作会移除最后一名启用Owner |
| 409 | `token_limit` | 已有50条未撤销token记录，先撤销不用的记录 |
| 409 | `hostname_is_destination` | 新域名已被现有默认 / 地区目标引用，先迁移目标 |
| 413 | `body_too_large` | 正文超过接口上限 |
| 414 | `uri_too_long` | 最终组合URL过长 |
| 415 | `content_type` | 管理API需application/json；密码POST另需表单类型 |
| 421 | `wrong_host` | Admin请求origin与ADMIN_ORIGIN不一致 |
| 429 | `rate_limited` | 管理API认证前或写入限流；查看Retry-After，不自动高频重试 |
| 500 | `internal_error` | 未映射的Admin异常，包括部分D1或上游网络异常；保留request_id |
| 502 | `analytics_query_failed` | AE上游HTTP、结构或计数校验失败 |
| 503 | `access_not_configured`、`access_keys_unavailable` | Access配置无效或签名公钥暂不可获取 |
| 503 | `link_password_unconfigured`、`invalid_password_record` | 密码根secret缺失或存储校验记录异常 |
| 503 | `browser_check_unconfigured` | 开启单链接策略前未配置浏览器检查能力 |
| 503 | `assets_missing`、`rate_limit_not_configured` | 管理端静态资源或生产写限流绑定缺失，检查构建与绑定 |
| 503 | `security_policy_invalid` | 部署安全策略JSON、字段或允许值不合法 |

公开浏览器表单还可能返回 `browser_form_type`、`invalid_browser_form` 等专用错误；不要按管理JSON字段去修复原本应提交的表单。源码对目标私网 / 已管理域名等检查也有专用错误，应以实际响应和 request_id定位对应验证函数。错误表用于排障，不作为忽略未知错误或将未知错误视为成功的理由。

**依据：** `packages/shared/src/http.ts`、`validation.ts`、`policy.ts`、`destination.ts`、`access.ts`、`link-password.ts`；`apps/admin/src/worker/auth.ts`、`index.ts`、`api.ts`、`analytics.ts`；`apps/redirect/src/browser-page.ts`。
