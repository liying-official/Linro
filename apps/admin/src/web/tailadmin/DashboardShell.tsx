// SPDX-License-Identifier: MIT
// Adapted from TailAdmin AppLayout/AppSidebar/AppHeader, copyright (c) 2023 TailAdmin.
// Upstream revision and license: LICENSES/TailAdmin-MIT.txt and NOTICE.
import React, { useEffect, useRef, useState } from 'react';
import type { Locale } from '../i18n';

type NavigationItem = { id: string; label: string; icon: React.ReactNode; management: boolean };
type Props = {
  locale: Locale; page: string; title: string; workspace: string; email: string; role: string;
  navigation: NavigationItem[]; onNavigate: (page: string) => void; onSignOut: () => void;
  languageSwitch: React.ReactNode; brandIcon: React.ReactNode; children: React.ReactNode;
};

export function DashboardShell(props: Props) {
  const { locale, page, title, workspace, email, role, navigation, onNavigate, onSignOut, languageSwitch, brandIcon, children } = props;
  const [isExpanded, setIsExpanded] = useState(true);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1280);
  const sidebar = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const zh = locale === 'zh-CN';
  const close = () => { setIsMobileOpen(false); toggle.current?.focus(); };
  useEffect(() => {
    const resize = () => { const mobile = window.innerWidth < 1280; setIsMobile(mobile); if (!mobile) setIsMobileOpen(false); };
    window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => { setIsMobileOpen(false); }, [page]);
  useEffect(() => {
    if (!isMobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebar.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setIsMobileOpen(false); toggle.current?.focus(); }
      if (event.key === 'Tab') {
        const items = [...sidebar.current!.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)')].filter(el => el.getClientRects().length);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = previous; document.removeEventListener('keydown', key); };
  }, [isMobileOpen]);
  return <div className={`ta-layout min-h-screen xl:flex ${isExpanded ? '' : 'ta-collapsed'} ${isMobileOpen ? 'ta-mobile-open' : ''}`}>
    <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>{zh ? '跳到正文' : 'Skip to content'}</a>
    {isMobileOpen && <button className="ta-backdrop" onClick={close} aria-label={zh ? '关闭导航菜单' : 'Close navigation menu'} tabIndex={-1}/>}
    <aside ref={sidebar} id="app-navigation" className="ta-sidebar" inert={isMobile && !isMobileOpen} role={isMobileOpen ? 'dialog' : undefined} aria-modal={isMobileOpen || undefined} aria-label={zh ? '主导航' : 'Main navigation'}>
      <div className="ta-brand-row"><a className="brand" href="#dashboard" onClick={() => setIsMobileOpen(false)} aria-label="Linro"><span className="brand-mark">{brandIcon}</span><span className="ta-brand-text">Linro<small>{zh ? '链接管理' : 'LINK MANAGEMENT'}</small></span></a><button className="ta-close icon-button" onClick={close} aria-label={zh ? '关闭导航菜单' : 'Close navigation menu'}>×</button></div>
      <nav className="ta-navigation">
        {[false, true].map(management => <div className="ta-nav-group" key={String(management)}><div className="ta-nav-label">{management ? (zh ? '管理' : 'MANAGEMENT') : (zh ? '工作区' : 'WORKSPACE')}</div>{navigation.filter(item => item.management === management).map(item => <button key={item.id} type="button" className={`ta-nav-item ${page === item.id ? 'active' : ''}`} aria-current={page === item.id ? 'page' : undefined} title={item.label} onClick={() => { onNavigate(item.id); setIsMobileOpen(false); if (isMobile) toggle.current?.focus(); }}><span className="ta-nav-icon">{item.icon}</span><span className="ta-nav-text">{item.label}</span>{page === item.id && <span className="ta-nav-indicator"/>}</button>)}</div>)}
      </nav>
      <div className="ta-workspace"><span className="ta-workspace-dot"/><div><strong>{workspace}</strong><small>{zh ? '当前工作空间' : 'Current workspace'}</small></div></div>
    </aside>
    <div className="ta-main flex-1 transition-[margin] duration-300 ease-in-out">
      <header className="ta-header"><div className="ta-header-start"><button ref={toggle} className="icon-button ta-menu-toggle" aria-controls="app-navigation" aria-expanded={isMobile ? isMobileOpen : isExpanded} aria-label={zh ? '切换导航菜单' : 'Toggle navigation menu'} onClick={() => isMobile ? setIsMobileOpen(value => !value) : setIsExpanded(value => !value)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button><div className="ta-breadcrumb"><span>{workspace}</span><span aria-hidden="true">/</span><strong>{title}</strong></div></div><div className="ta-header-actions">{languageSwitch}<span className="ta-header-divider"/><div className="ta-user"><span className="avatar" aria-hidden="true">{email.slice(0, 1).toUpperCase()}</span><span className="ta-user-copy"><strong>{role}</strong><small>{email}</small></span></div><button className="text-button ta-signout" onClick={onSignOut}>{zh ? '退出' : 'Sign out'}</button></div></header>
      <main id="main-content" className="ta-content mx-auto p-4 md:p-6" tabIndex={-1}>{children}</main>
    </div>
  </div>;
}
