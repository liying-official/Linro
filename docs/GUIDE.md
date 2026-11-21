# Linro v1.0.2 使用与部署指南

[English](GUIDE.en-US.md) · [回到 README](../README.md) · [API 参考](API.md) · [离线 HTML](index.html)

这份指南先教你把项目跑起来，再解释可选功能。所有命令都在**包含 `package.json` 的项目根目录**执行。看到 `example.com`、`YOUR_…` 或重复数字 ID，表示示例，必须换成你自己的值；它们不是可用账号或凭据。

## 1. 先认清四个部分

Linro 像一间小店：**Admin Worker** 是只给成员使用的柜台，**Redirect Worker** 是访客打开短链接的门，**D1** 是共用的资料柜，**Access** 是检查后台身份的门卫。

| 名词 | 你需要知道的事 |
| --- | --- |
| 管理域名 | 例如 `admin.example.com`，用于后台和管理 API；整个主机都要由 Access 保护 |
| 短链域名 | 例如 `go.example.com`，供访客使用；与管理域名分开 |
| 短码 slug | 域名后的一小段，例如 `/welcome`；同一域名下不能重复，大小写不同就是不同短码 |
| D1 数据库 | 两个 Worker 必须使用同一个数据库 ID |
| 应用令牌 token | 给脚本使用的钥匙；不是 Cloudflare 部署令牌，也不是访客密码 |
| Secret | 放在 Worker 秘密存储里的密钥；不要写入公开配置、网页或 Git |
| 迁移 migration | 按顺序给数据库补表、字段和索引；保留数据升级时使用 |

当前应用版本是 **v1.0.2**，管理 API 仍是 `/Linro/v1`。API 的 `v1` 与应用补丁版本不是同一个编号。源码里有 0001–0006 六份数据库迁移，是否要执行某一份取决于数据库迁移账本。[版本兼容说明](PROTOCOL-v1.0.2.md)

<a id="local"></a>

## 2. 先在自己的电脑上体验

只看界面可直接使用[静态演示](DEMO.md)。下面的本地运行会启动真实应用逻辑和本地数据库，但不会部署到 Cloudflare。

### 2.1 安装依赖

先安装 **Node.js 22.16.0 或更高版本**，解压源码，再进入项目目录。以下基础命令在 Bash 和 Windows PowerShell 都可逐行执行：

```bash
node --version
npm --version
node -p "require('./package.json').name + ' ' + require('./package.json').version"
npm ci
npm run toolchain:versions
```

版本应显示 `linro 1.0.2`。`npm ci` 按随包锁文件安装，不要为了处理安装错误而删除 `package-lock.json`。项目锁定 Wrangler **4.132.0**；`toolchain:versions` 会列出 Wrangler、Miniflare 和 workerd 等实际使用的工具版本。

### 2.2 准备本地数据并启动

```bash
npm run local:init
npm run build:web
npm run db:migrate:local
npm run db:seed:local
npm run dev:admin
```

记下 `local:init` 在你自己的终端中显示的临时开发令牌。再打开第二个终端，进入同一个项目目录：

```bash
npm run dev:redirect
```

用浏览器打开 `http://127.0.0.1:8787`，输入开发令牌；本地短链入口是 `http://127.0.0.1:8788`。终端按 `Ctrl+C` 停止服务。开发令牌保存在本地私有文件中，**不要贴到 Issue、截图或提交记录里**。

本地数据位于 `.local/`，与云端 D1 分开。重复 `local:init` 会保留已有有效密钥和数据，不应靠删除目录来排障。需要测试本地 KV 时可用 `npm run local:init -- --kv`。本地默认关闭统计与全局时区采集；本地体验不能代替真实 Cloudflare Access、Radar 或网络 RTT 验收。

<a id="install"></a>

## 3. 为正式部署准备 Cloudflare 资源

### 3.1 准备清单

你需要 Cloudflare 账户、已接入 Cloudflare 的域名、可管理 Workers / D1 与 Access 的权限，以及首位管理员能登录 Access 的邮箱。管理域名和短链域名可以是同一根域名下的不同子域名。

本节开始会接触云端。`configure`、`preflight`、`check`、`build` 主要操作本机；`d1 create`、`db:migrate`、`secret put` 和 `deploy` 会创建或改变云端资源。逐步执行，确认前一步成功再继续。

### 3.2 登录部署账户

```bash
npx wrangler --version
npx wrangler login
npx wrangler whoami
```

