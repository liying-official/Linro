# Linro v1.0.1 源码与文档发布

[English](RELEASE.en-US.md) · [许可](LICENSING.md) · [安全](SECURITY.md)

## 从干净源码制作发布目录

在保留公共占位模板的完整源码目录中运行：

```bash
npm run package:source
# 或指定尚不存在的输出目录：
npm run package:source -- --out release/Linro-v1.0.1-public
```

默认输出为 `release/Linro-v1.0.1/`。脚本只使用 Node 内置模块，不安装依赖、不构建、不调用 Cloudflare，不覆盖已有输出。正式发布仍须分别执行 check、test、test:runtime、test:browser、build 和 deploy:dry-run；打包成功不是运行时测试通过。

打包器收录明确的根文件和受控目录中的允许类型，排除生成目录、`.local/`、`.wrangler/`、`node_modules/`、`dist/`、`deployment.json`、常见环境变量、数据库、私钥和备份文件，并拒绝选中路径中的符号链接。普通源码或 Markdown 中手工写入的秘密仍可能被打包；发布者必须另做内容审查。

两份公开 Wrangler 模板及根 `deployment.example.json` 必须满足源码内固定 SHA-256。不要在已经 configure 的生产副本中改回占位配置来绕过检查；从干净副本发布。本次文档整理保留这三份模板的字节和锁文件不变。

## 双语文档收录

源码打包清单包含 `README.md`、`README.en-US.md` 和 `docs/` 下的双语手册、API 参考与公共示例。发布前核对两种语言均完整收录，并执行文档链接、配置示例和命令检查。

## 文档包与校验清单

独立文档包只含 Markdown、离线 HTML、公共示例及许可通知，不含应用源码或构建产物。它的 `MANIFEST.sha256` 只覆盖该文档包，**不能覆盖到完整源码包中冒充源码清单**。

修改 README 或 `docs/` 后，通过打包器重新生成完整源码清单。清单覆盖除自身外的各发布文件，不是作者身份签名。

```bash
sha256sum -c MANIFEST.sha256
```

上述命令须在对应包的根目录执行。Windows 可使用兼容 SHA-256 清单的工具，或逐文件用 `Get-FileHash -Algorithm SHA256` 核对；不要用某个单文件哈希代替完整清单验证。

只压缩已审阅的输出目录，不压缩工作目录。审查报告、执行日志、证据、修复方案和历史归档与面向用户的公共文档分开保存。保留 `LICENSE`、`NOTICE` 和所有继承许可文本；法律说明的双语翻译不替换权威许可原文。
