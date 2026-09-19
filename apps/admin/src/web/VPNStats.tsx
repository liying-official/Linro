import React from 'react';
import type { Locale } from './i18n';

export const vpnLabels = {
  'zh-CN': {
    block: '禁止疑似 VPN 用户访问', badge: 'VPN 拦截',
    hint: '浏览器时区与 Cloudflare IP 时区不一致，或 Cloudflare 将访问标记为 Tor 时拒绝访问。无法保证拦截全部 VPN 用户，并且会存在错误拦截。开启后需要 JavaScript、Cookie 和可用的两种时区；无法判断时也会拒绝。',
    setup: '启用前请在两个 Worker 设置同一个独立的 BROWSER_CHECK_SECRET；不要替换已有 LINK_PASSWORD_SECRET。',
    total: '疑似 VPN 访问次数', success: '疑似 VPN 成功访问', blocked: '已拦截疑似 VPN', unknown: '无法判断而拦截',
    tor: '其中 Cloudflare Tor 标记',
    note: '采样加权请求次数，不是去重用户数。疑似次数包含成功访问与终止拦截；采集页和站内 303 不计。无法获取时区不直接标为 VPN。历史未采集的浏览器时区显示无。',
  },
  en: {
    block: 'Block suspected VPN visitors', badge: 'VPN blocking',
    hint: 'Deny access when the browser timezone differs from the Cloudflare IP timezone, or Cloudflare identifies Tor. This cannot block all VPNs and may incorrectly block legitimate visitors. JavaScript, cookies and both timezones are required; unverifiable visits are also denied.',
    setup: 'First configure the same independent BROWSER_CHECK_SECRET on both Workers. Do not replace the existing LINK_PASSWORD_SECRET.',
    total: 'Suspected VPN visits', success: 'Suspected VPN successes', blocked: 'Suspected VPN blocks', unknown: 'Unverifiable blocks',
    tor: 'Cloudflare Tor signals included',
    note: 'Sample-weighted requests, not unique users. Suspected counts include successes and terminal denials, excluding collection pages and local 303s. Missing timezone data is not itself a VPN finding. Older uncollected browser timezones show none.',
  },
} as const;

export function VPNStats({ locale, data }: { locale: Locale; data: Record<string, unknown> }) {
  const t = vpnLabels[locale];
  const count = (key: string) => Math.round(Number(data[key]) || 0).toLocaleString(locale);
  return <section aria-label={t.total} className="vpn-summary">
    <div className="metric-grid">{[[t.total, 'suspected_vpn_visits'], [t.success, 'suspected_vpn_successes'], [t.blocked, 'blocked_vpn_visits'], [t.unknown, 'unknown_timezone_blocks']].map(([title, key]) => <div className="metric" key={key}><div className="metric-label">{title}</div><strong>{count(key!)}</strong></div>)}</div>
    <p className="analytics-provenance">{t.tor}: {count('tor_visits')} · {t.note}</p>
  </section>;
}
