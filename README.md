# Linro v1.0.1

[完整双语指南（HTML）](docs/index.html) · [多域名配置示例](docs/examples/deployment.multidomain.example.json)

管理界面采用 TailAdmin React 的 MIT 布局与卡片组件适配，图表使用 Recharts（MIT），不包含 ApexCharts。保留简体中文 / English、天蓝色 `#87CEEB`、白色 `#FFFFFF` 与文字 `#0D394A`；API、Access、权限、数据和公开访问策略保持原有实现。上游归属及许可见 [NOTICE](NOTICE) 和 [许可说明](docs/LICENSING.md)。

Linro 是 Cloudflare 原生私有短链平台：**独立 Redirect Worker + Admin Worker + D1 + 可选 KV + Workers Static Assets + React 简体中文/English GUI**。保留密码、地理分流、纯文本、请求上限、浏览器环境检查、Access/RBAC 与访问统计。

主题：天蓝色 `#87CEEB`、白色 `#FFFFFF`、主要文字 `#0D394A`、普通正文与说明文字 `#0D394A`。总览已过期图标为 X。

## 部署与升级须知

**无需为更名清库、重建 Owner 或新增迁移。** 本版没有改变四个既有 SQL 文件。仍必须以远端迁移清单为准应用所有待应用项，而不是假设之前部署过中间版本。

### 现有线上实例：保留真实资源名

新部署默认 Worker 名称为 `linro-admin`、`linro-redirect`，D1 名称为 `linro`，统计数据集为 `linro_clicks`。**品牌名称不是已有 Cloudflare 资源的自动改名操作。** 直接使用新的 Worker 名称会创建不同 Worker，原 secrets、绑定与自定义域名不会自动迁移。

从旧实例升级时，保留原 `deployment.json`、数据库 ID/名称、KV ID、统计数据集、Access issuer/AUD 和两个原 secret。在自己的配置中显式填写原资源名（下面仅示范旧默认命名，应以实际控制台为准）：

```json
{
  "admin_worker_name": "cf-links-admin",
  "redirect_worker_name": "cf-links-redirect",
  "database_name": "cf-links",
  "analytics_dataset": "cf_links_clicks"
}
```

把这些字段合并进完整配置，不要用这四行覆盖整个 deployment.json。若同目录仍有原先生成的同账户、同数据库 Wrangler 配置，`configure` 也会在输入未明确设置名称时继承它们；显式输入优先。新解压目录只有占位模板，无法凭空知道线上资源名，须填写上述字段。重新部署前核对命令打印的两个 Worker 名称。不要为品牌更名解绑域名或轮换 secret。

### v1.0.1 协议标识升级

本版统一使用 Linro 协议标识，接口区分大小写：

| 项目 | v1.0.1 标识 |
|---|---|
| 管理 API | `/Linro/v1` |
| 应用令牌 | `Linro_` 加 43 位随机编码 |
| 请求头 | `X-Linro-CSRF`、`X-Linro-Dev` |
| 内部路径 | `/__Linro_unlock/`、`/__Linro_browser/`、`/__Linro_assets/` |
| 访客 Cookie | `__Host-Linro_unlock_*`、`__Host-Linro_browser_*`；开发环境无 `__Host-` |
| 浏览器查询参数 | `_Linro_check`、`_Linro_lang` |

升级时同步部署两端并更新 API 客户端；旧 API 路径、请求头和应用令牌不再受支持。Owner 通过 Access 登录后重新签发应用令牌并更新调用端；不能只替换旧令牌字符串的前缀。旧访客 Cookie 不再生效，需要重新完成密码或浏览器检查。

已有数据库、短链密码哈希及其密码学用途标签、KV 缓存键、本地 Owner 身份和存储设置保持不变；无需清库、改密或重建 Cloudflare 资源。原许可归属保留。历史报告记录对应版本的行为，不代表 v1.0.1 的测试结果。

### 开源源码入口

生产使用前发布与你实际部署完全对应的源码包或仓库版本，在 `deployment.json` 填 `source_url` 并重新生成两端配置；该地址会显示于 GUI、访客页及响应 Link 头。默认值为空，预检查会提醒；不自动上传、代理或伪造 URL。不得将含 secret 的工作目录作为公开源码，详见 [AGPL 与对应源码](docs/LICENSING.md)。

## 阅读顺序

升级先读第 0 节；首次上线还需顺序完成第 1–9 节。第 10 节统计、11 节自动化和 0.2 节 KV 均可选；访问密码另需 0.3 节的独立 secret。

