import React from 'react';
import type { Locale } from './i18n';

export const vpnLabels = {
  'zh-CN': {
    block: '禁止疑似 VPN 用户访问',
    badge: 'VPN 拦截',
    hint: '仅允许 Cloudflare Radar 分类为 ACCESS_ISP 或 ORGANIZATION 的 ASN。Tor 或时区不匹配时拒绝访问。Worker 在一条 WebSocket 上计时 5 轮，轮间隔 400 ms；五轮完成后至少一轮与连接 RTT 的绝对差须小于 55 ms。需要 JavaScript、Cookie 及 Redirect Worker 的 RADAR_API_TOKEN，无法完成检查时也会拒绝。无法保证拦截全部 VPN 用户，并且会存在错误拦截。',
    setup:
      '启用前请在两个 Worker 设置同一个独立的 BROWSER_CHECK_SECRET；不要替换已有 LINK_PASSWORD_SECRET。',
    total: '疑似 VPN 访问次数',
    success: '疑似 VPN 成功访问',
    blocked: '已拦截疑似 VPN',
    unknown: '无法判断而拦截',
    tor: '其中 Cloudflare Tor 标记',
    note: '采样加权请求次数，不是去重用户数。疑似次数包含成功访问与终止拦截；采集页和站内 303 不计。无法获取时区不直接标为 VPN。历史未采集的浏览器时区显示无。',
  },
  en: {
    block: 'Block suspected VPN visitors',
    badge: 'VPN blocking',
    hint: 'Allow only ASNs classified as ACCESS_ISP or ORGANIZATION by Cloudflare Radar. Deny Tor and timezone mismatches. The Worker times five rounds on one WebSocket, with 400 ms between rounds. All five must complete and at least one must differ from the connection RTT by less than 55 ms. Checks require JavaScript, cookies and RADAR_API_TOKEN on the Redirect Worker. Incomplete checks deny access. This cannot block all VPNs and may incorrectly block legitimate visitors.',
    setup:
      'First configure the same independent BROWSER_CHECK_SECRET on both Workers. Do not replace the existing LINK_PASSWORD_SECRET.',
    total: 'Suspected VPN visits',
    success: 'Suspected VPN successes',
    blocked: 'Suspected VPN blocks',
    unknown: 'Unverifiable blocks',
    tor: 'Cloudflare Tor signals included',
    note: 'Sample-weighted requests, not unique users. Suspected counts include successes and terminal denials, excluding collection pages and local 303s. Missing timezone data is not itself a VPN finding. Older uncollected browser timezones show none.',
  },
} as const;

export function VPNStats({ locale, data }: { locale: Locale; data: Record<string, unknown> }) {
  const t = vpnLabels[locale];
  const count = (key: string) => Math.round(Number(data[key]) || 0).toLocaleString(locale);
  return (
    <section aria-label={t.total} className="vpn-summary">
      <div className="metric-grid">
        {[
          [t.total, 'suspected_vpn_visits'],
          [t.success, 'suspected_vpn_successes'],
          [t.blocked, 'blocked_vpn_visits'],
          [
            t.unknown,
            data.unverifiable_blocks === undefined
              ? 'unknown_timezone_blocks'
              : 'unverifiable_blocks',
          ],
        ].map(([title, key]) => (
          <div className="metric" key={key}>
            <div className="metric-label">{title}</div>
            <strong>{count(key!)}</strong>
          </div>
        ))}
      </div>
      <p className="analytics-provenance">
        {t.tor}: {count('tor_visits')} · {t.note}
      </p>
    </section>
  );
}
