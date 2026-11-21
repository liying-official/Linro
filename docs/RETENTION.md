# Linro v1.0.2：检查旧数据，再决定是否清理

[English](RETENTION.en-US.md) · [备份与升级](GUIDE.md#backup)

审计、每日统计和已撤销令牌像不断增加的旧收据。Linro 默认保留这些记录，**不会自动按日期删除**。`retention` 工具先帮你数一数有多少旧记录；你决定保留多久，工具不会替你执行云端删除。

## 1. 准备一份私有快照

工具读取的是本地 **SQLite 二进制数据库**，不是 D1 导出的 SQL 文本。先按指南导出完整备份，再把可信 SQL 恢复到一个新建、隔离的本地 SQLite 文件。

例如，在自己的私有备份目录中启动 `sqlite3 review.sqlite`，依次输入 `.read Linro-backup.sql`、`PRAGMA quick_check;`、`.quit`。这需要本机已安装 SQLite 命令行工具。不要用待审查脚本覆盖唯一备份，也不要把真实数据库放进源码目录。

快照可能包含真实邮箱、链接、令牌校验值和审计详情，必须像原始备份一样保护。下面的 `SNAPSHOT.sqlite` 只是占位文件名，改为你自己的私有快照路径。

## 2. 先看报告，不改数据

在项目根目录、Node.js ≥22.16.0 环境运行：

```bash
node scripts/retention.mjs --database "SNAPSHOT.sqlite"
node scripts/retention.mjs --database "SNAPSHOT.sqlite" --audit-days 180 --archive-days 365 --revoked-token-days 90 --limit 100
```

第一条只查看容量。第二条示范“审计保留 180 天、每日统计保留 365 天、撤销令牌保留 90 天”，这些天数不是项目推荐的统一政策，应按自己的需求决定。

| 选项 | 根据哪个日期判断旧记录 |
| --- | --- |
| `--audit-days` | `audit_logs.created_at`：审计产生时间 |
| `--archive-days` | `daily_stats.date`：访问所属的 UTC 日期 |
| `--revoked-token-days` | `api_tokens.revoked_at`：撤销时间；没有撤销的令牌都保留，已到期也一样 |

省略某个天数就保留那张表的全部记录，策略值显示为 `null`。工具默认以当前 **UTC 日期零点**为基准，减去指定天数，只选择严格早于截止时间的记录；恰好在边界上的保留。可以用 `--as-of YYYY-MM-DD` 固定核对日期，实际运行时换成有效日期。天数为 0 仍保留参考日及之后的记录。

报告输出 JSON，包含总行数、符合条件的行数、下一批行数和大小。总文件占用与可复用空闲页是不同指标：删行后 SQLite 可以复用空间，文件未必立刻缩小。系统没有 `dbstat` 时，单表字节数为 `null`，不表示表为空。

## 3. 需要时，只生成一小批 SQL

```bash
node scripts/retention.mjs --emit-cleanup-sql audit_logs --audit-days 180 --limit 100
```

这个模式只输出一条 SQL，不打开数据库，也不会执行它。可选表是 `audit_logs`、`daily_stats`、`api_tokens`；每次只能选一张，并给出对应保留天数。默认每批最多 100 行，允许 1–1,000 行。

先固定与报告相同的参考日期，审阅生成 SQL，并在一次性恢复副本中试运行，再重新查看报告。若决定操作正式库，先确认数据库 ID 和可恢复的最新备份，再由有权限的维护者执行已审阅语句。

每次语句只删除一批，**重复执行会继续删除下一批**。行数上限限制删除量，不保证寻找候选行只读同样少的行。每日统计如果仍在归档补算窗口内，删除后可能又被补写，因此不要把极短保留期当成彻底停止归档的方法；不需要归档时应关闭相应功能。
