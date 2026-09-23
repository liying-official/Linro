# Linro v1.0.1 API

基础路径：`https://ADMIN_HOST/Linro/v1`。生产环境始终需要有效 Cloudflare Access assertion；自动化另外需要应用 Bearer token。部署配置、服务 token 的完整接入流程见 README 的部署与自动化接入章节。

## 响应约定

成功：`{"ok":true,"data":...}`。失败：`{"ok":false,"error":{"code":"...","message":"...","request_id":"..."}}`。请求 ID 同时出现在响应头，用于定位问题。JSON 字段严格校验，拒绝未知写入字段；时间统一为 Unix **秒**；对象 ID 使用 UUID；页码从 1 开始。

普通分页默认 25、上限 100；列表排序通常为创建时间倒序 + ID 倒序。列表不是跨请求快照，批量导出时避免并发修改。

## 路由

| 方法 | 路径 | 权限 / 说明 |
|---|---|---|
| GET | `/session` | 当前用户、scopes、site_name、source_url、版本、link_write_scope 与公开的参数/到期策略 |
| GET | `/summary` | links:read；规则总数、有效/过期、域名数 |
| GET | `/links` | links:read；q、domain_id、status、page、limit |
| POST | `/links` | links:write；创建，201 |
| GET | `/links/:id` | links:read；详情 |
| PATCH | `/links/:id` | links:write；必须携带 version，并满足链接归属 |
| DELETE | `/links/:id?version=N` | links:delete；并满足链接归属 |
| POST | `/links/import` | links:write；每批 1–10 条，原子提交 |
| POST | `/links/bulk` | 启停需 links:write；删除需 links:delete；每批 1–10 条 |
| GET | `/domains` | domains:read；全部域名及 link_count |
| POST | `/domains` | domains:write；创建 D1 记录，不修改 DNS |
| PATCH | `/domains/:id` | domains:write；version；域名不可改名 |
| DELETE | `/domains/:id?version=N` | domains:write；必须先移除该域名全部链接 |
| GET | `/stats?days=7&link_id=UUID` | analytics:read；days 为 1–90，单选link_id或多选link_ids，最多50，不能混用 |
| GET | `/stats/archive?page=1&limit=25` | analytics:read；D1 日归档，items，无 total；支持相同link_id/link_ids筛选，不含设备/时区明细 |
| GET / POST | `/users` | Owner + 交互式会话；列表/创建 |
| PATCH | `/users/:id` | Owner + 交互式会话；version；停用而非删除 |
| GET / POST | `/tokens` | 交互式会话；仅管理本人 token |
| DELETE | `/tokens/:id` | 交互式会话；撤销本人 token |
| GET | `/audit` | audit:read；分页审计 |
| GET / PATCH | `/settings` | Owner + 交互式会话；仅可写 site_name |
| GET | `/system/health` | settings:write；D1 实查，统计仅展示配置状态 |

两个 Worker 另有 `/health`：Admin 先鉴权（可能读 D1/JWKS），Redirect 为不读 D1 的公开存活接口但受 REDIRECT_LIMITER 限流。公开 Redirect Worker 的普通短码只接受 GET/HEAD，另有保留的密码解锁 POST（见下文），Admin API 路由按表列明方法；未知 API 或不支持的 API 方法返回 JSON 404，不回退成 SPA。

## 创建与修改链接

```json
{
  "domain_id": "实际域名UUID",
  "slug": "docs",
  "target_url": "https://example.org/docs?a=1",
  "title": "项目文档",
  "description": "备注",
  "redirect_code": 301,
  "query_mode": "discard",
  "enabled": true,
  "expires_at": null,
  "cache_ttl": 0
}
```

redirect模式的`domain_id` 和 `target_url` 必须提供；text模式则需要domain_id和text_content，不需要target_url；slug 为空或省略时自动生成。未指定状态码采用域名默认值。title ≤200、description ≤2000、URL ≤4096、slug ≤64；URL 必须是显式 http/https，无 credentials/control characters。后台/受管短域名禁止作为目标；私有/本地目标默认拒绝，仅部署者的精确主机例外可允许。写入与有效跳转两处复检，不能用直接改库绕过；不解析 DNS。

