# Linro 源码发布规范

Linro 以 AGPL-3.0-only 发布，根 LICENSE/NOTICE 及 LICENSES 中的继承许可必须一同收录。本项目发布的是源码包，不是开发目录快照，也不是已经构建或部署的 Cloudflare 实例。

## 打包入口

在保留公共占位配置的干净源码目录中执行：

```bash
npm run package:source
```

默认生成 `release/Linro-v<package.json.version>/`，包含源码、迁移、公共配置模板、文档、测试及新生成的 `MANIFEST.sha256`。也可以指定**尚不存在**的输出目录：

```bash
npm run package:source -- --out /path/to/new/Linro-source
```

脚本只使用 Node 内置模块，不安装依赖、不调用 Cloudflare、不覆盖已有输出、不删除本地开发数据。此命令是源码清单生成器，**不是编译或部署检查**；正式验收仍需 `check`、`test`、`test:runtime`、`build` 和两个 Worker 的 `deploy:dry-run`。

## 收录与排除

根目录仅收录明确列出的公共文件，以及 `LICENSES`、`.github`、`apps`、`packages`、`migrations`、`scripts`、`tests`、`examples`、`docs` 中允许的源码/文档类型。

以下生成物或私有内容不会被收录：`.build/`、`node_modules/`、`.local/`、`.wrangler/`、`dist/`（含 `apps/admin/dist/`）、`release/`、测试覆盖率/浏览器临时输出、`deployment.json`、`.dev.vars*`、`.env*`、数据库及常见私钥/备份文件。源目录中的原文件不会因此被修改。已选目录中的符号链接会被拒绝，不能经链接夹带目录外文件。

`package-lock.json` 在存在且根包名/版本与当前Linro包一致时会保留。没有依赖安装结果时不能编造锁文件；用户升级应保留已有锁文件并审查差异。

## 公共模板保护

源码包内两份 `apps/*/wrangler.jsonc` 和 `deployment.example.json` 必须与本版审核过的公共模板逐字节一致。打包器检查固定 SHA-256；发现真实账户配置或其他改动时拒绝打包，不会自动覆盖你的配置。

因此请在干净源码副本中制作发布包，不要在已经运行过 `configure` 的生产工作目录里删除/替换配置来绕过检查。未来有意修改公共模板时，应审查配置并同步更新打包器中的模板哈希和测试。

这些规则是防止常见误打包的边界，不是通用秘密扫描器；人为写入普通源码、文档或日志的敏感内容仍须发布者审查。

## 校验和与压缩

清单按相对路径稳定排序，用 SHA-256 覆盖所有发布文件，**不包含清单自身**。脚本写入每个文件后重新核对哈希；ZIP 和 TAR.GZ 必须只压缩上述生成目录，不要直接压缩项目工作目录。

在解压目录中可使用支持 SHA-256 清单的工具校验；例如 Linux 的 `sha256sum -c MANIFEST.sha256`。外部校验文件用于验证源码压缩包。内部清单证明内容一致，不代表身份签名。

发布测试必须先在工作目录中产生 `.build/` 等文件，再验证输出排除它们。解压后的源码包应能重新执行测试；测试产生的 `.build/` 不属于原始清单，也不应被补写进发布包。

## 仓库范围


修复报告、方案、执行日志、证据、历史归档及详细更新记录保存在仓库外，不作为源码发布内容。