- [0. 新功能、配置、迁移与升级必读](#security-upgrade)
- [1. 架构与资源](#deployment-model) · [2. 安装与构建](#prepare) · [3. 账户](#account) · [4. D1](#database)
- [5. Access](#access) · [6. 配置](#configure) · [7. 部署](#deploy) · [8. 首次使用](#first-link) · [9. 云端验收](#acceptance)
- [10. 可选统计](#analytics) · [11. 自动化](#automation) · [12. 业务链接导入](#local-to-production)
- [13. 升级与回滚](#upgrade) · [14. 备份恢复](#backup) · [15. 排错](#troubleshooting) · [16. 本地开发](#development) · [17. 源码打包](#commands)

<a id="security-upgrade"></a>
## 0. 新功能、配置、迁移与升级必读

### 0.0 继承的 D3 / D4 / I3 修复与迁移纪律

本版没有新增或改写迁移SQL。**不能据版本号推断目标库已经应用了哪些迁移。** 报告的生产库仅有0001/0002，因跳过中间版本，实际还须0003与0004；原基线已修复这一升级说明缺口；Linro 保留该纪律。原始0001–0004全部保留，禁止只挑本版changelog提到的文件运行。

1. 使用**原已配置项目目录**与真实账户/D1绑定，先执行下面的只读迁移清单检查，保存结果；不要在占位模板目录对不明数据库操作。保留生产D1备份、两个Worker版本ID、实际deployment.json、已验证的package-lock.json、原LINK_PASSWORD_SECRET和BROWSER_CHECK_SECRET。
2. 解压本包至新目录，按第2节同步锁文件根版本；依赖版本不变，没有新增npm依赖。复制自己的配置并重新configure/preflight，确认Account ID、D1、KV、域名、Access及所有开关仍为原值。已有`browser_timezone_enabled:false`原样保留，不应因为升级而改成true；单链block_vpn继续独立生效。
3. 完成`check → test → test:runtime → build → test:browser → deploy:dry-run`。D3的请求头保真度金丝雀与真实Chromium测试是不同检查层；缺工具或浏览器被策略阻止均为失败/受阻，不能当成跳过后通过。
4. 维护窗口内，从**新配置目录**重新核对目标库清单，应用**全部待应用迁移**，再列一次确认没有遗漏，然后更新两个Worker并探活。若确实已经完整应用0001–0004，迁移命令应报告无待应用项；无需清库或重建Owner。

```bash
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
# 核对账户、数据库、备份与全部待应用项；确认后才执行写操作
npm run db:migrate
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
# 只读核对列与实际规则修订触发器（不是仅凭版本名称推断）
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT name FROM pragma_table_info('links') WHERE name IN ('response_mode','text_content','block_vpn') ORDER BY cid;"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='links_rule_revision';"
```

期望列包含response_mode、text_content、block_vpn；触发器必须同时覆盖三者，且纯计数更新不会改rule_revision。Wrangler `migrations apply`会按顺序处理待应用迁移；若迁移失败，停止后续发布，排查实际schema和迁移记录，不能以手工标记已应用或删除迁移文件求通过。[官方迁移说明](https://developers.cloudflare.com/d1/reference/migrations/) · [list/apply命令](https://developers.cloudflare.com/workers/wrangler/commands/d1/)

5. 实际Chrome/Edge验证密码→环境检查→最终跨域目标、纯文本、错误时区拒绝、Cookie及额度。修复前停住的标签页应重新打开原短链。旧升级报告的 D4/F1方案仅更改采集提交的成功响应形态，密码签名、挑战/证明、限流、D1/KV权限校验和计数不变；保持CSP的`form-action 'self'`，不以放宽CSP掩盖问题。

**访客可见文案**：中文“该页面已开启浏览器环境检查，检查通过后会自动跳转。”；英文“This page has browser environment checks enabled. You will be redirected automatically once the check passes.”。标题、错误提示与noscript也不解释检测信号、比对算法或具体采集项；管理GUI的误拦警告、安全说明与站点隐私用途说明仍应保留。脚本和表单字段当然仍可被浏览器查看，通用提示不是隐藏源码或可信设备证明。

### 0.0.1 浏览器时区与疑似 VPN 控制（沿用 v1.1.2）

**功能首次引入于v1.1.2的 `0004_browser_checks.sql`，本修复不新增SQL；升级必须按目标库清单应用全部待应用迁移，不能假设0003已完成。** 只增加 `block_vpn`（默认0）并扩展规则修订触发器，不清库、不重建Owner、不清计数、不更换密码。旧链接默认不拦截VPN；但配置生成器默认启用全局浏览器时区采集，访问流程因此变化。

> **无法保证拦截全部 VPN 用户，并且会存在错误拦截。** 浏览器时区是客户端自报，不是可信证明；IP定位不精确、旅行或手动时区会造成误拦，同一时区的代理也可能不被发现。不要把该功能当成身份认证、位置合规或唯一安全屏障。

#### 新行为与字段

| 配置 | 默认/作用 |
|---|---|
| `browser_timezone_enabled` | 默认true；两端生成 `BROWSER_TIMEZONE_ENABLED`。正常GET先经过轻量HTML，执行JavaScript采集真实浏览器设置时区 |
| 单链接 `block_vpn` | 默认0/false；为true时拒绝Cloudflare Tor及有效时区不一致的访问；即使全局采集关闭也必须检查 |
| `BROWSER_CHECK_SECRET` | 两端同值的独立部署secret，32随机字节base64url。签名120秒挑战/证明，不写入vars、D1、KV或源码；未配置而需要采集时返回503 |
| 原 `LINK_PASSWORD_SECRET` | 原样保留；两类secret不要混用，本版无需重新设置已有链接密码 |

JavaScript使用 `Intl.DateTimeFormat().resolvedOptions().timeZone`；IP参考值独立读取 `request.cf.timezone`；Tor只看Cloudflare可信元数据 `request.cf.country === 'T1'`。不信任客户端普通 `CF-IPCountry` 头、查询参数、UA字符串或客户端声称的Tor状态。Cloudflarecountry值与CF-IPCountry国家值对应，T1是其Tor标记。[Cloudflare Request](https://developers.cloudflare.com/workers/runtime-apis/request/) · [Cloudflare Tor国家代码](https://developers.cloudflare.com/fundamentals/reference/http-headers/) · [浏览器Intl API](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/resolvedOptions)

两种时区均由服务端同一Intl实现校验/规范化（在运行时支持时减少US/Eastern等别名误判，别名合并依赖部署Intl实现，仍可能误拦），按**时区标识**比较，不按当天UTC偏移比较。不同IANA时区即使当前偏移相同仍可能被判不一致。Tor优先于时区；缺失/无效值是“无法判断”，不是“已发现VPN”。

#### 访问顺序（不是直接301中插入JavaScript）

```text
公开GET → 原限流、D1/KV安全gate、启停/到期/额度
        → 启用block_vpn且Cloudflare T1：403终止
        → 有密码则先密码页/站内解锁303
        → HTML时区采集页（200，无目标地址/正文）
        → 同源POST /__Linro_browser/<slug>，只提交签名challenge及浏览器timezone
        → 检查来源、120秒签名、链接修订/主机/查询/当前网络元数据
        → 允许：脚本收到200 JSON {ok:true,data:{next}}及HttpOnly短期Cookie
        → location.assign(next)发起到同一短链的普通导航（不是表单导航链）
        → 最终GET重新读D1、验证证明/最新规则，再占额并返回目标3xx或纯文本200
```

浏览器脚本是同源 `/__Linro_assets/browser.js`，无内联脚本、无eval、不加载第三方。采集页、采集POST的JSON 200、内部303、脚本/CSS都不占短链额度或成功统计。原密码POST来源修复保持；显式外站/错端口/错协议 Origin 永远拒绝，后台 Access 会话的 CSRF 严格校验没有改变。新POST也只接受精确同源或`Origin:null`配合`Sec-Fetch-Site:same-origin`；矛盾/缺失来源失败关闭。

**D4/F1提交方式**：脚本只向本页同源的`form.action`发送`POST`（urlencoded challenge/timezone、`Accept: application/json`、same-origin凭据、manual重定向、no-store）。允许时服务端200 JSON只含原短链的相对next路径、无目标地址/正文，附同一签名Cookie；客户端验证next同源、同短码和单一完成标记后用`location.assign(next)`普通导航。两种响应都保留CSP、no-referrer和no-store。不带有效JSON Accept的旧表单仍303，同源验证、密码、签名、策略与拒绝分支完全共用。

**无JavaScript/失败回退**：开启block_vpn时必须有JavaScript、Cookie和可比较信息才能通过；缺值继续403（信息不足单列，不直接标VPN）。全局采集开启但未block时，旧表单允许缺时区并记none，但**不保证浏览器能够跟随表单链的最终跨域跳转**，不能再宣传“无JS也能正常跳转”。全局false且未block的链接仍可直接301/文本；这才是非JS客户端的兼容路径。

网络故障、协议/JSON不符时，脚本最多尝试一次原表单回退；此回退仍可能被Chromium的form-action阻止，不能当作F1已完成。明确的4xx/5xx（含403/429）仅显示通用失败文本，不自动二次POST、不重复记录拒绝事件；这是比报告简化catch片段更窄的回退策略。请求等待预算10秒，不能通过重复提交/循环导航绕过保护；Cookie被禁或证明失效则回到原短链重试。生产要求HTTPS与平台IP元数据，配置缺失失败关闭。

**HEAD**：未拦截的链接保留原HEAD直接响应语义（成功占一次额度，但不记AE）；拦截开启时，无有效证明HEAD为403、无Location/正文/额度，不能通过HEAD泄露目标。手动API/curl和预览机器人不能自动执行采集页；它们可能看到200 HTML而不是旧301/纯文本，不能把HTML200当成目标内容。需要旧非浏览器兼容模式时可将全局采集设false，但单链`block_vpn`不会因此关闭。

浏览器证明绑定链接ID/修订、主机、清理内部参数后的查询摘要、当前平台IP与地理元数据的短期HMAC摘要；不暴露预期IP时区、原始IP、目标或密码。挑战120秒，签发证明不续期；最终响应清除Cookie。纯文本最终地址含内部完成标记，刷新该地址在Cookie已清除后会提示原短链重试；重新打开最初不含标记的短链可重新采集。它**不是服务端消费型一次性凭据**，有效窗口内仍可重放，无法阻止客户端伪造自报信息；每次最终请求仍通过D1和严格额度更新。IP改变/规则修改后需重新检查。已授权在途响应不能被事后撤回。

启用采集或拦截时强制no-store，KV仍只缓存路由规则；拦截旗标和所有权限取当前D1，不缓存浏览器时区、证明或计数。无法撤回用户此前缓存的旧301。额外HTML、JS、POST及后续导航增加请求/延迟；保护页也消耗Workers/WAF/IP限流额度，不能承诺零成本/无感延迟。时区及短期证明的用途应在站点隐私说明告知。

#### 部署和升级顺序

1. 保留原数据库、有效锁文件、真实`deployment.json`和原`LINK_PASSWORD_SECRET`。先核对`migrations list --remote`，备份后应用**全部待应用迁移**（例如目标库只有0001/0002时须依次补0003/0004），不要销毁重建。第一阶段可显式设置`browser_timezone_enabled:false`，原链接`block_vpn=0`保持直接响应，避免新secret尚未配置时普遍503。
2. 按第2节仅同步锁文件根版本（依赖版本未升级），`configure → preflight → toolchain:versions → check → test → test:runtime → build → test:browser → deploy:dry-run`。任何失败都停止。先在维护窗口迁移，再更新两个Worker；两端不是原子操作，期间不要开启新策略。
3. **仅首次启用且没有BROWSER_CHECK_SECRET时**，在私有终端生成一次新root并将同一值写到两端、存入密码管理器；已有实例保留两个原root，不要重新生成。

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
npx wrangler secret put BROWSER_CHECK_SECRET --config apps/admin/wrangler.jsonc
npx wrangler secret put BROWSER_CHECK_SECRET --config apps/redirect/wrangler.jsonc
```

`secret put`会发布新Worker版本，需按第7节探活；preflight只校验本地配置，**不能证明远程两端secret一致**。当前签名只在Redirect产生和验证，Admin只检查配置存在性；两端同值是部署约定，不是跨Worker实测。若同一公开端不同处理版本使用不同值，则挑战/证明校验失败。轮换浏览器root会使短期浏览器证明失效，但不改变D1链接密码校验值；原密码root仍不可随意轮换。

4. **仅需要全局采集时**才设`browser_timezone_enabled:true`并重新configure、检查、部署和探活；已选择false且只使用单链接block_vpn的部署继续保留false。GUI创建/编辑链接中的“禁止疑似VPN用户访问”可单独勾选，页面显示误拦/漏拦说明；列表有策略标记。只设置该策略不会更改地理分流、正文或配额。JSON/CSV导入导出包含`block_vpn`，错误类型拒绝而非静默移除保护。
5. 用真实Chrome/Edge分别测试匹配、不匹配、无JS/无Cookie、密码后检查、文本、HEAD和选定链接统计。Tor需真实Cloudflare T1流量验收，不能用自行加普通header的curl冒充平台标记。原生工具/浏览器本地失败不能标成验收通过。

可对新POST `/__Linro_browser/*` 独立配置边缘按IP的WAF速率限制，额度应考虑正常采集请求；不把它并入严格5次/分的密码尝试桶导致正常访问误伤。保留第0.3.1节原密码WAF规则和原应用限流，任何新规则须按账户计划验证，不自动调用云端修改。

**回退警告：旧v1.1.1及以前Redirect不识别block_vpn，会绕过新策略。** 已启用拦截后不得裸回退旧公开端；先维护/阻断流量并评估替代控制。0004无需为了回退而删除字段、清表或重建Owner。

### 0.0.2 纯文本短链接

GUI 创建/编辑 → 返回方式 → **纯文本 / Plain text**，填写正文后保存。此时目标URL、地理分流、查询透传不适用，GUI不要求填写这些字段。访问成功返回 **200 + Content-Type: text/plain; charset=utf-8 + nosniff**，无Location，正文按文本原样返回，不解析HTML/Markdown或执行JavaScript；不是对目标URL发起fetch，也不是把URL作为返回内容。

正文为1–16384个UTF-16代码单元，且最多32768个UTF-8字节；保留首尾空格、TAB、CR/LF，拒绝非法控制字符/无效Unicode。普通短链默认继续HTTP跳转。文本模式始终no-store（包括CDN），**正文不写KV**，读D1；已有旧KV命中仍受D1的模式/版本/修订校验，不能用旧跳转覆盖文本。

密码、启停、到期、归属/版本锁及次数上限继续生效。未解锁密码页不显示正文；只有最终授权的文本200才计成功访问；启用浏览器采集时最初响应是HTML200，不是文本内容。**设置上限时成功GET/HEAD各占一次，AE成功访问仅记录GET**；失败/密码页/内部303不计成功。新VPN/未知拦截另有double1=0的拒绝事件。普通修改保留已用次数，必须明确重置才清零。正文修改和模式切换撤销旧cookie。

GUI导入保持原文件2 MiB/5000条上限；按最多10条、JSON编码后256 KiB自动分批，避免多条长正文使一个批次超过API上限。任何单条编码超限会在发送前报错，不放宽服务端请求上限。每批原子提交，后续失败不回滚已提交批次。

正文可以被已授权的团队读取成员查看，也会包含在GUI JSON/CSV和D1备份中；不记录到审计明细、KV或Analytics Engine。请勿把导出当作无敏感数据的公开文件；audit:links仅提示正文存在而不输出正文。不要存放需要独立权限隔离的密钥。脚本API详见docs/API.md；直接API切换到text时必须显式清除旧geo_rules，否则拒绝冲突而非默默保留分流。

### 0.1 行为概览

| 功能 | 默认与配置入口 | 安全边界 |
|---|---|---|
| KV 加速 | `redirect_cache_namespace_id` 为空：D1-only；配置 namespace：两端绑定 `REDIRECT_CACHE`，KV-first + D1 fallback | 命中时也向 D1 主库核对版本、规则修订、密码、剩余次数、域名启停与目标是否成为受管短域名；D1 异常不从旧 KV 放行 |
| 智能分流 | 创建/编辑短链 → 高级选项；默认无规则 | 国家优先于大洲，均不匹配回到 `target_url`；只读取 `request.cf.country` / `request.cf.continent`，不用访问者可伪造的普通头或查询参数 |
| 访问密码 | 默认无密码；使用前两端设置同一个 `LINK_PASSWORD_SECRET` | 存储带盐、服务端 pepper 的 PBKDF2 校验串；明文及校验串不进入 GUI 响应、导出、KV 或审计；受限流的站内 POST 解锁 |
| 请求次数上限 | 默认无限制；`max_redirects` 为 1–1000000000 的整数或 null | 每次最终获准的 GET/HEAD 跳转或文本200使用 D1 原子条件更新；不通过 KV 或 Analytics Engine 计数 |
| 浏览器时区与疑似VPN | 全局采集默认true；单链接block_vpn默认false | 客户端自报不可信；需新BROWSER_CHECK_SECRET；漏拦、误拦均可能 |
| 客户端缓存 | 普通旧链接保留 `cache_ttl`；启用上述任一逐次访问控制时强制 no-store | 无法撤销客户端在升级/加密码之前已经缓存的 301/308；不要给需撤销的敏感链接提前开启缓存 |

本版仍保留 v1.0.2-fix 的目标/参数/归属加固：默认 discard；merge/replace 只转发部署白名单；所有地理目标与默认目标均须通过 HTTP(S)、私网例外、后台/受管域名及敏感参数检查。Editor 与所有应用令牌仅能修改所属用户创建的链接；交互式 Owner/Admin 保留团队管理权限。团队读取仍共享，地理分流和链接密码都不是后台认证替代品。

### 0.2 可选 KV：按绑定自动工作

**无绑定就是 D1-only，不要求安装 KV，不需要伪造一个空 binding。** 第 6 节模板默认 `redirect_cache_namespace_id: ""`。首次部署可不启用 KV，正常创建和跳转不受影响。

准备启用时，先按照第 3–6 节填写真实账户并生成配置，然后在该账户创建一次专用 namespace（云端资源操作）：

```bash
npx wrangler kv namespace create REDIRECT_CACHE --config apps/redirect/wrangler.jsonc
```

把命令返回的 **32 位 namespace ID** 填入 `deployment.json` 的 `redirect_cache_namespace_id`；不要填 namespace 标题、Account ID 或 D1 ID。两个 Worker 使用同一个 namespace，由生成器自动绑定，无需分别建两个。

```bash
npm run configure
npm run preflight
npm run check
npm test
npm run test:runtime
npm run build
npm run deploy:dry-run
```

全部通过后按第 7 节发布。设置页显示绑定是否配置，**不是实测 KV 连通性/命中率仪表盘**。关闭 KV 时将 namespace ID 改回空字符串，重新生成并部署两端；不会删除 D1 数据。旧 KV 无需作为备份恢复。

缓存实现细节：

- 键由规范化主机名和大小写敏感短码组成；多域名同名短码相互独立，缓存内容是规则而非最终 HTTP 响应。
- TTL 默认 300 秒，`redirect_cache_ttl` 范围 60–86400 秒。记录内的截止时间还受链接到期时间限制；不会依赖平台 TTL 及时删除来判定链接有效性。
- KV 空值、格式错误、过期、读取报错或超过 200ms 的应用等待预算时回落 D1；写入/清理失败不使已经成功的业务事务回滚。写缓存经 `waitUntil` 尽力完成，不保证每次写入成功。
- D1 写入与审计先原子提交，再回填/清理 KV。陈旧版本、删除、启停、密码和上限变更由**每次 D1 主库 gate**兜底，不承诺 KV 清理全球即时生效。
- 单次缓存查找命中有一条精简D1 gate；未命中/D1-only为规则读取加目标策略查询。浏览器流程在初始GET、POST和最终GET重新取规则，最终无限额响应另有一次D1确认，有限额则用原子UPDATE占额。读时陈旧版本会额外回落。这里是代码路径说明，**没有实测跨地区延迟或省费比例承诺**。
- 不缓存密码、配额计数和未知短码；不会把国家 A 的最终 Location 当作国家 B 的响应缓存。KV 包含业务目标 URL，应使用私有专用 namespace 和最小权限，不公开列表/读取接口；具备 KV 写权限仍属于可信部署边界，不能把它视为可由不可信用户编辑的配置。

Cloudflare KV 为最终一致读模型，删除/更新及负缓存可滞后，不能充当权限或严格计数的唯一真相。D1 读 gate 不使用 Sessions API 的副本路由；本项目直接 `DB.prepare` 的查询走主库，不应改成不受约束的副本读取。[KV 一致性](https://developers.cloudflare.com/kv/concepts/how-kv-works/) · [KV 绑定](https://developers.cloudflare.com/kv/get-started/) · [D1 主库与副本](https://developers.cloudflare.com/d1/best-practices/read-replication/)

### 0.3 访问密码：首次配置与使用

密码为链接访问控制，不是 Cloudflare Access 登录密码。每条链接可设置不同密码，长度 **12–128 字符**，不允许控制字符；不自动 trim，首尾空格属于密码。建议在密码管理器生成并通过独立可信渠道分发。

首次启用前，在自己的私有终端生成一次 32 字节随机根 secret：

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

保存生成值到密码管理器，**以下两次提示输入同一个值**，不要各自重新生成。不要粘贴到公开工单、README、`deployment.json`、Wrangler vars 或代码仓库：

```bash
npx wrangler secret put LINK_PASSWORD_SECRET --config apps/admin/wrangler.jsonc
npx wrangler secret put LINK_PASSWORD_SECRET --config apps/redirect/wrangler.jsonc
```

Wrangler `secret put` 会立即创建/部署新 Worker 版本。首次新实例先发布未设置访问密码的基础服务，再写入两端 secret，确认均生效后才创建带密码的链接。已有实例保留原 secret；变更应安排维护窗口，不能认为两次 secret 操作是原子发布。`preflight` 不能读取远程 secret 来证明两端一致。[官方 secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

浏览器流程：公开 GET 先返回双语密码页（200，不含目标地址）；错误密码 POST 为 401；正确密码 POST 返回 **303 至本域同一短码**并设置 HttpOnly、Secure、SameSite=Lax cookie。随后 GET 再次通过最新 D1 配置；需要浏览器时区采集/拦截时继续第0.0节检查，最终才返回301/302/307/308或纯文本200。密码不会出现在 URL，也不会因 307/308 被提交到目标网站。Cookie 按链接 ID、主机和规则修订绑定，最长 15 分钟；编辑链接会使旧授权失效。HEAD 未授权时同样不会得到目标 Location。

后台“保留密码 / 设置新密码 / 移除密码”明确分开：编辑时空输入不会意外清除旧密码。生产缺 secret、HTTPS、必要密码限流绑定或校验记录无效时失败关闭，不降级为公开链接。POST 必须同源，使用独立的 `PASSWORD_LIMITER`，默认运维说明为“**同连接内 5 次/分，跨连接不保证**”；`password_rate_limit` 可设 1–30，namespace 默认 21004，与其它三个限流 namespace 不同。公开 REDIRECT_LIMITER 仍先运行。分布式攻击、平台 CPU 与账户额度仍须外层防护，密码计算不是免费操作。

存储使用 PBKDF2-SHA256（100000 次）+ 每条随机盐 + 独立 secret HMAC pepper，并用不同用途标签签名 cookie；该参数针对目标运行时兼容性选择，不能代替强密码、pepper 保管及暴力尝试限制。原生 crypto 兼容性由 `test:runtime` 验证；**没有通过时不得删检查或降低参数来部署**。

**根 secret 必须与数据库备份配套保存。** 它不在 D1 SQL 备份中；随意轮换/丢失会让现有密码校验失败，而不仅仅是 cookie 失效。正确轮换需维护窗口并给受影响链接重新设置密码，没有自动重新加密/恢复明文功能。未启用密码功能的部署可不设置此 secret。


### 0.3.1 密码POST的外层WAF速率限制（建议启用）

**建议：在 Cloudflare 上给 POST /__Linro_unlock/* 加一条 WAF 速率限制规则（边缘级按 IP，不受 isolate 计数影响）。** 它在Workers代码之外计数，不依赖当前isolate或连接是否复用，作为PASSWORD_LIMITER之外的纵深保护；不是移除应用限流、密码校验或同源检查的理由。

上述“同连接内 5 次/分，跨连接不保证”按用户指定作为保守运维提示保留，**不是本次对跨连接行为的生产压测结论，也不是Cloudflare按连接严格计数的官方保证**。应用仍按IP哈希调用Workers binding，而不是自行建立连接ID计数器。官方将Workers限流描述为位置级、机器本地缓存、异步更新的尽力计数；并不提供严格准确配额。WAF独立于isolate，但仍有数据中心/地理位置维度，不是全球单一原子计数器。[Workers限制](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) · [WAF计数模型](https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/)

在公开短链域名所属Zone，进入 **Security → Security rules → Create rule → Rate limiting rules**（控制台名称按实际版本），为所有公开短域名设置匹配条件。示例表达式中的主机名需要替换：

```text
(http.host in {"go.example.com"}
 and http.request.method eq "POST"
 and starts_with(http.request.uri.path, "/__Linro_unlock/"))
```

计数特征选择**IP（ip.src）**，不要把slug、完整URI、Cookie、User-Agent或连接端口加入计数键；这样同IP在不同短码的密码尝试共享额度。通过Rulesets API创建时必须保留平台要求的cf.colo.id维度；不要删除它来伪装全球计数。计数所有匹配POST，而非仅上游401，才能在进入密码哈希计算前生效。

若账户支持该周期，可从**每IP 60秒5次、Block、缓解60秒**开始，按NAT共享用户与误伤实测调整；不同计划允许的匹配字段、周期、阈值、动作不同，**不能承诺免费计划支持这个精确组合**。以控制台允许的参数和WAF文档为准，不通过关闭WAF或伪造配置“对齐”说明。规则应覆盖公开主机，不能误包含后台API、GET密码页、CSS或health，不改变Access整域名保护。[创建规则](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/) · [参数与计划条件](https://developers.cloudflare.com/waf/rate-limiting-rules/parameters/)

上线验收使用专用测试链接、获授权测试IP，确认安全事件记录命中这条具体规则；分别检查连接复用和重新连接的尝试，观察WAF拒绝，而非只观察Worker内429。不要记录密码正文、Cookie或IP到公开证据。验证后删除测试链接，记录规则ID/阈值/周期/动作；共享出口误伤时人工调整，不能把任何单次测试称为全球严格保证。本源码交付不自动调用Cloudflare账户创建规则。

### 0.4 智能分流：国家优先，再大洲

创建/编辑短链的高级选项可添加最多 32 条规则。每条选择“国家 / Country”或“大洲 / Continent”，填写地区代码和完整 HTTP(S) 目标。国家使用两位大写代码，例如 CN、JP、US；语法会校验但不提供完整 ISO 国家名词典，请核对真实代码。大陆代码：AF 非洲、AN 南极洲、AS 亚洲、EU 欧洲、NA 北美洲、OC 大洋洲、SA 南美洲。同类型同代码不可重复。

示例：国家 JP → 日本站；大洲 AS → 亚洲站；欧洲 EU → 欧洲站；默认目标 → 全球站。日本访客始终命中国家规则，亚洲其他访客命中 AS；没有位置/未知位置不匹配时使用原 `target_url`。Cloudflare 特殊国家值 XX/T1 不匹配国家规则；若仍有有效大洲信息，可命中大洲规则。

规则不按添加顺序抢占；优先级固定 **国家 > 大洲 > 默认**。仅使用 Cloudflare 的 `request.cf`，不调用外部 IP 库、不接受 `country=JP` 或访客伪造 `CF-IPCountry`/XFF 改目的地。VPN/代理出口可能改变平台看到的地理位置，因此不是地区身份验证、合规判定或访问控制。所有默认/备用目标都在写入时校验，最终选择的目标还会在跳转时复检；参数策略对每个目标一致应用。[Cloudflare Request 元数据](https://developers.cloudflare.com/workers/runtime-apis/request/)

### 0.5 次数上限、计数口径与错误文本

设置 `max_redirects` 为正整数；留空/null 表示无限制，**0 不是无限制**。计数从新增上限后的受限跳转开始；无限制期间不写点击计数，旧 Analytics Engine 历史不会转换为配额。取消上限时暂停计数并保留原值；重新启用沿用该值。编辑 URL、密码、地理规则、启停或调高/降低上限不会自动清零；明确勾选“重置已用次数”/PATCH `reset_redirect_count:true` 才会清零，并记录审计。

“成功跳转”定义为本 Worker 完成验证与原子占额、获准返回**目标 Location 的301/302/307/308，或纯文本模式200**；GET 和 HEAD 都消耗一次，避免通过 HEAD 获取 Location 却绕过限额。密码页、错误密码、内部解锁 303、401/403/404/410/429、目标校验失败及一般提交前异常不计数。达到上限时返回 **HTTP 403**、no-store、无 Location：

```text
简体中文：此链接请求次数已到达上限，请联系管理员
English: This link has reached its request limit. Please contact the administrator.
```

密码页和次数耗尽文本按照 `Accept-Language` 选择语言（未知语言回退 English），也可用短码查询 `_Linro_lang=zh-CN` 或 `_Linro_lang=en` 明确选择。此内部参数不会透传给目标；响应带 Content-Language 和 Vary，HEAD 始终无响应体。403 表示永久性业务配额耗尽，不与短期 IP 限流 429 混淆。

计数用 D1 主库的单条 `UPDATE ... WHERE redirect_count < max_redirects ... RETURNING`，同时匹配链接版本、修订、启用、到期与域名状态。并发请求不会因“先 SELECT 再无条件加一”突破上限；KV 陈旧计数、浏览器缓存或 AE 抽样不参与决策。**每次受限成功跳转增加一次 D1 行写入**；读写配额和热点主库吞吐须按实际计划验收，未作容量承诺。

**不能保证“最终用户确实打开了目标站”的精确一次统计。** Worker 看不到用户是否收到响应、是否跟随跳转或目标站是否返回 200。若数据库已提交但网络丢失提交确认，或进程在提交后终止，可能保守地消耗一次而客户端只收到错误/未收到响应。本版不重试不确定提交、不放行未确认配额；不能通过退款计数去冒险突破上限。这里是服务器授权计数，而非终端送达证明。AE成功访问仍只记录GET，与GET+HEAD原子额度不是同一口径；另有独立VPN/未知终止拒绝事件，不计入成功访问。

### 0.6 从 v1.0.2-fix 升级的执行顺序

**先查看目标库的`migrations list --remote`，应用全部待应用迁移；不要根据所称版本或changelog假定前置状态。** 示例：实际只有0001/0002时补0003/0004，已有完整0001–0004时不重跑；这些是迁移记录条件，不是版本号推测。 新增内部路径保留 `__Linro_` 前缀；旧版若使用此类短码，须先运行审阅脚本处理冲突，升级后不会再公开解析它们（不自动改名）。0001 原样保留，0002 只新增字段和规则修订触发器，旧链接默认无分流/无密码/无限额，原 Owner、归属、默认302、链接目标与审计不重置。保留原库，不清库/重建 Owner/重新播种。

先备份生产 D1 和私有配置，停止本项目本地开发进程及其子进程，安排双 Worker 更新维护窗口。将真实 `deployment.json`、已验证 `package-lock.json`、已有 Cloudflare secret 和整个 `.local/`（仅开发）保留；不要复制旧 dist/.build。按第 2 节只同步锁文件根版本，按第 6 节生成两端新配置，再完成全部检查：

```bash
npm run configure
npm run preflight
npm run check
npm test
npm run test:runtime
npm run build
npm run deploy:dry-run
```

在维护窗口确认账户与库，先应用远程新迁移，再部署两端：

```bash
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
npm run db:migrate
npm run deploy
```

不要把迁移加入未加保护的自动前端构建。`deploy` **不自动创建数据库，也不自动执行迁移**，两端发布**不是原子操作**。新代码搭配旧库会失败关闭；旧 Redirect 代码不会识别新密码/配额字段，因此在两端尚未都升级完成前不得通过新 Admin 启用新功能。

**启用新控制之后不能回滚到 v1.0.x Redirect**，否则旧代码会忽略密码、次数与分流。安全回退应在维护窗口保留拒绝入口，修复/重建本版；确需整体恢复旧版时按第 14 节使用匹配的旧 SQL 备份和原 secret、验证受保护链接处理方案后切换。不能只回滚 Worker 或执行 DROP COLUMN 当作无损回退。

上线至少验证：旧链接与权限不回归；两种 KV 绑定模式；陈旧 KV 后加密码/降低上限/删除不能绕过；国家、大洲、未知位置；密码错误/正确、改密撤销、HEAD 不泄露目标；受限链接的并发最后一个名额；耗尽中英提示；导入导出与双语 GUI；D1/绑定异常失败关闭。并发验证只在自己的本地或隔离验收实例进行，不能对生产做配额耗尽压力测试。`test:runtime` 的工具缺失不是跳过通过；实际云端验收仍需部署者完成。

### 0.7 导出、只读审阅与本地开发

JSON/CSV 导出包含地区规则、password_protected 布尔标记、max_redirects 与当前 redirect_count，但**不包含访问密码或 password_hash**。重新导入只恢复非秘密规则和上限，从0计数；受密码保护的导出行必须逐条提供新的 password，GUI 拒绝静默转成无密码链接。完整还原用 D1 SQL 备份 + 原 LINK_PASSWORD_SECRET，不把“业务导入”当作安全状态备份。HTTP API 只接受可写字段，直接把包含 id/count/protected 标志的完整导出行 POST 会被严格拒绝，请按 [API 文档](docs/API.md) 转换。

只读审阅（本地文件，无网络、无 SQL 写入）：

```bash
npm run audit:links -- --input private-export.json --config deployment.json
```

会同时复核默认/地区目标、敏感参数、大小写短码、新保留前缀 `reserved_control_namespace`、显式缓存及受保护导出提示；退出2表示人工复核，不是自动修复。输出不含目标 URL 或密码；缺字段或超出导出范围不等于完整数据库审计。

本地默认 D1-only：`npm run local:init`。需要本地 KV 路径：

```bash
npm run local:init -- --kv
npm run db:migrate:local
npm run db:seed:local
npm run build
npm run dev:admin
```

另开终端 `npm run dev:redirect`。两个本地 Worker 同用 `.local/state`；初始化保留已有开发令牌、LINK_PASSWORD_SECRET 与状态，没有 secret 时只为本机新增随机值。密码 root 保存在 `.local/.dev.vars`，不要对外公开或复制到生产；以无 `--kv` 方式重新初始化切回本地 D1-only，不清本地数据库。Cloudflare `request.cf` 的真实地理行为须在云端验收，本地开发没有生产 IP 定位保证。

<a id="deployment-model"></a>
## 1. 部署方式和资源边界

### 1.1 推荐结构

```text
公开访客
  └─ https://go.example.com/<slug>
       └─ linro-redirect Worker
            ├─ DB → 正式 D1（规则与安全查询；受限链接原子计数写入）
            ├─ REDIRECT_CACHE → KV 路由缓存（可选，命中仍有 D1 gate）
            └─ ANALYTICS → Analytics Engine（可选）

管理员
  └─ https://admin.example.com
       └─ Cloudflare Access（整域名）
            └─ linro-admin Worker（再次验证 JWT、角色和权限）
                 ├─ ASSETS → React GUI 静态资源
                 ├─ /Linro/v1/* → D1
                 └─ 统计查询 / Cron 归档（可选）
```

**这是两个 Worker + 一个共享 D1，不另建 Pages 项目，不需要 VPS、Tunnel 或长期运行的本地 Node 服务。** 本机只用于安装、构建、部署和运维。关掉本地开发进程不影响已经部署的 Worker。

| 项目 | 本项目固定名称 / 作用 |
|---|---|
| Admin Worker | `linro-admin`，绑定后台域名，提供 GUI 与 API |
| Redirect Worker | `linro-redirect`，绑定一个或多个公开短链域名 |
| D1 binding | 两端都叫 `DB`，必须指向同一正式 Database ID |
| 静态资源 | `apps/admin/dist/`，binding 为 `ASSETS` |
| 后台认证 | Access + Worker 自身 JWT 校验；不是项目内用户名密码 |
| 本地开发目录 | `.local/`，仅用于开发，绝不作为正式配置上传 |

配置生成器固定使用上述两个 Worker 名称。**同账户已有同名 Worker 时，部署可能更新现有应用**，上线前核对所有权和用途。本版没有多环境模板；不要随意加 `--env production`，也不要用相同名称把第二套测试实例覆盖到生产。

### 1.2 准备这些条件

你需要有权限管理目标 Cloudflare 账户、一个状态为 Active 的域名区域，以及可用的 Workers、D1 和 Cloudflare Access。推荐使用独立的后台子域名 `admin.example.com` 和公开子域名 `go.example.com`，不要占用已有官网或邮件相关主机名。

本项目使用 **Custom Domains**：Worker 本身就是源站，部署后 Cloudflare 按该机制创建相关 DNS / 证书。不要套用传统源站 Route 教程去建立假 IP，也不要给主机名添加 `/*`。已有 CNAME、其他 Worker 或网站绑定可能冲突；先确认现有业务，再迁移或换一个未使用的子域名，不盲目删除记录。[官方：Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

Workers、D1、Access、Analytics Engine 的可用性与费用分别以账户实际计划为准，不假设购买某个站点套餐就包含全部开发者服务。本项目不会自动购买套餐，也不承诺永久免费。[Workers 计划与计费](https://developers.cloudflare.com/workers/platform/pricing/) · [D1 计费](https://developers.cloudflare.com/d1/platform/pricing/)

### 1.3 操作纪律

以下命令均在**解压后的项目根目录**执行，除非明确要求进入另一个目录。示例域名与 ID 必须替换成你的真实值。每个命令成功后才进入下一步；出现非零退出码、错误或意外目标账户时停止。

`npm test` / `npm run build` 是本地检查；`d1 create`、带 `--remote` 的迁移/导入、`deploy` 和 `secret put` 会操作云端。`deploy:dry-run` 不发布服务，但不能替代线上身份、DNS/TLS 和数据库验收。

<a id="prepare"></a>
## 2. 解压、锁定依赖并构建

### 2.1 验证交付包

在压缩包所在目录核对外部 `Linro-v1.0.1-SHA256SUMS.txt`。PowerShell 示例：

```powershell
Get-FileHash .\Linro-v1.0.1.zip -Algorithm SHA256
Expand-Archive .\Linro-v1.0.1.zip -DestinationPath .\Linro-release
Set-Location .\Linro-release\Linro-v1.0.1
```

将哈希与校验文件中 ZIP 对应行比较；不要把不同文件的哈希互相比对。Linux / Bash：

```bash
sha256sum -c Linro-v1.0.1-SHA256SUMS.txt
# 该命令需要校验文件中列出的全部交付件均在当前目录。
tar -xzf Linro-v1.0.1.tar.gz
cd Linro-v1.0.1
sha256sum -c MANIFEST.sha256
```

Windows 也可在解压根目录校验内部清单：

```powershell
Get-Content .\MANIFEST.sha256 | ForEach-Object {
    if ($_ -notmatch '^([a-f0-9]{64})  (.+)$') { throw "Invalid manifest entry" }
    $ExpectedHash = $Matches[1]
    $RelativePath = $Matches[2]
    $ActualHash = (Get-FileHash -LiteralPath $RelativePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualHash -ne $ExpectedHash) { throw "Checksum mismatch: $RelativePath" }
}
```

应在修改版本锁文件、配置或源码**之前**校验。之后这些文件的哈希变化属于预期，不要修改旧清单来冒充原包未变。

### 2.2 使用已验证的 Node 与依赖

```bash
node --version
npm --version
```

项目声明 Node.js `>=22.16.0`；历史用户报告中实际通过的环境为 Node.js **22.23.2** / npm **10.9.8**。测试用 `node:sqlite` 的实验性警告本身不是失败。Worker 运行不依赖本地 SQLite。

**保留并私下备份你本机已验证的 `package-lock.json`。** 用户只提供报告、未提供锁文件，本交付不伪造完整依赖锁。继承v1.1.0-fix按报告D1建议固定的Wrangler版本 **`4.132.0`**；选择依据为报告所核验的版本和上游包元数据，而非宣称本环境已跑通其原生测试。预期其捆绑 **Miniflare 5**，实际小版本、workerd 和 esbuild 必须由命令打印并保存，最终以你的锁文件及测试为准。

复制旧锁文件后，可以先同步本项目根版本元数据（不改变任何锁定依赖）：

```bash
node -e "const fs=require('node:fs');const f='package-lock.json';const p=JSON.parse(fs.readFileSync('package.json','utf8'));const l=JSON.parse(fs.readFileSync(f,'utf8'));if(p.name!=='linro'||!['cf-links','linro'].includes(l.name)||!l.packages||!l.packages['']||!['cf-links','linro'].includes(l.packages[''].name??l.name))throw new Error('Invalid lockfile');l.name=p.name;l.version=p.version;l.packages[''].name=p.name;l.packages[''].version=p.version;fs.writeFileSync(f,JSON.stringify(l,null,2)+'\n');"
```

**上述 Node 命令不是升级 Wrangler 的命令。** 为把已有锁文件与新的精确声明对齐，在可访问 npm 的环境执行下面的定向解析，并审查锁文件差异：

```bash
npm install --save-dev --save-exact wrangler@4.132.0 --package-lock-only --ignore-scripts --no-audit --no-fund
npm ci
npm run toolchain:versions
```

`--package-lock-only --ignore-scripts` 只用于更新锁的阶段；后面的 `npm ci` 应正常安装/准备工具链。确认 Wrangler 为 4.132.0，Miniflare 为 5.x，记录 workerd/esbuild 的实际版本；核对除工具链及其传递依赖外没有不期望的升级。若有意外变更或 API 缺失，停止并检查，不删除锁文件掩盖漂移。本项目加载器只解析项目的 Wrangler 依赖树，不自动安装、不回退全局 Miniflare，也不在工具缺失时跳过测试。

全新安装、无有效锁文件时执行 `npm install`，保存产生的真实 `package-lock.json`，再执行 `npm run toolchain:versions`；后续使用 `npm ci`。固定 Wrangler 顶层版本不等于已经锁定整个传递依赖图；不要用 `npm update` 或 `npm audit fix --force` 作为部署步骤。

### 2.3 重新构建本版

```bash
npm run check
npm test
npm run test:runtime
npm run build
npm run deploy:dry-run
```

这些命令分别执行完整前后端类型检查、Node 回归、原生 workerd 抓取、密码、KV 和 D1 配额测试、包含类型检查的完整构建和两个 Worker 的打包检查。`apps/admin/dist/index.html` 与其资源应由**本版源码**生成；不要从旧版复制 `dist/`。`.build/` 只是 Node 测试输出，Wrangler 从 TypeScript 源码打包生产 Worker。

原生测试驱动按报告方案 A 使用 Wrangler 捆绑的 **Miniflare 5 `convertV4MiniflareOptions` + `outboundService`**，不再使用已移除的 `createFetchMock` / `fetchMock`。官方转换器生成 `workers: []` 配置；测试不模拟旧 undici API。所有 `dispatchFetch` 显式 `redirect: 'manual'`，保留 301/302/303/307/308 原始响应。

原生命令顺序为：版本打印 → **1 项 API 金丝雀** → **26 项语义用例**（继承原22项，新增4项纯文本/设备运行时用例；加金丝雀共27项定义）。出站拦截按准确 URL / 方法路由；意外出站返回 599 **并在 teardown 失败**，未消费的必要拦截也失败，没有向 fixture 目标发起真实外网请求的默认路径。金丝雀失败就不会把剩余用例运行成“一片误导性的语义失败”。测试定义数量不等于本环境执行数量；实际结果见验证报告。

D2 的原生“浏览器形态”用例设置 `Origin: null` 和 `Sec-Fetch-Site: same-origin`，不是驱动了真实 Chrome。第 9 节仍要求真人浏览器验收；不能仅用 curl 自行填写 Origin 就认为覆盖导航提交。

**`npm run build:web` 只运行 Vite，不检查 TypeScript 类型，不能代替完整的 `npm run build`。** 配置模板的 dry-run 成功也不证明填入真实账户后的部署可用；第 7 节还会再次检查。

### 2.4 D3 请求头保真度与 D4 真实 Chromium 门禁

`deniedOrigins`仅含两个harness均可表达的拒绝请求；`deniedOriginsNodeOnly`保留空值与空白Origin，由Node完整断言拒绝。用户报告观察到原生HTTP层丢弃这类空头；生产`unlock-origin.ts`不改写。原生金丝雀新增回显断言：空头到达时`has=false / get=null`，而字面量null、NULL和真实Origin保留；平台行为变更会明确失败，必须重审矩阵，不能静默过滤或放宽拒绝规则。

真实浏览器测试是独立的第三层，不由HTTP 200/303/302断言替代：

```bash
npm run test:browser
```

不增加npm依赖；Node内置WebSocket驱动独立临时Chromium/Chrome/Edge配置目录。工具自动查找常见安装路径；显式指定示例：

```powershell
$env:CFL_CHROMIUM_PATH = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
npm run test:browser
```

```bash
export CFL_CHROMIUM_PATH=/usr/bin/chromium
npm run test:browser
```

仅访问本机两个不同源的测试服务，运行真实编译Worker与落盘语义等价SQLite接口；Cloudflare元数据、限流是测试输入，不是云端证明。断言四种最终重定向、密码+检查组合、纯文本、拒绝、全局关闭兼容路径；另有旧表单链负向对照，必须观察到form-action阻断，防止把“CSP未执行”误当修复成功。正向用例必须真正到达目标且无CSP违规。

CI已加入此门禁。手动部署前也必须完成，不静默skip；缺浏览器或`ERR_BLOCKED_BY_ADMINISTRATOR`应在允许本机测试的环境复验，禁止通过关闭CSP、忽略证书或绕过管理员网络策略求绿。普通环境默认保留浏览器进程沙箱；仅可信隔离root容器确有需要时可显式设`CFL_CHROMIUM_NO_SANDBOX=1`，并记录这一执行条件，不得用于日常浏览器/不可信页面。该开关不会解除CSP或管理员URL策略。没有真实浏览器通过结果时，必须如实标注未验收。

<a id="account"></a>
## 3. 登录 Cloudflare 并确认账户

在项目根目录使用本项目安装的 Wrangler：

```bash
npx wrangler --version
npx wrangler login
npx wrangler whoami
```

浏览器授权的是用于部署的 Cloudflare 登录。它与随后访问 WebGUI 的 Access 身份是两件事。检查 `whoami` 显示的账户 ID，与控制台目标账户一致；Account ID 不是 Zone ID，也不是 D1 UUID。

为了使**创建 D1 之前**的命令也明确指向目标账户，在当前终端设置账户 ID。PowerShell：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = Read-Host "Cloudflare Account ID (32 lowercase hex characters)"
```

Bash：

```bash
read -r -p "Cloudflare Account ID: " CLOUDFLARE_ACCOUNT_ID
export CLOUDFLARE_ACCOUNT_ID
```

该值不是登录密钥。首次推荐交互式 `wrangler login`，避免混淆 API Token。命令行账户必须具有目标 Workers、D1 与域名相关资源的权限；仅能读取 Analytics 的 token 不能用来部署。

生产 Worker 不应保存你的部署 API Token。若使用 CI，部署 token 只放 CI secret，按需要限制账户和区域；本仓库现有 CI **只验证与制作源码目录，不自动创建 D1 或远程部署**。

<a id="database"></a>
## 4. 创建或选择正式 D1

### 4.1 首次上线：新建正式数据库

```bash
npx wrangler d1 list
npx wrangler d1 create linro
```

先查列表避免重建已有业务库。`create` 是实际远程创建操作；记录输出中的 `database_name` 与 `database_id`。若提示是否自动改写配置，选择不自动改写，本项目第 6 节由统一生成器写两份配置，避免只绑定一端。

```bash
npx wrangler d1 info linro
```

确认数据库在正确账户。名称不是 `linro` 时，命令和后续配置中的 `database_name` 一起使用你选定的名称。不要分别给两个 Worker 创建两个数据库。[官方：D1 Wrangler 命令](https://developers.cloudflare.com/d1/wrangler-commands/)

### 4.2 已有正式数据库：保留原库

复用原 Database ID，先按第 14 节备份，不执行重新建库或种子导入。`0001_initial.sql` 保持原样，**以目标库的migrations list --remote为准，应用全部待应用迁移；实际仅0001则补后续全部，实际0001/0002则补0003/0004，不按版本名称猜测**。保留原库和已有数据，不清库、不重建 Owner；迁移顺序见第 0.6 节。

本地测试库 `.local/state/` 不会自动同步到远程 D1。首次正式部署应从新的正式 D1 开始，仅按第 12 节选择性导入业务链接。**不要把本地 SQL 全量导入生产来保留本地 Owner**，本地 `access_sub` 与正式 Access 身份不兼容。

<a id="access"></a>
## 5. 先保护整个后台域名

### 5.1 建立 Access 应用

在 Cloudflare 控制台进入 **Zero Trust → Access controls → Applications**（旧界面可能显示 **Access → Applications**），创建 **Self-hosted / Self-hosted and private** 应用，添加公开主机名。

| 设置 | 本项目的填写方式 |
|---|---|
| Application name | 例如 `Linro admin` |
| Public hostname | `admin.example.com`，替换成真实后台域名 |
| Path | 留空以覆盖整个主机名，不仅保护 `/admin` 或 `/Linro/*` |
| Identity provider | 选择你实际使用的登录方式；邮箱 OTP 或现有 IdP 按账户配置 |
| Session duration | 按管理需求选择，例如 8 小时；这不是项目设置 |
| Allow policy | Include → Emails → 精确填写实际管理员邮箱 |

保存应用和允许策略。需要 MFA 时在 IdP 或 Access 侧配置并实际验证。不要使用 `Bypass`，不要用 `Everyone` 放开后台，也不要为了排错临时关闭认证。

**公开短链域名 `go.example.com` 不加入这个 Access 应用。** 检查是否已有 `*.example.com` 的广泛保护或更具体的冲突应用，确保公开访问不被误要求登录。本应用不需要 Tunnel；Worker 已是域名的源站。[官方：Self-hosted 应用](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)

### 5.2 保存三个不同的值

```text
access_issuer = https://你的团队名.cloudflareaccess.com
access_aud    = 这个后台 Access 应用的 Application Audience (AUD) Tag
owner_email   = 你实际通过 Access 登录的管理员邮箱
```

AUD 可在该应用的 Configure / Additional settings 中查找。它不是 API token、Application ID 或账户 ID。Issuer 不带结尾 `/`，不是你的后台域名。[官方：AUD 与 JWT 验证](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)

本项目由 Worker 再验证 `Cf-Access-Jwt-Assertion` 的签名、Issuer、AUD 和时间等，不信任任意 email header。**新库首次 Owner 必须同时满足用户表为空、真实 Access 邮箱与 `owner_email` 一致**。已有用户时，修改配置里的邮箱不会夺取或替换 Owner。

### 5.3 静态资源也要受保护

项目设置 `assets.run_worker_first: true`：后台 HTML、JavaScript、深层路由和 API 都先进入 Worker 门控。不要改为只保护 `/Linro/*`。这同时意味着后台静态请求会经过 Worker，不按“全部静态免费请求”估算用量。[官方：Static Assets 配置](https://developers.cloudflare.com/workers/static-assets/binding/)

Admin 的 `/health` 已在 Worker 自身鉴权之后返回；认证可能查询 D1/JWKS，不是绕过认证的存活例外。整域名 Access 继续保护它，不加 Bypass。公开探活可使用受限流的 Redirect Worker `/health`。

<a id="configure"></a>
## 6. 填写配置与部署预检查

### 6.1 创建 deployment.json

仅在文件不存在时从模板复制。PowerShell：

```powershell
if (Test-Path .\deployment.json) { throw "deployment.json already exists; keep and review it" }
Copy-Item .\deployment.example.json .\deployment.json
```

Bash：

```bash
test ! -e deployment.json && cp deployment.example.json deployment.json
```

已有正式配置时保留原文件，不能被模板覆盖。使用 UTF-8 编辑器填写（无注释、无尾逗号）：

```json
{
  "account_id": "YOUR_CLOUDFLARE_ACCOUNT_ID",
  "database_id": "YOUR_D1_DATABASE_UUID",
  "database_name": "linro",
  "admin_host": "admin.example.com",
  "redirect_hosts": [
    "go.example.com"
  ],
  "access_issuer": "https://YOUR-TEAM.cloudflareaccess.com",
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
  "browser_timezone_enabled": true,
  "source_url": ""
}
```

以上仍是不可部署的占位模板，必须填真实值。

| 字段 | 解释 / 校验要求 |
|---|---|
| `account_id` | 32 位小写十六进制 Account ID，不是 Zone ID；与第 3 节一致 |
| `database_id` | 正式 D1 的 UUID，两端共享，不能填本地开发 ID |
| `database_name` | 正式数据库名称；本项目接受小写字母、数字与连字符 |
| `admin_host` | 后台小写 DNS 主机名，不带协议、端口、路径或尾点 |
| `redirect_hosts` | 1–50 个独立小写短链主机名；不能与后台相同，不能重复 |
| `access_issuer` | 团队 `https://…cloudflareaccess.com`，无尾斜线 |
| `access_aud` | 同一个后台 Access 应用 AUD，不能为空或填占位符 |
| `owner_email` | 首次 Owner 的真实 Access 邮箱，程序转为小写 |
| `analytics_enabled` | JSON 布尔值 `false` / `true`，不要写字符串；首次建议 `false` |
| `analytics_dataset` | 默认 `linro_clicks`；字母或下划线开头，仅字母/数字/下划线 |
| `auth_rate_namespace` | 正整数字符串，默认 `21001` |
| `write_rate_namespace` | 正整数字符串，默认 `21002` |
| `redirect_rate_namespace` | 正整数字符串，默认 `21003`；四个 namespace 必须不同，且避免与其他实例共用 |
| `redirect_rate_limit` | 默认 `300`，整数 1–100000，单位为来源 IP / Cloudflare 位置 / 60 秒；不是账户每日配额 |
| `query_forward_allowlist` | 最多 32 个不重复的小写精确参数名，格式 `[a-z][a-z0-9_]{0,63}`；默认五个 `utm_*`；敏感键禁止，即使手工加配置也拒绝 |
| `private_target_allowlist` | 默认 `[]`；最多 32 个精确规范主机或带方括号的 IPv6 字面量，JSON 不超过 4096 字符；无通配符/协议/端口/CIDR；例外允许该主机任意合法 HTTP(S) 路径及端口，须人工审查 |
| `expired_link_status` | JSON 数字 `404`（默认）或 `410`（显式接受到期存在性信号） |
| `password_rate_namespace` | 独立限流 namespace，默认 `21004`，与另三个及其它项目不同 |
| `password_rate_limit` | 默认5，整数1–30；同连接内 5 次/分，跨连接不保证（默认值提示，非严格服务保证）；配合第0.3.1节WAF |
| `cloudflare_device_type_enabled` | 布尔值false（默认）/true；仅在确认平台生成并覆盖CF-Device-Type后开启；不配置时设备为none |
| `redirect_cache_namespace_id` | 空字符串为无KV；启用填真实非全零32位小写十六进制KV namespace ID，两端自动一致绑定 |
| `redirect_cache_ttl` | 60–86400秒，默认300；无KV绑定时不触发KV操作 |

没有 `default_redirect_code` 配置项：**域名默认跳转状态码在 GUI / D1 管理，不在 deployment.json 管理**。不要添加不存在的字段期望其生效。

`deployment.json` 不放 API Token、Access Client Secret、LINK_PASSWORD_SECRET 或本地开发令牌。根 secret 只能配置为 Worker secret，不能放入 vars。它与生成后的配置仍包含部署标识，应按私有运维配置保存。

### 6.2 生成、查看并预检查

```bash
npm run configure
npm run preflight
```

`configure` 只在本地写 `apps/admin/wrangler.jsonc` 与 `apps/redirect/wrangler.jsonc`，不创建 Access 应用、不创建 D1、不执行迁移、不导入任何链接。它会覆盖这两份配置，先备份已有人工修改。

可用下面命令只输出需要人工复核的项目，不输出 secret：

```bash
node -e "const fs=require('node:fs');for(const f of ['apps/admin/wrangler.jsonc','apps/redirect/wrangler.jsonc']){const c=JSON.parse(fs.readFileSync(f,'utf8'));console.log(JSON.stringify({file:f,name:c.name,account:c.account_id,database:c.d1_databases,routes:c.routes,mode:c.vars.ENVIRONMENT,workers_dev:c.workers_dev,preview_urls:c.preview_urls,run_worker_first:c.assets?.run_worker_first},null,2));}"
```

必须确认：正式模式、两端 Account / Database ID 正确、后台与公开域名分开、`workers_dev` 与 `preview_urls` 均为 `false`、后台 `ASSETS` 受 Worker 门控。不要打开备用访问入口绕过 Access。

`preflight` 是**本地配置检查**，不会验证你拥有账户、DNS 已解析、Access 策略已配置、D1 有表、统计 secret 有效。未通过时不能直接调用裸 `wrangler deploy` 绕过。[官方：Wrangler 配置](https://developers.cloudflare.com/workers/wrangler/configuration/)

<a id="deploy"></a>
## 7. 迁移并部署两个 Worker

### 7.1 先完成本地发布门槛

真实配置生成后再执行：

```bash
npm run preflight
npm run check
npm test
npm run test:runtime
npm run build
npm run deploy:dry-run
```

`deploy:dry-run` 先 Admin 后 Redirect；前者失败时后者可能未执行。需要诊断时分别执行：

```bash
npx wrangler deploy --dry-run --config apps/admin/wrangler.jsonc
npx wrangler deploy --dry-run --config apps/redirect/wrangler.jsonc
```

这些打包检查不创建远程表，不能用成功输出替代后面的迁移。

### 7.2 迁移正式 D1（远程写入）

确认目标数据库，再查看待执行迁移：

```bash
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
npm run db:migrate
```

首次空库依次应用0001、0002、0003、0004；旧库先查看migrations list --remote并应用全部待应用迁移，不按软件版本名称推断哪些文件可省略。不能重跑已标记完成的迁移。七张业务表为 `domains`、`links`、`users`、`api_tokens`、`settings`、`audit_logs`、`daily_stats`，另有迁移和平台内部表。

只需通过 Admin 配置迁移一次，因为两个 Worker 共享同一 D1。**不要将 `.local/seed.sql` 或 `db:seed:local` 用于生产；不要手动重复执行已发布的建表 SQL。** 若表已经存在但迁移记录缺失，先备份并核对来源，停止操作，不删除表来让命令变绿。[官方：D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)

可做只读核对：

```bash
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name;"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT COUNT(*) AS users_count FROM users;"
```

首次登录前的新库 `users_count` 应为 `0`，已有正式实例则不要求为 `0`。后一个命令用于发现误导入本地测试用户，不应据此清库。

### 7.3 执行正式部署（远程写入）

Access 整域名策略已保存、数据库迁移已成功、本地门槛全部通过后：

```bash
npm run deploy
```

该命令按顺序执行：

```text
preflight → build（含 check）→ test → test:runtime → deploy:admin → deploy:redirect（发布后 verify:deployment）
```

它**不自动创建数据库，也不自动执行迁移**。两个 Worker 发布**不是原子操作**；若 Admin 已成功而 Redirect 失败，先核对失败原因和当前两个线上版本，不宣称整体上线成功，也不删除已成功 Worker 或数据库。只有定位原因并确认不会重复触发故障后才人工重试，或按第 13 节选择安全回退。若失败发生在发布后的探活，Worker 很可能已经更新，不应把非零状态理解为“尚未发布”。

成功后保存两个部署结果 / Version ID，以及本次源码校验值、锁文件和脱敏后的配置记录。不要把敏感日志上传公开仓库。

### 7.4 发布后 HTTPS 探活、TLS 排查与控制台复核

**不能仅凭 Wrangler 的 Success 认定对外可用。** `deploy:redirect` 在成功发布后自动调用 `npm run verify:deployment`。该只读命令默认从已生成的 Redirect 配置读取全部 Custom Domains，对各域名 `/health` 检查 HTTPS 证书/主机名、HTTP 200、JSON `status: ok` 和本包版本；默认要求全部主机连续两轮成功。它不会访问短链，所以不消耗单链接额度，但请求仍经过公开限流和平台计费。

```bash
npm run verify:deployment
# 排查时可以单独指定主机/地址族；预计版本默认取 package.json。
npm run verify:deployment -- --url https://go.example.com/health --family 4 --attempts 12 --interval-ms 5000 --timeout-ms 10000
npm run verify:deployment -- --url https://go.example.com/health --family 6 --attempts 1
```

计时参数均有边界，默认 12 次、轮间 5 秒、单次含响应体读取最多 10 秒（最坏约 175 秒；多域名并行）。`--attempts 1` 是人工诊断的一次检查，不要求两轮。错误包括 DNS/连接失败、TLS 验证失败、非 200、无效 JSON 和版本不符；工具不输出响应体或凭据、不携带令牌、不跟随 Location、不禁用 TLS。模板未配置即拒绝探测，错误退出 1。IPv6 单独失败也可能是操作者本机无 IPv6 网络，不能据此断定所有访问者故障。

**探活失败不做自动重部署、回滚、解绑重绑或 DNS 修改。** 发布可能已完成，保留当前配置、两个版本 ID 和诊断记录，人工区分：

```bash
# Bash；Windows PowerShell 用 curl.exe，避免旧 PowerShell 的 curl 别名。
nslookup go.example.com
curl -4 --connect-timeout 5 --max-time 15 --silent --show-error --dump-header - https://go.example.com/health
curl -6 --connect-timeout 5 --max-time 15 --silent --show-error --dump-header - https://go.example.com/health
# 在有 OpenSSL 的环境中，显式传 SNI；结束后 Ctrl+C 或关闭标准输入。
openssl s_client -connect go.example.com:443 -servername go.example.com -verify_hostname go.example.com -verify_return_error -showcerts </dev/null
```

Windows 原生 PowerShell 没有 `</dev/null` 语法；可交互执行同一 openssl 命令再 Ctrl+C，或在 WSL/Bash 中执行上面的行。不要加 `curl -k` 或用关闭证书校验的结果宣称恢复。

DNS 解析正常但 `no peer certificate available` 是 TLS 层线索，先看 Custom Domain/证书状态，而不是改 Worker 跳转规则。有效 TLS 下的 404/503/错误版本则检查 Worker 路由、绑定、数据库和限流。连接重置、超时或本机缺 IPv6 不足以单独证明“缺证书”。后台应另外验证真实 HTTPS + Access 登录/静态资源保护，不能移除其认证来让公开探活返回 200。

用户报告 I1 是其经历解绑/重绑后的**特定实例观察**：发布（包括 `secret put`）曾伴随约 1–3 分钟证书空窗，人工重新发布后恢复。不是所有 Cloudflare 发布必然存在这个窗口，也不是本项目能保证的恢复时长。本版没有代码层“修复 Cloudflare 签证”的承诺。公开域名变更选低峰，后台与公开端分开观察；每次公开端 `secret put` 或发布后重跑探活。若平台签发持续异常，保留证据并联系平台支持。只有诊断确认且操作者接受影响时，才手动发布一次原配置并重新探测；不要循环发布以“等到绿色”，也不要例行解绑来刷新 DNS。

报告另记录 Wrangler OAuth 调 `POST /accounts/{id}/workers/domains` 的 `10405` 鉴权方案错误；不把这类 API 调用加入本项目恢复自动化。使用既有 `wrangler deploy` 或控制台支持的入口，按显式域名核对，不删除其它业务记录。

**随后进行控制台复核：**

进入 **Workers & Pages**，分别打开 `linro-admin` 与 `linro-redirect`：

| 位置 | 预期 |
|---|---|
| Settings → Domains & Routes | Admin 只有后台域名；Redirect 有全部计划中的短链域名 |
| D1 绑定 | 两端 `DB` 的 Database ID 一致 |
| Admin 静态资源 | 与本版 Vite 构建对应，binding 为 `ASSETS` |
| 环境变量 | `ENVIRONMENT=production`，没有 `LOCAL_DEV_TOKEN`；两端 ADMIN_ORIGIN 与安全策略一致 |
| 公开限流 | Redirect 存在 REDIRECT_LIMITER，默认300/60，以及 PASSWORD_LIMITER，默认提示“同连接内 5 次/分，跨连接不保证”；四个namespace各自独立 |
| KV（可选） | 两端均无 REDIRECT_CACHE，或两端绑定相同 namespace；TTL一致，不能单边启用 |
| 密码（可选） | 启用时两端 Worker secret 中 LINK_PASSWORD_SECRET 值相同；不放本地令牌/vars；预检查不探测远程秘密 |
| 备用入口 | `workers.dev` 和 Preview URLs 均关闭 |

等待实际 DNS / TLS 状态正常；不承诺固定传播时间。域名未绑定时使用同一份配置重新部署，或按官方 Custom Domain 入口操作；若选择控制台手动改动，也同步维护 `deployment.json`，避免下一次 `configure/deploy` 恢复旧值。[官方：Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

后台必须通过其真实 HTTPS 域名访问；不要把 `workers.dev` 当故障时的后门。公开短链域名使用 HTTPS；需要 HTTP 自动升级时，在 Cloudflare 对相应域名配置 HTTPS 重定向并另行测试，不用关闭 Worker 的主机校验来兼容错误来源。

<a id="first-link"></a>
## 8. 首次登录、域名记录与第一条短链

### 8.1 建立正式 Owner

打开 `https://admin.example.com`，完成 Access 登录。使用配置中的 `owner_email`；新库会在通过认证后自动建立 Owner。**正式 GUI 没有开发令牌登录入口，也不需要把本地 token 上传为 Worker secret。**

先核对页脚、`/Linro/v1/session` 与公开 `/health` 返回的版本均为 `1.0.1`。设置中的工作空间名称可自行修改，GUI 顶栏可切换简体中文 / English；语言选择保存在浏览器，不影响跳转规则。

### 8.2 添加业务域名记录

进入 **域名 / Domains → 添加域名 / Add domain**：

```text
域名：go.example.com（与 Redirect Worker 绑定一致）
显示名称：按需要填写
默认状态码：明确选择 301 或 302 等所需值
启用：勾选
```

Cloudflare 域名绑定只决定请求能否进入 Worker；D1 域名记录决定是否有可查询规则。两者都完成才可创建和访问该域名下的短链。

用户本地报告中 `127.0.0.1` 的默认状态码是 `302`，报告认定其是被审计的配置变化，而非缺陷。本版本**不会将它重置为 301**，也不会把它自动同步到新生产域名。需要生产也默认 302 时，在这里明确选择 302；修改域名默认值不会批量改写已有链接的状态码。

### 8.3 建立独立验收链接

**启用浏览器采集后curl不会执行JS，初始GET应为200 HTML。** 下方旧GET/HEAD直跳smoke仅适用于全局`browser_timezone_enabled:false`且该链接`block_vpn:false`的兼容路径；不要为了检测受保护链接而临时移除它的block策略。新浏览器路径须完整走第0.0节JS→POST(JSON 200)→普通导航→最终响应；公开/health不受采集影响。

为避免默认值歧义，创建一个未占用的测试短码，并**显式**填写：

```text
短码：docs
目标：https://example.org/docs
状态码：301（此测试单独指定，不修改域名默认值）
查询策略：discard / 忽略传入参数
缓存：0
到期：留空
```

在终端执行项目自带 GET / HEAD 烟测，先替换公开域名：

```bash
node scripts/smoke.mjs --short-url "https://go.example.com/docs" --expected-location "https://example.org/docs" --code 301
```

这个脚本不跟随目标站，检查状态码、`Location` 与默认 `no-store`。若你的验收链接明确设成 302，应相应传 `--code 302`，不能把合法的 302 误判成失败。不要为了让烟测通过而修改真实业务链接。

<a id="acceptance"></a>
## 9. 上线验收清单

### 9.1 无凭据与公开路径检查

Windows 使用 `curl.exe`，避免 PowerShell 旧版 `curl` 别名；Bash 使用 `curl`。不要带 `-L`，先观察第一跳。

```powershell
curl.exe -i "https://go.example.com/health"
curl.exe -I "https://go.example.com/docs"
curl.exe -i "https://admin.example.com/Linro/v1/session"
curl.exe -i "https://admin.example.com/"
```

公开 `/health` 应是 200，JSON 包含 `version: "1.0.1"`。后台无凭据请求可以是 Access 的登录重定向或拒绝响应，而不是一定返回项目 JSON；**不能直接取得业务数据或后台 HTML/JS**。另选浏览器 Network 中一个真实的后台静态资源 URL，用无痕/无凭据请求检查门控，不能只测不存在的资源。

### 9.2 已登录业务验收

| 必须检查 | 通过标准 |
|---|---|
| Access 与 Owner | 允许邮箱成功；不允许邮箱被拒绝；正确角色显示 |
| 全部 GUI | 八个页面可打开；中英文切换及刷新保持；没有意外错误 |
| 链接 CRUD | 创建、编辑、停用及删除分别成功；失败重试不丢表单 |
| 并发冲突 | 旧版本编辑被拒绝，不静默覆盖较新记录 |
| 状态码 | 分别建立 301 / 302 / 307 / 308 验收链接，`Location` 正确 |
| HEAD | 无响应体、不写AE点击；block_vpn开启时须有效证明，无证明403/无Location/不占额；获准最终响应才占额度 |
| 参数策略 | discard 保留目标 query；merge 目标同名键优先；replace 完全替换 |
| 负向路径 | 未知/停用/大小写错误为 404；到期默认 404，显式配置可为 410；不自动跳回首页 |
| 默认缓存 | 缓存为 0 的新请求返回 `no-store`；改址后重新请求读新规则 |
| 用户与权限 | Viewer 不能写入；最后一个启用 Owner 不能被停用/降级 |
| 审计 | 成功修改有记录；目标 query/fragment 脱敏；不记录令牌原文 |
| 备份恢复 | 第 14 节做一次独立恢复演练，再认为可运维 |

当前实现是实际删除链接记录，并不保留短码占位。为避免旧浏览器缓存和已传播短链混淆，运维上不要把已公开的短码复用给不相关目标；验收使用独立短码。客户端此前缓存的永久跳转不受新部署控制；测试用新的请求 / 新短码验证，不将历史缓存误判为服务未更新。

将测试日期、两个部署版本、角色、结果与失败截图保存成私有验收记录。**本次修复的 Cloudflare 远程验收未完成前，不用任何本地通过数量替代它。** 可选功能不启用时标记“未启用”，不是伪造通过。

### 9.3 密码导航提交：真实浏览器必测

选择专用验收短码，在 Chrome 和 Edge 中实际打开短链密码页并填写密码；不要直接 GET 解锁路径，不要用 fetch 控制台或 curl 的成功代替表单导航测试。开发者工具记录状态/请求头（分享前删除 Cookie、密码和目标 URL）：无凭据 GET 200 密码页且无目标；正确表单 POST 303 回本域短码；后续GET才返回目标3xx或文本模式200；错误密码 401；跨站或无同源证据 POST 403；非 POST 解锁路径 405 / Allow: POST；修改规则后旧 cookie 再次落回密码页。确认 Cookie 的 HttpOnly/Secure/SameSite 与密码限流仍在，内部 303 不计次数，最终 GET/HEAD 才计次数。

原 `no-referrer` 页面在报告的 Chromium 请求中产生 `Origin: null`；本版对 `null + same-origin` 允许进入密码验证，但**明确外站 Origin 即便配 same-origin 仍 403**。这是修复报告布尔片段与文字边界不一致的反向用例。别修改后台 `X-Linro-CSRF` 检查来兼容公开密码表单。

可选的 `tests/browser/password-server.mjs` 只为隔离本机测试提供 Node+SQLite HTTP 桥接，不是生产 Worker、不是原生 workerd，也不证明生产 HTTPS/Secure-cookie 行为。不得公网暴露测试服务，不能把其生成数据导入生产；本次浏览器尝试受阻的原始记录见证据包。

<a id="analytics"></a>
## 10. 可选：Analytics Engine 与 Cron

先用 `analytics_enabled=false` 完成基础上线，统计不可用提示是预期行为，不影响短链管理与跳转。需要统计时再执行本节。

### 10.1 准备查询 secret

在 Cloudflare 创建限定**本账户**的自定义 API Token，权限选择 **Account → Account Analytics → Read**；它与部署 token、Access Service Token、Linro `Linro_...` token 都不同。[官方：Analytics SQL API 认证](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/)

Admin Worker 已按第 7 节存在后，执行：

```bash
npx wrangler secret put ANALYTICS_API_TOKEN --config apps/admin/wrangler.jsonc
```

在交互提示中粘贴查询 token，不写在命令行参数、`deployment.json`、前端或仓库中。`secret put` 会创建并立即部署新的 Worker 版本，是线上变更，应在维护记录中注明；这不是仅在本地保存密钥。[官方：Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)

### 10.2 开启并重新部署

把同一份 `deployment.json` 中的 `analytics_enabled` 改为 JSON 布尔值 `true`，数据集名称保持计划值，然后：

```bash
npm run configure
npm run preflight
npm run deploy:dry-run
npm run deploy
```

前提是当前目录已完成正式版构建；`deploy` 会再次完整检查、构建、测试。生成器给 Redirect 添加 `ANALYTICS` 写入 binding，给 Admin 添加 `*/15 * * * *` Cron；只有 Admin 保存查询 secret。数据集按官方机制在配置绑定后的首次写入创建，不需要先手工建数据表。[官方：Analytics Engine 入门](https://developers.cloudflare.com/analytics/analytics-engine/get-started/)

### 10.3 分开验收写入、查询和归档

产生几次**真实 GET** 短链请求，再打开 GUI 的访问统计。只运行 `curl -I` / HEAD 不会产生统计。首次写入和可查询可能有延迟；数据集名、账户、secret 权限错误时可能返回 502，不能把它当作零访问量。

项目以采样间隔加权估算请求，不提供精确 UV，不保存完整 IP、完整 UA 或完整 Referer URL。AE故障不阻止已获准的跳转或纯文本响应。GUI 当前 1–90 天趋势查询 AE，不自动回退到 D1 日归档。

Cron 按 **UTC 的前两个完整日期**归档；每次最多处理 400 个 link/day 组，超过保存游标，下次继续。因此今天的点击不应立刻出现在 `daily_stats`。检查归档状态：

```bash
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT key,value,updated_at FROM settings WHERE key LIKE 'analytics_rollup_%';"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT link_id,date,clicks,updated_at FROM daily_stats ORDER BY date DESC LIMIT 10;"
```

Cron 配置传播不一定立即完成；控制台检查 Scheduled / Cron 执行情况。项目没有对公网开放“立即执行归档”的维护路由。`/Linro/v1/system/health` 的 `configured_not_probed` 只表示配置存在，**不是查询或 Cron 已成功的证明**。[官方：Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

### 10.4 关闭统计

把 `analytics_enabled` 改回 `false`，`configure → preflight → deploy`；生成器会移除写入 binding 与定时触发配置。现有数据不会因此自动删除。需要撤销查询 token 时先确认无其他使用者，再在 Cloudflare 撤销，并按 secrets 管理流程移除 Admin secret；不要误撤销部署或 Access 凭据。

### 10.5 查询凭据轮换：先验证、后删除，绝不按列表行号

报告 I2 是一次“轮转后列表重排，按旧行位置误删新 token”的操作事故，不是应用 SQL 或鉴权漏洞。固定以下顺序：

1. 私下记录旧 token 的**显式 ID**、唯一名称/创建时间、权限、使用者；新 token 使用带用途和日期的不同名称。优先新建可并行验证的替代凭据；原地轮转可能立即使旧值失效，应另安排维护窗口。
2. 取得新值后，交互式写入 Admin `ANALYTICS_API_TOKEN`（第 10.1 节），记录发布版本。不要把值写入命令行参数、日志、报告或 Git。不要在完成验证前删除仍需要的旧凭据。
3. 使用该新值对**实际账户的 Analytics Engine SQL API**执行只读查询，要求 HTTP 200 且解析到期望格式/数据；再验证后台实际统计页无错误。不能只看保留的旧图表，也不能将 `/system/health` 的 configured 标志当成查询成功。
4. 验证后**重新加载凭据列表**，按记录的显式 ID 确认将删除的是旧项；名称重复或 ID 不明确时停止。不能依据“第几行”“另一个同名”“上次使用”猜测。确认没有其它使用者后才手工撤销旧项。
5. 撤销后再次发起真实查询并检查 GUI。若失败，先恢复一个明确身份的有效查询凭据；不要照抄事故恢复过程去删除全部令牌。

以下示例只用于本机手动验证。新值已按第 10.1 节写入后，在 Bash 隐藏输入（不把值写进 shell history）：

```bash
read -r -p 'Account ID: ' CLOUDFLARE_ACCOUNT_ID
read -r -s -p 'New read-only Analytics token: ' ANALYTICS_API_TOKEN; printf '\n'
export CLOUDFLARE_ACCOUNT_ID ANALYTICS_API_TOKEN
node scripts/verify-analytics-token.mjs
unset ANALYTICS_API_TOKEN
```

PowerShell 用安全输入并立即清理临时变量：

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = Read-Host 'Account ID'
$TokenInput = Read-Host 'New read-only Analytics token' -AsSecureString
$TokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($TokenInput)
try {
    $env:ANALYTICS_API_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($TokenPointer)
    node scripts/verify-analytics-token.mjs
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($TokenPointer)
    Remove-Item Env:ANALYTICS_API_TOKEN -ErrorAction SilentlyContinue
    Remove-Variable TokenInput,TokenPointer -ErrorAction SilentlyContinue
}
```

脚本只 POST 固定的只读 `SELECT 1 AS ok FORMAT JSON`，不输出 token、响应体或连接参数，不修改/轮转/删除任何凭据，非 200 或无效 JSON 非零退出。它验证 SQL 查询凭据可用性，**不证明目标数据集已有数据**；仍需 GUI 的实际数据查询验收。调用可能产生服务请求，应避免重复刷新。

`401` 是该次请求的鉴权失败信号；`403` 还需检查 scope/账户权限；`429` 是限流，应按平台指示退避后复验，**不能证明凭据有效，也不能证明凭据失效**；5xx/网络错误同样不下凭据结论。脚本不会把 429 静默转换为成功，也不进行自动重试或撤销。

**`LINK_PASSWORD_SECRET` 不适用上述日常查询 token 轮换流程。** 它是现有链接密码的 pepper 和 cookie 根密钥，数据库备份不包含它；升级必须保留原值。更换需按第 0.3 节维护并重新设置受影响链接密码，不应因清理 AE token 而误轮换它。

### 10.6 报告中的非缺陷观察

报告指出 AE 429、同名数据集保留旧历史，以及 KV 陈旧仍受 D1 gate 保护。本版保持顺序查询及不自动重试；新增维度会增加查询数量，不删除数据集、不清KV或D1。需要重新开始统计时应人工选择新数据集名并计划迁移；不要因为新建 Worker/数据库就假定账户级统计历史也已归零。


### 10.7 单条/多条统计、浏览器时区与疑似VPN

统计页支持全部、单条或自选最多50条短链，分页搜索及跨页选择保留；点应用才改变范围。链接列表的统计按钮可直达该链接。API的`link_id`和逗号分隔`link_ids`不能混用、不能空选；任何无效/删除ID明确报错，绝不退回全部。所有卡片和分布使用同一选择、时间窗口及采样权重。

| 维度/计数 | 真实来源与口径 |
|---|---|
| 浏览器时区 / `timezones` | 前端JavaScript Intl自报，服务端校验规范化，成功GET的分布；未采集/旧事件显示无/none，不用IP填充 |
| IP参考时区 / `ip_timezones` | `request.cf.timezone`；是IP地理时区，**不是浏览器**，与浏览器维度分开显示 |
| 设备 | 保留Cloudflare覆盖的CF-Device-Type及显式`cloudflare_device_type_enabled:false`默认；mobile/tablet→移动设备，desktop→PC，未知none，不自行解析UA |
| 疑似VPN访问 / `suspected_vpn_visits` | 有效时区不一致或Cloudflare T1的最终成功GET + 策略终止拒绝；不是初始采集页计数 |
| 疑似VPN成功 / `suspected_vpn_successes` | 上述中最终授权成功的GET。未开启拦截的疑似访问仍正常返回内容 |
| 已拦截疑似VPN / `blocked_vpn_visits` | 开启block_vpn后，T1直接GET/采集端POST拒绝，或同源有效挑战POST的时区不一致终止拒绝；success=0 |
| 无法判断拦截 / `unknown_timezone_blocks` | 缺失/无效时区而安全拒绝；不算疑似VPN |
| 无法判断成功 / `unknown_timezone_successes` | 未拦截链接最终成功，但没有可比的两个时区 |
| Tor / `tor_visits` | Cloudflare `request.cf.country='T1'`标记的成功或终止拒绝，是疑似VPN计数的子集，不推断真实用户身份 |

**这些是采样加权请求次数，不是独立用户数。** 终止拒绝可重复发生；Tor请求可在密码页前被策略拒绝；直接POST采集端的Tor请求也计终止拒绝，无需完成合法挑战，因此这些计数不证明脚本已运行。未完成采集直接离开的访问没有成功/疑似终止事件，不能从中推算全量访问人数。保护页、普通来源错误、错误密码、站内303、脚本、HEAD和配额耗尽不增加成功GET统计。未知信息不算已发现VPN。归档仍只保留成功GET日总数，不提供不存在的历史VPN/时区分布。

设备开关true要求操作方确认Cloudflare**生成/覆盖所有公开入口的头**，不是信任访客原始头。保持false时设备none；不要通过Cache Everything破坏保护页的no-store。相关能力/计划与实际覆盖须在自己的账户验证。[平台设备示例](https://developers.cloudflare.com/workers/examples/conditional-response/)

#### Analytics Engine字段兼容

```text
indexes[0] / index1: link ID
blob1–5: 原hostname、slug、country、referrer hostname、旧浏览器族（兼容不变）
blob6: 原Cloudflare IP时区（保留原位置）
blob7: mobile / pc / none
blob8: redirect / text
blob9: 新浏览器时区（Intl自报规范化或none）
blob10: tor / timezone_mismatch / match / unknown
blob11: success / vpn_blocked / unknown_blocked

double1: 最终成功GET=1；终止拒绝=0（旧点击和归档保持）
double2: 最终HTTP状态
double3: 疑似VPN=1
double4: 拦截疑似VPN=1
double5: 无法判断拦截=1
double6: 无法判断但成功=1
double7: Cloudflare Tor=1
```

旧数据没有blob9，因此浏览器时区归none；旧double3–7没有历史判定，不补造结果。新IP参考维度仍看blob6；不把旧IP记录搬成浏览器值。API顶层timezone:'UTC'只表示趋势分组，与两种访问时区不同。AE事件不保存浏览器本地完整时间、其他浏览器指纹、原始IP/UA、挑战/Cookie/密码、目标或文本正文；原blob5为既有兼容浏览器族，不用于VPN判定。原始来源只保留host，采集后通过签名挑战延续原host。

每次查询**8条顺序请求**（总量、趋势、热门、国家、来源、浏览器时区、IP时区、设备），避免并行突发；所有分布/日归档加double1>0排除拒绝。总量同时累加独立VPN计数，疑似成功由double1×double3筛选。无429自动重试，不保证这8次为单一原子快照；任意失败整体报错，不把部分结果或未知计数伪装为零。真实AE端点/SQL兼容性和费用需按上线清单验收。

<a id="automation"></a>
## 11. 可选：API 自动化双层认证

### 11.1 凭据不要混用

| 凭据 | 用途 | 保存位置 |
|---|---|---|
| Wrangler 登录 / 部署 API Token | 部署和管理 Cloudflare 资源 | 操作者本机 / CI，不放 Worker |
| Access Service Token 的 Client ID + Secret | 让脚本通过后台域名外层 Access | 调用端 secret 管理 |
| Linro 应用 token `Linro_...` | 应用内部角色与 scope 授权 | 调用端；D1 只存哈希 |
| `ANALYTICS_API_TOKEN` | Admin 查询 Analytics SQL API | Admin Worker secret |
| `LINK_PASSWORD_SECRET` | 访问密码 pepper 与解锁 cookie 签名，不是访客密码/调用凭据 | 两个 Worker 相同 secret，另行私有备份 |

另有独立 `BROWSER_CHECK_SECRET`：只用于短期浏览器检查证明，不是密码root、管理登录或AE查询凭据。

### 11.2 创建调用资格

在 GUI 的 **API 令牌 / API Tokens** 页面，用有相应权限的用户创建最小 scope、适当有效期的 token。完整值只显示一次。自动化 token 不能管理用户、设置或域名写入，只能使用源码允许的链接 / 域名读取 / 统计读取 scopes；任何角色签发的应用 token 都只能修改其所属用户创建的链接。

再在 Access 的 **Service credentials → Service tokens** 创建服务 token，给**原来同一个后台 Access 应用**增加一个 **Service Auth** 策略，只 Include 这个指定 token。保留管理员人类登录的 Allow 策略，不改成 Bypass，也不要用不同 AUD 的独立 `/Linro/*` 应用覆盖它。[官方：Access Service Tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/)

本项目需要的是：

```text
有效 Access 身份 + 有效 Linro Bearer token + 对应 scope
```

只有服务 token 时没有应用权限；只有 Bearer 时不能绕过 Access。Cloudflare 验证服务凭据后把 assertion 传给 Worker，调用端不要自行伪造 `Cf-Access-Jwt-Assertion`。浏览器的写 API 另有同源与 CSRF header 校验，不要关闭该校验来迁就脚本。

### 11.3 调用示例

先由你的密码管理器/CI 安全注入环境变量 `CF_ACCESS_CLIENT_ID`、`CF_ACCESS_CLIENT_SECRET` 和 `CF_LINKS_API_TOKEN`；下面不含真实密钥。PowerShell（单行，避免续行语法歧义）：

```powershell
curl.exe --fail-with-body "https://admin.example.com/Linro/v1/links?limit=25" -H "CF-Access-Client-Id: $env:CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $env:CF_ACCESS_CLIENT_SECRET" -H "Authorization: Bearer $env:CF_LINKS_API_TOKEN"
```

Bash：

```bash
curl --fail-with-body 'https://admin.example.com/Linro/v1/links?limit=25' \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $CF_LINKS_API_TOKEN"
```

成功应返回本项目 `{ "ok": true, "data": ... }` JSON，而不是 Access 登录 HTML。测试缺任意一层凭据会被拒绝、撤销 token 后不能再读写、只读 scope 不能创建链接。不要用 `-v` 把认证 header 写入公开日志。[API 字段与接口](docs/API.md)

<a id="local-to-production"></a>
## 12. 把本地链接迁到生产

**推荐：全新正式 D1 + Access Owner + 选择性导入链接。** `.local/state`、`.local/.dev.vars`、测试账户与本地短链域名不上传。

在本地 GUI 导出 CSV / JSON 后，保留原导出作私有备份，在副本上操作。生产先添加正式域名，再修改导入文件每条链接的 `hostname` 为对应正式域名；也可以删除 `hostname`，在导入时选择缺省正式域名。**导入优先匹配记录内的 hostname**，保留 `127.0.0.1` 会导致“域名不存在”，不能指望缺省域名覆盖它。

只有计划迁移的 `links` 需要导入；JSON 中的 `domains` / `settings` 元数据不会自动恢复。不要批量替换 target_url 中的域名，因为目标地址可能确实需要保留。逐条检查 `redirect_code`、参数策略、缓存与到期时间；明确保留合法的 302，而不是把全部状态码改为 301。

Web 导入上限 2 MiB / 5000 行，每 10 条为一个原子批次；同名短码不覆盖，失败批次回滚，之前成功批次保留。发生网络异常先核对服务端实际已导入数量，再移除已成功行重试。用户 ID、原审计、API token、历史点击和原创建时间不是这个导入流程的恢复目标。v1.1.0 会保留地区规则与上限，但计数从0开始；password_protected 导出行必须提供新 password，拒绝静默取消保护。完整安全状态恢复使用 SQL 加原 LINK_PASSWORD_SECRET。

**不要把本地 Owner 的 `cf-links-local-owner` 身份绑定复制到生产。** 正式 Owner 要通过真实 Access 首次登录建立；保留旧本地数据只是为了本机继续开发或回退，不是正式身份迁移。

<a id="upgrade"></a>
## 13. 以后升级与代码回滚

全部待应用迁移核对及禁止旧公开端回退限制以第0.0节为准。正文模式不得在线交给旧Admin编辑，也不能为回退清空或重建数据库。

### 13.1 从旧版升级至 Linro v1.0.1

解压到新目录，保留旧目录不覆盖。复制已验证锁文件并按第 2 节更新根版本；保留现有 `deployment.json`、Worker names、Database ID、Access issuer/AUD、secret 名称。不要复制旧 `dist/`、`.build/`。

先按第 0 节只读审查存量数据并备份正式 D1，再 `configure → preflight → check → test → test:runtime → test:browser → build → deploy:dry-run`。核对 `migrations list --remote`，备份并按顺序补上缺少的0002/0003/0004 migration；不重建数据库。最后 `npm run deploy`，完成第 0 / 9 节关键回归。

用户报告中的本地域名 302 设置不会被配置生成或版本更新改写。线上已经建立的 301/302 等具体值以各条规则为准，不能用“版本升级”替管理员改数据。

### 13.2 回滚代码，不等于回滚数据库

保存上线前两个 Worker 的 Version ID、源码、lockfile、配置和 SQL 备份。**新block_vpn启用后不能回滚到v1.1.1及更早Redirect；原密码/额度功能启用后也严禁回滚到v1.0.x Redirect**：旧代码会忽略数据库中的访问密码与次数上限。出现问题时先在维护窗口保持入口受控，优先修复/重建仍保留本版校验的版本；需要恢复旧版时必须制定受保护链接停止访问与配套旧库恢复方案。

Workers 控制台回滚、secret 变更、D1 恢复分别是不同操作，不存在跨两端 Worker/数据库/secret 的原子回退。只选择已验证、与当前控制字段和 secret 兼容的版本，随后重新验证密码、限额与权限；不要用旧 `.local/` 替代生产。不能因为前端构建失败就用 Time Travel 抹去业务数据。[官方回滚说明](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

<a id="backup"></a>
## 14. 备份与数据库恢复

### 14.1 发布前 / 定期 SQL 备份

```bash
npm run preflight
npm run backup
```

默认输出项目根目录的 `Linro-backup.sql`。先把上次备份移到受控位置，避免覆盖。该文件包含用户、token 哈希等敏感数据；加密保存到项目目录外，不提交仓库，不发到聊天或公开证据包。secret 和 Access 策略不在 D1 SQL 备份内，需另有安全的配置/凭据恢复计划。

需要明确文件名时，先保证目标目录存在且文件名未占用：

```bash
npx wrangler d1 export DB --remote --config apps/admin/wrangler.jsonc --output ../Linro-before-v1.0.0.sql
```

导出属于远程操作，可能阻塞数据库请求，安排低峰维护窗口，不宣称完全无感。Web JSON/CSV 导出不是事务快照，也不包含全部管理数据，不能替代 SQL 备份。[官方：D1 导入导出](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

### 14.2 在新数据库演练恢复，不覆盖现有生产库

先准备独立的恢复目录与配置副本，**不绑定生产域名、不开 Cron、不进行 deploy**。在目标账户新建不同名称的空库，例如：

```bash
npx wrangler d1 create linro-restore-check
```

恢复副本的 `deployment.json` 使用新库名称与新 Database ID；保存其他所需配置以便 `configure` 生成准确的 `DB` 绑定。确认只在恢复副本目录中执行：

```bash
npm run configure
npm run preflight
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --file ../Linro-before-v1.0.0.sql
```

这条命令会写入**配置指向的数据库**，必须再核对它是恢复测试库，不是现有生产库。全量 SQL 通常包含建表语句，**先导入，不先执行建表迁移造成表名冲突**。不可直接把 `.sqlite` 文件作为 `--file` 上传；使用官方 SQL 导出格式。[官方：D1 导入导出](https://developers.cloudflare.com/d1/best-practices/import-export-data/)

然后只读核对：

```bash
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "PRAGMA foreign_key_check;"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT name,type FROM sqlite_schema WHERE type IN ('table','index','trigger') ORDER BY type,name;"
npx wrangler d1 execute DB --remote --config apps/admin/wrangler.jsonc --command "SELECT 'users' AS item,COUNT(*) AS n FROM users UNION ALL SELECT 'links',COUNT(*) FROM links UNION ALL SELECT 'domains',COUNT(*) FROM domains UNION ALL SELECT 'audit_logs',COUNT(*) FROM audit_logs;"
npx wrangler d1 migrations list DB --remote --config apps/admin/wrangler.jsonc
```

比较源库计数、关键业务样本、Owner / `access_sub`、触发器和迁移记录。若导出没有包含所需迁移记录，停止并审查，不对已存在业务表重新执行初始迁移，也不编造已应用记录。

仅演练恢复时，**不要部署恢复副本**。真正需要切库时安排写入维护窗口，先确认数据恢复点和将丢失/补录的后续写入，再把正式部署配置的两个 Worker 同时指向新库、重跑门槛并部署，核对旧 Access 身份仍能使用。两端切换不是原子操作，维护期间禁止继续修改链接，防止分别写向两个库。

### 14.3 Time Travel 是额外保护

可记录现有数据库的恢复书签：

```bash
npx wrangler d1 time-travel info DB --config apps/admin/wrangler.jsonc
```

按账户实际保留窗口使用 Time Travel。恢复到过去会影响该时间点之后的数据，先备份当前状态并完成影响评估；不要在常规发布命令里自动执行 restore。[官方：D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)

<a id="troubleshooting"></a>
## 15. 常见故障排查

| 现象 | 优先核对 / 处理 |
|---|---|
| `EAI_AGAIN registry.npmjs.org` | npm 网络/DNS，停止安装；不靠删锁文件或降级解决 |
| `TS2688`、`vite/wrangler not found` | 依赖是否安装齐；不跳过 `check` 或拿旧 `dist` 发布 |
| `preflight` 拒绝占位配置 | 填真实 `deployment.json` 后运行 `configure`；不是删除守卫 |
| Cloudflare 认证 / 权限错误 | `whoami`、Account ID、当前 CLI 凭据和资源范围；不输出 token 排错 |
| 域名冲突 / DNS 不解析 | 主机名是否属于 Active zone、Custom Domain 是否正确、是否占用原网站/CNAME；不盲目删 DNS |
| TLS 未生效 | 核对证书与域名绑定状态，等待传播；不关闭 HTTPS 或改成错误主机 |
| 后台不断回登录页 | Access host/path、登录方式、允许邮箱、Cookie 与策略；不用 Bypass 排查 |
| `access_required` | 请求没带经 Access 验证的 assertion；确认不是错误入口/旁路/Bypass |
| Access JWT 错误 / `user_not_allowed` | issuer/AUD、首次 Owner 邮箱、用户是否启用、是否误导入本地 `access_sub`；不要清空用户表 |
| `wrong_host` / 421 | `ADMIN_ORIGIN` 与真实 HTTPS 域名是否完全一致，不接受其他备用来源 |
| `no such table` | 是否迁移到了同一**远程** D1；本地迁移成功不代表生产已有表 |
| 公开短链 404 | Cloudflare 绑定与 D1 域名记录两者是否存在；大小写/启用/删除状态；主机名不能带端口 |
| 新链接默认 302 | 看域名 `default_redirect_code`；合法配置，不是代码把 301 改坏 |
| `csrf` / 403 | 浏览器是否同源、是否经正常 GUI 发写请求；脚本使用第 11 节双层认证 |
| 429 | 后台或公开端限流；按 Retry-After 退避，检查 NAT 共用来源 IP、命名空间及额度；不关闭鉴权、不以不停重试加压 |
| 公开端持续 503 | 先查新 REDIRECT_LIMITER、ADMIN_ORIGIN 和策略变量是否绑定；再查 D1/目标政策；不要跳过目标复检 |
| 403 link_owner_required | Editor 或应用令牌操作了其他用户的链接；使用合适交互式管理员或独立 CI 归属，不扩权/改库绕过 |
| 400 unsafe_query_mode / private_target | 改用 discard 或由部署者审批精确私有目标例外；UI 或令牌不能自行修改部署策略 |
| GUI 白屏 / JS 请求变 HTML | 查看静态资源绑定、真实构建目录、Access 会话，不能把 API 404 当 SPA 页面 |
| Analytics unavailable / 502 | 两端开关、Admin 查询 secret、Account Analytics Read 权限、dataset 名、是否有成功 GET |
| Cron 无归档 | 传播、执行日志、secret、前两天 UTC 窗口与游标；今天的点击不立即归档 |
| 导入默认域名无效 | 记录中 hostname 优先；去掉本地域名或映射为已创建的正式域名 |
| `package:source` 拒绝生产配置 | 正常保护；从公共模板的干净源码副本打包，不覆盖运维工作目录 |

只在排障窗口查看实时日志：

```bash
npx wrangler tail --config apps/admin/wrangler.jsonc
npx wrangler tail --config apps/redirect/wrangler.jsonc
```

这两条是长连接查看，分别在终端运行，完成后退出。项目默认关闭 Workers observability；应用日志的最小化不等于平台层没有访问元数据。不要长期收集或公开 URL、认证 cookie、完整请求头和敏感短码。应用 `request_id` 可用于定位，不必公开用户数据。

<a id="development"></a>
## 16. 本地开发、关键语义与安全边界

### 16.1 保留本地验证环境

只在本机开发目录运行：

```bash
npm run local:init
npm run build
npm run db:migrate:local
npm run db:seed:local
npm run dev:admin
```

另开终端执行 `npm run dev:redirect`。后台为 `http://127.0.0.1:8787`，短链端为 `http://127.0.0.1:8788`。两个本地 Worker 共享 `.local/state/`，开发令牌在 `.local/.dev.vars`。

本地升级前停止两个父进程及其属于本项目的子进程，复制整个 `.local/` 可保留旧库和开发令牌，再运行 `local:init` 更新路径。用户现场发现 Windows 的 workerd 子进程可能继续占用端口；核对 8787/8788 对应 PID 树，不按程序名结束其他项目进程。本版不更改启动器。

### 16.2 规则语义与本次加固

仅 GET/HEAD；未知/停用返回 404，到期默认 404（可显式 410），规则或配置失败返回 503，限流返回 429。默认缓存为 0，允许显式 TTL 0–3600 秒；缓存后客户端可能不再回访 Worker。短码仍 1–64 位 ASCII 字母、数字、`_`、`-`，区分大小写，不重命名历史短码；随机生成 8 位。创建时复核大小写形近码，本版未引入唯一小写索引。

默认白名单下的示例：

```text
目标 https://example.org/page?a=1；来访 /docs?utm_source=mail&next=untrusted

discard → https://example.org/page?a=1
merge   → https://example.org/page?a=1&utm_source=mail
replace → https://example.org/page?utm_source=mail
```

精确匹配大小写；不在白名单或含控制字符的传入项忽略，敏感键不可配置为白名单。合并仍是目标同名键优先；`replace` 仍会清空旧查询串，即便来访没有允许的参数；有固定业务参数应选 `discard` 或经审查的 `merge`。目标主机、路径、片段不取自访问者。可识别的认证/敏感目标无论历史模式都按 `discard`，且写入时拒绝非 `discard`。白名单是输入限制，不代表目标站消费任何白名单参数都安全。

HTTP(S) 目标拒绝 credentials、控制字符、私有/本地主机和本平台管理/受管主机；合法私有用途须部署级精确例外。读路径复检需要额外一次按 hostname 的索引查询：有效普通跳转共 2 次 SELECT，未知短码通常 1 次，限流拒绝 0 次。D1 故障或被 SQL 恢复成违规目标时拒绝跳转，不产生成功点击统计。不存在 DNS 检查、自动标题抓取或目标代理。**短码不是身份验证或保密凭据。**

### 16.3 不是多租户 SaaS

有读取权限的成员仍能读取团队链接；归属限制只收紧更新、删除、启停与批量操作，并非隐私/租户隔离。交互式 Owner/Admin 可管理全工作区，Editor 与所有应用令牌只能改其所属用户创建的链接；具备读取 scope 的 token 仍能读团队链接。没有匿名创建、公开注册、项目内密码重置、付费计费、精确 UV 或账户级严格计费配额。新增的是单链接服务器授权跳转上限，不是精确终端送达/UV证明。

D1 是共享故障点。公开 Worker 在有上限时写入原子计数；未启用上限不增加计数写入。KV 是可选路由缓存，命中仍有 D1 主库安全 gate；没有 Cache API 或副本读取，也不承诺纯 KV 全局低延迟。后台与公开限流都按 Workers 位置尽力执行，不是全网严格总配额；binding 不减少已进入 Worker 的调用计数。[官方：Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)

更多说明见 [SECURITY](docs/SECURITY.md)。本版不新增审批流、多租户或身份恢复后门。

<a id="commands"></a>
## 17. 命令表与源码再发布

| 命令 | 范围与作用 |
|---|---|
| `npm run check` | 本地前后端严格类型检查 |
| `npm test` | 本地编译测试用 Worker 并运行 Node/WebCrypto/SQLite/安全/发布回归 |
| `npm run toolchain:versions` | 打印精确 Wrangler 与 Miniflare/workerd/esbuild 的实际版本；缺工具或版本不符失败 |
| `npm run test:runtime` | 先 API 金丝雀，再原生 workerd 安全/密码/配额语义测试；失败阻止发布 |
| `npm run verify:deployment` | 发布后的只读 HTTPS/JSON/版本探测，不自动重发布 |
| `npm run audit:links -- --input EXPORT.json --config deployment.json` | 只读本地 JSON 升级审阅；退出 2 表示需人工复核，不是自动修复 |
| `npm run build` | check + Worker 编译 + Vite GUI 构建 |
| `npm run build:web` | 仅 Vite，不可替代 check |
| `npm run configure` | 本地生成两份生产配置，覆盖相应配置文件 |
| `npm run preflight` | 本地配置守卫，不是云端探测 |
| `npm run db:migrate` | 预检查后应用**远程 D1**迁移 |
| `npm run deploy:dry-run` | 两个 Worker 打包检查，不发布 |
| `npm run deploy` | 预检查、构建、Node 与原生运行时测试，再发布 Admin 和 Redirect；不迁移 |
| `npm run deploy:admin` / `deploy:redirect` | 预检查后单端部署，不自动构建；不得用来绕过发布门槛 |
| `npm run backup` | 远程正式 D1 SQL 导出 |
| `npm run local:init` / `dev:*` | 本地开发配置与服务，不能充当线上部署 |
| `npm run package:source` | 只制作干净源码目录与新清单，不发布云端服务 |

源码再发布用干净的公共模板副本：

```bash
npm run package:source
```

输出 `release/Linro-v1.0.1/`，只压缩这个目录，不直接压缩工作区。生成物、依赖、本地数据库和常见 secret 文件会被排除；真实 Wrangler 配置会阻止发布，**不要为打包而覆盖正在使用的生产配置**。需保留自己的有效 lockfile 时先同步根版本。该脚本不是通用秘密扫描器。[源码发布规范](docs/RELEASE.md)

项目目录、接口和来源：

License: **AGPL-3.0-only**。首次上线前完成本 README 第 9 节；保留可用备份与回滚记录后再用于实际业务。


## 文档

[API](docs/API.md) · [安全边界](docs/SECURITY.md) · [协议升级](docs/PROTOCOL-v1.0.1.md) · [源码发布](docs/RELEASE.md) · [许可](docs/LICENSING.md)