PATCH 提供需要修改的字段及当前 `version`，例如：

```json
{"version":1,"target_url":"https://example.org/updated","enabled":true}
```

服务器更新后 version 加 1。过期版本返回 409；不要自动覆盖，先重新读取并处理冲突。DELETE 同样必须提供 `?version=N`。响应中有 `short_url`、hostname、created_at、updated_at、version 等。

**Query**：discard 忽略传入；merge/replace 仅传入部署允许的精确参数名（默认五个 utm_*）。merge 仍目标同名键优先；replace 会清空旧 query，即便来访过滤后为空。敏感键禁止配置；可识别的认证/登录/重置/令牌/跳转参数目标必须 discard，否则写入返回 400 unsafe_query_mode；旧同类目标在公开读路径直接采用 discard，数据库不自动改写。**缓存**：cache_ttl=0 为 no-store，非零是 private 客户端缓存，最大 3600 秒，且不能超过到期时间剩余长度。有地区规则、密码、次数上限或浏览器检查流程时强制 no-store，忽略非零客户端 TTL。

## 列表查询

```text
GET /links?q=docs&domain_id=UUID&status=active&page=1&limit=25
```

status 支持 `all`、`active`、`disabled`、`expired`、`exhausted`（已达上限）；active 会排除耗尽记录。搜索匹配 slug、title、target_url；长度最多 120。LIKE 特殊字符被转义，不作为通配符注入。

```json
{"ok":true,"data":{"items":[],"total":0,"page":1,"limit":25}}
```

## 批量与导入

```json
{"links":[{"domain_id":"UUID","slug":"a","target_url":"https://example.org/a"}]}
```

`/links/import` 一个请求全部成功或回滚，成功为201并返回 imported、ids。多个请求之间不是一个大事务；网络超时不代表服务器一定没提交，先查询去重。

```json
{"action":"disable","items":[{"id":"UUID","version":2}]}
```

`/links/bulk` 的 action 为 enable/disable/delete。每项有独立事务，响应 `results:[{id,ok,conflict?,forbidden?}]` 可出现部分成功。跨归属项目标 forbidden:true；版本冲突和已不存在项目标 conflict:true。拒绝项不记录成功审计；客户端需要逐项核对，不要只看 HTTP200。

## 域名、用户、设置

创建域名：`{hostname,name?,enabled?,default_redirect_code?}`；修改：`{version,name?,enabled?,default_redirect_code?}`。已有链接引用的域名不可删除。hostname 不能等于生产后台域名，也不能将现有链接默认目标或任一地区目标的主机新增为短链域名。

创建用户：`{email,display_name?,role?}`；默认viewer。修改：`{version,display_name?,role?,enabled?}`。邮箱创建后不可修改；首次验证后绑定 Access subject。身份提供商迁移导致 subject 改变时，需由数据库维护者在完成身份核实和备份后重置该用户绑定；不提供公开自助重绑。

设置：`PATCH /settings` 接收 `{site_name:"团队名称"}`，长度1–80。其它配置通过部署文件或 secret 管理。

## 应用令牌

创建：

```json
{"name":"automation","scopes":["links:read","links:write"],"expires_at":实际未来Unix秒}
```

上方时间占位符需替换为整数；最早为当前时间60秒之后，最迟为365天之后。权限候选为 links:read、links:write、links:delete、domains:read、analytics:read，且不得超过当前角色权限。没有 users/settings/admin token scope。

返回 `data.token` 只显示一次，过后只能撤销再生成。非撤销 token 数软限制50（并发创建不承诺严格配额）；到期但未撤销的 token 也计入此限制。令牌不能调用 `/tokens` 创建更多令牌，也不能管理其他用户。

## 统计

`/stats` 未配置时返回 HTTP200、`available:false`、reason；上游授权/查询失败则返回502。成功包含 available、sampled、timezone、days、clicks、timeline、top、countries、referrers。

这里的 clicks 是最终授权GET跳转或纯文本200响应的采样加权估算，不是去机器人后的真实点击或精确 UV。`/stats/archive` 是 D1 持久化日聚合，删除链接会级联移除该链接归档。

