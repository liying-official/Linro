# Linro v1.0.2 许可证与对应源码

[English](LICENSING.en-US.md) · [README](../README.md) · [发布说明](RELEASE.md)

可以把开源许可证理解为使用和分发软件时要遵守的规则。Linro 的规则是 **AGPL-3.0-only**，即 GNU Affero General Public License 第 3 版，不含“或更新版本”。完整条款在 [LICENSE](./licenses/LICENSE.txt)；本页帮助你找到要做的事，不替代原文。

## 哪些许可需要一起保留？

| 内容 | 在哪里看 |
| --- | --- |
| Linro 整体 | [AGPL-3.0-only](./licenses/LICENSE.txt) |
| TailAdmin React 适配 | [MIT 通知](./licenses/TailAdmin-MIT.txt)，上游固定修订见 [NOTICE](./licenses/NOTICE.txt) |
| Recharts | [MIT 通知](./licenses/Recharts-MIT.txt) |
| 其他依赖 | 各依赖自己的许可证，以及随包锁文件记录的版本 |

MIT 内容仍保留自己的通知，不能因此把 Linro 整体改称 MIT。`LICENSE`、`NOTICE`、`LICENSES/` 中的权利人署名不是需要删除的私人资料。不要改写权威许可文本，也不要自行新增例外授权。包内未包含 TailAdmin Pro 或 ApexCharts，不代表已经逐一审查所有传递依赖的许可义务。

## 对外提供服务时，源码入口有什么用？

AGPL 第 13 节涉及修改版本通过网络与用户交互时提供对应源码的要求。请按实际使用、修改和分发方式阅读完整条款，提供运行版本的完整对应源码及所需构建、安装材料。

Linro 用 `source_url` 帮你展示这个入口：它映射到两个 Worker 的 `SOURCE_URL`，可出现在管理界面和公开保护页面，并在安全包装响应中添加 `Link` 头，关系为 `describedby`。

**填写地址不会自动上传或验证源码。** 你需要自己确认地址可访问、内容对应运行版本，而且足以按说明构建。尽量指向固定标签、提交或发布包，不只指向不断变化的默认分支。

## 地址怎么填？

地址需要 HTTPS，最长 2,048 字符；不含用户名、密码、查询参数、片段、空白或反斜线；不能用当前管理域名或短链域名。公共模板故意留空，`preflight` 会提醒，但不会代替许可判断。

公开源码时仍须保密账户配置、用户数据、数据库和密钥。提供公共模板与依赖锁文件即可让别人填写自己的配置，不需要交出你的部署凭据。实际义务有疑问时，可就具体情况寻求合格专业意见。
