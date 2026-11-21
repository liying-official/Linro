import { APIError } from './client';
import { CSVError } from './csv';
import type { Locale } from './i18n';
import { UI } from './i18n-dict';

const localized: Record<string, [string, string]> = {
  local_token_required: [
    '请输入 npm run local:init 显示的本地开发令牌。',
    'Enter the local development token printed by npm run local:init.',
  ],
  user_not_allowed: ['当前账号未获准访问 Linro。', 'This account does not have access to Linro.'],
  invalid_access_token: [
    'Cloudflare Access 凭据无效，请重新登录。',
    'The Cloudflare Access credential is invalid. Sign in again.',
  ],
  access_keys_unavailable: [
    '暂时无法核验 Cloudflare Access 凭据，请稍后重试。',
    'Cloudflare Access credentials could not be verified. Try again later.',
  ],
  access_required: [
    '登录状态失效，请重新打开管理页面完成 Cloudflare Access 登录。',
    'Reopen the console and sign in with Cloudflare Access.',
  ],
  request_failed: ['请求失败。', 'The request failed.'],
  invalid_response: ['无法读取服务器响应。', 'Could not read the server response.'],
  network_error: ['网络连接失败。', 'The network connection failed.'],
  request_timeout: ['请求超时。', 'The request timed out.'],
  rate_limited: ['请求过于频繁。', 'Too many requests.'],
  search_too_long: [
    '搜索词过长。转义后的搜索模式最多 50 个 UTF-8 字节。',
    'Search text is too long. The escaped search pattern is limited to 50 UTF-8 bytes.',
  ],
  invalid_slug: [
    '短码须为 1–64 个英文字母、数字、_ 或 -；health、cdn-cgi 及 __Linro_ 前缀为系统保留项。',
    'Use 1–64 ASCII letters, digits, _ or -. health, cdn-cgi, and the __Linro_ prefix are reserved.',
  ],
  invalid_block_vpn: [
    'VPN 拦截选项必须为明确的布尔值。',
    'The VPN blocking option requires an explicit boolean.',
  ],
  browser_check_unconfigured: [
    '请先在两个 Worker 设置独立的 BROWSER_CHECK_SECRET，保留原密码密钥。',
    'Configure the independent BROWSER_CHECK_SECRET on both Workers first; keep the existing password secret.',
  ],
  invalid_response_mode: ['返回方式仅支持跳转或纯文本。', 'Choose HTTP redirect or plain text.'],
  invalid_text_content: [
    '纯文本需为 1–16384 字符且不超过 32768 UTF-8 字节，不可包含非法控制字符。',
    'Text requires 1–16384 characters and at most 32768 UTF-8 bytes without invalid control characters.',
  ],
  text_geo_conflict: [
    '纯文本不能使用地理跳转规则，请明确移除分流规则。',
    'Plain text cannot use geographic targets. Clear the routing rules.',
  ],
  invalid_link_id: [
    '请选择 1–50 条有效短链，不可提交空的自选范围。',
    'Select 1–50 valid links; an empty custom scope is not allowed.',
  ],
  stats_link_not_found: [
    '部分所选短链已不存在，请刷新并重新选择。',
    'Some selected links no longer exist. Refresh and choose again.',
  ],
  invalid_geo_rules: [
    '地理规则无效：最多 32 条，使用大写两位国家或大洲代码。',
    'Invalid geographic rules: up to 32 rules using uppercase two-letter country or continent codes.',
  ],
  duplicate_geo_rule: [
    '同一类型的国家或大洲规则不可重复。',
    'A country or continent can occur only once per rule type.',
  ],
  invalid_link_password: [
    '访问密码必须为 12–128 个字符，不可包含控制字符。',
    'Access passwords require 12–128 characters without control characters.',
  ],
  link_password_unconfigured: [
    '请先在两个 Worker 配置同一个 LINK_PASSWORD_SECRET。',
    'Configure the same LINK_PASSWORD_SECRET on both Workers first.',
  ],
  invalid_password_record: [
    '密码记录无效，请管理员重新设置密码。',
    'Invalid password record. An administrator must set a new password.',
  ],
  link_owner_required: [
    '只能修改自己创建的链接；跨用户管理需 Owner/Admin 交互会话。',
    'You may modify only your own links; cross-user changes require an interactive Owner/Admin session.',
  ],
  unsafe_query_mode: [
    '该目标含身份认证或敏感参数，访问参数策略必须选择“忽略”。',
    'This target is authentication-related or contains sensitive parameters. Select discard.',
  ],
  private_target: [
    '私有/内网目标需要管理员在部署配置中添加精确白名单。',
    'A private/local target requires an exact allowlist entry in deployment configuration.',
  ],
  security_policy_invalid: [
    '安全配置缺失或无效，请按 README 重新生成两个 Worker 的配置。',
    'Security configuration is missing or invalid. Regenerate both Worker configurations as documented.',
  ],
};
export function errorMessage(error: unknown, locale: Locale): string {
  if (error instanceof CSVError) {
    const labels = {
      csv_too_large: ['CSV 文件超过 2 MiB。', 'The CSV file exceeds 2 MiB.'],
      csv_too_many_rows: ['单次导入最多 5000 行。', 'Import up to 5000 rows at a time.'],
      csv_invalid_quote: ['CSV 引号格式错误。', 'Invalid quoting in the CSV file.'],
      csv_unclosed_quote: [
        'CSV 包含未闭合引号。',
        'A quoted CSV field is missing its closing quote.',
      ],
      csv_invalid_headers: [
        'CSV 列名为空或重复。',
        'CSV column names must be nonempty and unique.',
      ],
      csv_column_count: [
        `第 ${error.row} 行列数不匹配。`,
        `Row ${error.row} has a different number of columns.`,
      ],
    };
    return labels[error.code][locale === 'zh-CN' ? 0 : 1];
  }
  if (error instanceof APIError)
    return `${localized[error.code]?.[locale === 'zh-CN' ? 0 : 1] ?? error.message}${error.requestId ? ` [${error.requestId}]` : ''}`;
  return error instanceof Error ? error.message : UI[locale].common.operationFailed;
}