## 常用错误

400 参数错误；401 缺少/失效凭据；403 角色、scope、CSRF 或身份未授权；409 唯一键/版本/最后Owner等冲突；413 请求体过大；421 错误管理域名；429 限流；502 统计上游错误；503 数据库/签名公钥或必要绑定不可用。

客户端应显示错误 message 与 request_id。对 GET 可进行有限退避重试；创建、导入、批量写入未实现客户端 idempotency-key，重试前查询确认。

## 链接归属与响应边界

交互式 Owner/Admin 的 link_write_scope 为 workspace；Editor、Viewer 以及**所有应用 token**为 owned，但仍必须先满足具体操作 scope。owned 的更新、删除和批量操作必须满足 link.created_by == principal.user.id；不是 token_id。同一用户的多个 token 共享归属，建议 CI 使用独立 Editor。读取仍遵循团队共享模型，并非用户隐私隔离。created_by 为 null 的行只允许交互式 Owner/Admin 治理。客户端不得在创建/导入/更新中指定 created_by。

/session 新增示例（原有字段保留）：

```json
{"link_write_scope":"owned","security":{"queryKeys":["utm_source","utm_medium","utm_campaign","utm_term","utm_content"],"expiredStatus":404}}
```

不会将 private target 例外主机列表加入此会话响应。界面据 session 和 created_by 限制操作入口，最终仍由后端独立判断。

| 响应 | 意义 |
|---|---|
| 403 link_owner_required | 当前写入主体不拥有该链接（交互式管理员例外） |
| 400 unsafe_query_mode | 可识别的敏感目标必须 discard |
| 400 private_target | 私有/本地目标未被部署例外允许 |
| 400 internal_target / redirect_chain | 不得指向后台或受管短域名 |
| 503 security_policy_invalid | 部署策略无效，需修正配置，不是用户可覆盖的输入 |
| 公开 429 + Retry-After: 60 | D1 查询前位置级限流；HEAD 无 body，无 Location |
| 公开 503 + Retry-After: 5 | 缺必要绑定、限流异常、目标违规或数据库异常，不进行成功跳转 |

到期默认公开 404（显式 EXPIRED_LINK_STATUS=410 可保留旧 410），默认 no-store 不变。未知/停用/过期不会自动跳首页。通过配置扩大查询白名单或私有例外是部署权限，不是应用 API scope；现有 settings PATCH 仍只允许 site_name。


## 可选缓存、地区分流、密码与次数上限

`/session` 的 `features` 增加 `redirect_cache`（binding 是否存在）、`cache_consistency: "d1-guarded"`、`passwords_configured`（Admin secret 格式是否已配置）；它们不是对 KV/D1 连通性或两端 secret 一致性的线上探测。前端没有设置 namespace/secret 的 API；这些只由部署者通过配置管理。

### 新建/更新字段

```json
{
  "domain_id": "实际域名UUID",
  "slug": "regional",
  "target_url": "https://example.org/global",
  "geo_rules": [
    {"kind":"country","code":"JP","target_url":"https://example.org/japan"},
    {"kind":"continent","code":"AS","target_url":"https://example.org/asia"}
  ],
  "max_redirects": 100,
  "query_mode": "discard",
  "cache_ttl": 0
}
```

| 字段 | 写入语义 |
|---|---|
| `geo_rules` | 数组，0–32条，kind为country/continent，code两位大写，同kind/code不可重复；每个target_url通过与默认目标相同的验证。省略保留，空数组清除 |
| `password` | 新建省略/null为无密码；PATCH省略保留，null明确移除，字符串设置新密码；12–128字符，不trim，无控制字符；两端必须配置同一LINK_PASSWORD_SECRET |
| `max_redirects` | null无限制或1–1000000000整数；省略保留；0/负数/小数拒绝。已有已用次数不随编辑或改变上限清零 |
| `reset_redirect_count` | **仅PATCH**，boolean，true在同一次受版本/归属控制的更新中清零，并记录审计；省略/false不重置 |
| `version` | PATCH既有乐观锁，不能省略；设置密码/规则/限额仍受原scope和created_by限制 |

