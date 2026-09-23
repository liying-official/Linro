# Linro v1.0.1 API 参考

[English](https://liying-official.github.io/Linro/?lang=en#api-reference) · [完整手册](GUIDE.md) · [权限矩阵](GUIDE.md#permissions)

本参考沿用完整手册第09–13及16章编号，共25个管理方法/路径组合。部署与角色章节中的细节属于同一版本契约。

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

短码仅保留 `health`、`cdn-cgi`，以及 `__linro_` 前缀；检查这些保留项时不区分大小写。`Linro`、`linro`、`admin`、`api`、`assets`、`robots`、`favicon` 均可用作业务短码。业务短码仍区分大小写，须满足 1–64 个 ASCII 字母、数字、`_` 或 `-`；`.well-known`、`robots.txt`、`favicon.ico` 等含点路径仍不符合短码语法。管理域名下的 `/Linro/v1` API 不受影响。

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