检查显示的 Account ID 是你要使用的账户。Cloudflare 的 **Account ID、Zone ID、D1 Database ID 和 Access AUD 都不同**，不能互相代替。Wrangler 登录是允许电脑部署；它不等于登录 Linro 后台。

若你有多个账户，在创建资源前明确选择。Bash：

```bash
read -r -p "目标 Cloudflare Account ID: " CLOUDFLARE_ACCOUNT_ID
export CLOUDFLARE_ACCOUNT_ID
```

Windows PowerShell：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = Read-Host "目标 Cloudflare Account ID"
```

### 3.3 创建一个 D1

**只有首次安装才创建新库。** 已有实例直接阅读[升级](#upgrade)。

```bash
npx wrangler d1 list
npx wrangler d1 create linro
npx wrangler d1 info linro
```

记下返回的 `database_name` 和 `database_id`，两个 Worker 稍后共用它。不要分别给后台与公开端建库，也不要把本地体验库导入正式库来复制本地 Owner。[D1 迁移官方说明](https://developers.cloudflare.com/d1/reference/migrations/)

### 3.4 先给整个后台域名设置 Access

在 Cloudflare Zero Trust 中创建 **Self-hosted Access application**：

1. 主机填写你的管理域名，例如 `admin.example.com`；Path 留空，覆盖整个主机。
2. 设置真人 **Allow** 策略，只允许预期的邮箱或受控身份组。
3. 选用已配置的邮件验证码或身份提供方。
4. 保存该应用的 **Audience / AUD**，以及团队的 `https://YOUR-TEAM.cloudflareaccess.com` 地址。
5. 确认公开短链域名没有被此管理应用或上级泛域名策略挡住。

不要用 Bypass 或 Everyone 来“先让后台能打开”。Access 保护外层入口，Worker 还会验证其 JWT。`assets.run_worker_first: true` 保证后台静态文件也先鉴权；`workers_dev` 和 `preview_urls` 均保持 `false`。[Access 应用说明](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)

<a id="configuration"></a>

## 4. 填配置、迁移，然后上线

### 4.1 复制公共模板

选择一种终端，不要覆盖已有的 `deployment.json`。

Bash：

```bash
test ! -e deployment.json && cp deployment.example.json deployment.json
```

Windows PowerShell：

```powershell
if (Test-Path .\deployment.json) { throw "文件已存在，请编辑原文件" }
Copy-Item .\deployment.example.json .\deployment.json
```

编辑复制出来的文件。下面是可理解的最小起点，其他可选字段沿用模板默认值：

```json
{
  "account_id": "YOUR_CLOUDFLARE_ACCOUNT_ID",
  "database_id": "YOUR_D1_DATABASE_UUID",
  "database_name": "linro",
  "admin_host": "admin.example.com",
  "redirect_hosts": ["go.example.com"],
  "access_issuer": "https://your-team.cloudflareaccess.com",
  "access_aud": "YOUR_ACCESS_APPLICATION_AUD",
  "owner_email": "owner@example.com",
  "analytics_enabled": false,
  "browser_timezone_enabled": false,
  "cloudflare_device_type_enabled": false,
  "redirect_cache_namespace_id": "",
  "source_url": ""
}
```

所有资源 ID、邮箱和主机都要换成你自己的实际值。主机字段只写域名，不带 `https://` 或路径；`access_issuer` 则需要 HTTPS 且没有结尾 `/`。`source_url` 用于给用户提供运行版本的对应源码，正式提供服务前按[许可说明](LICENSING.md)填写合适的公开地址。

```bash
npm run configure
npm run preflight
```

`configure` 会根据 `deployment.json` **覆盖两份 `apps/*/wrangler.jsonc`**，已有手工配置请先比对。它不会创建 Access、数据库、业务域名记录或秘密。`preflight` 检查本地配置是否相互匹配；通过不代表远程 DNS、证书、密钥或数据已经可用。

### 4.2 默认不用填秘密；需要功能时再配置

普通短链的基础部署可先关闭所有可选功能。需要下列功能时，按对应位置使用 Worker secret，不能放入 `deployment.json` 的普通字段。

