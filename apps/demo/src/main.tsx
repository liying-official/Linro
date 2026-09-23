import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../admin/src/web/App';
import { applyLocale, detectLocale, type Locale } from '../../admin/src/web/i18n';
import { enterDemo, leaveDemo, resetDemo, setDemoRole, previewLink } from './store.mjs';
import '../../admin/src/web/styles.css';
import '../../admin/src/web/tailadmin/theme.css';
import './demo.css';

function Demo() {
  const [open, setOpen] = React.useState(false);
  const [locale, setLocale] = React.useState<Locale>(detectLocale);
  const [error, setError] = React.useState(false);
  const [epoch, setEpoch] = React.useState(0);
  const [role, setRole] = React.useState('owner');
  const [preview, setPreview] = React.useState<Record<string, any> | null>(null);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const zh = locale === 'zh-CN';
  React.useEffect(() => {
    applyLocale(locale);
    const observer = new MutationObserver(() => setLocale(document.documentElement.lang === 'en' ? 'en' : 'zh-CN'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    return () => observer.disconnect();
  }, [locale]);
  React.useEffect(() => { if (preview) dialog.current?.showModal(); }, [preview]);
  const signOut = () => { leaveDemo(); setOpen(false); setRole('owner'); setError(false); };
  const reset = () => { resetDemo(); enterDemo('Linro'); setRole('owner'); history.replaceState(null, '', '#dashboard'); setEpoch(e => e + 1); };
  const switchLocale = (value: Locale) => { applyLocale(value); setLocale(value); };
  if (!open) return <main className="demo-login">
    <div className="demo-login-card">
      <div className="demo-login-top"><span className="demo-label">PUBLIC DEMO</span><div className="demo-languages"><button aria-pressed={zh} onClick={() => switchLocale('zh-CN')}>简体中文</button><button aria-pressed={!zh} onClick={() => switchLocale('en')}>English</button></div></div>
      <div className="demo-mark" aria-hidden="true">↗</div>
      <h1>Linro <span>{zh ? '演示站点' : 'WebGUI Demo'}</span></h1>
      <p>{zh ? '体验短链、域名与团队管理。' : 'Explore link, domain, and team management.'}</p>
      <form onSubmit={event => { event.preventDefault(); const password = new FormData(event.currentTarget).get('password'); if (enterDemo(password)) { setError(false); setOpen(true); } else setError(true); }}>
        <label className="field"><span>{zh ? '演示口令' : 'Demo password'}</span><input name="password" type="password" required autoComplete="off" autoFocus aria-describedby="demo-password-hint"/></label>
        <p id="demo-password-hint" className="demo-password-hint">{zh ? '公开演示口令：Linro（区分大小写）' : 'Public demo password: Linro (case-sensitive)'}</p>
        {error && <p role="alert" className="demo-error">{zh ? '口令不正确，请输入 Linro。' : 'Incorrect password. Enter Linro.'}</p>}
        <button className="primary full" type="submit">{zh ? '进入演示' : 'Enter demo'} <span aria-hidden="true">→</span></button>
      </form>
      <div className="demo-disclosure"><strong>{zh ? '虚构数据 · 无后台连接' : 'Fictional data · No backend connection'}</strong><p>{zh ? '所有操作仅在当前页面内存中模拟，刷新即重置。请勿输入真实域名、个人信息或密钥。口令仅用于演示流程，不是安全认证。' : 'Actions are simulated in page memory and reset on refresh. Do not enter real domains, personal data, or secrets. The password demonstrates a workflow; it is not secure authentication.'}</p></div>
      <a className="demo-doc-link" href={`../?lang=${zh ? 'zh' : 'en'}#api-reference`}>{zh ? '阅读 API 文档' : 'Read the API documentation'} ↗</a>
    </div><p className="demo-version">Linro v1.0.1 · TailAdmin React + Recharts</p>
  </main>;
  return <div className="demo-shell" onClickCapture={event => {
    const anchor = (event.target as Element).closest('a');
    if (!anchor || !/^https?:/.test(anchor.getAttribute('href') || '')) return;
    const row = previewLink(anchor.href);
    if (row) { event.preventDefault(); setPreview(row); }
  }}>
    <aside className="demo-toolbar" aria-label={zh ? '演示控制' : 'Demo controls'}>
      <div><strong>{zh ? '静态演示' : 'STATIC DEMO'}</strong><span>{zh ? '虚构数据 · 刷新重置 · 无真实 API' : 'Fictional data · Reset on refresh · No live API'}</span></div>
      <div className="demo-toolbar-actions"><label><span>{zh ? '体验角色' : 'Role'}</span><select aria-label={zh ? '演示角色' : 'Demo role'} value={role} onChange={e => { const value = e.target.value; setDemoRole(value); setRole(value); setEpoch(n => n + 1); }}>{['owner','admin','editor','viewer'].map(r => <option key={r} value={r}>{r[0].toUpperCase()+r.slice(1)}</option>)}</select></label><button onClick={reset}>{zh ? '重置数据' : 'Reset data'}</button><a href={`../?lang=${zh ? 'zh' : 'en'}#api-reference`}>{zh ? 'API 文档' : 'API docs'}</a></div>
    </aside>
    <App key={epoch} onSignOut={signOut}/>
    <dialog className="demo-preview" ref={dialog} onCancel={() => setPreview(null)} onClose={() => setPreview(null)}>
      <span className="demo-label">DEMO PREVIEW</span><h2>{zh ? '虚构短链预览' : 'Fictional link preview'}</h2>
      <p>{zh ? '此链接不会打开外部网站；演示站不提供真实跳转服务。' : 'This link does not open an external site. The demo does not provide live redirects.'}</p>
      {preview && <><code>{preview.short_url}</code><pre>{preview.response_mode === 'text' ? preview.text_content : preview.target_url}</pre>{preview.password_protected && <p>{zh ? '此示例具有密码保护标记；这里不验证链接访问密码。' : 'This example has a password-protection marker; link passwords are not verified here.'}</p>}</>}
      <button className="primary" autoFocus onClick={() => dialog.current?.close()}>{zh ? '关闭预览' : 'Close preview'}</button>
    </dialog>
  </div>;
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing demo root');
createRoot(root).render(<Demo/>);
