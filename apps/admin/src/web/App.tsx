// SPDX-License-Identifier: AGPL-3.0-only
// Linro modifications: 2026-09-18; inherited attribution is in NOTICE.
import React from 'react';
import { DashboardShell } from './tailadmin/DashboardShell';
import { ComponentCard, MetricCard } from './tailadmin/ComponentCard';
import { AnalyticsSelection } from './AnalyticsSelection';
import { responseLabels } from './response-ui';
import { VPNStats, vpnLabels } from './VPNStats';
import { LinkOptions } from './LinkOptions';
import { VERSION } from '../../../../packages/shared/src/platform';
import { api, APIError, download } from './client';
import { parseCSV, exportCSV } from './csv';
import { Icon, Empty, Field, Pagination, TrafficChart } from './components';
import { applyLocale, detectLocale, localeLabels, type Locale } from './i18n';

type Row = Record<string, any>;
type Page = 'dashboard' | 'links' | 'domains' | 'analytics' | 'tokens' | 'users' | 'audit' | 'settings';
const pages: Page[] = ['dashboard', 'links', 'domains', 'analytics', 'tokens', 'users', 'audit', 'settings'];
const isPage = (value: string): value is Page => pages.includes(value as Page);

const UI = {
  'zh-CN': {
    common: {
      notAvailable: '—',
      saved: '已保存。',
      operationFailed: '操作失败。',
      copied: '已复制到剪贴板。',
      copyUnavailable: '无法访问剪贴板，请手动选择复制。',
      close: '关闭',
      cancel: '取消',
      save: '保存',
      saving: '正在保存…',
      refresh: '刷新',
      signOut: '退出',
      loading: '正在加载…',
      workspace: '工作区',
      management: '管理',
      language: '语言',
      all: '全部',
      details: '查看详情',
      viewAll: '查看全部',
      edit: '编辑',
      delete: '删除',
      enable: '启用',
      disable: '停用',
      import: '导入',
      exportCsv: '导出 CSV',
      exportJson: '导出 JSON',
      status: '状态',
      actions: '操作',
      enabled: '已启用',
      disabled: '已停用',
      expired: '已过期',
      active: '运行中',
      yes: '是',
      no: '否',
    },
    pages: {
      dashboard: '总览',
      links: '短链管理',
      domains: '域名',
      analytics: '访问统计',
      tokens: 'API 令牌',
      users: '用户与权限',
      audit: '操作日志',
      settings: '设置与备份',
    },
    descriptions: {
      dashboard: '所有链接，一处掌控。',
      links: '创建、组织并安全地管理你的跳转。',
      domains: '让每一个短链接都使用自己的域名。',
      analytics: '了解链接的访问趋势，不记录完整 IP 或访客指纹。',
      tokens: '为自动化任务授予最小权限。',
      users: '通过 Access 身份与应用角色控制管理权限。',
      audit: '关键修改有据可查；网址查询参数在日志中脱敏。',
      settings: '配置管理界面，导出链接，检查服务状态。',
    },
    eyebrow: {
      dashboard: 'OVERVIEW',
      other: 'WORKSPACE',
    },
    login: {
      title: '欢迎使用 Linro',
      subtitle: 'Cloudflare 原生私有短链管理平台',
      verifying: '正在验证身份…',
      localToken: '本地开发令牌',
      localTokenHint: '使用 npm run local:init 输出的随机令牌；此入口仅用于本机开发。',
      enterLocal: '进入本地控制台',
      remoteHint: '请确认该邮箱已被 Access 策略允许，并已添加到 Linro 用户列表。',
      recheck: '重新验证身份',
      runtime: `v${VERSION} · Workers + D1 + Static Assets`,
    },
    topbar: {
      createLink: '创建短链',
      addDomain: '添加域名',
      addUser: '添加用户',
      createToken: '创建令牌',
      localBanner: '本地开发模式 · 数据保存在本机，尚未部署到 Cloudflare',
      dismissError: '关闭错误',
      dismissNotice: '关闭提示',
      footerSite: '当前工作空间',
    },
    links: {
      emptyTitle: '还没有短链',
      emptyDetail: '创建第一条短链，或者从 CSV / YOURLS 导出文件导入。',
      emptyNeedDomain: '先添加并绑定一个跳转域名，再创建你的第一条短链。',
      addDomain: '添加域名',
      selectPage: '全选当前页',
      selectOne: '选择',
      shortLinkTarget: '短链接 / 目标地址',
      redirectType: '跳转类型',
      createdAt: '创建时间',
      permanent: '永久跳转',
      temporary: '临时跳转',
      copyShortLink: '复制短链接',
      deleteConfirm: (slug: string) => `永久删除 /${slug}？此操作不能撤销。`,
      deleted: '链接已删除。',
      searchAria: '搜索短链',
      searchPlaceholder: '搜索短码、标题或目标地址…',
      search: '搜索',
      allDomains: '所有域名',
      allStatuses: '所有状态',
      bulkSelected: (n: number) => `已选择 ${n} 条`,
      bulkConfirm: (n: number, action: string) => `确认对 ${n} 条链接执行${action === 'delete' ? '永久删除' : action === 'enable' ? '启用' : '停用'}？`,
      bulkConflict: (n: number) => `${n} 条因权限或版本变化未执行，其余已完成。刷新后再检查。`,
      bulkDone: '批量操作完成。',
      imported: (n: number) => `已导入 ${n} 条链接。`,
      importedProgress: (done: number, total: number) => `已提交 ${done} / ${total} 条`,
      importRollbackWarning: (message: string, done: number) => `${message} 已提交批次不会自动回滚；请移除已成功的 ${done} 行后重试。`,
      exportChanged: '导出期间数据发生变化，请暂停修改后重试；完整快照请使用 D1 SQL 导出。',
      exportLimit: 'Web 导出上限为 10000 条，请使用 README 中的 D1 SQL 完整备份命令。',
      exportDone: (n: number) => `已导出 ${n} 条链接。导出过程中请避免并发修改；完整一致备份请用 D1 SQL 导出。`,
      importButton: '导入链接',
      autoGenerate: '自动生成',
      importRowsInvalid: '文件需包含 1–5000 条有效记录。',
      fileTooLarge: '文件大小不能超过 2 MiB。',
      jsonNeedsArray: 'JSON 需要 links 数组或直接使用链接数组。',
      missingDomain: (i: number) => `第 ${i} 条记录的域名不存在，请先添加域名或选择默认域名。`,
      missingTarget: (i: number) => `第 ${i} 条缺少 target_url/url。`,
    },
    dashboard: {
      metrics: [
        ['短链总数', '所有已创建的链接', 'link'],
        ['有效短链', '已启用且未过期', 'check'],
        ['已过期', '过期链接不可访问', 'close'],
        ['管理域名', '数据库中的域名记录', 'globe'],
      ] as const,
      chartTitle: '访问趋势',
      chartSubtitle: '过去 7 天 · UTC · 采样加权估算',
      chartReady: (n: number) => `${n.toLocaleString('zh-CN')} 次成功访问`,
      chartPending: '统计未就绪',
      analyticsConnect: '连接 Analytics Engine',
      analyticsReading: '正在读取统计配置…',
      viewAnalytics: '查看统计状态',
      recentTitle: '最近创建',
      recentSubtitle: '最新添加到工作空间的短链接',
    },
    domains: {
      note: '先将域名绑定到 Redirect Worker 的 Custom Domains，再添加数据库记录。此页面的启用状态不代表 DNS/TLS 已验证。',
      ruleEnabled: '规则已启用',
      ruleDisabled: '规则已停用',
      defaultName: '自定义跳转域名',
      linkCount: '条短链',
      defaultCode: '默认状态码',
      edit: '编辑域名',
      deleteConfirm: (hostname: string) => `删除 ${hostname}？域名下必须没有链接。`,
      emptyTitle: '添加你的第一个域名',
      emptyDetail: '支持多个独立跳转域名，同一短码可以在不同域名重复使用。',
      add: '添加域名',
      saved: '域名记录已保存。请确认 Cloudflare Custom Domain 也已绑定。',
    },
    analytics: {
      window: '统计窗口',
      recentDays: (n: number) => `过去 ${n} 天`,
      hint: '只统计成功的 GET 跳转或纯文本响应，不计 HEAD、密码页或失败请求。采样值不是精准点击或独立访客。',
      unavailableTitle: '统计尚不可用',
      unavailableDetail: '请在部署配置启用 Analytics Engine，并设置服务端 ANALYTICS_API_TOKEN。',
      trendSubtitle: (n: number) => `UTC · 近 ${n} 天`,
      estimatedRequests: '次估算成功访问',
      topLinks: '热门链接',
      countries: '国家 / 地区',
      referrers: '来源站点',
      noData: '暂无数据',
      unknownCountry: '未知',
      direct: '直接访问 / 无来源',
    },
    tokens: {
      note: '令牌仅显示一次、仅存 SHA-256；只能修改所属用户创建的链接（Owner 令牌也不例外）。同一用户名下令牌不互相隔离，CI 请使用专用 Editor。生产 API 仍需 Access Service Token。',
      emptyTitle: '没有 API 令牌',
      emptyDetail: '创建具有最小权限和有效期的令牌，供脚本自动管理短链。',
      name: '名称',
      prefix: '前缀 / 权限',
      expiresAt: '到期时间',
      revoke: '撤销',
      revokeConfirm: '立即撤销此令牌？',
      revoked: '已撤销',
      valid: '有效',
      revokedNotice: '令牌已撤销。',
    },
    users: {
      note: '添加邮箱后仍需 Access 允许策略。Editor 仅修改自己的链接；Owner/Admin 交互会话可管理全部链接。只读范围仍是团队共享，最后一名 Owner 受保护。',
      user: '用户',
      role: '角色',
      createdAt: '创建时间',
    },
    audit: {
      time: '时间',
      actor: '操作者',
      action: '操作',
      resource: '资源 / 详情',
      requestId: 'Request ID',
    },
    settings: {
      workspaceSettings: '工作空间设置',
      workspaceName: '工作空间名称',
      runStatus: '运行状态',
      runStatusDetail: 'Worker 与 D1 即时检查；统计显示配置状态，不伪装成上游可用性探测。',
      healthCheck: '检查服务状态',
      healthSuccess: 'Worker 与 D1 检查通过；统计仍需实际点击和查询验收。',
      lastArchive: '最近统计归档',
      exportBackup: '导出与备份',
      exportBackupDetail: 'JSON 保留链接配置与域名元数据；CSV 兼容表格软件并处理公式注入。',
      fullRestore: '完整恢复请使用 D1 SQL 备份',
      exportNote: 'Web 导出不包含用户、令牌哈希、审计日志与历史统计，也不是事务快照。',
      importTitle: '导入已有链接',
      importDetail: '支持本项目 CSV / JSON 和带 keyword、url、title 列的 YOURLS CSV。不覆盖已存在的短码。',
    },
    modals: {
      linkNew: '创建短链',
      linkEdit: '编辑短链',
      domainNew: '添加域名',
      domainEdit: '编辑域名',
      userNew: '添加用户',
      userEdit: '编辑用户',
      tokenNew: '创建 API 令牌',
      tokenSecret: '保存你的 API 令牌',
      importTitle: '导入链接',
      closeDialog: '关闭对话框',
      fieldDomain: '跳转域名',
      fieldSlug: '自定义短码',
      fieldSlugHint: '区分大小写；留空生成 8 位随机短码。仅 health、cdn-cgi 及 __Linro_ 前缀保留（保留项不区分大小写）。',
      fieldSlugPlaceholder: '例如 docs，或留空',
      fieldTarget: '目标地址',
      fieldTargetHint: '仅 HTTP(S)；禁止后台或受管短域名。私有/内网目标需部署层精确白名单授权。',
      fieldTitle: '标题',
      fieldCode: '跳转状态码',
      fieldQuery: '访问参数策略',
      fieldQueryHint: '仅透传部署白名单参数（默认 utm_* 中的五项）。OAuth、登录、重置密码或含令牌/跳转参数的目标必须使用忽略。替换模式会清空目标原查询串。',
      fieldExpires: '到期时间（本地时区）',
      fieldExpiresHint: '留空则永不过期。',
      fieldCache: '客户端缓存（秒）',
      fieldCacheHint: '0 表示 no-store；非零可能使改址 / 停用延迟生效。',
      fieldDescription: '备注',
      fieldName: '显示名称',
      fieldHostname: '域名',
      fieldHostnameHint: '不带 https://、路径或端口；添加后域名不可改名。',
      fieldRole: '角色',
      fieldEmail: 'Access 登录邮箱',
      fieldEnabledLink: '启用此链接',
      fieldEnabledDomain: '启用此域名的全部有效链接',
      fieldEnabledUser: '允许该用户访问',
      fieldTokenName: '令牌名称',
      fieldTokenPlaceholder: '例如 CI link publisher',
      fieldTokenDays: '有效期',
      scopes: '授权范围',
      secretBody: '完整令牌仅显示这一次。关闭后无法找回；不要放进公开代码仓库。',
      secretAria: '完整 API 令牌',
      copyToken: '复制令牌',
      closeAfterSave: '已保存，关闭',
      file: 'CSV / JSON 文件',
      fileHint: '上限 2 MiB、5000 条；每批最多 10 条且不超过 256 KiB，批内原子提交。',
      fallbackDomain: '缺省域名',
      fallbackDomainHint: '记录包含 hostname 时，优先按该域名匹配。',
      previewCode: '短码',
      previewTarget: '目标地址',
      importWarning: '不会覆盖同名短码。失败批次自动回滚，已成功批次保留。YOURLS 点击历史和创建时间不会导入。',
      confirmImport: '确认导入',
      importing: '正在导入…',
      linkWarning: '301 / 308 是永久跳转。默认 no-store 可以降低缓存影响，但无法撤回客户端以前已经缓存的跳转。',
      domainInfo: '此操作仅修改 D1。请同时更新 deployment.json 中的 redirect_hosts，运行 configure 并重新部署 Redirect Worker，或在 Cloudflare 控制台绑定 Custom Domain。',
      queryDiscard: '忽略传入参数（默认）',
      queryMerge: '合并参数 · 目标优先',
      queryReplace: '替换全部目标查询参数',
      codePermanent: '永久',
      codeTemporary: '临时',
      oneDay: '1 天',
      sevenDays: '7 天',
      thirtyDays: '30 天',
      ninetyDays: '90 天',
      yearDays: '364 天',
      viewer: 'Viewer · 只读',
      editor: 'Editor · 仅修改自己的链接',
      admin: 'Admin · 链接、域名与日志',
      owner: 'Owner · 全部权限',
    },
  },
  en: {
    common: {
      notAvailable: '—',
      saved: 'Saved.',
      operationFailed: 'Operation failed.',
      copied: 'Copied to clipboard.',
      copyUnavailable: 'Clipboard access failed. Please copy the value manually.',
      close: 'Close',
      cancel: 'Cancel',
      save: 'Save',
      saving: 'Saving…',
      refresh: 'Refresh',
      signOut: 'Sign out',
      loading: 'Loading…',
      workspace: 'Workspace',
      management: 'Management',
      language: 'Language',
      all: 'All',
      details: 'View details',
      viewAll: 'View all',
      edit: 'Edit',
      delete: 'Delete',
      enable: 'Enable',
      disable: 'Disable',
      import: 'Import',
      exportCsv: 'Export CSV',
      exportJson: 'Export JSON',
      status: 'Status',
      actions: 'Actions',
      enabled: 'Enabled',
      disabled: 'Disabled',
      expired: 'Expired',
      active: 'Active',
      yes: 'Yes',
      no: 'No',
    },
    pages: {
      dashboard: 'Dashboard',
      links: 'Links',
      domains: 'Domains',
      analytics: 'Analytics',
      tokens: 'API Tokens',
      users: 'Users & Roles',
      audit: 'Audit Log',
      settings: 'Settings & Backups',
    },
    descriptions: {
      dashboard: 'Manage every link from one place.',
      links: 'Create, organize, and safely manage redirects.',
      domains: 'Use your own domains for every short link.',
      analytics: 'Review traffic trends without storing full IP addresses or visitor fingerprints.',
      tokens: 'Grant the least privilege needed for automation.',
      users: 'Control management access through Access identities and app roles.',
      audit: 'Critical changes stay traceable and URL query parameters are redacted in the log.',
      settings: 'Configure the console, export links, and check service health.',
    },
    eyebrow: {
      dashboard: 'OVERVIEW',
      other: 'WORKSPACE',
    },
    login: {
      title: 'Welcome to Linro',
      subtitle: 'A Cloudflare-native private short-link platform',
      verifying: 'Verifying identity…',
      localToken: 'Local development token',
      localTokenHint: 'Use the random token printed by npm run local:init. This entry is for local development only.',
      enterLocal: 'Open local console',
      remoteHint: 'Make sure this email is allowed by your Access policy and has been added to the Linro user list.',
      recheck: 'Verify again',
      runtime: `v${VERSION} · Workers + D1 + Static Assets`,
    },
    topbar: {
      createLink: 'Create link',
      addDomain: 'Add domain',
      addUser: 'Add user',
      createToken: 'Create token',
      localBanner: 'Local development mode · data is stored locally and has not been deployed to Cloudflare',
      dismissError: 'Dismiss error',
      dismissNotice: 'Dismiss notice',
      footerSite: 'Workspace',
    },
    links: {
      emptyTitle: 'No short links yet',
      emptyDetail: 'Create your first short link or import one from a CSV / YOURLS export.',
      emptyNeedDomain: 'Add and bind a redirect domain before creating your first short link.',
      addDomain: 'Add domain',
      selectPage: 'Select all items on this page',
      selectOne: 'Select',
      shortLinkTarget: 'Short link / target URL',
      redirectType: 'Redirect',
      createdAt: 'Created at',
      permanent: 'Permanent',
      temporary: 'Temporary',
      copyShortLink: 'Copy short link',
      deleteConfirm: (slug: string) => `Permanently delete /${slug}? This action cannot be undone.`,
      deleted: 'Link deleted.',
      searchAria: 'Search links',
      searchPlaceholder: 'Search by slug, title, or target URL…',
      search: 'Search',
      allDomains: 'All domains',
      allStatuses: 'All statuses',
      bulkSelected: (n: number) => `${n.toLocaleString('en')} selected`,
      bulkConfirm: (n: number, action: string) => `Apply ${action} to ${n} selected link(s)?${action === 'delete' ? ' This permanently deletes the selected links.' : ''}`,
      bulkConflict: (n: number) => `${n} item(s) were skipped due to ownership or version conflicts. The rest completed. Refresh and check again.`,
      bulkDone: 'Bulk operation completed.',
      imported: (n: number) => `Imported ${n} link(s).`,
      importedProgress: (done: number, total: number) => `Submitted ${done} / ${total}`,
      importRollbackWarning: (message: string, done: number) => `${message} Submitted batches are not rolled back automatically; remove the ${done} already imported row(s) and try again.`,
      exportChanged: 'Data changed during export. Pause concurrent edits and try again; use a D1 SQL export for a full snapshot.',
      exportLimit: 'Web export is limited to 10000 links. Use the D1 SQL backup command in the README for a complete backup.',
      exportDone: (n: number) => `Exported ${n} link(s). Avoid concurrent edits during export; use a D1 SQL export for a fully consistent backup.`,
      importButton: 'Import links',
      autoGenerate: 'Auto-generate',
      importRowsInvalid: 'The file must contain 1–5000 valid rows.',
      fileTooLarge: 'The file must not exceed 2 MiB.',
      jsonNeedsArray: 'JSON must provide a links array or be an array of links directly.',
      missingDomain: (i: number) => `Row ${i} references a domain that does not exist. Add the domain first or choose a fallback domain.`,
      missingTarget: (i: number) => `Row ${i} is missing target_url/url.`,
    },
    dashboard: {
      metrics: [
        ['Total links', 'All created links', 'link'],
        ['Active links', 'Enabled and not expired', 'check'],
        ['Expired', 'Expired links are unavailable', 'close'],
        ['Managed domains', 'Domain records in the database', 'globe'],
      ] as const,
      chartTitle: 'Traffic trend',
      chartSubtitle: 'Last 7 days · UTC · sample-weighted estimate',
      chartReady: (n: number) => `${n.toLocaleString('en')} successful visits`,
      chartPending: 'Analytics unavailable',
      analyticsConnect: 'Connect Analytics Engine',
      analyticsReading: 'Reading analytics configuration…',
      viewAnalytics: 'View analytics status',
      recentTitle: 'Recently created',
      recentSubtitle: 'Latest short links added to this workspace',
    },
    domains: {
      note: 'Bind the domain to the Redirect Worker custom domains first, then add the database record. The enabled state on this page does not prove DNS/TLS validation.',
      ruleEnabled: 'Rule enabled',
      ruleDisabled: 'Rule disabled',
      defaultName: 'Custom redirect domain',
      linkCount: 'links',
      defaultCode: 'default code',
      edit: 'Edit domain',
      deleteConfirm: (hostname: string) => `Delete ${hostname}? The domain must not contain any links.`,
      emptyTitle: 'Add your first domain',
      emptyDetail: 'You can manage multiple redirect domains, and the same slug may exist on different domains.',
      add: 'Add domain',
      saved: 'Domain record saved. Make sure the Cloudflare Custom Domain is bound as well.',
    },
    analytics: {
      window: 'Window',
      recentDays: (n: number) => `Last ${n} day${n === 1 ? '' : 's'}`,
      hint: 'Only successful GET redirects or plain text responses are counted, not HEAD, password pages or failures. Sampled values are not exact clicks or unique visitors.',
      unavailableTitle: 'Analytics unavailable',
      unavailableDetail: 'Enable Analytics Engine in the deployment configuration and set ANALYTICS_API_TOKEN on the server.',
      trendSubtitle: (n: number) => `UTC · last ${n} day${n === 1 ? '' : 's'}`,
      estimatedRequests: 'estimated successful visits',
      topLinks: 'Top links',
      countries: 'Countries / regions',
      referrers: 'Referrers',
      noData: 'No data yet',
      unknownCountry: 'Unknown',
      direct: 'Direct / no referrer',
    },
    tokens: {
      note: 'Tokens are shown once and only SHA-256 hashes are stored. Every token can modify only links created by its owning user, even an Owner token. Tokens of one user share ownership; use a dedicated CI Editor. Access Service Token is still required.',
      emptyTitle: 'No API tokens',
      emptyDetail: 'Create time-limited least-privilege tokens for scripts that manage short links.',
      name: 'Name',
      prefix: 'Prefix / scopes',
      expiresAt: 'Expires at',
      revoke: 'Revoke',
      revokeConfirm: 'Revoke this token now?',
      revoked: 'Revoked',
      valid: 'Valid',
      revokedNotice: 'Token revoked.',
    },
    users: {
      note: 'Access must also allow the email. Editors modify only their own links; interactive Owner/Admin sessions manage all links. Reads remain team-wide, and the last active Owner is protected.',
      user: 'User',
      role: 'Role',
      createdAt: 'Created at',
    },
    audit: {
      time: 'Time',
      actor: 'Actor',
      action: 'Action',
      resource: 'Resource / details',
      requestId: 'Request ID',
    },
    settings: {
      workspaceSettings: 'Workspace settings',
      workspaceName: 'Workspace name',
      runStatus: 'Runtime health',
      runStatusDetail: 'Checks Worker and D1 directly. Analytics only reports configuration state and does not pretend to probe upstream availability.',
      healthCheck: 'Check service health',
      healthSuccess: 'Worker and D1 checks passed; analytics still requires real click/query validation.',
      lastArchive: 'Last analytics archive',
      exportBackup: 'Export & backup',
      exportBackupDetail: 'JSON preserves link configuration and domain metadata; CSV stays spreadsheet-friendly and mitigates formula injection.',
      fullRestore: 'Use a D1 SQL backup for full restore',
      exportNote: 'Web exports do not include users, token hashes, audit logs, or historical analytics, and they are not transactional snapshots.',
      importTitle: 'Import existing links',
      importDetail: 'Supports this project’s CSV / JSON formats and YOURLS CSV files with keyword, url, and title columns. Existing slugs are not overwritten.',
    },
    modals: {
      linkNew: 'Create short link',
      linkEdit: 'Edit short link',
      domainNew: 'Add domain',
      domainEdit: 'Edit domain',
      userNew: 'Add user',
      userEdit: 'Edit user',
      tokenNew: 'Create API token',
      tokenSecret: 'Save your API token',
      importTitle: 'Import links',
      closeDialog: 'Close dialog',
      fieldDomain: 'Redirect domain',
      fieldSlug: 'Custom slug',
      fieldSlugHint: 'Case-sensitive. Leave empty for an 8-character random slug. Only health, cdn-cgi, and the __Linro_ prefix are reserved, ignoring case.',
      fieldSlugPlaceholder: 'For example docs, or leave empty',
      fieldTarget: 'Target URL',
      fieldTargetHint: 'HTTP(S) only. Admin and managed short-link hosts are prohibited. Private/local targets need an exact deployment-level exception.',
      fieldTitle: 'Title',
      fieldCode: 'Redirect status code',
      fieldQuery: 'Query string policy',
      fieldQueryHint: 'Only deployment-allowlisted keys are forwarded (five utm_* keys by default). OAuth, login, reset, token and redirect destinations must use discard. Replace clears the target query string.',
      fieldExpires: 'Expiration time (local time)',
      fieldExpiresHint: 'Leave blank for no expiration.',
      fieldCache: 'Client cache (seconds)',
      fieldCacheHint: '0 means no-store. Non-zero values may delay redirect changes or disables taking effect.',
      fieldDescription: 'Notes',
      fieldName: 'Display name',
      fieldHostname: 'Domain',
      fieldHostnameHint: 'No scheme, path, or port. The hostname cannot be renamed after creation.',
      fieldRole: 'Role',
      fieldEmail: 'Access login email',
      fieldEnabledLink: 'Enable this link',
      fieldEnabledDomain: 'Enable all valid links on this domain',
      fieldEnabledUser: 'Allow this user to access the console',
      fieldTokenName: 'Token name',
      fieldTokenPlaceholder: 'For example CI link publisher',
      fieldTokenDays: 'Lifetime',
      scopes: 'Scopes',
      secretBody: 'The full token is shown only once. It cannot be recovered after closing; do not put it in a public repository.',
      secretAria: 'Full API token',
      copyToken: 'Copy token',
      closeAfterSave: 'Saved, close',
      file: 'CSV / JSON file',
      fileHint: 'Up to 2 MiB and 5000 rows; each atomic batch has at most 10 rows and 256 KiB.',
      fallbackDomain: 'Fallback domain',
      fallbackDomainHint: 'If a row contains hostname, that hostname is preferred over the fallback domain.',
      previewCode: 'Slug',
      previewTarget: 'Target URL',
      importWarning: 'Existing slugs are not overwritten. Failed batches roll back automatically; already successful batches remain. YOURLS click history and creation time are not imported.',
      confirmImport: 'Import',
      importing: 'Importing…',
      linkWarning: '301 / 308 are permanent redirects. Default no-store reduces caching impact, but it cannot revoke redirects already cached by clients.',
      domainInfo: 'This only updates D1. Also update redirect_hosts in deployment.json, run configure, and redeploy the Redirect Worker, or bind the Custom Domain in the Cloudflare dashboard.',
      queryDiscard: 'Discard incoming query parameters (default)',
      queryMerge: 'Merge query parameters · target wins',
      queryReplace: 'Replace all target query parameters',
      codePermanent: 'Permanent',
      codeTemporary: 'Temporary',
      oneDay: '1 day',
      sevenDays: '7 days',
      thirtyDays: '30 days',
      ninetyDays: '90 days',
      yearDays: '364 days',
      viewer: 'Viewer · read only',
      editor: 'Editor · manage own links',
      admin: 'Admin · links, domains, and logs',
      owner: 'Owner · all permissions',
    },
  },
} as const;