不可写 `password_hash`、`password_protected`、`redirect_count`、`remaining_redirects`、`rule_revision` 或 `created_by`。原 schema migration 0001不变，0002新增字段与修订触发器。

### 读取与导出

链接列表/详情新增：geo_rules数组、password_protected布尔、max_redirects、redirect_count、remaining_redirects（无限制null，否则不小于0）、rule_revision。**从不返回password/password_hash**。原id/version/目标URL等字段仍存在，团队读权限不会隐藏目标URL，因此链接密码不是用来隔离已授权后台成员的秘密。

Web JSON/CSV保留非秘密控制信息；导入时不恢复counter/readonly标志，也不接受verifier。GUI读取protected标志后，若没有新password会拒绝导入以避免降级；脚本调用者也必须做这项检查并转换为上述可写字段。公开API本身不接受原样整行导出对象。SQL备份可以保留校验串/计数/修订，恢复密码还必须使用原根secret。

### 公开访问协议

- 普通GET/HEAD从request.cf选择国家优先、大洲其次、默认最后；每次最新D1状态授权，KV命中不能跳过。地理规则不是认证，也不使用访客自填的country头。
- 受密码保护且无有效cookie：200 HTML挑战，无Location；HEAD没有body，仍无目标Location。页面使用自源CSS，不执行脚本。
- `POST /__Linro_unlock/<slug>`：来源判断按下文公开解锁来源规则，拒绝显式外站与矛盾metadata；Content-Type须为application/x-www-form-urlencoded且只包含单个password字段，实际body上限8192字节；错误密码401、限流429、依赖失败503。
- 正确密码：303至本站`/<slug>`并设置15分钟HttpOnly/Secure/SameSite=Lax cookie；这次不计入quota/AE。下一次GET才返回设定的目标状态码，POSTbody永不转发目标。
- 受限的最终GET与HEAD，各次返回目标Location前原子增加1；重复HEAD/GET都是不同请求。无上限时不写该counter，原AE仍仅统计GET。
- 耗尽：403纯文本，`Content-Language`，no-store，无Location。中文“此链接请求次数已到达上限，请联系管理员”，英文“This link has reached its request limit. Please contact the administrator.”；HEAD无body。Accept-Language或`_Linro_lang`决定UI语言，内部语言参数不透传。
- `/__Linro_assets/password.css`为密码页自源样式，所有`__Linro_`前缀短码保留。普通短码仍拒绝任意POST/PUT等方法。

单次D1条件UPDATE解决并发最后一个名额竞争，但不能证明客户端收到/访问目标；提交确认丢失时可能保守占用一格，不自动重试/退款或绕过上限。因限额开启而增加的D1写入与KV查询单独消耗资源；只把它称为服务器授权计数。

### 新增错误与运维约束

400 `invalid_geo_rules` / `duplicate_geo_rule`：规则形状、地区码、重复或长度不合要求；400 `invalid_link_password`：密码格式不符；503 `link_password_unconfigured`：Admin缺secret；target/query安全错误继续适用于所有地理目标。公开端D1/KV异常不会泄露密码或使用旧password_protected布尔值来放行。

所有写入先提交D1和审计，再尽力维护KV；缓存维护失败不意味着业务事务回滚。KV不是备份，也不是调用次数来源。密码计算/解锁cookie不依赖KV里是否带密码标志。


## 公开解锁来源规则

管理 API 字段、权限、计数语义及迁移不变。公开 `/__Linro_unlock/<slug>` 的非POST方法统一405，`Allow: POST`；HEAD无body。POST的Origin:null/缺失仅在严格同源Fetch Metadata下进入密码验证，显式外站Origin不论Metadata都403；正确Origin可兼容无Metadata客户端，但不得带矛盾的site值。后台CSRF不接受这个例外。

来源403为纯文本“请从短链密码页提交。”或“Please submit the form from the short link password page.”；沿用Accept-Language及_Linro_lang选择机制、no-store，无Location/Set-Cookie。错误密码仍401，正确密码内部303不计额度。不存在、停用或已耗尽的链接继续遵循原先查询/访问控制顺序，不利用错误提示泄露目标。


## 纯文本与精确链接选择

### 纯文本写入及读取

