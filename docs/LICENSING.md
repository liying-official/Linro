# Linro v1.0.1 许可证与对应源码

[English](LICENSING.en-US.md) · [README](../README.md)

## 整体与继承许可

Linro 整体采用 **AGPL-3.0-only**：GNU Affero General Public License 第3版，不包含“或更高版本”。完整权威文本见 [LICENSE](../LICENSE)；本页是项目说明，不替代许可证或针对具体部署的法律意见。

保留的许可与归属如下：

| 材料 | 许可与位置 |
| --- | --- |
| 继承的 cf-links 贡献 | [cf-links MIT 通知](../LICENSES/cf-links-MIT.txt) |
| TailAdmin React 适配 | `apps/admin/src/web/tailadmin/`，保留 [TailAdmin MIT](../LICENSES/TailAdmin-MIT.txt)；上游固定修订见 [NOTICE](../NOTICE) |
| Recharts | [Recharts MIT](../LICENSES/Recharts-MIT.txt) |
| Linro 整体及其他原有文件 | 保持其 AGPL-3.0-only 许可及现有文件通知 |

这些 MIT 通知不使 Linro 整体变为 MIT，也不撤销先前合法获得的 MIT 版本权利。交付源码及锁文件未包含 ApexCharts 或 TailAdmin Pro；这不等于已经逐一审计所有传递依赖的法律义务。第三方依赖继续受各自许可约束。

`LICENSE`、`NOTICE` 和 `LICENSES/*.txt` 应原样保留。双语解释不覆盖权利人的署名，不自行补造作者、版权归属或例外授权。

## 网络使用与 source_url

AGPL 第13节涉及修改版本向通过网络交互的用户提供对应源码的要求。部署前检查适用于自身使用和分发方式的完整条款，并提供实际运行版本的完整对应源码及所需构建 / 安装材料。

部署配置 `source_url` 映射到两端 `SOURCE_URL`。程序可在管理界面与公开保护页面提供源码入口，并在安全包装的响应中附加 `Link`，关系为 `describedby`。它不是自动上传、镜像或验证源码的工具。

格式要求：HTTPS、最长2048字符，无 URL 凭据、查询、片段、空白和反斜线，且不使用当前管理或短链主机。公共示例留空；生产前填写实际对应版本的公开入口。`preflight` 对空值只警告，不替你确认源码已经公开、完整、可构建或符合法律要求。

尽量指向实际发布提交 / 标签的源码，而不是随时变化的默认分支。不要为了公开源码而泄露账户配置、用户数据、数据库、密码或私钥；保留可复现构建所需的公共模板与锁文件。法律要求有疑义时，应就具体情形寻求合格专业意见。
