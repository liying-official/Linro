// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import { VERSION } from '../../../../packages/shared/src/platform';
import { AppController } from './AppController';
import { isLocalHost, saveLocalToken, signOut } from './admin-session';
import { DashboardShell } from './tailadmin/DashboardShell';
import { Icon } from './components';
import {
  AdminModal,
  ModalFooter,
  DomainForm,
  UserForm,
  TokenForm,
  TokenSecret,
} from './modal-component';
import { LinkForm } from './link-form';
import { ImportForm } from './import-form';
import { LinkTable } from './LinkTable';
import { DashboardPage } from './pages/DashboardPage';
import { LinksPage } from './pages/LinksPage';
import { DomainsPage } from './pages/DomainsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { TokensPage } from './pages/TokensPage';
import { UsersPage } from './pages/UsersPage';
import { AuditPage } from './pages/AuditPage';
import { SettingsPage } from './pages/SettingsPage';
import { LanguageSwitch, Login } from './login-component';
import { isPage, type Page } from './models';

export class App extends AppController {
  private renderLinkTable(compact: boolean) {
    const s = this.state;
    return (
      <LinkTable
        compact={compact}
        rows={s.links}
        locale={s.locale}
        selected={s.selected}
        pending={s.mutationPending}
        hasDomains={s.domains.length > 0}
        canWrite={this.can('links:write')}
        canManage={this.canManageLink}
        onSelect={(selected) => this.setState({ selected })}
        onEdit={(row) => this.openModal({ type: 'link', row })}
        onDelete={this.deleteLink}
        onCopy={(url) => void this.copy(url)}
        onStats={this.can('analytics:read') ? (id) => this.viewAnalytics([id]) : undefined}
        onAddDomain={this.can('domains:write') ? () => void this.navigate('domains') : undefined}
      />
    );
  }
  private renderPage() {
    const state = this.state;
    switch (state.page) {
      case 'dashboard':
        return (
          <DashboardPage state={state} onNavigate={(page) => void this.navigate(page)}>
            {this.renderLinkTable(true)}
          </DashboardPage>
        );
      case 'links':
        return (
          <LinksPage
            state={state}
            canWrite={this.can('links:write')}
            canDelete={this.can('links:delete')}
            onSearch={(q) => this.setState({ q })}
            onFilter={this.setLinkFilters}
            onImport={() => this.openModal({ type: 'import' })}
            onExport={() => void this.exportLinks('csv')}
            onBulk={(action) => void this.bulk(action)}
            onPage={this.changeLinkPage}
          >
            {this.renderLinkTable(false)}
          </LinksPage>
        );
      case 'domains':
        return (
          <DomainsPage
            state={state}
            canWrite={this.can('domains:write')}
            onEdit={(row) => this.openModal({ type: 'domain', row })}
            onDelete={this.deleteDomain}
          />
        );
      case 'analytics':
        return (
          <AnalyticsPage
            state={state}
            onApply={this.viewAnalytics}
            onDays={(days) => this.setState({ days, analytics: null }, () => void this.loadPage())}
          />
        );
      case 'tokens':
        return <TokensPage state={state} onRevoke={this.revokeToken} />;
      case 'users':
        return (
          <UsersPage
            state={state}
            roleName={this.roleName}
            onEdit={(row) => this.openModal({ type: 'user', row })}
          />
        );
      case 'audit':
        return <AuditPage state={state} onPage={this.changeAuditPage} />;
      case 'settings':
        return (
          <SettingsPage
            state={state}
            onSave={this.saveWorkspace}
            onExport={(format) => void this.exportLinks(format)}
            onImport={() => this.openModal({ type: 'import' })}
          />
        );
    }
  }

  renderModal() {
    const s = this.state;
    const modal = s.modal;
    if (!modal) return null;
    const { locale, mutationPending: pending } = s;
    const ui = this.ui().modals;
    const footer = <ModalFooter locale={locale} pending={pending} onClose={this.closeModal} />;
    let title: string;
    let content: React.ReactNode;
    switch (modal.type) {
      case 'link':
        title = modal.row ? ui.linkEdit : ui.linkNew;
        content = (
          <LinkForm
            row={modal.row}
            locale={locale}
            domains={s.domains}
            features={s.session?.features}
            pending={pending}
            responseMode={s.responseMode}
            plainTextDraft={s.plainTextDraft}
            onModeChange={(responseMode) => this.setState({ responseMode })}
            onTextChange={(plainTextDraft) => this.setState({ plainTextDraft })}
            onSubmit={(e) => void this.submitLink(e)}
            footer={footer}
          />
        );
        break;
      case 'domain':
        title = modal.row ? ui.domainEdit : ui.domainNew;
        content = (
          <DomainForm
            locale={locale}
            row={modal.row}
            onSubmit={(e) => void this.submitDomain(e)}
            footer={footer}
          />
        );
        break;
      case 'user':
        title = modal.row ? ui.userEdit : ui.userNew;
        content = (
          <UserForm
            locale={locale}
            row={modal.row}
            onSubmit={(e) => void this.submitUser(e)}
            footer={footer}
          />
        );
        break;
      case 'token':
        title = ui.tokenNew;
        content = (
          <TokenForm
            locale={locale}
            scopes={s.session?.scopes ?? []}
            onSubmit={(e) => void this.submitToken(e)}
            footer={footer}
          />
        );
        break;
      case 'secret':
        title = ui.tokenSecret;
        content = (
          <TokenSecret
            locale={locale}
            token={modal.token}
            onCopy={(v) => void this.copy(v)}
            onClose={this.closeModal}
          />
        );
        break;
      case 'import':
        title = ui.importTitle;
        content = (
          <ImportForm
            locale={locale}
            pending={pending}
            domains={s.domains}
            progress={{
              importRows: s.importRows,
              importName: s.importName,
              importDone: s.importDone,
              importStatus: s.importStatus,
              importRetryAt: s.importRetryAt,
            }}
            onFile={(f) => void this.chooseImport(f)}
            onSubmit={(e) => void this.submitImport(e)}
            onClose={this.closeModal}
          />
        );
        break;
    }
    return (
      <AdminModal
        title={title}
        locale={locale}
        pending={pending}
        error={s.modalError}
        onClose={this.closeModal}
      >
        {content}
      </AdminModal>
    );
  }

