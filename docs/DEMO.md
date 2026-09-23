# Linro WebGUI 演示站

[English](DEMO.en-US.md) · [打开演示站](https://liying-official.github.io/Linro/demo/) · [API 文档](https://liying-official.github.io/Linro/?lang=zh#api-reference)

演示口令为 **`Linro`**，区分大小写。它是公开静态页面中的流程演示，不是安全认证，也不保护任何秘密。

演示复用当前 TailAdmin React / Recharts 管理界面，支持中英双语、示例链接与域名管理、角色切换、虚构统计、模拟令牌、导入导出。所有数据仅存在当前页面内存中；刷新、退出或重置后恢复虚构示例。导出的文件名带 `DEMO-` 前缀。

不会连接 Workers、D1、KV、Access 或真实 API。演示短链点击后仅显示预览，不打开目标网站。新增域名、目标 URL 和邮箱只能使用 `.example` 或 `example.com`、`example.net`、`example.org` 保留示例域名。请勿填写真实个人信息、密码或密钥。密码保护、地理分流、请求配额等选项仅展示其管理方式，不提供真实公开跳转或访客验证服务。

## 构建与发布

在完整源码根目录执行：

```bash
npm ci
npm run build:demo
```

源码位于 `apps/demo/`；生成的静态文件位于 `docs/demo/`。该目录随源码提交，以适配 GitHub Pages 的 `main` 分支 `/docs` 发布方式。修改共享 UI 或演示源码后重新构建并提交静态文件；CI 会检查它们是否一致。不要在 `docs/` 中保存部署凭据、日志或数据库备份。

演示构建单独替换 API 客户端为内存模拟器，生产构建继续使用原有 API 客户端和安全校验。演示页 CSP 禁止网络连接和表单导航；页面资源从同一站点加载。
