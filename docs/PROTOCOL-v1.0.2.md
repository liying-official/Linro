# Linro v1.0.2 版本与协议对照

[English](PROTOCOL-v1.0.2.en-US.md) · [升级步骤](GUIDE.md#upgrade) · [API 细节](API.md)

应用版本像书的版次，协议像书中使用的语言。**升级到 v1.0.2，没有把现有管理 API 改成 `/v1.0.2`。** v1.0.1 实例沿用下面的对外标识。

| 作用 | 本版使用的标识 |
| --- | --- |
| 管理 API | `/Linro/v1`，大小写敏感 |
| 应用令牌 | `Linro_` 前缀加 43 个 base64url 字符，使用创建时返回的完整值 |
| 后台写入 / 本地开发头 | `X-Linro-CSRF` / `X-Linro-Dev` |
| 访客密码 POST | `/__Linro_unlock/{slug}` |
| 浏览器检查 POST | `/__Linro_browser/{slug}` |
| VPN 延迟探针 POST | `/__Linro_rtt` |
| 内部查询参数 | `_Linro_check`、`_Linro_lang`，不转发到目标 |
| 生产 Cookie | `__Host-Linro_unlock_*`、`__Host-Linro_browser_*` |
| JSON 导出标记 | `format: "linro"`、`version: "1.0.2"` |

## 页面资源与访客流程

页面使用带内容指纹的 `password.css`、`password.js`、`browser.js`，路径位于 `/__Linro_assets/`，指纹版本可长期缓存。没有指纹的旧路径继续返回当前资源，但使用 `Cache-Control: no-store`。

密码和浏览器验证成功时，内置页面接收 200 JSON 并重新打开同源短链；普通表单可得到 303。两种方式都不会把 POST 密码提交给最终目标。完整字段、Cookie 与错误行为见 [API](API.md)。

单链 VPN 检查会先判断 Tor 和 ASN，仅 Radar 的 `ACCESS_ISP` 分类可继续；通过后每次挑战尝试发送一个同源 RTT 探针。若网络在挑战前就被拒绝，浏览器直接得到 403 结果页，不发送探针。

## 从 v1.0.1 升级要保留什么？

保留 Worker 名称、数据库与其他资源绑定、Access 设置和原根密钥。已有令牌哈希、Cookie 格式、KV 键和 CSV 标记保持兼容，已有密码和有效令牌按原期限与规则继续验证。某些内部兼容字符串保留旧名称是为了继续读取已有数据，不能只为“看起来统一”而替换。

源码包含 `0001_initial.sql` 至 `0006_destination_hosts_and_archive.sql`。已经全部应用六项的数据库无需新增迁移；其他实例按实际迁移账本补齐，不按文件夹版本猜测，也不清库重建。

公开端保留 `health`、`cdn-cgi` 和 `__Linro_` 前缀，保留判断忽略大小写。`Linro` 仍可作为普通业务短码；`robots.txt` 等带点路径不符合短码语法。