```json
{"domain_id":"实际域名UUID","slug":"notice","response_mode":"text","text_content":"第一行\nSecond line","query_mode":"discard","max_redirects":100}
```

新增可写字段response_mode（redirect/text，默认redirect）、text_content。正文限制1–16384 UTF-16代码单元/最多32768 UTF-8字节，无控制字符（TAB/CR/LF除外）。text模式不要求target_url、强制discard，不能携带非空geo_rules；修改旧分流链接须显式传geo_rules:[]。回到redirect模式必须提供通过原安全校验的target_url；text_content清除。纯文本无条件no-store，cache_ttl不用于缓存正文。

为保留原非空target_url数据库约束，text行内部使用非HTTP哨兵about:blank；API读取时target_url为空字符串。该哨兵不是可访问目标，不进入Location也不fetch。既有Link.id/version/归属规则不变，rule_revision随模式/正文变化递增，旧密码cookie失效。公共GET返回200 text/plain; charset=utf-8、nosniff，无Location；HEAD同状态/头但空body。密码/限额/启停/过期继续检查；最终成功GET/HEAD各扣一次配额，只有GET记AE。

JSON/CSV导出包含response_mode/text_content，正文是敏感业务数据；审计仅记录模式和正文长度，不记录正文。KV不缓存正文或text行。导入接受可写字段，不能把带readonly控制字段的整行直接POST；密码保护导出仍必须提供新密码，不能静默降级。

### 统计筛选

```text
GET /Linro/v1/stats?days=7
GET /Linro/v1/stats?days=7&link_id=11111111-1111-4111-8111-111111111111
GET /Linro/v1/stats?days=30&link_ids=11111111-1111-4111-8111-111111111111,22222222-2222-4222-8222-222222222222
GET /Linro/v1/stats/archive?link_ids=11111111-1111-4111-8111-111111111111&page=1&limit=25
```

UUID为示意值，必须换成真实存在的link.id，而不是slug或domain.id。无选择参数为全部；link_id为旧兼容单选，link_ids为逗号分隔1–50个小写规范UUID。两者不能混用，同名参数不能重复；不允许空值、尾逗号、任意SQL字符；重复UUID去重，但输入长度仍受50上限。任意选中ID不存在/已删除→404 stats_link_not_found，不自动忽略，更不会回退成全部。无效输入→400 invalid_link_id。所有路由仍要求analytics:read与正常Access/API认证；保留团队共享读取，不按创建者过滤。

新增结果字段：link_ids（null表示全部）、timezones:[{timezone,clicks}]、devices:[{device,clicks}]、dimension_sources、success_scope。device只为mobile/pc/none；缺失旧记录聚合进none。timezones分布为JavaScript自报浏览器时区；ip_timezones独立保留Cloudflare IP参考。顶层timezone:'UTC'仍为趋势分组时区。dimension_sources.browser_timezone='javascript_client_reported_untrusted'，旧浏览器未采集记录归none。success_scope='authorized_get_redirect_or_text'，不统计密码页/内部303/HEAD/失败；不是精确去重用户。

/stats/archive使用相同链接选择、参数化D1查询；只包含已有daily_stats日总量，dimension_detail_available:false，不生成不存在的历史时区/设备数据。AE为8条顺序查询、sample-weighted sum，无自动重试429；任意维度失败即整个查询明确失败，不能显示部分结果冒充完整筛选。

/session.features新增text_responses:true和device_header_enabled布尔值。设备开关由部署配置管理，不接受普通GUI或用户scope直接变更平台信任来源。

新增错误：400 invalid_response_mode、invalid_text_content、text_geo_conflict、invalid_link_id；404 stats_link_not_found。500/503等仍不得展示正文或密码作为诊断信息。

GUI 导入按单批最多10行且完整JSON UTF-8编码不超过262144字节分批。HTTP API仍严格执行该请求体字节上限，直接调用者同样需要分批；已有成功批次不会因后续失败回滚。

## 浏览器检查与 VPN 统计

