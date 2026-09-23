# Linro v1.0.1 协议升级

适用于 Linro v1.0.1。当前协议标识如下；旧协议名称不再作为别名。

| 项目 | 当前标识 |
|---|---|
| API 基础路径 | `/Linro/v1` |
| 应用令牌 | `Linro_` + 43 位 base64url 随机串 |
| CSRF / 本地开发请求头 | `X-Linro-CSRF` / `X-Linro-Dev` |
| 解锁与浏览器检查 | `/__Linro_unlock/:slug` / `/__Linro_browser/:slug` |
| 公开检查资源 | `/__Linro_assets/password.css` / `/__Linro_assets/browser.js` |
| 访客 Cookie | `__Host-Linro_unlock_*` / `__Host-Linro_browser_*` |
| 开发环境 Cookie | `Linro_unlock_*` / `Linro_browser_*` |
| 内部查询参数 | `_Linro_check` / `_Linro_lang` |

URL、令牌和 Cookie 名称区分大小写；HTTP 请求头按标准不区分大小写。`__Host-` 是浏览器安全前缀，继续保留，Cookie 的 Secure、HttpOnly、SameSite、有效期及主机/规则绑定不放宽。

## 升级步骤

1. 保存部署配置、secret 和数据库备份，同步部署两个 Worker。
2. API 客户端更新基础路径和请求头；Owner 通过原有 Cloudflare Access 登录后重新创建应用令牌，替换调用端保存的令牌，再撤销不用的旧记录。
3. 不能把旧令牌的字符串前缀改写后继续使用：数据库存储的是完整令牌哈希。
4. 访客重新完成密码或浏览器检查，以取得新的 Cookie。旧 Cookie 不授予访问权限。

旧 API 命名空间明确返回 404，避免误落入 GUI；新 API 仍执行 Access、角色、scope、CSRF 和同源检查。原数据库迁移文件逐字节保留，已有密码的派生方式和密码学用途标签保留，不要求重新设置短链密码。KV 键、本地 Owner 身份、浏览器存储键及 Cloudflare 资源名称不在本次协议更名范围内。
