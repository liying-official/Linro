# Linro v1.0.2 界面演示

[English](DEMO.en-US.md) · [README](../README.md) · [部署指南](GUIDE.md)

演示像一个装着玩具数据的练习本：你可以试着创建、编辑和删除，但它不会改变任何真实 Cloudflare 资源。**无需账号；输入页面当次显示的六位体验码即可进入。** 刷新会生成新码。

## 怎样打开？

[打开 GitHub Pages 在线演示](https://liying-official.github.io/Linro/demo/)

下载完整源码后，在项目根目录运行一个只监听本机的静态服务器。已安装 Python 时：

```bash
python -m http.server 8000 --bind 127.0.0.1 --directory docs
```

然后打开 `http://127.0.0.1:8000/demo/`。系统命令是 `python3` 时将上面的 `python` 换成 `python3`。体验结束后，在终端按 `Ctrl+C` 停止。

## 可以练习什么？

演示使用当前版本的中英双语管理界面，包括链接、域名、角色切换、虚构统计、模拟令牌以及导入导出。数据只留在当前页面内存中；刷新、退出或重置后恢复虚构示例。导出文件带 `DEMO-` 前缀。

这里不连接 Workers、D1、KV、Access 或真实 API。点击模拟短链只显示预览，不打开目标网站。密码、地区分流和次数上限等选项只演示如何管理；它们不能证明正式环境的访客保护已经工作。

新增主机、目标和邮箱只能使用 `.example` 或 `example.com`、`example.net`、`example.org` 保留域名。请继续使用虚构内容，不填真实密码、令牌、邮箱或业务资料。演示页面会禁止外部连接和表单导航，资源从本站加载。

## 修改界面后怎样更新演示？

在完整源码根目录执行：

```bash
npm ci
npm run build:demo
```

源代码在 `apps/demo/`，输出在 `docs/demo/`。演示构建把 API 客户端替换成内存模拟器；正式构建仍使用真实 API 客户端。改动共享界面或演示源码后，要重新生成并提交 `docs/demo/`，CI 会检查同步情况。

本仓库的 GitHub Pages 从 `main` 分支的 `/docs` 目录发布。`docs/` 是公开内容目录，不放凭据、日志或备份。[GitHub Pages 官方设置说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