Links创建/PATCH/导入支持block_vpn（JSON boolean或0/1；禁止字符串、null及未知类型）。未指定时新建默认0、PATCH保留旧值。启用新策略需要BROWSER_CHECK_SECRET；缺失返回503 browser_check_unconfigured，而非悄悄公开。读取/JSON/CSV包含此非秘密标志；日志记录flag，不记录浏览器证明或root。Editor/API令牌归属限制不变。直接SQL更新该flag也通过0004触发器更新rule_revision，不改计数。

/session.features新增browser_timezone_collection_enabled、browser_checks_configured，仅返回布尔，不返回secret。部署JSON新增browser_timezone_enabled默认true，两端变量必须同值；不能通过管理API写root。

公开POST /__Linro_browser/:slug仅接受同源浏览器表单challenge/timezone，每次实际读取上限4096B、严格两字段。非POST405。正确表单签名/当前D1规则通过后，若block_vpn=true且时区不匹配/Tor或时区不可验证则403（未知另列）。允许时，显式`Accept: application/json`（有效q>0）返回200 JSON `{"ok":true,"data":{"next":"/<slug>?_Linro_check=1"}}`及原签名HttpOnly证明Cookie，JSON无Location、无目标/正文；其它客户端保持303回同一短链。两种响应均有`Vary: Accept`和no-store，验证与拒绝路径完全共用，证明仍不超过原120秒；最终GET重新检查再返回业务结果。完成参数_Linro_check不是凭据，必须有配套有效Cookie，且内部参数不透传给目标。该端点不是后台Bearer API，访问密码仍先独立验证。

统计新增ip_timezones与suspected_vpn_visits、suspected_vpn_successes、blocked_vpn_visits、unknown_timezone_blocks、unknown_timezone_successes、tor_visits。VPN计数含最终成功GET与策略终止拒绝请求（含合法挑战POST的拒绝），不含中间200/303，不去重为人数。vpn_scope=terminal_successes_and_policy_denials_not_unique_users；Tor是request.cf.country=T1；浏览器/IP时区规范化后身份不一致为疑似。缺值unknown不标VPN，但开启block时安全拒绝。

原clicks/成功趋势/国家/来源/设备及每日归档只算double1>0的成功GET；新拒绝double1=0。每个新统计字段遵循同一link_id/link_ids范围。旧事件缺新字段，不回填猜测VPN/浏览器时区；旧日归档不增加不存在的历史维度。详细blob/double位置、拒绝码和部署顺序见README0.0/10.7。

### 浏览器提交与成功响应

JSON是**成功响应协商**，不是新增请求体格式：仍为application/x-www-form-urlencoded，仅challenge/timezone两个字段。application/json请求体仍415；非法来源、签名、规则、密码与策略均拒绝且无Set-Cookie。Accept不参与权限判断。密码解锁接口仍使用原303，不改后台API CSRF。

JSON 200与旧303均不扣quota、不记录成功访问；随后脚本校验next为同源同短码的相对路径，使用location.assign普通导航。不得将JSON响应的200误认为最终文本200，统计位置和double布局不变。旧表单回退可能仍受CSP阻止；只适合作兼容路径，不保证无JS浏览器能完成最终跨域跳转。公开页及拒绝提示改为通用环境检查文案，详细采集与判定边界仍见README与SECURITY。


## Linro v1.0.1 品牌与来源保护

JSON 导出 format 为 `linro`。v1.0.1 使用 `/Linro/v1`、`Linro_` 应用令牌、`X-Linro-*` 请求头、`/__Linro_*` 内部路径与 `_Linro_*` 查询参数；旧协议不再受支持，客户端需要同步升级并重新签发令牌。

`GET /session` 增加 `source_url`（由部署配置的公共 HTTPS 地址验证后返回，未配置时为空）；旧默认工作空间名仅显示映射为 Linro，用户自定义名不改库。

所有 `/Linro`、`/Linro/*` 若含显式非同源 Origin（含 null/空串）则在鉴权前 403 `cross_origin`。同源/无 Origin 仍适用原鉴权与 CSRF，不开放 CORS。两端 HTTPS 返回一年 HSTS（includeSubDomains，无 preload）；HEAD 无正文但保留安全响应头。公开 health 版本变为 1.0.1，仍属于只供运维的存活信号，不替代数据库或 Access 健康检查。
