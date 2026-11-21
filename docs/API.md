# Linro v1.0.2 API 参考

[English](API.en-US.md) · [部署与使用](GUIDE.md) · [权限说明](GUIDE.md#permissions) · [安全边界](SECURITY.md)

API 就是让程序填写和读取表单的入口。如果只是日常管理，用网页即可；写脚本时，先读“共同规则”，再找对应接口。本页按当前源码列出 **25 个管理方法/路径组合**，以及公开短链协议。

所有域名、邮箱、UUID 和请求 ID 都是示例。凭据从你自己的秘密管理工具读取；本文不提供可用 token 或密码。

<a id="api-conventions"></a>

## 1. 先理解共同规则

### 地址与两层认证

管理 API 的基础地址是 `https://admin.example.com/Linro/v1`。后文 `/links` 表示完整地址末尾再接 `/links`。替换自己的管理主机，保留路径大小写，不额外加结尾 `/`。基础地址本身不是接口目录；不支持的方法或路径返回 404 `api_not_found`。

生产请求先经过 **Cloudflare Access**，再经过 Linro 自己的权限检查。浏览器使用真人 Access 会话；脚本使用 Access 服务身份加 Linro 应用令牌。

| 请求头 | 何时需要 |
| --- | --- |
| `Accept: application/json` | 管理客户端建议发送；不会把登录跳转变成成功 JSON |
| `Content-Type: application/json` | 带 JSON 正文的管理写请求，可附 `charset=utf-8` |
| `Authorization: Bearer Linro_…` | 脚本使用的完整 Linro 应用令牌 |
| `CF-Access-Client-Id` / `CF-Access-Client-Secret` | 脚本通过外层 Access；该服务身份必须被应用策略允许 |
| `Cf-Access-Jwt-Assertion` | Worker 验证的 Access JWT，正常由认证入口传入，不要自己伪造 |
| `Origin` / `X-Linro-CSRF: 1` | 真人 Access 会话写请求，Origin 必须等于管理 origin |
| `X-Linro-Dev` | 仅受限的本地开发模式，正式请求不要使用 |

API 入口拒绝显式不等于 `ADMIN_ORIGIN` 的 Origin，包括空字符串或 `null`。服务端 token 请求可以不发 Origin；真人写入还拒绝 `Sec-Fetch-Site: cross-site`。应用 token 不走真人 Cookie 的 CSRF 分支，但仍受入口来源限制。

没有开放的跨站 CORS/JSONP 协议，也没有通用 OPTIONS 预检接口。把 token 放进外站网页不能绕过这些限制。请求一旦带 Authorization，就按 token 分支认证；无效 token 不会回退到浏览器 Cookie 登录。

### 权限与所有权

`scope` 是某项操作的许可证。应用令牌只能具有 `links:read`、`links:write`、`links:delete`、`domains:read`、`analytics:read`，并受所属用户当前角色限制。

工作区读取共享。Editor 与**全部应用令牌**只能修改所属用户自己创建的链接；真人 Admin/Owner 可维护整个工作区。相同用户的两个令牌共享用户级写入范围，并非每枚令牌各自隔离。标记“交互式”的接口不接受应用 token。

### 成功和失败长什么样？

正常读取/修改通常返回 200，创建/导入返回 201。管理成功统一包装为：

```json
{"ok":true,"data":{"deleted":true}}
```

错误示例：

```json
{"ok":false,"error":{"code":"version_conflict","message":"This item changed. Refresh before saving again.","request_id":"example-request-id"}}
```

`data` 可能是对象或数组，不能总假设有 `items`。程序按 HTTP 状态和 `error.code` 判断，英文 `message` 供排障。通过 Worker 安全包装的响应有 `X-Request-Id`；反馈问题时给这个 ID，不给凭据。

管理 JSON 使用 `Cache-Control: no-store`。限流 429 带 `Retry-After: 60`。外层 Access 或平台提前返回的结果可能是 HTML/302，没有这套 JSON；解析前检查状态和 `Content-Type`，不要自动跟随认证重定向。

### 正文、时间和编辑版本

JSON 正文最多 **262,144 字节**，按实际读取字节计算；必须是有效 UTF-8 对象，不能为数组或 null。写接口的顶层正文拒绝未声明字段，不要把 GET 的整份对象直接 PATCH 回去；嵌套条目按各接口规则处理。

数字用 JSON 数字。业务布尔一般接受 `true/false/1/0`；`reset_redirect_count` 只接受布尔。字符串长度通常按 JavaScript UTF-16 代码单元算，密码和正文还受单独 UTF-8 字节限制。

`created_at`、`updated_at`、`expires_at`、`revoked_at` 是 Unix **秒**，不是毫秒。导出包 `exported_at` 是 ISO 时间字符串，日归档 `date` 是 UTC 日期。`null` 的意思由字段决定，不能通用地当成“不修改”。

链接、域名、用户更新带当前 `version`；链接和域名删除带 `?version=…`。它像取号：别人先改过，旧号码就会得到 409。刷新、比较后再提交。它不等于访客保护使用的 `rule_revision`。

### 分页：选一种方式

| 方式 | 请求 | 响应 |
| --- | --- | --- |
| 游标，适合连续翻页 | `pagination=cursor&limit=25`；下一次原样带回 `cursor` | `items, limit, next_cursor`，末页 `next_cursor:null` |
| 页码，兼容旧客户端 | 默认或 `pagination=page&page=1&limit=25` | `items, page, limit`，部分接口另有 `total` |

`limit` 默认 25，范围 1–100；页码范围 1–100000。游标模式不能同时带 `page`，页码模式不能带 `cursor`。游标最长 512 字符，应当作不透明值传回；保留原筛选条件，不用于权限证明或快照一致性。

链接列表可用 `include_total=true/false` 控制计数，页码默认 true、游标默认 false。审计只有页码模式返回总数；日归档没有总数。域名、用户、令牌和设置直接返回数组，不使用这套分页。

### 三个健康入口别混淆

| 地址 | 认证/方法 | 检查什么 |
| --- | --- | --- |
| Admin `/health` | 已认证，GET/HEAD | 后台浅层健康 |
| Admin `/Linro/v1/system/health` | Owner，GET | Worker 和 D1 `SELECT 1` |
| Redirect `/health` | 公开，GET/HEAD | 公开端浅层状态和版本，不查 D1 |

管理 API 不自动把 HEAD 当 GET：例如 `HEAD /Linro/v1/links` 返回 404。

<a id="models"></a>

## 2. 链接表单与返回对象

### 创建和更新可填写的字段

POST `/links` 与导入条目支持下面 17 个字段。PATCH `/links/{id}` 还需 `version`，并允许 `reset_redirect_count`。更新时省略字段通常保留原值。

| 字段 | 规则 | 创建默认 / 特别说明 |
| --- | --- | --- |
| `domain_id` | 现有域名 ID，字符串最长 36 | 必需；停用域名也可存链接，但访客不能使用 |
| `slug` | 1–64 个 ASCII 字母、数字、`_`、`-` | 省略或空串自动生成 8 位；更新空串无效 |
| `target_url` | HTTP(S)，原始输入与规范化后的 URL 都最长 4096 | redirect 模式必需；拒绝凭据、控制字符和反斜线 |
| `title` | 字符串最长 200 | 空串 |
| `description` | 字符串最长 2000，可正常换行 | 空串 |
| `redirect_code` | 数字 301/302/307/308 | 采用域名默认，域名初始默认 301 |
| `query_mode` | `discard/merge/replace` | `discard`；text 模式固定 discard |
| `enabled` | 布尔或 0/1 | 1；读取为数字 |
| `expires_at` | null 或 Unix 秒整数 1–253402300799 | null；过去时间允许保存，但公开访问已过期 |
| `cache_ttl` | 整数 0–3600 秒 | 0；控制客户端缓存，不是 KV |
| `kv_cache_ttl` | null、0 或整数 60–86400 秒 | null 继承全局，0 关闭；保护类链接绕过 KV |
| `geo_rules` | 0–32 条，序列化最长 65536 字符 | `[]`；更新 `[]` 清空 |
| `password` | null 或 12–128 个代码单元、最多 512 UTF-8 字节 | 省略为无密码/更新保留；null 移除；字符串重新设置 |
| `max_redirects` | null 或整数 1–1000000000 | null 无限；改上限不清零已有计数 |
| `response_mode` | `redirect/text` | redirect |
| `text_content` | 非空，最多 16384 个代码单元、32768 UTF-8 字节 | text 模式必需；redirect 模式归一化为空串 |
| `block_vpn` | 布尔或 0/1 | 0；首次打开需有效浏览器根密钥配置 |

`reset_redirect_count:true` 才清零，false/省略不清零。密码不 trim，首尾空格属于密码；空串和包含控制字符（包括 TAB/CR/LF）的密码无效。文本允许 TAB/CR/LF，拒绝其他受限控制字符和无效 Unicode，不作为 HTML 渲染。

目标还需通过私有主机和短链环路策略。验证不会请求目标网页，也不解析 DNS。短码保留 `health`、`cdn-cgi` 和 `__Linro_` 前缀，保留比较忽略大小写；业务短码本身区分大小写。`Linro` 可用；含点的 `robots.txt` 不符合短码语法。

### 查询参数怎样带过去？

只处理部署白名单允许的来访键，敏感键不能转发：

- `discard`：保持已保存目标的查询参数，丢弃来访参数。
- `merge`：只追加目标中尚不存在的允许键，目标已有同名值优先。
- `replace`：用过滤后的来访参数替换目标的**整个查询部分**；来访为空会清空。

敏感登录、重置或回调目标要求 `discard`。内部 `_Linro_check`、`_Linro_lang` 不透传。最终组合 URL 最长 8192 字符，超长返回 414。

### 地区规则 GeoRule

```json
[
  {"kind":"country","code":"JP","target_url":"https://www.example.org/ja/"},
  {"kind":"continent","code":"EU","target_url":"https://www.example.org/eu/"}
]
```

条目只接受 `kind,code,target_url`。优先级为国家 → 大洲 → 默认目标；相同 `kind:code` 不可重复。大洲为 `AF/AN/AS/EU/NA/OC/SA`；国家要求大写两字母且非 `XX`，代码不做完整 ISO 名单核验，调用方应填真实有效国家代码。每个目标都应用同样安全检查。text 模式必须显式清空原地区规则。

### 读取到的 PublicLink

“PublicLink”是管理 API 中移除密码校验信息后的对象名称，**不意味着匿名可读**。它包含业务字段，但不含 `password/password_hash`；还包括：

| 字段 | 意思 |
| --- | --- |
| `id`、`hostname`、`short_url` | 链接 UUID、主机、短地址；生产 short_url 为 HTTPS |
| `password_protected` | 是否有密码保护，布尔值 |
| `created_by` | 创建用户 UUID，历史记录可能 null |
| `created_at`、`updated_at` | Unix 秒 |
| `version` | 编辑并发检查版本 |
| `rule_revision` | 缓存和访客证明使用的规则修订 |
| `redirect_count` | 有限额业务请求的授权计数，不是总点击量 |
| `remaining_redirects` | 无限时 null，否则 `max(0,max_redirects-redirect_count)` |
| `domain_enabled` | 链接列表含此字段，其他返回不保证包含 |

`enabled` 和 `block_vpn` 输出 0/1；`geo_rules` 输出数组。text 模式对外 `target_url:""`，数据库内部的 `about:blank` 只是兼容存储值，不会被打开。

示例 ID 约定：域名 `11111111-1111-4111-8111-111111111111`，链接 `22222222-2222-4222-8222-222222222222`，用户 `33333333-3333-4333-8333-333333333333`。实际调用必须替换为 API 返回值。

### 其他读取对象

| 名称 | 字段与说明 |
| --- | --- |
| Domain | `id,hostname,name,enabled,default_redirect_code,created_at,updated_at,version`；完整列表另有 `link_count` |
| User | `id,email,display_name,role,enabled,created_at,updated_at,version`；不返回 `access_sub` |
| Token 列表项 | `id,name,prefix,scopes,expires_at,revoked_at,created_at`；**scopes 是 JSON 字符串** |
| Token 创建结果 | `id,token,name,scopes,expires_at,shown_once`；此处 scopes 是数组，完整 token 仅此一次 |
| Setting | `key,value,updated_at`；读取可能含归档内部水位，仅 site_name 可修改 |
| Audit | `id,user_id,actor_email,action,resource_type,resource_id,details,request_id,created_at`；**details 是 JSON 字符串** |
| DailyStat | `link_id,date,clicks,updated_at`；列表加 `slug,hostname`，clicks 是采样加权值，可为非整数 |

审计记录业务修改，不是完整访问日志。URL 查询和片段已脱敏，文本只记长度，密码只记保护状态；不能通过审计找回密码或正文。令牌模型没有 `last_used_at`。

<a id="api-reference"></a>

## 3. 全部管理接口

以下描述的返回值都是外层 `data`，省略重复的 `ok:true`。`{id}` 是实际资源 ID，调用时不带花括号。

### GET /session：我是谁，能做什么？

任意已认证会话可用，无额外 scope。返回：`user`、`scopes`、`source_url`、`auth_kind`（access/token/local）、`site_name`、`analytics_configured`、`link_write_scope`（owned/workspace）、`version:"1.0.2"`，以及下面的功能和策略对象：

```json
{
  "features":{
    "browser_timezone_collection_enabled":false,
    "browser_checks_configured":false,
    "redirect_cache":false,
    "cache_consistency":"d1-guarded",
    "redirect_cache_default_ttl":300,
    "passwords_configured":false,
    "text_responses":true,
    "device_header_enabled":false
  },
  "security":{
    "queryKeys":["utm_source","utm_medium","utm_campaign","utm_term","utm_content"],
    "expiredStatus":404
  }
}
```

这些是结构示例，实际值以部署为准。全局采集标志反映 Admin 中的采集与统计开关，公开端执行还要求真实 Analytics 写入绑定。`passwords_configured` 和 `browser_checks_configured` 只检查 Admin 本侧根密钥格式，不证明两端值相同、Redirect 绑定完整或访客流程已经可用。会话不返回根密钥、Access 凭据、私有目标白名单或令牌明文。

### GET /summary：工作区有多少链接？

需 `links:read`。返回 `{"links":6,"active":5,"expired":1,"domains":2}`。active 要同时满足链接/域名启用、未过期和未耗尽；expired 单独按时间统计，不保证与其他状态互斥。

### GET /links：列出链接

需 `links:read`。支持两种分页，按 `created_at DESC,id DESC` 排序。

| 查询参数 | 规则 |
| --- | --- |
| `pagination,page,cursor,limit` | 见共同分页规则 |
| `view` | full 默认完整对象；picker 仅 `id,hostname,slug` |
| `include_total` | 字符串 true/false；页码默认 true，游标默认 false |
| `q` | 搜索 slug/title/target_url；转义后的 LIKE 模式含两侧 `%`，最多 50 个 UTF-8 字节 |
| `domain_id` | 按域名 ID 过滤，未知 ID 通常得到空列表 |
| `status` | all/active/disabled/expired/exhausted |

游标响应为 `{"items":[],"limit":25,"next_cursor":null}`，仅要求计数时附 total。页码响应含 page；默认附 total。搜索上限按实际模式字节而非“50 个汉字”，超出为 400 `search_too_long`。

### POST /links：创建一条链接

需 `links:write`。接受第 2 节创建字段，返回 201 PublicLink。

```json
{"domain_id":"11111111-1111-4111-8111-111111111111","slug":"welcome","target_url":"https://www.example.org/start","title":"欢迎页","redirect_code":302,"cache_ttl":0}
```

创建者由认证身份决定，不能自行填写。自动短码冲突最多尝试 5 轮；显式短码冲突返回 409。无域名为 400 `domain_not_found`；需要的根密钥未配置会失败，不降级为明文。链接和成功审计同批提交。

### GET /links/{id}：读取一条链接

需 `links:read`。返回 PublicLink，不存在为 404。可读取他人创建的工作区链接；不会返回密码校验串。

### PATCH /links/{id}：改一条链接

需 `links:write`，同时检查所有权。提交当前 version 和要改的字段：

```json
{"version":1,"title":"新标题","target_url":"https://www.example.org/new","cache_ttl":0}
```

返回更新后的 PublicLink。重置次数可传 `reset_redirect_count:true`；移除密码传 `password:null`。找不到为 404，版本旧为 409 `version_conflict`，跨所有者为 403 `link_owner_required`。

改域名/短码后先提交 D1，再尽力清除旧 KV；两种存储不是跨服务原子事务，旧缓存仍受最新 D1 校验。已经发给客户端的响应不能强制收回。

### DELETE /links/{id}：删除链接

需 `links:delete` 和所有权，必需 `?version=1`，无正文。成功 `{"deleted":true}`；不存在 404、版本冲突 409、无权 403。D1 日归档随外键级联删除，已经写出的 Analytics Engine 历史事件不会由这个接口清除。

### POST /links/import：小批量创建

需 `links:write`，顶层仅 `links`，数组 1–10 项，每项为创建字段：

```json
{"links":[{"domain_id":"11111111-1111-4111-8111-111111111111","slug":"notice","response_mode":"text","text_content":"维护已完成。","geo_rules":[]}]}
```

成功 201，返回 `{"imported":1,"ids":["22222222-2222-4222-8222-222222222222"]}`。本请求先校验全部条目，再事务提交；其中一条验证/唯一性失败则本批不部分导入。它不接收 CSV、multipart、只读导出字段、domains 或 settings；GUI 在客户端完成文件转换和分批。

### POST /links/bulk：批量启停或删除

正文只含 `action,items`。action 为 enable/disable 时需 `links:write`，delete 时需 `links:delete`；每项都检查所有权。items 为 1–10 个不重复的 `{id,version}`：

```json
{"action":"disable","items":[{"id":"22222222-2222-4222-8222-222222222222","version":1}]}
```

返回 200 `{"results":[{"id":"22222222-2222-4222-8222-222222222222","ok":true}]}`。失败项可能带 `forbidden:true` 或 `conflict:true`。**200 不等于每一项都成功**，逐项处理也不整体回滚；先检查 results 再向用户确认。

### GET /domains：列出域名

需 `domains:read`，无分页。默认按 hostname 排序返回完整 Domain 数组及 `link_count`，包括停用域名。`view=directory` 只返回 `id,hostname,enabled,default_redirect_code`，适合选择框并减少计数查询；无单独 `GET /domains/{id}`。

### POST /domains：登记业务域名

需 `domains:write`，当前仅真人 Admin/Owner 可满足。只接受 hostname、name、enabled、default_redirect_code：

```json
{"hostname":"go.example.com","name":"公共入口","enabled":true,"default_redirect_code":302}
```

hostname 必需，最长 253 字符，只写规范域名，不带协议、端口或路径。name 默认空且最长 100，enabled 默认 1，状态码默认 301。返回 201 Domain，不保证带 link_count。重复主机为 409；管理主机为 400 `admin_hostname`；已有链接默认/地区目标使用此主机时为 409 `hostname_is_destination`，先迁移目标避免短链环路。

这个接口只写 D1，不配置 DNS、证书或 Worker 绑定。

### PATCH /domains/{id}：改域名设置

需 `domains:write`。只接受 version、name、enabled、default_redirect_code：

```json
{"version":1,"name":"团队入口","enabled":true,"default_redirect_code":302}
```

返回 Domain。hostname 不可修改，传入会 400；不存在 404，版本冲突 409。停用影响其下全部链接；默认状态码只影响以后新建且未指定码的链接。

### DELETE /domains/{id}：删除域名记录

需 `domains:write`，查询必需 version，无正文。成功 `{"deleted":true}`。仍有链接引用时 409 `in_use`，需先移动或删除链接；不会自动清除平台 DNS 或 Custom Domain。

### GET /stats：查实时统计

需 `analytics:read`。默认 `view=full`，`view=dashboard` 只返回总量/趋势和共同元数据，减少查询量。

| 参数 | 规则 |
| --- | --- |
| `days` | 默认 7，整数 1–90；以 UTC 分组 |
| `view` | full/dashboard，只允许出现一次 |
| `link_id` | 一个小写标准 UUID |
| `link_ids` | 逗号分隔 1–50 个小写标准 UUID |

两种 ID 参数互斥，各自不能重复出现；空串、空项或尾逗号无效。50 项先计数再去重。都不传表示整个工作区；显式选择中有任一 ID 不存在，404 `stats_link_not_found`，即使未配置统计也先检查选择。days 当前按第一个值解析，调用方仍应只发一次。

未配置返回 200，而不是错误或零访问：

```json
{"available":false,"reason":"Analytics Engine is disabled or the Analytics Read secret is not configured.","sampled":true,"link_ids":null}
```

成功时两种视图都有 `available:true,sampled:true,timezone:"UTC",days,link_ids,clicks,timeline`。timeline 为 `[{date,clicks}]`，没有事件的日期不保证补零；clicks 是成功业务 GET 的采样加权值，不是人数。

full 另外包含：

| 字段 | 内容 |
| --- | --- |
| `top` | 最多 50 条 `{link_id,hostname,slug,clicks}` |
| `countries` / `referrers` | 各最多 20 项 `{country,clicks}` / `{referrer,clicks}`，来源仅主机 |
| `timezones` / `ip_timezones` | `{timezone,clicks}`，分别是浏览器自报 / IP 地理时区，缺失为 none |
| `devices` | `{device,clicks}`，device 为 mobile/pc/none |
| `suspected_vpn_visits` / `suspected_vpn_successes` | 疑似事件与其中成功访问估计 |
| `blocked_vpn_visits` / `unknown_timezone_blocks` | 疑似 VPN 拒绝 / 未知时区拒绝估计 |
| `unverifiable_blocks` | ASN、时区或延迟不可验证的拒绝估计，含未知时区拒绝 |
| `unknown_timezone_successes` / `tor_visits` | 未知时区成功 / Tor 事件估计 |
| `vpn_scope` | `terminal_successes_and_policy_denials_not_unique_users` |
| `success_scope` | `authorized_get_redirect_or_text` |
| `dimension_sources` | 如下来源说明 |

```json
{"dimension_sources":{"timezone":"javascript_client_reported","ip_timezone":"cloudflare_ip_geolocation","device":"cloudflare_generated_header","browser_timezone":"javascript_client_reported_untrusted","tor":"cloudflare_request_cf_country_T1","device_header_enabled":false}}
```

整组请求 10 秒上游时限，完整视图最多两路并发；成功结果可在同实例复用 15 秒，权限和链接选择仍每次检查。上游结构/计数失败 502 `analytics_query_failed`，超时 504 `analytics_timeout`，调用方取消 408 `request_aborted` 并停止后续查询。

### GET /stats/archive：查 D1 每日归档

需 `analytics:read`。支持两种分页和相同 link_id/link_ids，**不实现 days 筛选**。按 date 降序、link_id 升序。page 响应含 items/page/limit，cursor 含 items/limit/next_cursor；都包含 `sampled:true,link_ids,dimension_detail_available:false`，都没有 total。

items 为 DailyStat。只包含已写入 D1 且链接仍存在的每日计数，无国家/时区/设备明细；不是实时统计错误时自动启用的后备。统计关闭后，旧归档仍可读。

### GET /users：列出成员

需 `users:write` 且交互式，即 Owner。返回按创建时间排序的 User 数组，无分页，无单独用户 GET。

### POST /users：登记成员

Owner 交互式。仅接受 email、display_name、role：

```json
{"email":"editor@example.com","display_name":"内容维护","role":"editor"}
```

email 必需，最长 254，去首尾空白并转小写；display_name 默认空、最长 100；role 默认 viewer，可为 viewer/editor/admin/owner。新用户启用，不能自行传 enabled、access_sub、id、version。返回 201 User，重复邮箱 409，非法角色 400。不会发邮件或修改 Access 策略。

### PATCH /users/{id}：修改角色或停用

Owner 交互式。仅接受 version、display_name、role、enabled：

```json
{"version":1,"role":"viewer","enabled":false}
```

返回 User，不存在 404、版本旧 409；不能停用/降级最后一名启用 Owner，否则 409 `last_owner`。不能改邮箱或身份 subject，无 DELETE 用户接口。停用阻止后续身份/令牌认证，不删除其公开链接。

### GET /tokens：列出我的令牌

任意交互式会话，只列本人，按创建时间降序；包括已撤销记录，无分页。scopes 是 JSON 字符串，需 `JSON.parse`；prefix 只供显示，不是可用 token。不返回完整值、token_hash 或最后使用时间。

### POST /tokens：创建我的令牌

交互式会话。只接受 name、scopes、expires_at。name 为 1–100 字符且非全空白；scopes 原数组 1–5 项，限定为当前用户能授予的五种应用权限，合法重复项去重；越权为 403 `invalid_scopes`。

expires_at 是创建时起至少 60 秒、最多 365 天的 Unix 秒。使用动态计算，例如 `Math.floor(Date.now()/1000)+7*86400`，不要复制已经过期的固定时间。50 条未撤销记录后返回 409 `token_limit`，过期未撤销也计入。这个计数检查不是并发情况下的严格全局配额。

成功 201 返回 `id,token,name,scopes,expires_at,shown_once:true`；scopes 此时是数组。完整 token 只返回一次，立刻安全保存；读取列表找不回来。

### DELETE /tokens/{id}：撤销我的令牌

交互式且属于本人，无 version、无正文。成功 `{"revoked":true}`。已撤销、不存在或属于别人均为 404，重复调用不保证再次成功。应用 token 不能调用此接口撤销自己。

### GET /audit：查看操作记录

需 `audit:read`，即真人 Admin/Owner。支持两种分页，按 `created_at DESC,id DESC`；cursor 省去总数查询，page 仍有精确 total。没有用户、动作或日期筛选参数。items 为 Audit，details 是 JSON 字符串；敏感内容不会据此恢复。

### GET /settings：读取站点设置

需 `settings:write` 且交互式，即 Owner。返回按 key 排序的 Setting 数组，可能含归档内部记录。不要把全部读取结果原样提交回去。

### PATCH /settings：改站点名称

Owner 交互式，只接受 `site_name`，1–80 字符且非全空白：

```json
{"site_name":"团队短链接"}
```

成功返回同样的 site_name 对象。无 version，最后一次写入生效。此接口不修改 Access、域名绑定、统计开关、KV 或 secrets。

### GET /system/health：检查 D1

需 `settings:write`，当前实际用户为 Owner。执行 D1 `SELECT 1` 后返回：

```json
{"worker":"ok","database":"ok","analytics":"configured_not_probed","version":"1.0.2"}
```

统计配置不完整时为 `disabled_or_incomplete`。`configured_not_probed` 只表示配置存在，**没有实际查询 Analytics Engine**。D1 故障不会返回这份成功对象。

没有列出的 PUT、用户删除、所有权转移、token 刷新、手工归档、API 批量导出等接口，不应假设存在。

<a id="public-api"></a>

## 4. 访客短链协议

这些路径位于 Redirect 的短链域名，**不带 `/Linro/v1`**。应用 token 不能充当访客解锁密码。

### 路由和缓存

| 方法与路径 | 用途 |
| --- | --- |
| GET/HEAD `/` | 200 品牌文本，不列链接或转后台 |
| GET/HEAD `/health` | 裸 JSON `{"status":"ok","version":"1.0.2"}`，不查 D1 |
| GET/HEAD `/robots.txt` | 禁止索引的文本提示，不是访问控制 |
| GET/HEAD `/__Linro_assets/{file}` | 带指纹的 CSS/JS 可缓存一年，无指纹旧路径 no-store |
| GET/HEAD `/{slug}` | 跳转、文本、保护页或拒绝 |
| POST `/__Linro_unlock/{slug}` | 密码解锁 |
| POST `/__Linro_browser/{slug}` | 浏览器证明提交 |
| GET `/__Linro_rtt`（WebSocket Upgrade） | 一次连接，五轮服务端 RTT 挑战，成功升级返回 101 |

内部 POST 路径用错方法返回 405 `Allow: POST`；其他公开路径只接受 GET/HEAD。公开限流先于 health、资源和业务读取，因此生产限流绑定故障也可能让 health 为 503。

普通有效链接返回配置的 301/302/307/308 和 Location；文本为 200 `text/plain; charset=utf-8`，没有 Location。不存在或停用为 404；过期按配置为 404/410；次数耗尽为 403。

业务跳转和文本响应禁用 CDN 缓存；前述带指纹静态资源仍可公开缓存。无密码/地区规则/次数上限/浏览器流程的普通跳转，才按 `cache_ttl` 允许私有客户端缓存，并受剩余有效期约束；文本和保护响应 no-store。不要用外层 Cache Everything 覆盖这些规则。

**最终获准的 HEAD 也会消耗有限次数额度**，只是没有响应正文，也不记成功点击。密码页 HEAD 不解锁、不扣额度。仅全局采集开启时 HEAD 可直接响应；单链 VPN 检查缺证明时 HEAD 拒绝。

### 密码提交

尚未解锁的 GET 返回 200 密码页。POST 正文为 `application/x-www-form-urlencoded`，只有一个 password 字段，最多 8192 字节。密码错误为 401 HTML。

来源需能证明同源：存在 `Sec-Fetch-Site` 时必须是 same-origin；显式 Origin 必须与完整 origin 一致。缺失或 `null` Origin 仅在 Sec-Fetch-Site 明确 same-origin 时可能通过，显式其他 Origin 仍被拒绝。

内置页面用 `Accept: application/json` 获取 200 JSON，随后普通导航到同源短码；普通表单得到 303。成功设置 `__Host-Linro_unlock_*` Cookie，最长 900 秒，生产使用 Secure、HttpOnly、Path=/、SameSite=Lax，绑定链接、主机和规则修订。POST 不扣额度、不记成功点击；新的 GET 会再检查规则，密码不发送给目标。

无密码链接的解锁 POST 为 405。修改受保护规则、更换或移除密码可使旧 Cookie 失效。

### 浏览器检查提交

全局采集需要 `BROWSER_TIMEZONE_ENABLED=true`、统计开启和实际 Analytics 写入绑定；单链 `block_vpn=1` 则独立要求检查。浏览器报告的时区不可信，与平台 IP 时区只是不同来源的信号。

POST `/__Linro_browser/{slug}` 使用 `application/x-www-form-urlencoded` 表单，含唯一的 `challenge` 和 `timezone`。开启 `block_vpn` 时，`latency` 只传 Worker 签发的不透明回执，最长 128 字符。表单最多 4096 字节，挑战最长 2200 字符，时区最长 64 字符。

Accept 只控制成功结果，不改变正文或认证：明确接受 application/json 且 q 有效大于 0 时返回 200：

```json
{"ok":true,"data":{"next":"/welcome?_Linro_check=1"}}
```

未明确接受 JSON、仅通配或 JSON q=0 时返回 303，Location 为同一个 next。两种成功都设置短期 `__Host-Linro_browser_*` Cookie、`Vary: Accept` 和 no-store，不扣额度或记成功点击，也不在 POST 中给出最终目标。

恢复 GET 必须同时有恰好一个 `_Linro_check=1` 和有效 Cookie。证明最长 120 秒，不延长挑战窗口，绑定规则、主机、查询和网络上下文；缺一、过期或变化都不能绕过。最终会清除 Cookie，但没有服务端一次性消费表，不是绝对防重放的一次性凭据。

单链 VPN 检查先于密码页检查 Tor 和 ASN，仅允许 Radar 的 `ACCESS_ISP` 与 `ORGANIZATION`。被提前拒绝时不建立测量连接。

浏览器以相同查询串向 `/__Linro_rtt` 发起同源 WebSocket GET 升级，子协议列表依次为 `linro-rtt-v3`、当前签名挑战。Worker 校验来源与挑战后选定第一个子协议。普通 GET 返回 426，旧 POST 返回 405。浏览器发 `ready` 后开始计时，握手时间不计入样本。Worker 在一条同源 WebSocket 上发出 5 轮随机挑战，浏览器逐条原样回传。每次收到正确回包后等待 400 ms 再发下一轮。Worker 计时并与该连接的 TCP 或 QUIC RTT 比较。五轮全部完成且至少一轮的绝对差严格小于 55 ms 才通过；恰好 55 ms 不算通过。 会话最长 30 秒，且受原挑战到期时间限制。完成时末帧 `receipt.<回执>` 携带绑定原挑战的认证结果；错误回包、超时或中断无法取得放行凭据。测量不消耗短链次数。

内置 JS 使用普通导航继续，避免把密码/浏览器 POST 链式提交到跨站目标。旧式 303 表单仍在，但不能保证无 JS/Cookie 的客户端完成所有流程。保护页提供中文/English 切换。

### 公开状态码怎么读？

| 状态 | 常见含义 |
| --- | --- |
| 200 | 系统路径、资源、保护页、最终文本或内部 POST JSON 成功，须看 Content-Type |
| 301/302/307/308 | 最终跳转，只证明首跳，不证明目标网页成功 |
| 303 | 内部解锁/检查后的同源继续步骤 |
| 400/415 | HTTPS、表单或格式不合规 |
| 401 | 密码错误 |
| 403 | 来源不合规、额度耗尽或检查拒绝 |
| 404/410 | 不存在、停用或过期 |
| 405 | 方法错误或不适用的内部 POST |
| 414 | 请求/组合 URL 过长 |
| 429 | 限流，按 Retry-After 等待 |
| 503 | 数据库、密钥、规则或限流配置故障；不能据此放宽保护 |
| 508 | 最终目标形成直接跳转环路 |

公开端可能返回 HTML、文本或 JSON，不要对所有响应强行解析管理 API 的 envelope。

<a id="examples"></a>

## 5. 从一个只读调用开始

### Bash / curl

先在秘密管理工具或私有进程环境中设置 Access 服务凭据与 Linro token。下面不会提供真实值，也不自动跟随重定向：

```bash
export LINRO_ADMIN_ORIGIN='https://admin.example.com'
: "${CF_ACCESS_CLIENT_ID:?请设置 Access Client ID}"
: "${CF_ACCESS_CLIENT_SECRET:?请设置 Access Client Secret}"
: "${LINRO_API_TOKEN:?请设置 Linro 应用令牌}"

curl --silent --show-error --fail-with-body --max-time 20 \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $LINRO_API_TOKEN" \
  -H 'Accept: application/json' \
  "$LINRO_ADMIN_ORIGIN/Linro/v1/session"
```

`--fail-with-body` 对 4xx/5xx 失败；Access 302 仍可能退出 0，要核对 HTTP 状态、Content-Type 和 ok 值。不要加 `-L`。要列出链接，把末尾改为 `/links?pagination=cursor&limit=25`，令牌需有 links:read。

创建前先 GET `/domains?view=directory` 取得真实 domain_id，再把本页创建示例保存为 `create-link.json` 并改值。下面会真正创建业务记录：

```bash
curl --silent --show-error --fail-with-body --max-time 20 \
  -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
  -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
  -H "Authorization: Bearer $LINRO_API_TOKEN" \
  --data-binary @create-link.json \
  "$LINRO_ADMIN_ORIGIN/Linro/v1/links"
```

创建超时不代表没有写入；先按短码检查结果，再决定重试。不要无条件重放写请求。

### PowerShell：读取，再用当前版本改标题

在私有环境注入相同三项凭据，替换管理主机和链接 ID。此例会修改标题：

```powershell
$ErrorActionPreference = 'Stop'
$LinroOrigin = 'https://admin.example.com'
foreach ($LinroName in 'CF_ACCESS_CLIENT_ID','CF_ACCESS_CLIENT_SECRET','LINRO_API_TOKEN') {
    if (-not [Environment]::GetEnvironmentVariable($LinroName)) {
        throw "缺少环境变量：$LinroName"
    }
}
$LinroHeaders = @{
    'CF-Access-Client-Id' = $env:CF_ACCESS_CLIENT_ID
    'CF-Access-Client-Secret' = $env:CF_ACCESS_CLIENT_SECRET
    'Authorization' = "Bearer $($env:LINRO_API_TOKEN)"
    'Accept' = 'application/json'
}
$LinroId = '22222222-2222-4222-8222-222222222222'
$LinroUri = "$LinroOrigin/Linro/v1/links/$LinroId"
$LinroCurrent = Invoke-RestMethod -Uri $LinroUri -Headers $LinroHeaders -Method Get `
    -MaximumRedirection 0 -TimeoutSec 20
if ($LinroCurrent.ok -ne $true -or -not $LinroCurrent.data.version) {
    throw '没有收到有效链接对象'
}
$LinroBody = @{version=$LinroCurrent.data.version;title='更新后的标题'} | ConvertTo-Json -Compress
$LinroUpdated = Invoke-RestMethod -Uri $LinroUri -Headers $LinroHeaders -Method Patch `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($LinroBody)) `
    -MaximumRedirection 0 -TimeoutSec 20
$LinroUpdated.data | Select-Object id,slug,title,version
```

读取与修改之间仍可能被别人先修改，409 是正常保护，不要忽略。脚本和诊断输出按私有业务资料保管。

### 在自己的管理页面调用交互式接口

真人会话写请求用当前同源 Cookie，不带应用 token，并设置 `X-Linro-CSRF: 1`。以下函数只演示请求结构，不会自行执行修改：

```javascript
async function updateSiteName(siteName) {
  const response = await fetch('/Linro/v1/settings', {
    method: 'PATCH',
    credentials: 'same-origin',
    redirect: 'manual',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-Linro-CSRF': '1'
    },
    body: JSON.stringify({ site_name: siteName }),
    signal: AbortSignal.timeout(20000)
  });
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    throw new Error('没有收到 JSON，请检查 Access 会话与同源页面');
  }
  const result = await response.json();
  if (!response.ok || result.ok !== true) {
    throw new Error(result.error?.code || `HTTP ${response.status}`);
  }
  return result.data;
}
```

只在你管理的同源页面中调用，且此接口需要 Owner。不要在不可信网站粘贴携带凭据的脚本，也不要打印认证 Cookie。

<a id="troubleshooting"></a>

## 6. 主要管理错误码

先判断认证和 HTTP 状态，再看 code。表中没有的错误也应按失败处理；公开表单错误不必使用同一 JSON 格式。

| HTTP | code | 怎样处理 |
| --- | --- | --- |
| 400 | `empty_body, invalid_json, unknown_field, invalid_field` | 检查 UTF-8 JSON 对象、已声明字段、数字/长度/版本 |
| 400 | `invalid_slug, invalid_url, invalid_hostname, invalid_email` | 按字段约束改输入 |
| 400 | `invalid_code, invalid_query_mode, unsafe_query_mode` | 使用支持值；敏感目标只能 discard |
| 400 | `internal_target, private_target, redirect_chain` | 改成允许的最终目标，不绕过管理/私网规则 |
| 400 | `domain_not_found, admin_hostname` | 选择已有业务域名，管理主机不能用于短链 |
| 400 | `invalid_geo_rules, duplicate_geo_rule` | 核对规则结构、数量、代码与重复项 |
| 400 | `invalid_response_mode, invalid_text_content, text_geo_conflict` | 核对文本长度、模式和空地区规则 |
| 400 | `invalid_block_vpn, invalid_link_password` | 核对保护字段和密码限制 |
| 400 | `invalid_status, search_too_long, invalid_view` | 核对列表筛选、UTF-8 模式字节数及视图 |
| 400 | `invalid_pagination, invalid_cursor` | 不混用 page/cursor，原样传回合法游标 |
| 400 | `invalid_link_id, invalid_stats_view` | 核对统计选择、重复参数、最多 50 项和视图 |
| 400 | `invalid_import, invalid_batch, invalid_action, duplicate_item` | 核对 1–10 条批次及不重复 ID |
| 400 | `invalid_role, invalid_name, https_required` | 使用有效角色/非空名称/生产 HTTPS |
| 401 | `access_required, invalid_access_token` | 检查 Access JWT 和应用配置 |
| 401 | `invalid_token, local_token_required` | 检查对应令牌格式、期限、撤销和用户状态 |
| 403 | `user_not_allowed, human_identity_required` | 登记启用用户；服务身份还需 Linro token |
| 403 | `forbidden, invalid_scopes, interactive_only` | 当前角色/令牌不能执行，交互式操作用真人会话 |
| 403 | `link_owner_required, cross_origin, csrf` | 核对创建者、同源与 CSRF 请求头 |
| 404 | `not_found, api_not_found, stats_link_not_found` | 核对资源、方法、路径与选择 ID |
| 408 | `request_aborted` | 调用已取消，停止后续处理 |
| 409 | `conflict, version_conflict` | 去重或刷新版本后比较修改 |
| 409 | `in_use, last_owner, token_limit` | 处理引用、保留有效 Owner、撤销不用的 token |
| 409 | `hostname_is_destination` | 先迁移已有目标，再登记该短链域名 |
| 413/414/415 | `body_too_large, uri_too_long, content_type` | 减小正文/URL，使用正确媒体类型 |
| 421 | `wrong_host` | 使用正确管理 origin |
| 429 | `rate_limited` | 读取 Retry-After，避免高频重试 |
| 500 | `internal_error` | 保存 request_id 排查，不输出秘密或原始数据库信息 |
| 502 | `analytics_query_failed` | 检查 AE 上游结果、权限或数据 |
| 503 | `access_not_configured, access_keys_unavailable` | 检查 Access 配置或稍后重试公钥服务 |
| 503 | `link_password_unconfigured, invalid_password_record, browser_check_unconfigured` | 检查原根密钥和保存的保护数据 |
| 503 | `assets_missing, rate_limit_not_configured, security_policy_invalid` | 检查构建资源、绑定和安全策略 |
| 504 | `analytics_timeout` | 上游统计超时；可先用 dashboard 视图，不能当作零点击 |

公开浏览器表单还有 `browser_form_type`、`invalid_browser_form` 等错误，它们使用表单协议而非管理 JSON。更多按症状排查见 [指南](GUIDE.md#troubleshooting)。

本页对应 `apps/admin/src/worker/api.ts` 及各路由实现、`packages/shared/src/` 校验与保护模块、`apps/redirect/src/` 公开流程。源码导航和平台依据见 [SOURCES](SOURCES.md)。