interface State {
  responseMode: 'redirect' | 'text';
  plainTextDraft: string;
  analyticsIds: string[] | null;
  session: Row | null;
  loading: boolean;
  busy: boolean;
  page: Page;
  error: string;
  notice: string;
  summary: Row;
  domains: Row[];
  links: Row[];
  total: number;
  pageNo: number;
  q: string;
  filterDomain: string;
  filterStatus: string;
  selected: string[];
  analytics: Row | null;
  days: number;
  users: Row[];
  tokens: Row[];
  audit: Row[];
  auditTotal: number;
  auditPage: number;
  settings: Row[];
  modal: { type: string; row?: Row } | null;
  modalError: string;
  oneTimeToken: string;
  importRows: Row[];
  importName: string;
  importDone: number;
  locale: Locale;
}

const stamp = (value: unknown, locale: Locale) => value ? new Date(Number(value) * 1000).toLocaleString(locale, { hour12: false }) : UI[locale].common.notAvailable;
const localDateTime = (unix: unknown) => {
  if (!unix) return '';
  const date = new Date(Number(unix) * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const number = (value: unknown, locale: Locale) => Math.round(Number(value) || 0).toLocaleString(locale);

export class App extends React.Component<{ onSignOut?: () => void }, State> {
  state: State = {
    responseMode: 'redirect', plainTextDraft: '', analyticsIds: null,
    session: null,
    loading: true,
    busy: false,
    page: 'dashboard',
    error: '',
    notice: '',
    summary: {},
    domains: [],
    links: [],
    total: 0,
    pageNo: 1,
    q: '',
    filterDomain: '',
    filterStatus: 'all',
    selected: [],
    analytics: null,
    days: 7,
    users: [],
    tokens: [],
    audit: [],
    auditTotal: 0,
    auditPage: 1,
    settings: [],
    modal: null,
    modalError: '',
    oneTimeToken: '',
    importRows: [],
    importName: '',
    importDone: 0,
    locale: detectLocale(),
  };

  private mounted = false;
  private sequence = 0;
  private returnFocus: HTMLElement | null = null;

  ui = () => UI[this.state.locale];
  pageLabel = (page: Page) => this.ui().pages[page];
  pageDescription = (page: Page) => this.ui().descriptions[page];
  roleName = (role: string) => {
    const names: Record<string, string> = {
      viewer: this.ui().modals.viewer,
      editor: this.ui().modals.editor,
      admin: this.ui().modals.admin,
      owner: this.ui().modals.owner,
    };
    return names[role] ?? role;
  };
  statusName = (disabled: boolean, expired: boolean) => disabled ? this.ui().common.disabled : expired ? this.ui().common.expired : this.ui().common.active;
  redirectName = (code: number) => [301, 308].includes(code) ? this.ui().links.permanent : this.ui().links.temporary;
  setLocale = (locale: Locale) => { applyLocale(locale); this.setState({ locale }); };

  modalKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') this.closeModal();
    if (event.key !== 'Tab') return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')].filter(node => node.getClientRects().length > 0);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  };

  componentDidMount() {
    this.mounted = true;
    applyLocale(this.state.locale);
    window.addEventListener('hashchange', this.hashChanged);
    void this.start();
  }

  componentWillUnmount() {
    this.mounted = false;
    window.removeEventListener('hashchange', this.hashChanged);
  }

  hashChanged = () => {
    const name = location.hash.slice(1);
    if (isPage(name) && this.state.session) void this.navigate(name, false);
  };

  can = (scope: string) => !!this.state.session?.scopes?.includes(scope);
  canManageLink = (link: Row, scope = 'links:write') => this.can(scope) &&
    (this.state.session?.link_write_scope === 'workspace' || link.created_by === this.state.session?.user?.id);

  message = (error: unknown): string => {
    const localized: Record<string, [string, string]> = {
      invalid_slug: ['短码须为 1–64 个英文字母、数字、_ 或 -；health、cdn-cgi 及 __Linro_ 前缀为系统保留项。', 'Use 1–64 ASCII letters, digits, _ or -. health, cdn-cgi, and the __Linro_ prefix are reserved.'],
      invalid_block_vpn: ['VPN 拦截选项必须为明确的布尔值。', 'The VPN blocking option requires an explicit boolean.'],
      browser_check_unconfigured: ['请先在两个 Worker 设置独立的 BROWSER_CHECK_SECRET，保留原密码密钥。', 'Configure the independent BROWSER_CHECK_SECRET on both Workers first; keep the existing password secret.'],
      invalid_response_mode: ['返回方式仅支持跳转或纯文本。', 'Choose HTTP redirect or plain text.'],
      invalid_text_content: ['纯文本需为 1–16384 字符且不超过 32768 UTF-8 字节，不可包含非法控制字符。', 'Text requires 1–16384 characters and at most 32768 UTF-8 bytes without invalid control characters.'],
      text_geo_conflict: ['纯文本不能使用地理跳转规则，请明确移除分流规则。', 'Plain text cannot use geographic targets. Clear the routing rules.'],
      invalid_link_id: ['请选择 1–50 条有效短链，不可提交空的自选范围。', 'Select 1–50 valid links; an empty custom scope is not allowed.'],
      stats_link_not_found: ['部分所选短链已不存在，请刷新并重新选择。', 'Some selected links no longer exist. Refresh and choose again.'],
      invalid_geo_rules: ['地理规则无效：最多 32 条，使用大写两位国家或大洲代码。', 'Invalid geographic rules: up to 32 rules using uppercase two-letter country or continent codes.'],
      duplicate_geo_rule: ['同一类型的国家或大洲规则不可重复。', 'A country or continent can occur only once per rule type.'],
      invalid_link_password: ['访问密码必须为 12–128 个字符，不可包含控制字符。', 'Access passwords require 12–128 characters without control characters.'],
      link_password_unconfigured: ['请先在两个 Worker 配置同一个 LINK_PASSWORD_SECRET。', 'Configure the same LINK_PASSWORD_SECRET on both Workers first.'],
      invalid_password_record: ['密码记录无效，请管理员重新设置密码。', 'Invalid password record. An administrator must set a new password.'],
      link_owner_required: ['只能修改自己创建的链接；跨用户管理需 Owner/Admin 交互会话。', 'You may modify only your own links; cross-user changes require an interactive Owner/Admin session.'],
      unsafe_query_mode: ['该目标含身份认证或敏感参数，访问参数策略必须选择“忽略”。', 'This target is authentication-related or contains sensitive parameters. Select discard.'],
      private_target: ['私有/内网目标需要管理员在部署配置中添加精确白名单。', 'A private/local target requires an exact allowlist entry in deployment configuration.'],
      security_policy_invalid: ['安全配置缺失或无效，请按 README 重新生成两个 Worker 的配置。', 'Security configuration is missing or invalid. Regenerate both Worker configurations as documented.'],
    };
    if (error instanceof APIError) return `${localized[error.code]?.[this.state.locale === 'zh-CN' ? 0 : 1] ?? error.message}${error.requestId ? ` [${error.requestId}]` : ''}`;
    return error instanceof Error ? error.message : this.ui().common.operationFailed;
  };

  async start() {
    this.setState({ loading: true, error: '' });
    try {
      const session = await api('/session');
      const domains = await api('/domains');
      if (!this.mounted) return;
      const name = location.hash.slice(1);
      const page = isPage(name) ? name : 'dashboard';
      this.setState({ session, domains, loading: false }, () => { void this.navigate(page); });
    } catch (error) {
      if (this.mounted) this.setState({ loading: false, session: null, error: this.message(error) });
    }
  }

  async navigate(page: Page, setHash = true) {
    const allowed: Partial<Record<Page, string>> = { users: 'users:write', settings: 'settings:write', audit: 'audit:read' };
    if (allowed[page] && !this.can(allowed[page]!)) page = 'dashboard';
    if (setHash) history.replaceState(null, '', '#' + page);
    this.setState({ page, error: '', notice: '', selected: [], analytics: page === 'analytics' ? null : this.state.analytics }, () => { void this.loadPage(); });
  }

  async loadPage() {
    const sequence = ++this.sequence;
    const { page, days, pageNo, auditPage } = this.state;
    this.setState({ busy: true });
    try {
      const update: Partial<State> = {};
      if (page === 'dashboard') {
        update.summary = await api('/summary');
        update.links = (await api('/links?limit=5')).items;
        try {
          update.analytics = await api('/stats?days=7');
        } catch (error) {
          update.analytics = { available: false, reason: this.message(error) };
        }
      } else if (page === 'links') {
        const params = new URLSearchParams({ q: this.state.q, domain_id: this.state.filterDomain, status: this.state.filterStatus, page: String(pageNo), limit: '25' });
        const data = await api('/links?' + params);
        update.links = data.items;
        update.total = data.total;
      } else if (page === 'domains') update.domains = await api('/domains');
      else if (page === 'analytics') {
        const params = new URLSearchParams({ days: String(days) });
        if (this.state.analyticsIds !== null) {
          if (!this.state.analyticsIds.length) throw new Error(this.state.locale === 'zh-CN' ? '请选择至少一条短链。' : 'Select at least one link.');
          params.set('link_ids', this.state.analyticsIds.join(','));
        }
        update.analytics = await api('/stats?' + params);
      }
      else if (page === 'users') update.users = await api('/users');
      else if (page === 'tokens') update.tokens = await api('/tokens');
      else if (page === 'audit') {
        const data = await api('/audit?page=' + auditPage);
        update.audit = data.items;
        update.auditTotal = data.total;
      } else if (page === 'settings') update.settings = await api('/settings');
      if (this.mounted && sequence === this.sequence) this.setState({ ...update, busy: false } as State);
    } catch (error) {
      if (this.mounted && sequence === this.sequence) this.setState({ error: this.message(error), busy: false });
    }
  }

  async mutate(task: () => Promise<unknown>, success?: string) {
    if (this.state.busy) return;
    this.setState({ busy: true, error: '', modalError: '' });
    try {
      await task();
      this.setState({ busy: false, modal: null, notice: success ?? this.ui().common.saved, selected: [] });
      const domains = await api('/domains');
      this.setState({ domains });
      await this.loadPage();
    } catch (error) {
      const message = this.message(error);
      if (this.state.modal) {
        this.setState({ busy: false, modalError: message });
      } else {
        this.setState({ busy: false, error: message });
      }
    }
  }

  async copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.setState({ notice: this.ui().common.copied });
    } catch {
      this.setState({ error: this.ui().common.copyUnavailable });
    }
  }

  openModal = (type: string, row?: Row) => {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.setState({ plainTextDraft: row?.text_content ?? '', responseMode: row?.response_mode === 'text' ? 'text' : 'redirect', modal: { type, row }, modalError: '', oneTimeToken: '', importRows: [], importName: '', importDone: 0 }, () => {
      (document.querySelector('.modal [autofocus], .modal input, .modal select, .modal button') as HTMLElement | null)?.focus();
    });
  };

  closeModal = () => {
    if (!this.state.busy) this.setState({ modal: null, modalError: '', oneTimeToken: '', importRows: [] }, () => this.returnFocus?.focus());
  };

  async submitLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const row = this.state.modal?.row;
    const expires = String(values.get('expires_at') ?? '');
    let geo: unknown;
    try { geo = JSON.parse(String(values.get('geo_rules_json') ?? '[]')); }
    catch { this.setState({ modalError: this.state.locale === 'zh-CN' ? '地理规则格式无效。' : 'Invalid geographic rule data.' }); return; }
    const output = values.get('response_mode') === 'text' ? 'text' : 'redirect';
    const body: Row = {
      response_mode: output, text_content: output === 'text' ? values.get('text_content') : '',
      domain_id: values.get('domain_id'),
      slug: values.get('slug'),
      target_url: output === 'text' ? '' : values.get('target_url'),
      title: values.get('title'),
      description: values.get('description'),
      redirect_code: output === 'text' ? (row?.redirect_code ?? 301) : Number(values.get('redirect_code')),
      query_mode: output === 'text' ? 'discard' : values.get('query_mode'),
      enabled: values.get('enabled') === 'on',
      block_vpn: values.get('block_vpn') === 'on',
      expires_at: expires ? Math.floor(new Date(expires).getTime() / 1000) : null,
      cache_ttl: output === 'text' ? 0 : Number(values.get('cache_ttl')),
      geo_rules: output === 'text' ? [] : geo,
      max_redirects: values.get('max_redirects') ? Number(values.get('max_redirects')) : null,
    };
    if (values.get('password_action') === 'set') body.password = values.get('password');
    else if (values.get('password_action') === 'remove') body.password = null;
    if (row) { body.version = row.version; body.reset_redirect_count = values.get('reset_redirect_count') === 'on'; }
    await this.mutate(() => api('/links' + (row ? '/' + row.id : ''), row ? 'PATCH' : 'POST', body), row ? (this.state.locale === 'zh-CN' ? '短链已更新。' : 'Short link updated.') : (this.state.locale === 'zh-CN' ? '短链已创建。' : 'Short link created.'));
  }

  async submitDomain(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const row = this.state.modal?.row;
    const body: Row = { name: values.get('name'), enabled: values.get('enabled') === 'on', default_redirect_code: Number(values.get('default_redirect_code')) };
    if (row) body.version = row.version;
    else body.hostname = values.get('hostname');
    await this.mutate(() => api('/domains' + (row ? '/' + row.id : ''), row ? 'PATCH' : 'POST', body), this.ui().domains.saved);
  }

  async submitUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const row = this.state.modal?.row;
    const body: Row = { display_name: values.get('display_name'), role: values.get('role') };
    if (row) {
      body.version = row.version;
      body.enabled = values.get('enabled') === 'on';
    } else body.email = values.get('email');
    await this.mutate(() => api('/users' + (row ? '/' + row.id : ''), row ? 'PATCH' : 'POST', body));
  }

  async submitToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (this.state.busy) return;
    const values = new FormData(event.currentTarget);
    this.setState({ busy: true, modalError: '' });
    try {
      const result = await api('/tokens', 'POST', { name: values.get('name'), scopes: values.getAll('scopes'), expires_at: Math.floor(Date.now() / 1000) + Number(values.get('days')) * 86400 });
      this.setState({ busy: false, oneTimeToken: result.token, modal: { type: 'secret' }, tokens: await api('/tokens') });
    } catch (error) {
      this.setState({ busy: false, modalError: this.message(error) });
    }
  }

  async bulk(action: string) {
    const chosen = this.state.links.filter(link => this.state.selected.includes(link.id) && this.canManageLink(link, action === 'delete' ? 'links:delete' : 'links:write'));
    if (!chosen.length || !window.confirm(this.ui().links.bulkConfirm(chosen.length, action))) return;
    await this.mutate(async () => {
      const results: Row[] = [];
      for (let index = 0; index < chosen.length; index += 10) {
        const data = await api('/links/bulk', 'POST', { action, items: chosen.slice(index, index + 10).map(link => ({ id: link.id, version: link.version })) });
        results.push(...data.results);
      }
      const failed = results.filter((result: Row) => !result.ok);
      if (failed.length) throw new Error(this.ui().links.bulkConflict(failed.length));
    }, this.ui().links.bulkDone);
  }

  async exportLinks(format: 'json' | 'csv') {
    if (this.state.busy) return;
    this.setState({ busy: true, error: '' });
    try {
      const rows: Row[] = [];
      const seen = new Set<string>();
      let page = 1;
      let total = 0;
      let firstTotal: number | undefined;
      do {
        const data = await api(`/links?limit=100&page=${page}`);
        total = data.total;
        if (firstTotal === undefined) firstTotal = total;
        if (total !== firstTotal || page > 100 || (page > 1 && !data.items.length) || data.items.some((row: Row) => seen.has(row.id))) throw new Error(this.ui().links.exportChanged);
        for (const row of data.items) {
          seen.add(row.id);
          rows.push(row);
        }
        page++;
        if (total > 10000) throw new Error(this.ui().links.exportLimit);
      } while (rows.length < total);
      const name = `Linro-${new Date().toISOString().slice(0, 10)}`;
      if (format === 'csv') download(name + '.csv', exportCSV(rows), 'text/csv;charset=utf-8');
      else download(name + '.json', JSON.stringify({ format: 'linro', version: VERSION, exported_at: new Date().toISOString(), domains: this.state.domains, settings: { site_name: this.state.session?.site_name }, links: rows }, null, 2), 'application/json');
      this.setState({ busy: false, notice: this.ui().links.exportDone(rows.length) });
    } catch (error) {
      this.setState({ busy: false, error: this.message(error) });
    }
  }

  async chooseImport(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error(this.ui().links.fileTooLarge);
      const source = await file.text();
      let rows: Row[];
      if (file.name.toLowerCase().endsWith('.json')) {
        const data = JSON.parse(source);
        rows = Array.isArray(data) ? data : data.links;
        if (!Array.isArray(rows)) throw new Error(this.ui().links.jsonNeedsArray);
      } else rows = parseCSV(source);
      if (!rows.length || rows.length > 5000 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error(this.ui().links.importRowsInvalid);
      this.setState({ importRows: rows, importName: file.name, modalError: '', importDone: 0 });
    } catch (error) {
      this.setState({ modalError: this.message(error), importRows: [] });
    }
  }

  async submitImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (this.state.busy) return;
    const form = new FormData(event.currentTarget);
    const fallback = String(form.get('domain_id'));
    this.setState({ busy: true, modalError: '', importDone: 0 });
    try {
      const links = this.state.importRows.map((row, index) => {
        const domain = row.hostname ? this.state.domains.find(domain => domain.hostname === String(row.hostname).toLowerCase()) : this.state.domains.find(domain => domain.id === fallback);
        if (!domain) throw new Error(this.ui().links.missingDomain(index + 1));
        const slug = row.slug ?? row.keyword ?? '';
        const target = row.response_mode === 'text' ? '' : row.target_url ?? row.url;
        if (typeof target !== 'string') throw new Error(this.ui().links.missingTarget(index + 1));
        const result: Row = { response_mode: row.response_mode ?? 'redirect', text_content: row.text_content ?? '', domain_id: domain.id, slug, target_url: target, title: row.title ?? '', description: row.description ?? '' };
        for (const key of ['redirect_code', 'cache_ttl']) if (row[key] !== undefined && row[key] !== '') result[key] = Number(row[key]);
        if (row.enabled !== undefined && row.enabled !== '') result.enabled = row.enabled === true || row.enabled === 1 || row.enabled === '1' || row.enabled === 'true';
        if (row.block_vpn !== undefined && row.block_vpn !== '') {
          if (![true, false, 0, 1, '0', '1', 'true', 'false'].includes(row.block_vpn)) throw new Error(this.state.locale === 'zh-CN' ? '无效的 block_vpn 值，禁止静默移除保护。' : 'Invalid block_vpn value; protection cannot be silently removed.');
          result.block_vpn = [true, 1, '1', 'true'].includes(row.block_vpn);
        }
        const protectedExport = [true, 1, '1', 'true'].includes(row.password_protected);
        if (protectedExport && !row.password) throw new Error(this.state.locale === 'zh-CN' ? `第 ${index + 1} 条是密码保护链接，请提供新 password；禁止静默导入为公开链接。` : `Row ${index + 1} is password protected. Provide a new password; it cannot be silently imported as public.`);
        if (row.password !== undefined && row.password !== '') result.password = row.password;
        if (row.geo_rules) result.geo_rules = typeof row.geo_rules === 'string' ? JSON.parse(row.geo_rules) : row.geo_rules;
        if (row.max_redirects !== undefined && row.max_redirects !== null && row.max_redirects !== '') result.max_redirects = Number(row.max_redirects);
        // Exported counters are read-only snapshots, never client-assigned during import.
        if (row.query_mode) result.query_mode = row.query_mode;
        if (row.expires_at !== undefined && row.expires_at !== null && row.expires_at !== '') result.expires_at = Number(row.expires_at);
        return result;
      });
      // Respect both the server's 10-row atomic limit and its 256 KiB JSON
      // byte limit. Text/geo data can make ten valid rows too large together.
      // Plan every batch before writes so one oversized row fails before import.
      const batches: Row[][] = []; let batch: Row[] = [];
      const encoder = new TextEncoder();
      const bytes = (rows: Row[]) => encoder.encode(JSON.stringify({ links: rows })).length;
      for (const link of links) {
        if (bytes([link]) > 262144) throw new Error(this.state.locale === 'zh-CN' ? '单条导入记录超过 256 KiB 请求上限。' : 'An import row exceeds the 256 KiB request limit.');
        const candidate = [...batch, link];
        if (candidate.length > 10 || bytes(candidate) > 262144) { batches.push(batch); batch = [link]; }
        else batch = candidate;
      }
      if (batch.length) batches.push(batch);
      let imported = 0;
      for (const group of batches) {
        await api('/links/import', 'POST', { links: group }); imported += group.length;
        this.setState({ importDone: imported });
      }
      this.setState({ busy: false, modal: null, notice: this.ui().links.imported(links.length) });
      await this.loadPage();
    } catch (error) {
      this.setState({ busy: false, modalError: this.ui().links.importRollbackWarning(this.message(error), this.state.importDone) });
    }
  }

  viewAnalytics = (ids: string[] | null) => {
    if (ids !== null && (!ids.length || ids.length > 50)) return;
    this.setState({ analyticsIds: ids, analytics: null }, () => { void this.navigate('analytics'); });
  };

  renderLanguageSwitch(compact = false) {
    const ui = this.ui();
    return <div className={'lang-switch' + (compact ? ' compact' : '')} aria-label={ui.common.language} role="group">
      {(['zh-CN', 'en'] as Locale[]).map(locale => <button key={locale} type="button" className={this.state.locale === locale ? 'active' : ''} aria-pressed={this.state.locale === locale} onClick={() => this.setLocale(locale)}>{localeLabels[locale]}</button>)}
    </div>;
  }

  renderLogin() {
    const ui = this.ui();
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    return <div className="login-shell"><div className="login-card"><div className="login-toolbar">{this.renderLanguageSwitch(true)}</div><span className="brand-mark"><Icon name="link" size={30}/></span><div className="eyebrow">YOUR LINKS. YOUR CONTROL.</div><h1>{ui.login.title}</h1><p>{ui.login.subtitle}</p>{this.state.loading ? <p className="muted">{ui.login.verifying}</p> : <>
      {this.state.error && <div className="alert error" role="alert">{this.state.error}</div>}
      {isLocal ? <form onSubmit={event => { event.preventDefault(); const value = new FormData(event.currentTarget).get('dev_token'); sessionStorage.setItem('cf-links-dev-token', String(value)); void this.start(); }}><Field label={ui.login.localToken} hint={ui.login.localTokenHint}><input name="dev_token" type="password" required autoComplete="off"/></Field><button className="primary full" type="submit">{ui.login.enterLocal} <Icon name="arrow"/></button></form> : <><p>{ui.login.remoteHint}</p><button className="primary" onClick={() => location.reload()}>{ui.login.recheck}</button></>}
    </>}<small>{ui.login.runtime}</small></div></div>;
  }

  render() {
    if (!this.state.session) return this.renderLogin();
    const { page, session, busy } = this.state;
    const ui = this.ui();
    const nav: { page: Page; icon: string; scope?: string }[] = [
      { page: 'dashboard', icon: 'grid' },
      { page: 'links', icon: 'link' },
      { page: 'domains', icon: 'globe' },
      { page: 'analytics', icon: 'chart' },
      { page: 'tokens', icon: 'key' },
      { page: 'users', icon: 'users', scope: 'users:write' },
      { page: 'audit', icon: 'audit', scope: 'audit:read' },
      { page: 'settings', icon: 'settings', scope: 'settings:write' },
    ];
    return <><DashboardShell locale={this.state.locale} page={page} title={this.pageLabel(page)} workspace={session.site_name} email={String(session.user.email)} role={this.roleName(session.user.role)}
      navigation={nav.filter(item => !item.scope || this.can(item.scope)).map(item => ({ id: item.page, label: this.pageLabel(item.page), icon: <Icon name={item.icon}/>, management: ['tokens', 'users', 'audit', 'settings'].includes(item.page) }))}
      onNavigate={target => { if (isPage(target)) void this.navigate(target); }} onSignOut={() => { if (this.props.onSignOut) { this.props.onSignOut(); return; } sessionStorage.removeItem('cf-links-dev-token'); location.assign(session.auth_kind === 'local' ? '/' : '/cdn-cgi/access/logout'); }}
      languageSwitch={this.renderLanguageSwitch()} brandIcon={<Icon name="link" size={24}/>}><div className="page-heading"><div><div className="eyebrow">{page === 'dashboard' ? ui.eyebrow.dashboard : `${ui.eyebrow.other} / ${this.pageLabel(page).toUpperCase()}`}</div><h1>{this.pageLabel(page)}</h1><p>{this.pageDescription(page)}</p></div><div className="heading-actions"><button className="icon-button" title={ui.common.refresh} aria-label={ui.common.refresh} disabled={busy} onClick={() => void this.loadPage()}><Icon name="refresh"/></button>{(page === 'links' || page === 'dashboard') && this.can('links:write') && <button className="primary" disabled={!this.state.domains.length || busy} onClick={() => this.openModal('link')}><Icon name="plus"/>{ui.topbar.createLink}</button>}{page === 'domains' && this.can('domains:write') && <button className="primary" onClick={() => this.openModal('domain')}><Icon name="plus"/>{ui.topbar.addDomain}</button>}{page === 'users' && <button className="primary" onClick={() => this.openModal('user')}><Icon name="plus"/>{ui.topbar.addUser}</button>}{page === 'tokens' && <button className="primary" onClick={() => this.openModal('token')}><Icon name="plus"/>{ui.topbar.createToken}</button>}</div></div>
      {session.auth_kind === 'local' && <div className="local-banner">{ui.topbar.localBanner}</div>}
      {this.state.error && <div className="alert error" role="alert">{this.state.error}<button aria-label={ui.topbar.dismissError} onClick={() => this.setState({ error: '' })}>×</button></div>}
      {this.state.notice && <div className="alert success" role="status">{this.state.notice}<button aria-label={ui.topbar.dismissNotice} onClick={() => this.setState({ notice: '' })}>×</button></div>}
      <div aria-busy={busy}>{this.renderPage()}</div><footer className="page-footer"><span>{ui.topbar.footerSite}: {session.site_name}</span><span className="license-links"><span>Linro v{VERSION}</span><a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">AGPL-3.0-only</a>{session.source_url && <a href={session.source_url} target="_blank" rel="noreferrer">{this.state.locale === 'zh-CN' ? '对应源码' : 'Source'}</a>}</span></footer></DashboardShell>{this.renderModal()}</>;
  }

  renderLinkTable(compact = false) {
    const rows = this.state.links;
    const canWrite = this.can('links:write');
    const writable = rows.filter(link => this.canManageLink(link));
    const ui = this.ui();
    if (!rows.length) return <Empty title={ui.links.emptyTitle} detail={this.state.domains.length ? ui.links.emptyDetail : ui.links.emptyNeedDomain} action={!this.state.domains.length && this.can('domains:write') ? <button className="primary" onClick={() => void this.navigate('domains')}>{ui.links.addDomain} <Icon name="arrow"/></button> : undefined}/>;
    return <div className="table-scroll"><table className="links-table"><thead><tr>{!compact && canWrite && <th className="check-cell"><input aria-label={ui.links.selectPage} type="checkbox" disabled={!writable.length} checked={writable.length > 0 && writable.every(link => this.state.selected.includes(link.id))} onChange={event => this.setState({ selected: event.target.checked ? writable.map(link => link.id) : [] })}/></th>}<th>{ui.links.shortLinkTarget}</th><th>{ui.links.redirectType}</th><th>{ui.common.status}</th>{!compact && <th>{ui.links.createdAt}</th>}<th className="right">{ui.common.actions}</th></tr></thead><tbody>{rows.map(link => {
      const expired = link.expires_at && link.expires_at <= Date.now() / 1000;
      const disabled = !link.enabled || link.domain_enabled === 0;
      const exhausted = link.max_redirects !== null && link.max_redirects !== undefined && link.redirect_count >= link.max_redirects;
      return <tr key={link.id}>{!compact && canWrite && <td className="check-cell"><input aria-label={`${ui.links.selectOne} ${link.slug}`} disabled={!this.canManageLink(link)} type="checkbox" checked={this.state.selected.includes(link.id)} onChange={event => this.setState({ selected: event.target.checked ? [...this.state.selected, link.id] : this.state.selected.filter(id => id !== link.id) })}/></td>}<td><div className="link-primary"><span className="link-cell-icon"><Icon name="link" size={16}/></span><a href={link.short_url} target="_blank" rel="noreferrer">{link.hostname}/<strong>{link.slug}</strong></a></div><div className="target-text" title={link.response_mode === 'text' ? responseLabels[this.state.locale].text : link.target_url}>{link.title ? link.title + ' · ' : ''}{link.response_mode === 'text' ? responseLabels[this.state.locale].text : link.target_url}</div></td><td><span className="code-badge">{link.response_mode === 'text' ? 200 : link.redirect_code}</span><small className="cell-small">{link.response_mode === 'text' ? responseLabels[this.state.locale].text : this.redirectName(link.redirect_code)}</small></td><td><span className={'badge ' + (disabled ? 'muted-badge' : expired ? 'warning-badge' : 'green-badge')}><i/>{!disabled && !expired && exhausted ? (this.state.locale === 'zh-CN' ? '次数已用尽' : 'Limit reached') : this.statusName(disabled, !!expired)}</span><div className="control-badges">{!!link.block_vpn && <span>{vpnLabels[this.state.locale].badge}</span>}{link.password_protected && <span>{this.state.locale === 'zh-CN' ? '密码保护' : 'Password'}</span>}{link.geo_rules?.length > 0 && <span>{this.state.locale === 'zh-CN' ? '地理分流' : 'Geo routing'}</span>}{link.max_redirects != null && <span>{link.redirect_count} / {link.max_redirects}</span>}</div></td>{!compact && <td className="date-cell">{stamp(link.created_at, this.state.locale)}</td>}<td><div className="row-actions">{this.can('analytics:read') && <button className="icon-button" title={responseLabels[this.state.locale].stats} aria-label={`${responseLabels[this.state.locale].stats} ${link.slug}`} onClick={() => this.viewAnalytics([link.id])}><Icon name="chart" size={16}/></button>}<button className="icon-button" aria-label={`${ui.links.copyShortLink} ${link.slug}`} title={ui.links.copyShortLink} onClick={() => void this.copy(link.short_url)}><Icon name="copy" size={16}/></button>{this.canManageLink(link) && <button className="text-button" onClick={() => this.openModal('link', link)}>{ui.common.edit}</button>}{!compact && this.canManageLink(link, 'links:delete') && <button className="text-button danger-text" onClick={() => { if (window.confirm(ui.links.deleteConfirm(link.slug))) void this.mutate(() => api(`/links/${link.id}?version=${link.version}`, 'DELETE'), ui.links.deleted); }}>{ui.common.delete}</button>}</div></td></tr>;
    })}</tbody></table></div>;
  }

  renderPage() {
    const s = this.state;
    const ui = this.ui();
    if (s.page === 'dashboard') return <>
      <section className="metric-grid">{ui.dashboard.metrics.map(([label, hint, icon], index) => <MetricCard key={label} label={label} hint={hint} icon={<Icon name={icon} size={23}/>} value={[s.summary.links, s.summary.active, s.summary.expired, s.summary.domains][index] === undefined ? ui.common.notAvailable : number([s.summary.links, s.summary.active, s.summary.expired, s.summary.domains][index], s.locale)}/>)}</section>
      <ComponentCard title={ui.dashboard.chartTitle} desc={ui.dashboard.chartSubtitle} action={<span className="quiet-pill">{s.analytics?.available ? ui.dashboard.chartReady(Number(s.analytics.clicks ?? 0)) : ui.dashboard.chartPending}</span>}>
        {s.analytics?.available ? <TrafficChart rows={s.analytics.timeline ?? []} locale={s.locale}/> : <Empty title={ui.dashboard.analyticsConnect} detail={s.analytics?.reason ?? ui.dashboard.analyticsReading} action={<button onClick={() => void this.navigate('analytics')}>{ui.dashboard.viewAnalytics} <Icon name="arrow" size={16}/></button>}/>}
      </ComponentCard>
      <ComponentCard title={ui.dashboard.recentTitle} desc={ui.dashboard.recentSubtitle} action={<button className="text-button" onClick={() => void this.navigate('links')}>{ui.common.viewAll} <Icon name="arrow" size={16}/></button>}>{this.renderLinkTable(true)}</ComponentCard>
    </>;
    if (s.page === 'links') return <section className="panel"><div className="filters"><form className="search-form" onSubmit={event => { event.preventDefault(); this.setState({ pageNo: 1, selected: [] }, () => void this.loadPage()); }}><span><Icon name="search" size={18}/></span><input aria-label={ui.links.searchAria} placeholder={ui.links.searchPlaceholder} maxLength={120} value={s.q} onChange={event => this.setState({ q: event.target.value })}/><button type="submit">{ui.links.search}</button></form><select aria-label={ui.links.allDomains} value={s.filterDomain} onChange={event => this.setState({ filterDomain: event.target.value, pageNo: 1, selected: [] }, () => void this.loadPage())}><option value="">{ui.links.allDomains}</option>{s.domains.map(domain => <option key={domain.id} value={domain.id}>{domain.hostname}</option>)}</select><select aria-label={ui.links.allStatuses} value={s.filterStatus} onChange={event => this.setState({ filterStatus: event.target.value, pageNo: 1, selected: [] }, () => void this.loadPage())}><option value="all">{ui.links.allStatuses}</option><option value="active">{ui.common.active}</option><option value="disabled">{ui.common.disabled}</option><option value="expired">{ui.common.expired}</option><option value="exhausted">{s.locale === 'zh-CN' ? '次数已用尽' : 'Limit reached'}</option></select><div className="filter-actions">{this.can('links:write') && <button disabled={!s.domains.length || s.busy} onClick={() => this.openModal('import')}>{ui.common.import}</button>}<button disabled={s.busy} onClick={() => void this.exportLinks('csv')}><Icon name="download" size={16}/>{ui.common.exportCsv}</button></div></div>{s.selected.length > 0 && <div className="bulk-bar">{ui.links.bulkSelected(s.selected.length)}<button onClick={() => void this.bulk('enable')}>{ui.common.enable}</button><button onClick={() => void this.bulk('disable')}>{ui.common.disable}</button>{this.can('links:delete') && <button className="danger-text" onClick={() => void this.bulk('delete')}>{ui.common.delete}</button>}</div>}{this.renderLinkTable()}<Pagination page={s.pageNo} total={s.total} limit={25} locale={s.locale} onChange={pageNo => this.setState({ pageNo, selected: [] }, () => void this.loadPage())}/></section>;
    if (s.page === 'domains') return <><div className="info-note"><Icon name="globe"/>{ui.domains.note}</div><div className="domain-grid">{s.domains.map(domain => <section className="panel domain-card" key={domain.id}><div className="domain-card-top"><span className="domain-icon"><Icon name="globe" size={25}/></span><span className={'badge ' + (domain.enabled ? 'green-badge' : 'muted-badge')}><i/>{domain.enabled ? ui.domains.ruleEnabled : ui.domains.ruleDisabled}</span></div><h2>{domain.hostname}</h2><p>{domain.name || ui.domains.defaultName}</p><div className="domain-numbers"><span><strong>{number(domain.link_count, s.locale)}</strong>{ui.domains.linkCount}</span><span><strong>{domain.default_redirect_code}</strong>{ui.domains.defaultCode}</span></div>{this.can('domains:write') && <div className="domain-actions"><button onClick={() => this.openModal('domain', domain)}>{ui.domains.edit}</button><button className="text-button danger-text" onClick={() => { if (confirm(ui.domains.deleteConfirm(domain.hostname))) void this.mutate(() => api(`/domains/${domain.id}?version=${domain.version}`, 'DELETE')); }}>{ui.common.delete}</button></div>}</section>)}{!s.domains.length && <div className="panel"><Empty title={ui.domains.emptyTitle} detail={ui.domains.emptyDetail} action={this.can('domains:write') ? <button className="primary" onClick={() => this.openModal('domain')}>{ui.domains.add}</button> : undefined}/></div>}</div></>;
    if (s.page === 'analytics') return <><AnalyticsSelection locale={s.locale} ids={s.analyticsIds} disabled={s.busy} onApply={this.viewAnalytics}/><div className="analytics-controls"><span>{ui.analytics.window}</span><select aria-label={ui.analytics.window} value={s.days} onChange={event => this.setState({ days: Number(event.target.value), analytics: null }, () => void this.loadPage())}>{[1, 7, 30, 90].map(days => <option key={days} value={days}>{ui.analytics.recentDays(days)}</option>)}</select><small>{ui.analytics.hint}</small></div><p className="analytics-provenance">{responseLabels[s.locale].provenance}</p>{s.busy ? <p role="status">{ui.common.loading}</p> : !s.analytics?.available ? <section className="panel"><Empty title={ui.analytics.unavailableTitle} detail={s.analytics?.reason ?? ui.analytics.unavailableDetail} /></section> : <><VPNStats locale={s.locale} data={s.analytics}/><section className="panel"><div className="panel-heading"><div><h2>{ui.dashboard.chartTitle}</h2><p>{ui.analytics.trendSubtitle(s.days)}</p></div><strong className="stat-total">{number(s.analytics.clicks, s.locale)} <small>{ui.analytics.estimatedRequests}</small></strong></div><TrafficChart rows={s.analytics.timeline ?? []} locale={s.locale}/></section><div className="analytics-grid">{[[ui.analytics.topLinks, 'top'], [ui.analytics.countries, 'countries'], [ui.analytics.referrers, 'referrers'], [responseLabels[s.locale].timezones, 'timezones'], [responseLabels[s.locale].ipTimezones, 'ip_timezones'], [responseLabels[s.locale].devices, 'devices']].map(([title, key]) => <section className="panel" key={key}><div className="panel-heading"><h2>{title}</h2></div><div className="ranking">{(s.analytics?.[key] ?? []).length ? s.analytics?.[key].map((row: Row, index: number) => <div className="rank-row" key={index}><span className="rank-no">{String(index + 1).padStart(2, '0')}</span><span title={row.hostname ?? ''}>{key === 'top' ? `${row.hostname}/${row.slug}` : key === 'countries' ? row.country || ui.analytics.unknownCountry : (key === 'timezones' || key === 'ip_timezones') ? (row.timezone && row.timezone !== 'none' ? row.timezone : responseLabels[s.locale].none) : key === 'devices' ? (row.device === 'mobile' ? responseLabels[s.locale].mobile : row.device === 'pc' ? responseLabels[s.locale].pc : responseLabels[s.locale].none) : row.referrer || ui.analytics.direct}</span><strong>{number(row.clicks, s.locale)}</strong></div>) : <p className="muted">{ui.analytics.noData}</p>}</div></section>)}</div></>}</>;
    if (s.page === 'tokens') return <><div className="info-note"><Icon name="key"/>{ui.tokens.note}</div><section className="panel">{!s.tokens.length ? <Empty title={ui.tokens.emptyTitle} detail={ui.tokens.emptyDetail}/> : <div className="table-scroll"><table><thead><tr><th>{ui.tokens.name}</th><th>{ui.tokens.prefix}</th><th>{ui.tokens.expiresAt}</th><th>{ui.common.status}</th><th>{ui.common.actions}</th></tr></thead><tbody>{s.tokens.map(token => <tr key={token.id}><td><strong>{token.name}</strong></td><td><code>{token.prefix}…</code><small className="cell-small">{JSON.parse(token.scopes).join(', ')}</small></td><td>{stamp(token.expires_at, s.locale)}</td><td>{token.revoked_at ? ui.tokens.revoked : token.expires_at < Date.now() / 1000 ? ui.common.expired : ui.tokens.valid}</td><td>{!token.revoked_at && <button className="text-button danger-text" onClick={() => { if (confirm(ui.tokens.revokeConfirm)) void this.mutate(() => api('/tokens/' + token.id, 'DELETE'), ui.tokens.revokedNotice); }}>{ui.tokens.revoke}</button>}</td></tr>)}</tbody></table></div>}</section></>;
    if (s.page === 'users') return <><div className="info-note"><Icon name="users"/>{ui.users.note}</div><section className="panel"><div className="table-scroll"><table><thead><tr><th>{ui.users.user}</th><th>{ui.users.role}</th><th>{ui.common.status}</th><th>{ui.users.createdAt}</th><th>{ui.common.actions}</th></tr></thead><tbody>{s.users.map(user => <tr key={user.id}><td><strong>{user.display_name || user.email}</strong><small className="cell-small">{user.email}</small></td><td><span className="quiet-pill">{this.roleName(user.role)}</span></td><td><span className={'badge ' + (user.enabled ? 'green-badge' : 'muted-badge')}><i/>{user.enabled ? ui.common.enabled : ui.common.disabled}</span></td><td>{stamp(user.created_at, s.locale)}</td><td><button className="text-button" onClick={() => this.openModal('user', user)}>{ui.common.edit}</button></td></tr>)}</tbody></table></div></section></>;
    if (s.page === 'audit') return <section className="panel"><div className="table-scroll"><table><thead><tr><th>{ui.audit.time}</th><th>{ui.audit.actor}</th><th>{ui.audit.action}</th><th>{ui.audit.resource}</th></tr></thead><tbody>{s.audit.map(row => <tr key={row.id}><td className="nowrap">{stamp(row.created_at, s.locale)}</td><td>{row.actor_email}</td><td><span className="code-badge">{row.action}</span></td><td>{row.resource_type} <code>{row.resource_id}</code><details><summary>{ui.common.details}</summary><pre>{JSON.stringify(JSON.parse(row.details), null, 2)}</pre><small>{ui.audit.requestId}: {row.request_id}</small></details></td></tr>)}</tbody></table></div><Pagination page={s.auditPage} total={s.auditTotal} limit={25} locale={s.locale} onChange={auditPage => this.setState({ auditPage }, () => void this.loadPage())}/></section>;
    return <div className="settings-grid"><section className="panel padded"><h2>{ui.settings.workspaceSettings}</h2><p>{s.locale === 'zh-CN' ? '跳转缓存模式：' : 'Redirect cache: '}{s.session?.features?.redirect_cache ? 'KV-first + D1 guard / fallback' : 'D1-only'}</p><form onSubmit={event => { event.preventDefault(); const name = new FormData(event.currentTarget).get('site_name'); void this.mutate(async () => { await api('/settings', 'PATCH', { site_name: name }); this.setState({ session: { ...s.session, site_name: name } }); }); }}><Field label={ui.settings.workspaceName}><input name="site_name" defaultValue={s.session?.site_name} maxLength={80} required/></Field><button className="primary" disabled={s.busy}>{ui.common.save}</button></form><hr/><h3>{ui.settings.runStatus}</h3><p>{ui.settings.runStatusDetail}</p><button onClick={() => void this.mutate(async () => { const result = await api('/system/health'); this.setState({ notice: JSON.stringify(result) }); }, ui.settings.healthSuccess)}>{ui.settings.healthCheck}</button><p className="muted">{ui.settings.lastArchive}: {stamp(s.settings.find(row => row.key === 'analytics_rollup_last_success')?.value, s.locale)}</p></section><section className="panel padded"><h2>{ui.settings.exportBackup}</h2><p>{ui.settings.exportBackupDetail}</p><div className="button-row"><button disabled={s.busy} onClick={() => void this.exportLinks('json')}><Icon name="download" size={16}/>{ui.common.exportJson}</button><button disabled={s.busy} onClick={() => void this.exportLinks('csv')}>{ui.common.exportCsv}</button></div><div className="info-box"><strong>{ui.settings.fullRestore}</strong><p>{ui.settings.exportNote}</p><code>npm run backup</code></div><h3>{ui.settings.importTitle}</h3><p>{ui.settings.importDetail}</p><button disabled={s.busy || !s.domains.length} onClick={() => this.openModal('import')}>{ui.links.importButton}</button></section></div>;
  }

  renderModal() {
    const modal = this.state.modal;
    if (!modal) return null;
    const row = modal.row;
    const s = this.state;
    const ui = this.ui();
    const titles: Record<string, string> = {
      link: row ? ui.modals.linkEdit : ui.modals.linkNew,
      domain: row ? ui.modals.domainEdit : ui.modals.domainNew,
      user: row ? ui.modals.userEdit : ui.modals.userNew,
      token: ui.modals.tokenNew,
      secret: ui.modals.tokenSecret,
      import: ui.modals.importTitle,
    };
    const footer = <div className="modal-footer"><button type="button" disabled={s.busy} onClick={this.closeModal}>{ui.common.cancel}</button><button className="primary" type="submit" disabled={s.busy}>{s.busy ? ui.common.saving : ui.common.save}</button></div>;
    return <div className="modal-overlay" onKeyDown={this.modalKeyboard}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><div><div className="eyebrow">LINRO</div><h2 id="modal-title">{titles[modal.type]}</h2></div><button className="icon-button" disabled={s.busy} aria-label={ui.modals.closeDialog} onClick={this.closeModal}><Icon name="close"/></button></div>{s.modalError && <div className="alert error" role="alert">{s.modalError}</div>}
      {modal.type === 'link' && <form onSubmit={event => void this.submitLink(event)}><div className="form-grid"><Field label={responseLabels[s.locale].mode} wide><select name="response_mode" value={s.responseMode} disabled={s.busy} onChange={event => this.setState({ responseMode: event.target.value === 'text' ? 'text' : 'redirect' })}><option value="redirect">{responseLabels[s.locale].redirect}</option><option value="text">{responseLabels[s.locale].text}</option></select></Field>{s.responseMode === 'text' && <Field label={responseLabels[s.locale].content} hint={responseLabels[s.locale].hint} wide><textarea name="text_content" rows={8} maxLength={16384} required value={s.plainTextDraft} onChange={event => this.setState({ plainTextDraft: event.target.value })} autoFocus/></Field>}<Field label={ui.modals.fieldDomain}><select name="domain_id" defaultValue={row?.domain_id ?? s.domains[0]?.id} onChange={event => { if (!row) { const code = event.currentTarget.form?.elements.namedItem('redirect_code') as HTMLSelectElement | null; if (code) code.value = String(s.domains.find(domain => domain.id === event.currentTarget.value)?.default_redirect_code ?? 301); } }} required>{s.domains.map(domain => <option key={domain.id} value={domain.id}>{domain.hostname}{domain.enabled ? '' : s.locale === 'zh-CN' ? '（已停用）' : ' (disabled)'}</option>)}</select></Field><Field label={ui.modals.fieldSlug} hint={ui.modals.fieldSlugHint}><input name="slug" defaultValue={row?.slug ?? ''} pattern="[A-Za-z0-9_\-]{1,64}" maxLength={64} required={!!row} placeholder={ui.modals.fieldSlugPlaceholder}/></Field>{s.responseMode === 'redirect' && <Field label={ui.modals.fieldTarget} hint={ui.modals.fieldTargetHint} wide><input name="target_url" type="url" required maxLength={4096} defaultValue={row?.target_url ?? ''} placeholder="https://example.com/your-page" autoFocus/></Field>}<Field label={ui.modals.fieldTitle}><input name="title" maxLength={200} defaultValue={row?.title ?? ''}/></Field>{s.responseMode === 'redirect' && <Field label={ui.modals.fieldCode}><select name="redirect_code" defaultValue={row?.redirect_code ?? s.domains[0]?.default_redirect_code ?? 301}>{[301, 302, 307, 308].map(code => <option key={code} value={code}>{code} · {[301, 308].includes(code) ? ui.modals.codePermanent : ui.modals.codeTemporary}</option>)}</select></Field>}{s.responseMode === 'redirect' && <Field label={ui.modals.fieldQuery} hint={ui.modals.fieldQueryHint}><select name="query_mode" defaultValue={row?.query_mode ?? 'discard'}><option value="discard">{ui.modals.queryDiscard}</option><option value="merge">{ui.modals.queryMerge}</option><option value="replace">{ui.modals.queryReplace}</option></select></Field>}<Field label={ui.modals.fieldExpires} hint={ui.modals.fieldExpiresHint}><input type="datetime-local" name="expires_at" defaultValue={localDateTime(row?.expires_at)}/></Field>{s.responseMode === 'redirect' && <Field label={ui.modals.fieldCache} hint={ui.modals.fieldCacheHint}><input name="cache_ttl" type="number" min="0" max="3600" required defaultValue={row?.cache_ttl ?? 0}/></Field>}<label className="checkbox-field"><input type="checkbox" name="enabled" defaultChecked={row ? !!row.enabled : true}/>{ui.modals.fieldEnabledLink}</label><Field label={ui.modals.fieldDescription} wide><textarea name="description" rows={3} maxLength={2000} defaultValue={row?.description ?? ''}/></Field></div><LinkOptions key={row?.id ?? 'new'} textMode={s.responseMode === 'text'} locale={s.locale} link={row} passwordsConfigured={!!s.session?.features?.passwords_configured} browserChecksConfigured={!!s.session?.features?.browser_checks_configured} disabled={s.busy}/><div className="warning-note">{s.responseMode === 'text' ? responseLabels[s.locale].warning : ui.modals.linkWarning}</div>{footer}</form>}
      {modal.type === 'domain' && <form onSubmit={event => void this.submitDomain(event)}><div className="form-grid"><Field label={ui.modals.fieldHostname} hint={ui.modals.fieldHostnameHint} wide><input name="hostname" defaultValue={row?.hostname ?? ''} disabled={!!row} required maxLength={253} placeholder="go.example.com" autoFocus/></Field><Field label={ui.modals.fieldName}><input name="name" defaultValue={row?.name ?? ''} maxLength={100}/></Field><Field label={ui.modals.fieldCode}><select name="default_redirect_code" defaultValue={row?.default_redirect_code ?? 301}>{[301, 302, 307, 308].map(code => <option key={code}>{code}</option>)}</select></Field><label className="checkbox-field"><input type="checkbox" name="enabled" defaultChecked={row ? !!row.enabled : true}/>{ui.modals.fieldEnabledDomain}</label></div><div className="info-box">{ui.modals.domainInfo}</div>{footer}</form>}
      {modal.type === 'user' && <form onSubmit={event => void this.submitUser(event)}><div className="form-grid"><Field label={ui.modals.fieldEmail} wide><input type="email" name="email" required disabled={!!row} defaultValue={row?.email ?? ''} maxLength={254}/></Field><Field label={ui.modals.fieldName}><input name="display_name" defaultValue={row?.display_name ?? ''} maxLength={100}/></Field><Field label={ui.modals.fieldRole}><select name="role" defaultValue={row?.role ?? 'viewer'}><option value="viewer">{ui.modals.viewer}</option><option value="editor">{ui.modals.editor}</option><option value="admin">{ui.modals.admin}</option><option value="owner">{ui.modals.owner}</option></select></Field>{row && <label className="checkbox-field"><input type="checkbox" name="enabled" defaultChecked={!!row.enabled}/>{ui.modals.fieldEnabledUser}</label>}</div>{footer}</form>}
      {modal.type === 'token' && <form onSubmit={event => void this.submitToken(event)}><Field label={ui.modals.fieldTokenName}><input name="name" maxLength={100} required placeholder={ui.modals.fieldTokenPlaceholder} autoFocus/></Field><Field label={ui.modals.fieldTokenDays}><select name="days" defaultValue="30"><option value="1">{ui.modals.oneDay}</option><option value="7">{ui.modals.sevenDays}</option><option value="30">{ui.modals.thirtyDays}</option><option value="90">{ui.modals.ninetyDays}</option><option value="364">{ui.modals.yearDays}</option></select></Field><h3>{ui.modals.scopes}</h3><div className="scope-grid">{['links:read', 'links:write', 'links:delete', 'domains:read', 'analytics:read'].filter(scope => this.can(scope)).map(scope => <label className="checkbox-field" key={scope}><input name="scopes" type="checkbox" value={scope} defaultChecked={scope === 'links:read'}/><code>{scope}</code></label>)}</div>{footer}</form>}
      {modal.type === 'secret' && <div><p>{ui.modals.secretBody}</p><textarea className="secret" aria-label={ui.modals.secretAria} readOnly rows={3} value={s.oneTimeToken}/><div className="modal-footer"><button onClick={() => void this.copy(s.oneTimeToken)}><Icon name="copy"/>{ui.modals.copyToken}</button><button className="primary" onClick={this.closeModal}>{ui.modals.closeAfterSave}</button></div></div>}
      {modal.type === 'import' && <form onSubmit={event => void this.submitImport(event)}><Field label={ui.modals.file} hint={ui.modals.fileHint}><input type="file" accept=".csv,.json" disabled={s.busy} onChange={event => void this.chooseImport(event.target.files?.[0])}/></Field><Field label={ui.modals.fallbackDomain} hint={ui.modals.fallbackDomainHint}><select name="domain_id" required defaultValue={s.domains[0]?.id}>{s.domains.map(domain => <option value={domain.id} key={domain.id}>{domain.hostname}</option>)}</select></Field>{s.importRows.length > 0 && <div className="import-preview"><h3>{s.importName} · {s.importRows.length.toLocaleString(s.locale)}</h3><div className="table-scroll"><table><thead><tr><th>{ui.modals.previewCode}</th><th>{ui.modals.previewTarget}</th></tr></thead><tbody>{s.importRows.slice(0, 5).map((row, index) => <tr key={index}><td>{String(row.slug ?? row.keyword ?? ui.links.autoGenerate)}</td><td>{String(row.target_url ?? row.url ?? '')}</td></tr>)}</tbody></table></div></div>}<div className="warning-note">{ui.modals.importWarning}<br/>{s.locale === 'zh-CN' ? '密码保护导出必须提供新 password 才能导入；计数从 0 开始。完整恢复请使用私有 SQL 备份。' : 'Protected exports require a new password for import; counters start at 0. Use a private SQL backup for a full restore.'}</div>{s.importDone > 0 && <p role="status">{ui.links.importedProgress(s.importDone, s.importRows.length)}</p>}<div className="modal-footer"><button type="button" disabled={s.busy} onClick={this.closeModal}>{ui.common.cancel}</button><button type="submit" className="primary" disabled={s.busy || !s.importRows.length}>{s.busy ? ui.modals.importing : ui.modals.confirmImport}</button></div></form>}
    </section></div>;
  }
}
