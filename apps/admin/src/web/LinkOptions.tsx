import React from 'react';
import { vpnLabels } from './VPNStats';
import { Field } from './components';
import type { Locale } from './i18n';

type Rule = { kind: 'country' | 'continent'; code: string; target_url: string };
interface Props {
  locale: Locale;
  textMode?: boolean;
  link?: { geo_rules?: Rule[]; password_protected?: boolean; max_redirects?: number | null; redirect_count?: number; block_vpn?: number };
  passwordsConfigured: boolean;
  browserChecksConfigured: boolean;
  disabled: boolean;
}
export const optionLabels = {
  'zh-CN': {
    title: '分流与访问控制', geo: '智能分流', hint: '按 Cloudflare IP 地理位置匹配：国家优先，其次大洲，未匹配使用上方目标地址。最多 32 条；这不是访问权限控制。',
    country: '国家', continent: '大洲', code: '国家代码', codeHint: '两位国家代码，例如 CN、JP、US', target: '分流目标地址', add: '添加分流规则', remove: '移除规则',
    regions: { AF: '非洲', AN: '南极洲', AS: '亚洲', EU: '欧洲', NA: '北美洲', OC: '大洋洲', SA: '南美洲' },
    password: '访问密码', none: '不设置密码', keep: '保持现有密码', set: '设置新密码', clear: '移除现有密码', newPassword: '新访问密码',
    passwordHint: '12–128 个字符；不保存明文、不在列表和导出中显示密码。解锁凭据有效 15 分钟，修改链接配置后失效。',
    secretHint: '设置密码前，请在两个 Worker 配置同一个 LINK_PASSWORD_SECRET。已有密码在缺少 secret 时会安全拒绝访问。',
    limit: '成功访问次数上限', limitHint: '留空为不限次数。仅启用上限期间计数；获准返回目标 Location 或纯文本 200 的 GET / HEAD 各计一次。密码页、解锁 303、失败请求不计数。',
    count: '已使用次数', reset: '保存时将计数清零（不会自动随编辑重置）', cache: '启用浏览器采集/VPN拦截、分流、密码或次数上限时强制 no-store。已被客户端缓存的旧跳转无法撤回。',
  },
  en: {
    title: 'Routing & access controls', geo: 'Smart routing', hint: 'Match Cloudflare IP geolocation: country first, then continent, otherwise the target URL above. Up to 32 rules. This is not an access-control boundary.',
    country: 'Country', continent: 'Continent', code: 'Country code', codeHint: 'Two-letter country code, e.g. CN, JP, US', target: 'Routing target URL', add: 'Add routing rule', remove: 'Remove rule',
    regions: { AF: 'Africa', AN: 'Antarctica', AS: 'Asia', EU: 'Europe', NA: 'North America', OC: 'Oceania', SA: 'South America' },
    password: 'Access password', none: 'No password', keep: 'Keep existing password', set: 'Set a new password', clear: 'Remove existing password', newPassword: 'New access password',
    passwordHint: '12–128 characters. No plaintext storage; passwords are excluded from lists and exports. Unlock cookies last 15 minutes and are invalidated by link configuration changes.',
    secretHint: 'To set passwords, configure the same LINK_PASSWORD_SECRET on both Workers. Existing protected links fail closed when the secret is missing.',
    limit: 'Successful response limit', limitHint: 'Leave blank for unlimited. Counted only while a limit is enabled. Each GET / HEAD returning the target Location or plain text 200 counts once. Password pages, local unlock 303s, and failures do not count.',
    count: 'Used responses', reset: 'Reset the counter on save (ordinary edits do not reset it)', cache: 'Browser collection/VPN blocking, routing, password protection, or a request limit forces no-store. Previously cached client redirects cannot be revoked.',
  },
} as const;

export function LinkOptions({ textMode = false, locale, link, passwordsConfigured, browserChecksConfigured, disabled }: Props) {
  const t = optionLabels[locale];
  const [rules, setRules] = React.useState<Rule[]>(() => (link?.geo_rules ?? []).map(rule => ({ ...rule })));
  const [passwordAction, setPasswordAction] = React.useState(link?.password_protected ? 'keep' : 'none');
  const update = (index: number, change: Partial<Rule>) => setRules(rows => rows.map((row, i) => i === index ? { ...row, ...change } : row));
  return <fieldset className="link-options" disabled={disabled}>
    <legend>{t.title}</legend>
    {!textMode && <><h3>{t.geo}</h3><p>{t.hint}</p>
    <input type="hidden" name="geo_rules_json" value={JSON.stringify(textMode ? [] : rules)}/>
    <div className="geo-rules">{rules.map((rule, index) => <div className="geo-rule" key={index}>
      <select aria-label={`${t.geo} ${index + 1}`} value={rule.kind} onChange={event => update(index, { kind: event.target.value as Rule['kind'], code: '' })}>
        <option value="country">{t.country}</option><option value="continent">{t.continent}</option>
      </select>
      {rule.kind === 'country' ? <input aria-label={`${t.code} ${index + 1}`} title={t.codeHint} placeholder="CN" value={rule.code} pattern="[A-Z]{2}" minLength={2} maxLength={2} required onChange={event => update(index, { code: event.target.value.toUpperCase() })}/> :
        <select aria-label={`${t.continent} ${index + 1}`} required value={rule.code} onChange={event => update(index, { code: event.target.value })}><option value="">—</option>{Object.entries(t.regions).map(([code, label]) => <option key={code} value={code}>{label} ({code})</option>)}</select>}
      <input aria-label={`${t.target} ${index + 1}`} type="url" placeholder="https://example.org/regional" maxLength={4096} required value={rule.target_url} onChange={event => update(index, { target_url: event.target.value })}/>
      <button type="button" className="danger-text" aria-label={`${t.remove} ${index + 1}`} onClick={() => setRules(rows => rows.filter((_, i) => i !== index))}>{t.remove}</button>
    </div>)}</div>
    <button type="button" disabled={disabled || rules.length >= 32} onClick={() => setRules(rows => [...rows, { kind: 'country', code: '', target_url: '' }])}>{t.add}</button>
    <hr/>
    </>}<Field label={t.password} hint={t.passwordHint}><select name="password_action" value={passwordAction} onChange={event => setPasswordAction(event.target.value)}>
      <option value={link?.password_protected ? 'keep' : 'none'}>{link?.password_protected ? t.keep : t.none}</option>
      <option value="set" disabled={!passwordsConfigured}>{t.set}</option>
      {link?.password_protected && <option value="remove">{t.clear}</option>}
    </select></Field>
    {!passwordsConfigured && <p className="warning-note">{t.secretHint}</p>}
    {passwordAction === 'set' && <Field label={t.newPassword}><input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={128}/></Field>}
    <label className="checkbox-field"><input type="checkbox" name="block_vpn" defaultChecked={!!link?.block_vpn} disabled={disabled || (!browserChecksConfigured && !link?.block_vpn)}/>{vpnLabels[locale].block}</label>
    <p className="warning-note">{vpnLabels[locale].hint}</p>
    {!browserChecksConfigured && <p>{vpnLabels[locale].setup}</p>}
    <Field label={t.limit} hint={t.limitHint}><input name="max_redirects" type="number" min={1} max={1000000000} step={1} defaultValue={link?.max_redirects ?? ''}/></Field>
    {link && <><p>{t.count}: <strong>{Number(link.redirect_count ?? 0).toLocaleString(locale)}</strong></p><label className="checkbox-field"><input name="reset_redirect_count" type="checkbox"/>{t.reset}</label></>}
    <p className="warning-note">{t.cache}</p>
  </fieldset>;
}
