# Linro v1.0.1 协议标识

[English](PROTOCOL-v1.0.1.en-US.md) · [API](https://liying-official.github.io/Linro/?lang=zh#api-reference) · [升级](GUIDE.md#upgrade)

| 接口或数据 | v1.0.1 标识 |
| --- | --- |
| 管理 API | `/Linro/v1`，大小写敏感 |
| 应用 Bearer token | `Linro_` 加43位 base64url 字符；需使用完整创建返回值 |
| 交互式 CSRF / 本地开发头 | `X-Linro-CSRF` / `X-Linro-Dev` |
| 公开密码 / 浏览器 POST | `/__Linro_unlock/:slug` / `/__Linro_browser/:slug` |
| 自源资源 | `/__Linro_assets/password.css`、`/__Linro_assets/browser.js` |
| 内部查询参数 | `_Linro_check`、`_Linro_lang`，不透传给目标 |
| 生产 Cookie | `__Host-Linro_unlock_*`、`__Host-Linro_browser_*` |
| JSON 导出 | `format: "linro"`、`version: "1.0.1"` |

旧管理路径、旧 token 前缀及旧内部路径不提供兼容别名。数据库哈希按完整 token 计算；手工换前缀不会得到有效新 token。通过正常交互式会话重新签发并更新自动化客户端。旧 Cookie 不会自动迁移为新 Cookie。

这是公开协议变化，不是云资源重建要求。保留 Worker / D1 / KV / 数据集名称和原根 secrets；不要因品牌变化重建数据库。内部密码用途标签、KV `cf-links:route:v1:` 前缀、CSV `_cf_links_csv` 安全标记及本地身份键可能保留历史名称，它们不是旧公开 API 仍可使用的证明。

本源码包含0001–0004四份数据库迁移。根据目标库列出的待执行项升级，不能只根据版本号推断完整性。保留原 `LINK_PASSWORD_SECRET` 才能继续验证已存的密码校验串。浏览器检查使用另一个独立 secret。

Admin 和 Redirect 不是原子发布。计划切换顺序、协议兼容与维护窗口，并分别验证实际生效版本、客户端、静态资源、认证、迁移和专用测试链接。代码回滚不回滚数据库，也不能恢复被轮换掉的 secret。
