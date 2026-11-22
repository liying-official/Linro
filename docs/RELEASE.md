# Linro v1.0.2：制作可公开的源码包

[English](RELEASE.en-US.md) · [安全检查](SECURITY.md) · [许可证](LICENSING.md)

把发布目录想成准备交给别人的干净行李箱：放源代码、公共模板、文档和许可，不放自己家里的钥匙、账户配置或数据库。**不要直接压缩已经部署过的整个工作目录。**

## 1. 在干净源码副本里准备

保留运营实例的私有配置；另用公共模板制作发布包。`deployment.example.json` 和两份 Wrangler 模板应保留不可部署的示例值。根账户 ID、数据库 ID、邮箱和真实主机不应从运营目录带进来。

安装依赖后，按顺序运行：

```bash
npm ci
npm run check
npm run format:check
npm test
npm run test:runtime
npm run build
npm run build:demo
npm run build:docs
npm run test:browser
npm run deploy:dry-run
```

有合适本地运行环境时，再运行 `npm run test:disconnect` 验证真实连接取消。浏览器测试需要可执行的 Chrome / Chromium；未运行或环境失败须如实记录，不等于通过。上面没有正式部署命令，dry-run 也不切换线上流量。

## 2. 让源码与文档副本保持一致

- 修改 `apps/demo/` 或共享管理界面后，重建 `docs/demo/`。
- 修改 README、手册 Markdown 或许可原件后，运行 `npm run build:docs`。生成器重建 `docs/index.html`，并把 `LICENSE`、`NOTICE` 和两份 MIT 通知逐字节同步到 `docs/licenses/`。离线分发时将该目录与 `index.html` 放在一起。
- 离线 HTML 由 Markdown 生成，不再手工维护另一套正文；Markdown 解析依赖只用于构建。
- 核对两种语言的版本、命令、链接、字段和限制。涉及旧版本时，说明与当前版本的升级或兼容关系。

发布文档应讲使用、开发和运维方法，不包含内部任务指令、对话记录、真实机器路径、审核证据或敏感截图。

## 3. 生成发布目录

```bash
npm run package:source
```

默认输出是 `release/Linro-v1.0.2/`，不能已存在。要换一个新目录：

```bash
npm run package:source -- --out release/Linro-v1.0.2-public
```

打包器使用 Node 内置模块，按受控清单收录文件，不安装依赖、不自动构建、不部署，也不覆盖已有输出。它会排除 `node_modules/`、`.local/`、`.wrangler/`、`dist/`、私有 `deployment.json`、常见环境变量文件、私钥、数据库文件以及指定名称或扩展名的备份，并拒绝选中路径中的符号链接。

公共模板有固定 SHA-256 校验，防止把已填真实账户的 Wrangler 配置误当模板发布。打包完成后，另行扫描发布目录中的凭据模式，并人工复核正文、生成文件、图片及拟公开的提交历史。

## 4. 核对后再压缩

发布目录里的 `MANIFEST.sha256` 记录除自身外每个文件的哈希。它能发现内容是否改变，不能证明作者身份。在对应发布目录中执行：

```bash
sha256sum -c MANIFEST.sha256
```

Windows 可使用兼容清单的 SHA-256 工具，或逐项用 `Get-FileHash -Algorithm SHA256` 核对。修改任意文件后都应重新打包、重新生成清单，不手改某个哈希蒙混通过。

只压缩已审阅的输出目录。独立文档包若有自己的清单，那份清单只属于文档包，不能拿来替换完整源码清单。必须保留 `LICENSE`、`NOTICE` 和 `LICENSES/` 的通知。上传 GitHub Release 或设置 `source_url` 前，确认文件确实对应要运行的版本。