| Secret | 写入哪个 Worker | 作用 |
| --- | --- | --- |
| `LINK_PASSWORD_SECRET` | Admin 和 Redirect，**相同值** | 验证访客密码，保管好才能继续验证已有密码 |
| `BROWSER_CHECK_SECRET` | Admin 和 Redirect，**相同值** | 给浏览器检查挑战和证明签名 |
| `RADAR_API_TOKEN` | Redirect | 单链 VPN 检查需要的 Radar 读取权限 |
| `ANALYTICS_API_TOKEN` | Admin | 查询 Analytics Engine 的读取权限 |
| `LOCAL_DEV_TOKEN` | 仅本地开发 | 正式环境不要设置 |

首次安装可先部署基础功能，再给已创建的 Worker 添加秘密，刷新后台确认功能可用，最后开启相应设置。新建根密钥可在私有终端生成：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

每一种根密钥各生成一次，保存到自己的秘密管理工具；同一种密钥向两个 Worker 输入相同值。例如开启密码功能：

```bash
npx wrangler secret put LINK_PASSWORD_SECRET --config apps/admin/wrangler.jsonc
npx wrangler secret put LINK_PASSWORD_SECRET --config apps/redirect/wrangler.jsonc
```

按提示粘贴，不把值写在命令参数或文档里。`secret put` 会创建并立即部署 Worker 新版本，不只是本地登记；已有线上实例应安排好变更时间。浏览器检查使用相同方式写入 `BROWSER_CHECK_SECRET`。**升级时保留原根密钥，不要重新生成。** 根密钥需为 43–128 个 base64url 字符，与每条短链的访客密码不同。[Worker secrets 官方说明](https://developers.cloudflare.com/workers/configuration/secrets/)

### 4.3 应用全部待处理迁移

迁移像给资料柜增加抽屉。已有资料不能通过重新建柜或重复初始化来“升级”。先检查目标数据库，再执行：

```bash
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
npm run db:migrate
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
```

本版包含：

| 迁移 | 增加什么 |
| --- | --- |
| `0001_initial.sql` | 基础表、索引和最后一名 Owner 的保护 |
| `0002_link_controls.sql` | 地区规则、密码、次数上限和规则修订 |
| `0003_text_responses.sql` | 纯文本模式 |
| `0004_browser_checks.sql` | 单链 `block_vpn` 开关 |
| `0005_link_kv_cache.sql` | 每条链接自己的 KV 时长 |
| `0006_destination_hosts_and_archive.sql` | 目标主机索引、冲突约束和日归档排序索引 |

迁移失败就停下来处理原因，不删除账本或跳过失败项。`npm run deploy` **不自动创建数据库，也不自动执行迁移**。

### 4.4 检查并部署

```bash
npm run check
npm test
npm run test:runtime
npm run build
npm run test:browser
npm run deploy:dry-run
```

`test:runtime` 使用原生 workerd；`test:browser` 需要真实 Chrome / Chromium，可以通过 `CFL_CHROMIUM_PATH` 指向你已安装的浏览器。工具无法启动应记录为未完成，不能当作测试通过，也不要关闭浏览器安全限制来凑结果。`deploy:dry-run` 只验证打包，不切换线上流量。

确认配置、迁移和检查结果后：

```bash
npm run deploy
```

该命令实际执行：预检查 → 构建 → 单元测试 → 原生运行时测试 → Admin 发布 → Redirect 发布 → 公开探活。它**不包含浏览器测试**。两个 Worker 的发布**不是原子操作**，其中一个失败不会自动回滚另一个。

Admin 保留 `compatibility_date: "2026-09-15"` 与 `enable_request_signal`，让调用方断开连接时可取消统计上游请求。不要只删除此标志而保留旧日期；配置生成器与预检查负责保持一致。

### 4.5 第一次打开后台

用 `owner_email` 对应的 Access 身份登录。只有数据库用户表为空时才会自动建立第一名 Owner；已有用户时，修改配置中的邮箱不会替换原 Owner。

在“域名”页添加已经绑定到 Redirect Worker 的主机，再创建测试链接。**平台上的域名绑定与 Linro 的域名记录是两件事，缺一不可。** 多域名时，先把 1–50 个主机写入 `redirect_hosts`、重新配置并发布 Redirect，再到后台逐个登记；相同短码可以在不同域名下使用。后台新增域名不会自动创建 DNS、证书或 Worker Custom Domain。[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

为了运行下面的专用检查，创建 `slug=docs`、目标 `https://example.org/docs`、状态码 `301`、`cache_ttl=0` 的普通无保护测试记录，然后替换命令中的公开主机：

```bash
npm run verify:deployment
node scripts/smoke.mjs --short-url https://go.example.com/docs --expected-location https://example.org/docs --code 301
```

检查只验证首跳，不跟随目标。`GET /health` 显示公开端版本，但不查 D1；应同时验证一条实际短链。首次测试通过后可删掉专用记录，再逐个打开需要的可选功能。

<a id="usage"></a>
<a id="permissions"></a>

## 5. 日常使用与团队权限

### 5.1 创建链接时先看这几个选项

| 选项 | 新手可以这样理解 |
| --- | --- |
| 域名与短码 | 合起来是发给别人的地址。短码为空会自动生成 8 位 |
| 目标 URL | 访客最终要打开的 HTTP(S) 地址；不支持把用户名或密码写进 URL |
| 301 / 308 | 永久跳转，客户端可能记住；目标还会调整时应谨慎使用 |
| 302 / 307 | 临时跳转，适合需要改目标的入口；创建时可明确选择 302 |
| 到期与停用 | 到期或停用后，访客不能再正常打开 |
| 最大授权请求次数 | 控制服务器放行次数，不是独立访客人数；符合条件的 HEAD 也会扣一次 |
| 纯文本 | 直接显示一段文字，不把它当 HTML 执行 |
| 浏览器缓存 `cache_ttl` | 访客电脑能保留跳转多久，默认 0。需要快速撤回时保持 0 |
| KV 缓存 `kv_cache_ttl` | Cloudflare 辅助缓存时长，与浏览器缓存不同；默认继承全局 |

域名的默认跳转码初始为 **301**。你可在域名设置中改成 **302**；这只影响之后创建且未指定状态码的链接，不会改写已有链接。

短码允许 1–64 个 ASCII 字母、数字、`_` 和 `-`。`health`、`cdn-cgi` 和 `__Linro_` 前缀保留，判断保留项时忽略大小写；`Linro` 可以作为业务短码。

### 5.2 谁能读，谁能改？

| 能力 | Viewer | Editor | Admin | Owner |
| --- | --- | --- | --- | --- |
| 读取工作区全部链接、目标、纯文本及统计 | ✓ | ✓ | ✓ | ✓ |
| 创建链接、修改或删除自己创建的链接 | — | ✓ | ✓ | ✓ |
| 修改或删除其他成员创建的链接 | — | — | ✓ | ✓ |
| 管理域名、查看审计 | — | — | ✓ | ✓ |
| 管理成员和站点设置 | — | — | — | ✓ |
| 管理自己的应用令牌 | ✓ | ✓ | ✓ | ✓ |

这是共享资料柜，**Viewer 也能读到其他人的目标和正文**。访客密码只控制公开短链访问；需要成员间保密的数据不适合放在同一工作区。

邀请成员时，Owner 先在 Linro 登记邮箱与角色，再在 Access 允许该身份；项目不发送邀请邮件。成员没有另一套 Linro 登录密码。停用用户会使其后续登录和令牌认证失败，但不会自动停用其公开链接。最后一名启用的 Owner 不能被停用或降级。

### 5.3 自动化需要两把钥匙

脚本先用 **Access Service Token** 通过外层门卫，再用 **Linro 应用令牌**决定可以操作什么。请在同一 Access 应用为指定 Service Token 设置 Service Auth 策略；只创建令牌还不够。[官方 Service tokens 说明](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)

应用令牌只允许 `links:read`、`links:write`、`links:delete`、`domains:read`、`analytics:read`，且不得超过用户当前角色。所有应用令牌，包括 Owner 创建的令牌，**只能修改该用户自己创建的链接**。同一用户的多个令牌共享此写入范围，需要隔离自动化责任时应使用独立用户。

令牌有效期是创建时起 60 秒至 365 天；每个用户最多 50 条未撤销记录，过期但未撤销的也计数。完整值只显示一次，之后只能撤销并重建。具体调用见 [API](API.md)。

### 5.4 编辑、导入和导出

多人编辑时，`version` 像每份资料的修订号码。看到 409 冲突，先刷新并比较修改，再保存；不要忽略冲突重发旧对象。

导出支持 JSON 和 CSV，文件包含目标、描述和纯文本等实际业务内容，按私有备份保管。**导出不含密码及其校验串**；需要完整恢复密码功能时，必须使用 D1 备份和原根密钥。GUI 导入将数据转换成创建字段，文件最多 2 MiB（2,097,152 字节）、5,000 条，每次提交 10 条；整个文件不是一个事务。

每个 API 导入批次要么全部成功，要么都不写入。GUI 对明确发生在写入前的限流可等待重试，并保留已完成进度。遇到断网或超时而结果不明，先检查哪些短码已创建，再决定重试；项目没有通用写入幂等键。批量启停/删除则逐项返回结果，可能部分成功。[导入格式示例](../examples/import.json)

<a id="optional"></a>

## 6. 可选功能：需要什么再开什么

### 6.1 密码、地区规则和纯文本

密码长度为 12–128 个 JavaScript 字符串代码单元，且最多 512 UTF-8 字节，不能包含控制字符；不自动去掉首尾空格。编辑时选择“保留”“设置”或“移除”；API 中省略 `password` 是保留，`null` 是移除，空字符串无效。

密码通过后，页面先回到同源短链再请求目标，密码不会随跳转发给目标网站。解锁 Cookie 最长 900 秒，规则变更会让旧证明失效。已有密码依赖原 `LINK_PASSWORD_SECRET`，丢失根密钥不能从数据库找回明文。

地区规则最多 32 条，按“国家 → 大洲 → 默认目标”选择，来源为 Cloudflare 元数据。它只决定去哪里，不证明用户身份。纯文本最多 16,384 个代码单元、32,768 UTF-8 字节；不能同时保留地区规则，查询参数固定丢弃，最终响应始终 `no-store`。

### 6.2 浏览器时区和单链 VPN 检查

全局 `browser_timezone_enabled` 默认 `false`。普通链接只有在**全局采集开启、Analytics 开启且 Redirect 有可写 Analytics 绑定**时才增加采集页面。单链 `block_vpn=true` 独立生效，即使全局采集关闭也会要求检查。

浏览器用 `Intl.DateTimeFormat().resolvedOptions().timeZone` 自报时区；IP 时区来自 `request.cf.timezone`，不是浏览器时区。源码以 `request.cf.country === 'T1'` 判断平台 Tor 标记。**自报时区不可信**，旅行、系统设置和 IP 数据误差都可能造成误拦。

开启单链检查前，两端需有 `BROWSER_CHECK_SECRET`，Redirect 还需有账户 Radar 读取令牌：

```bash
npx wrangler secret put RADAR_API_TOKEN --config apps/redirect/wrangler.jsonc
```

该策略只接受 Radar 分类 `ACCESS_ISP` 的 ASN。通过网络检查后，页面发一次同源 RTT 探针；浏览器耗时与边缘连接 RTT 的绝对差大于 50 ms 会被拒绝。缺失时区、分类、RTT 或有效证明也可能被拒绝。它是严格的可选启发式策略，**不保证准确识别所有 VPN**；企业、校园网络、繁忙设备或排队也可能失败。

挑战和证明最长 120 秒，签发证明不会续期；它们绑定链接规则、主机、查询和网络上下文。源码没有服务端一次性消费表，不能承诺绝对防重放。无 JavaScript、Cookie 被禁用、网络变化或过期会阻止流程。HEAD 在只有全局采集时可以跳过采集；单链阻止开启且无证明时返回 403。

### 6.3 KV：辅助缓存，不是数据库替身

`redirect_cache_namespace_id` 留空表示不用 KV。需要时先创建 namespace：

```bash
npx wrangler kv namespace create REDIRECT_CACHE --config apps/redirect/wrangler.jsonc
```

把返回的 ID 填入配置、重新生成并发布两端，确保它们绑定同一 namespace。全局 TTL 默认 300 秒，范围 60–86,400 秒。单链 `kv_cache_ttl` 留空/null 继承，0 禁用，其他值也须在此范围。

密码、有效时区采集、VPN 检查、次数上限、到期、地区分流和纯文本链接都绕过 KV。普通命中仍核对最新 D1；D1 失败不会用旧缓存放行。KV 故障可以回到 D1，KV 写入失败有冷却抑制。

不开 KV 的普通直跳只需一次 D1 查询。开 KV 后还可能多一次 KV 读取、回填和安全复核；不同实例会有自己的缓存。因此 KV 并不必然省钱或更快，应比较真实延迟、D1 `rows_read` 和 KV 操作数，再决定是否启用。[KV 计费](https://developers.cloudflare.com/kv/platform/pricing/) · [D1 计费](https://developers.cloudflare.com/d1/platform/pricing/)

### 6.4 访问统计与日归档

统计默认关闭。需要时将 `analytics_enabled` 改为 `true`，确认 dataset 名称，并给 Admin 配置有 `Account → Account Analytics → Read` 权限的令牌：

```bash
npx wrangler secret put ANALYTICS_API_TOKEN --config apps/admin/wrangler.jsonc
npm run configure
npm run preflight
```

重新发布后，只有 Redirect 绑定写入端 `ANALYTICS`；Admin 使用读取 secret 查询。打开统计前确认当前套餐、账户权限和费用。[Analytics Engine SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)

统计中的“点击”是最终获准的业务 GET 的采样加权值，**不是独立访客数**。HEAD、密码提交和浏览器检查中间步骤不记成功点击。事件不保存原始 IP、完整 User-Agent、目标 URL、正文、Cookie 或密码；来源只取主机名。

仪表盘用 `view=dashboard`，只查趋势和总数；完整统计查多个维度，最多两路并发，整组有 **10 秒上游时限**。同实例的相同成功结果最多复用 15 秒，请求仍检查权限和 `link_ids`。`available:false` 表示未配置，不是零访问；查询错误也不能当作零。

浏览器时区与 IP 时区分开存储：`blob6` 是 IP 参考时区，`blob9` 是浏览器时区；`blob7` 是设备分类。默认设备为 `none`。只有确认平台可信地产生并覆盖 `CF-Device-Type` 时，才打开 `cloudflare_device_type_enabled`；`mobile/tablet` 映射为 `mobile`，`desktop` 映射为 `pc`。

归档开关 `analytics_rollup_enabled` 默认 true，但只有统计启用时才实际启用 Cron。默认每 15 分钟运行，允许 5 / 15 / 30 / 60 / 360 / 1440 分钟；默认每 6 小时重算已完成窗口。首次从最近两个完整 UTC 日开始，后续按水位追赶；每批最多 400 个链接/日期组合，计数变化才更新。归档只保留每日点击，没有完整维度，也不是查询失败时自动替代实时统计的后备系统。

### 6.5 限流与资源使用

应用自带四个独立限流 namespace：认证前、后台写入、公开请求、密码尝试。默认密码桶使用**来源 IP 的 SHA-256 哈希**作为 key，每个 key、每个 Cloudflare 位置 5 次 / 60 秒。共享出口可能共用额度；它不是连接级计数，也不是全球单一原子计数器。[官方限流语义](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

有需要时，可在账户支持的 WAF 中另加只针对密码 POST 的规则：

```text
(http.host eq "go.example.com" and http.request.method eq "POST" and starts_with(http.request.uri.path, "/__Linro_unlock/"))
```

替换主机后再配置适用的计数键、窗口和动作。项目不自动调用 Cloudflare 账户创建规则，也不能承诺免费计划支持所需 WAF 功能。不要把普通 GET 和静态资源塞进很低的密码桶。

减少资源消耗的起点是：先不开不需要的 KV、统计、采集和归档；使用界面默认游标分页；按需要清理旧审计/归档/撤销令牌；不要高频轮询完整统计。Admin 静态资源先经过 Worker 鉴权，因此也会执行 Worker；这是后台保护的一部分，不要为了省请求绕过它。

### 6.6 配置字段速查

完整可复制模板是 [deployment.example.json](../deployment.example.json)。下表中的默认值是源码默认值；已有部署应保留自己的资源名和 ID。

| 字段 | 默认或范围 | 作用 |
| --- | --- | --- |
| `account_id` / `database_id` | 必填真实资源 ID | Cloudflare 账户 / 共用 D1 |
| `database_name` | `linro` | 数据库名称；不是替代 UUID |
| `admin_worker_name` / `redirect_worker_name` | `linro-admin` / `linro-redirect` | 必须不同；升级复用原名称 |
| `admin_host` / `redirect_hosts` | 1 个后台主机 / 1–50 个不同公开主机 | 全小写、无协议和路径，不相互重复 |
| `access_issuer` / `access_aud` / `owner_email` | 必填 | Access 团队、同一应用 AUD、首次 Owner |
| `source_url` | 空 | 对应源码 HTTPS 地址，不能含凭据、查询、片段或使用本部署主机 |
| `analytics_enabled` / `analytics_dataset` | false / `linro_clicks` | 统计开关和数据集 |
| `analytics_rollup_enabled` | true，受统计开关约束 | 日归档开关 |
| `analytics_rollup_interval_minutes` | 15；仅允许 5、15、30、60、360、1440 | Cron 间隔 |
| `analytics_rollup_recheck_hours` | 6；整数 1–24 | 已完成窗口重算间隔 |
| `browser_timezone_enabled` / `cloudflare_device_type_enabled` | 都为 false | 浏览器采集 / 可信设备头读取 |
| `redirect_cache_namespace_id` / `redirect_cache_ttl` | 空 / 300 秒（60–86400） | KV 绑定与默认时长 |
| `auth_rate_namespace` / `write_rate_namespace` | `21001` / `21002` | 默认每 60 秒 300 / 120 次 |
| `redirect_rate_namespace` / `redirect_rate_limit` | `21003` / 300（1–100000） | 公开限流 |
| `password_rate_namespace` / `password_rate_limit` | `21004` / 5（1–30） | 密码尝试限流 |
| `query_forward_allowlist` | 五个 `utm_` 键；最多 32 个 | 仅这些审核过的键可转发；敏感键禁止 |
| `private_target_allowlist` | 空；最多 32 个精确主机/IP | 明确例外；不支持通配、CIDR 或端口，不能包含本部署主机 |
| `expired_link_status` | 404，可选 410 | 过期链接公开状态码 |

默认营销键为 `utm_source`、`utm_medium`、`utm_campaign`、`utm_term`、`utm_content`。`discard` 仅保留目标自身参数，`merge` 只追加目标中尚不存在的允许键，目标已有值优先；`replace` 把目标的整个查询部分替换为过滤后的来访参数，来访参数为空时会清空目标查询。登录、重置、回调等敏感目标只能用 `discard`。内部 `_Linro_check` / `_Linro_lang` 不透传。

目标校验拒绝后台和已管理短链主机，默认拒绝私有、本地地址。它不做 DNS 解析，不能据此声称已防住所有 DNS 重绑定情形。不要随意扩大私有目标白名单。[详细安全边界](SECURITY.md)

<a id="backup"></a>
<a id="upgrade"></a>

## 7. 备份与保留数据升级

### 7.1 先保存资料

升级前保管当前配置、资源 ID、两个 Worker 的版本 ID、域名/Cron/绑定，以及根密钥。密钥与数据库备份分别安全保管。选择新的私有文件名导出 D1：

```bash
npx wrangler d1 export DB --remote --config apps/admin/wrangler.jsonc --output Linro-pre-upgrade-backup.sql
```

`npm run backup` 也可导出，固定输出 `Linro-backup.sql`，再次运行前先归档旧文件。SQL 备份含真实用户、链接、审计和校验值，不能上传公共仓库。

恢复演练使用新建的隔离数据库，先验证、后删除旧资料；明确记录目标库的**显式 ID**，不要凭相同名称猜测目标。对备份做完整性检查，确认域名、链接数、规则及原密钥能配合工作，再考虑正式恢复。代码回滚不会恢复数据库。

### 7.2 把新源码接到原来的资源上

从 v1.0.1 升到 v1.0.2，保留原 Worker 名、D1 ID、KV namespace、dataset、Access、域名和根密钥。不要把公开占位模板直接部署到已有实例；也不要把旧版本目录里的整个生成配置盲目覆盖回来，应比较并补上新版本要求。

确认备份后，查询**全部待应用迁移**：

```bash
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
npm run db:migrate
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
```

数据库已有 0001–0006 时没有新增迁移要执行；较早数据库补缺失项。**不能据版本号推断**实际迁移状态。以下只读 SQL 可帮助核对：

```bash
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT name FROM d1_migrations ORDER BY id;"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT name,type FROM pragma_table_info('links');"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='links_rule_revision';"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "PRAGMA foreign_key_check;"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT key,value,updated_at FROM settings WHERE key LIKE 'analytics_rollup_%';"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT link_id,date,clicks,updated_at FROM daily_stats ORDER BY date DESC LIMIT 10;"
```

然后重新运行第 4 节的本地检查、原生测试、浏览器测试和 dry-run，再发布两个 Worker。不要重复生产 seed，也不要清空用户表重新生成 Owner。

### 7.3 上线后确认，再处理旧版本

检查两个 Worker 的实际版本、流量、绑定及域名，并验证已有应用令牌、密码短链和浏览器检查。v1.0.2 继续使用 v1.0.1 的 API、令牌哈希、Cookie 格式和兼容键，原授权按期限和规则继续生效。

需要精确分版本上线时，可使用 Wrangler 的版本上传与切流功能；先记录每个 Worker 返回的 UUID，并按[官方版本部署说明](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/)核对绑定和配置。不要把 `--keep-vars` 当作保留所有配置的承诺。

若部署已成功但探活失败，先查 DNS、TLS、域名绑定和版本，再单独运行 `npm run verify:deployment`。它不做自动重部署，也不关闭证书校验。确需回滚时，先确认旧代码仍兼容当前数据和密钥，再把两个 Worker 切回已记录版本；不要用旧备份直接覆盖升级后的新增业务数据。

<a id="troubleshooting"></a>

## 8. 遇到问题，先看哪一处？

| 现象 | 先检查 |
| --- | --- |
| 安装失败 | Node 版本、网络、原生依赖；保留锁文件，用 `npm ci` |
| Access 放行但后台 403 | Linro 用户是否启用、邮箱是否登记、首次 Owner 的用户表是否为空 |
| API 返回 HTML 或 302 | Access 登录是否失效；程序是否误跟随登录跳转 |
| 脚本带 token 仍然 401 | 是否同时通过 Access；令牌是否完整、到期、撤销或所属用户停用 |
| Owner 的应用 token 不能改别人的链接 | 所有 token 都只允许写自己用户创建的链接 |
| 修改提示 409 | 记录已变化；刷新读取当前 `version`，比较后再保存 |
| 公开 health 为 200，但短链 404 | D1 中是否有该主机、短码大小写、域名/链接启停与期限 |
| 密码升级后失效 | 两端是否仍使用原 `LINK_PASSWORD_SECRET` |
| 浏览器检查循环或拒绝 | Cookie、JS、挑战过期、规则或网络变化、Radar 分类和 RTT 可用性 |
| KV 开了仍有 D1 查询 | 正常；D1 仍是授权依据，不是 KV 命中就免查库 |
| 统计显示未配置 | 统计开关、dataset、Admin 查询 secret；区别于没有访问 |
| 归档没有今天/设备明细 | 归档针对完整 UTC 日，只有每日点击；不包含完整统计维度 |
| 添加域名提示目标冲突 | 已有链接指向该主机；先改为最终目标，避免短链套短链 |
| 删除域名提示被引用 | 先移动或删除其下链接，再删除域名记录 |
| Custom Domain / TLS / DNS 错误 | 核对平台配置和传播状态；不循环解绑重绑或忽略 TLS 验证 |

交互式后台写请求需要同源和 `X-Linro-CSRF: 1`。API 入口还拒绝**显式提供且不等于 ADMIN_ORIGIN 的 Origin**。公开密码表单的窄例外只允许有明确同源 `Sec-Fetch-Site` 证明的缺失/null Origin，显式其他 origin 仍然拒绝；它不会放宽后台规则。完整响应、错误码和调用示例见 [API](API.md)。

<a id="acceptance"></a>

### 上线验收小清单

- 用未登录浏览器打开后台，确认不能直接读取管理界面或 API。
- Owner 能登录；普通成员只拥有预期操作权限。
- 短链首跳状态与 `Location` 正确，停用、到期和不存在链接不会泄露目标。
- 如果启用密码、次数上限、浏览器检查，分别验证成功和拒绝情况。
- 如果启用统计/KV/归档，观察真实事件、用量和错误，不只看配置开关。
- 已保存可恢复备份，公开源码与运行版本一致，公共包没有真实配置或数据。

### 常用命令放在哪里？

| 命令 | 用途 |
| --- | --- |
| `npm run check` / `npm run format:check` | 类型与源码格式检查 |
| `npm test` / `npm run test:runtime` / `npm run test:browser` | 单元、原生运行时和浏览器测试 |
| `npm run test:disconnect` | 检查真实连接断开时的统计取消行为 |
| `npm run build` / `npm run build:demo` / `npm run build:docs` | 构建应用、静态演示、离线文档 |
| `npm run configure` / `npm run preflight` | 生成和检查部署配置 |
| `npm run db:migrate:local` / `npm run db:migrate` | 本地 / 云端数据库迁移 |
| `npm run deploy:dry-run` / `npm run deploy` | 试打包 / 正式发布 |
| `npm run verify:deployment` | 只读公开探活 |
| `npm run audit:links -- --input EXPORT.json` | 离线审计你自己的 GUI JSON 导出，不修改数据 |
| `npm run retention -- --help` | 查看本地快照保留期检查的参数说明 |
| `npm run package:source` | 制作已排除常见私有文件的源码目录 |

想检查旧数据占用，请继续阅读[数据保留](RETENTION.md)；准备上传 GitHub 或制作 Release，请阅读[发布说明](RELEASE.md)。