  render() {
    if (!this.state.session)
      return (
        <Login
          locale={this.state.locale}
          onLocaleChange={this.setLocale}
          loading={this.state.loading}
          error={this.state.loginError ? this.message(this.state.loginError) : ''}
          local={isLocalHost(location.hostname)}
          onLogin={(token) => {
            saveLocalToken(token);
            void this.start();
          }}
          onRecheck={() => location.reload()}
        />
      );
    const { page, session, pageLoading, mutationPending } = this.state;
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
    return (
      <>
        <DashboardShell
          locale={this.state.locale}
          page={page}
          title={this.pageLabel(page)}
          workspace={session.site_name}
          email={String(session.user.email)}
          role={this.roleName(session.user.role)}
          navigation={nav
            .filter((item) => !item.scope || this.can(item.scope))
            .map((item) => ({
              id: item.page,
              label: this.pageLabel(item.page),
              icon: <Icon name={item.icon} />,
              management: ['tokens', 'users', 'audit', 'settings'].includes(item.page),
            }))}
          onNavigate={(target) => {
            if (isPage(target)) void this.navigate(target);
          }}
          onSignOut={() => signOut(session.auth_kind, this.props.onSignOut)}
          languageSwitch={
            <LanguageSwitch locale={this.state.locale} onLocaleChange={this.setLocale} />
          }
          brandIcon={<Icon name="link" size={24} />}
        >
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {page === 'dashboard'
                  ? ui.eyebrow.dashboard
                  : `${ui.eyebrow.other} / ${this.pageLabel(page).toUpperCase()}`}
              </div>
              <h1>{this.pageLabel(page)}</h1>
              <p>{this.pageDescription(page)}</p>
            </div>
            <div className="heading-actions">
              <button
                className="icon-button"
                title={ui.common.refresh}
                aria-label={ui.common.refresh}
                disabled={pageLoading}
                onClick={() => void this.loadPage()}
              >
                <Icon name="refresh" />
              </button>
              {(page === 'links' || page === 'dashboard') && this.can('links:write') && (
                <button
                  className="primary"
                  disabled={!this.state.domains.length || pageLoading || mutationPending}
                  onClick={() => this.openModal({ type: 'link' })}
                >
                  <Icon name="plus" />
                  {ui.topbar.createLink}
                </button>
              )}
              {page === 'domains' && this.can('domains:write') && (
                <button
                  className="primary"
                  disabled={mutationPending}
                  onClick={() => this.openModal({ type: 'domain' })}
                >
                  <Icon name="plus" />
                  {ui.topbar.addDomain}
                </button>
              )}
              {page === 'users' && (
                <button
                  className="primary"
                  disabled={mutationPending}
                  onClick={() => this.openModal({ type: 'user' })}
                >
                  <Icon name="plus" />
                  {ui.topbar.addUser}
                </button>
              )}
              {page === 'tokens' && (
                <button
                  className="primary"
                  disabled={mutationPending}
                  onClick={() => this.openModal({ type: 'token' })}
                >
                  <Icon name="plus" />
                  {ui.topbar.createToken}
                </button>
              )}
            </div>
          </div>
          {session.auth_kind === 'local' && (
            <div className="local-banner">{ui.topbar.localBanner}</div>
          )}
          {this.state.error && (
            <div className="alert error" role="alert">
              {this.state.error}
              <button
                aria-label={ui.topbar.dismissError}
                onClick={() => this.setState({ error: '' })}
              >
                ×
              </button>
            </div>
          )}
          {this.state.notice && (
            <div className="alert success" role="status">
              {this.state.notice}
              <button
                aria-label={ui.topbar.dismissNotice}
                onClick={() => this.setState({ notice: '' })}
              >
                ×
              </button>
            </div>
          )}
          <div aria-busy={pageLoading || mutationPending}>{this.renderPage()}</div>
          <footer className="page-footer">
            <span>
              {ui.topbar.footerSite}: {session.site_name}
            </span>
            <span className="license-links">
              <span>Linro v{VERSION}</span>
              <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noreferrer">
                AGPL-3.0-only
              </a>
              {session.source_url && (
                <a href={session.source_url} target="_blank" rel="noreferrer">
                  {this.state.locale === 'zh-CN' ? '对应源码' : 'Source'}
                </a>
              )}
            </span>
          </footer>
        </DashboardShell>
        {this.renderModal()}
      </>
    );
  }
}
