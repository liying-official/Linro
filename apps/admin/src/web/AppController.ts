// SPDX-License-Identifier: AGPL-3.0-only
import React from 'react';
import { MAX_IMPORT_FILE_BYTES, MAX_LINK_BATCH_ROWS } from '../../../../packages/shared/src/limits';
import { api, APIError } from './client';
import { errorMessage } from './error-message';
import { applyLocale, detectLocale, type Locale } from './i18n';
import { UI } from './i18n-dict';
import { DialogFocus } from './dialog-focus';
import { requestedPage, pageTransition, observeHash, cursorHistory } from './navigation';
import { LatestRead } from './latest-read';
import { linkFormBody, domainFormBody, userFormBody, tokenFormBody } from './form-requests';
import { planImport, downloadExport, parseImportFile } from './link-transfer';
import { needsRefresh, readPage, type ChangedResource } from './page-data';
import {
  type AppState,
  type DomainRow,
  type FormModal,
  type JsonRecord,
  type LinkRow,
  type Page,
  type SessionData,
} from './models';

interface ImportProgress {
  batches: JsonRecord[][];
  next: number;
  done: number;
  retried: boolean;
}

export class AppController extends React.Component<{ onSignOut?: () => void }, AppState> {
  state: AppState = {
    responseMode: 'redirect',
    plainTextDraft: '',
    analyticsIds: null,
    session: null,
    loginError: null,
    loading: true,
    pageLoading: false,
    mutationPending: false,
    exporting: false,
    page: 'dashboard',
    error: '',
    notice: '',
    summary: {},
    domains: [],
    directoryLoaded: false,
    domainDetails: [],
    links: [],
    linkCursors: [],
    nextLinkCursor: null,
    searchQuery: '',
    q: '',
    filterDomain: '',
    filterStatus: 'all',
    selected: [],
    analytics: null,
    days: 7,
    users: [],
    tokens: [],
    audit: [],
    auditCursors: [],
    nextAuditCursor: null,
    settings: [],
    modal: null,
    modalError: '',
    importRows: [],
    importName: '',
    importDone: 0,
    importStatus: 'new',
    importRetryAt: 0,
    locale: detectLocale(),
  };

  private mounted = false;
  private readonly sessionReads = new LatestRead();
  private stopHashListener?: () => void;
  private readonly pageReads = new LatestRead();
  private exportRequest?: AbortController;
  private writing = false;
  private importPlan?: ImportProgress;
  private importTimer?: ReturnType<typeof setTimeout>;
  private importFileSequence = 0;
  private readonly dialogFocus = new DialogFocus();

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
  setLocale = (locale: Locale) => {
    applyLocale(locale);
    this.setState({ locale });
  };

  componentDidMount() {
    this.mounted = true;
    applyLocale(this.state.locale);
    this.stopHashListener = observeHash((page) => {
      if (this.state.session) void this.navigate(page, false);
    });
    void this.start();
  }

  componentWillUnmount() {
    this.mounted = false;
    this.pageReads.cancel();
    this.sessionReads.cancel();
    this.exportRequest?.abort();
    this.discardImport();
    this.stopHashListener?.();
  }

  can = (scope: string) => !!this.state.session?.scopes?.includes(scope);
  canManageLink = (link: LinkRow, scope = 'links:write') =>
    this.can(scope) &&
    (this.state.session?.link_write_scope === 'workspace' ||
      link.created_by === this.state.session?.user?.id);

  message = (error: unknown) => errorMessage(error, this.state.locale);

  async start() {
    this.setState({ loading: true, loginError: null, error: '' });
    await this.sessionReads.run(
      (signal) => api<SessionData>('/session', 'GET', undefined, signal),
      (session, signal) => {
        this.setState(
          () =>
            !this.mounted || signal.aborted
              ? null
              : { session, directoryLoaded: false, loading: false },
          () => {
            if (this.mounted && !signal.aborted)
              void this.navigate(requestedPage(location.hash) ?? 'dashboard');
          },
        );
      },
      (error, signal) => {
        if (this.mounted && !signal.aborted)
          this.setState(() =>
            signal.aborted ? null : { loading: false, session: null, loginError: error },
          );
      },
    );
  }

  async navigate(target: Page, setHash = true) {
    this.pageReads.cancel();
    this.setState(
      pageTransition(target, this.state.session?.scopes ?? [], this.state.analytics, setHash),
      () => void this.loadPage(),
    );
  }

  async loadPage(changed?: ChangedResource) {
    const state = this.state;
    this.setState({ pageLoading: true, error: '' });
    await this.pageReads.run(
      (signal) => readPage(state, signal, changed),
      (update, signal) => {
        if (this.mounted)
          this.setState((prev) =>
            signal.aborted ? null : { ...prev, ...update, pageLoading: false },
          );
      },
      (error, signal) => {
        if (this.mounted)
          this.setState(() =>
            signal.aborted ? null : { error: this.message(error), pageLoading: false },
          );
      },
    );
  }

  setLinkFilters = (
    filters: Partial<Pick<AppState, 'filterDomain' | 'filterStatus' | 'searchQuery'>>,
  ) => {
    this.pageReads.cancel();
    this.setState(
      (state) => ({ ...state, ...filters, linkCursors: [], nextLinkCursor: null, selected: [] }),
      () => void this.loadPage(),
    );
  };

  changeLinkPage = (forward: boolean) => {
    const { linkCursors, nextLinkCursor, pageLoading } = this.state;
    const next = cursorHistory(linkCursors, nextLinkCursor, forward);
    if (!pageLoading && next)
      this.setState(
        { linkCursors: next, nextLinkCursor: null, selected: [], pageLoading: true },
        () => void this.loadPage(),
      );
  };
  changeAuditPage = (forward: boolean) => {
    const { auditCursors, nextAuditCursor, pageLoading } = this.state;
    const next = cursorHistory(auditCursors, nextAuditCursor, forward);
    if (!pageLoading && next)
      this.setState(
        { auditCursors: next, nextAuditCursor: null, pageLoading: true },
        () => void this.loadPage(),
      );
  };

  private beginMutation() {
    if (this.writing) return false;
    this.writing = true;
    this.setState({ mutationPending: true, error: '', modalError: '' });
    return true;
  }

  private finishMutation(update: Partial<AppState>, resource?: ChangedResource) {
    if (!this.mounted) {
      this.writing = false;
      return;
    }
    const invalidateDirectory = resource === 'domains';
    this.setState(
      (state) => ({
        ...state,
        ...update,
        mutationPending: false,
        directoryLoaded: invalidateDirectory ? false : state.directoryLoaded,
      }),
      () => {
        this.writing = false;
        if (update.modal === null) this.dialogFocus.restore();
        if (resource && needsRefresh(this.state.page, resource)) void this.loadPage(resource);
      },
    );
  }

  private failMutation(error: unknown) {
    const message = this.message(error);
    this.finishMutation(this.state.modal ? { modalError: message } : { error: message });
  }

  async mutate(resource: ChangedResource, task: () => Promise<unknown>, success?: string) {
    if (!this.beginMutation()) return;
    try {
      await task();
      this.finishMutation(
        { modal: null, notice: success ?? this.ui().common.saved, selected: [] },
        resource,
      );
    } catch (error) {
      this.failMutation(error);
    }
  }

  deleteLink = (row: LinkRow) => {
    if (this.canManageLink(row, 'links:delete'))
      return this.mutate(
        'links',
        () => api('/links/' + row.id + '?version=' + row.version, 'DELETE'),
        this.ui().links.deleted,
      );
  };

  deleteDomain = (row: DomainRow) =>
    this.mutate('domains', () => api(`/domains/${row.id}?version=${row.version}`, 'DELETE'));
  revokeToken = (id: string) =>
    this.mutate('tokens', () => api('/tokens/' + id, 'DELETE'), this.ui().tokens.revokedNotice);

  saveWorkspace = (name: string) =>
    this.mutate('settings', async () => {
      const result = await api<{ site_name: string }>('/settings', 'PATCH', { site_name: name });
      if (this.mounted)
        this.setState((state) => ({
          session: state.session && { ...state.session, site_name: result.site_name },
        }));
    });

  async copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      this.setState({ notice: this.ui().common.copied });
    } catch {
      this.setState({ error: this.ui().common.copyUnavailable });
    }
  }

  openModal = (modal: FormModal) => {
    if (this.writing || this.state.modal?.type === 'secret') return;
    this.discardImport();
    const row = modal.type === 'link' ? modal.row : undefined;
    this.dialogFocus.capture();
    this.setState({
      plainTextDraft: row?.text_content ?? '',
      responseMode: row?.response_mode === 'text' ? 'text' : 'redirect',
      modal,
      modalError: '',
      importStatus: 'new',
      importRetryAt: 0,
      importRows: [],
      importName: '',
      importDone: 0,
    });
  };

  closeModal = () => {
    if (this.writing) return;
    this.discardImport();
    this.setState({ modal: null, modalError: '', importRows: [], importStatus: 'new' }, () =>
      this.dialogFocus.restore(),
    );
  };

  async submitLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (this.state.modal?.type !== 'link') return;
    const row = this.state.modal.row;
    let body: JsonRecord;
    try {
      body = linkFormBody(values, row, this.state.locale);
    } catch (error) {
      this.setState({ modalError: this.message(error) });
      return;
    }
    await this.mutate(
      'links',
      () => api('/links' + (row ? '/' + row.id : ''), row ? 'PATCH' : 'POST', body),
      row
        ? this.state.locale === 'zh-CN'
          ? '短链已更新。'
          : 'Short link updated.'
        : this.state.locale === 'zh-CN'
          ? '短链已创建。'
          : 'Short link created.',
    );
  }

  async submitDomain(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (this.state.modal?.type !== 'domain') return;
    const row = this.state.modal.row;
    const body = domainFormBody(values, row);
    await this.mutate(
      'domains',
      () => api('/domains' + (row ? '/' + row.id : ''), row ? 'PATCH' : 'POST', body),
      this.ui().domains.saved,
    );
  }

  async submitUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (this.state.modal?.type !== 'user') return;
    const row = this.state.modal.row;
    const body = userFormBody(values, row);
    await this.mutate('users', () =>
      api('/users' + (row ? '/' + row.id : ''), row ? 'PATCH' : 'POST', body),
    );
  }

  async submitToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (this.state.modal?.type !== 'token' || !this.beginMutation()) return;
    try {
      const values = new FormData(event.currentTarget);
      const result = await api<{ token: string }>(
        '/tokens',
        'POST',
        tokenFormBody(values, Date.now()),
      );
      this.finishMutation({ modal: { type: 'secret', token: result.token } }, 'tokens');
    } catch (error) {
      this.failMutation(error);
    }
  }

  async bulk(action: string) {
    const chosen = this.state.links.filter(
      (link) =>
        this.state.selected.includes(link.id) &&
        this.canManageLink(link, action === 'delete' ? 'links:delete' : 'links:write'),
    );
    if (!chosen.length || !window.confirm(this.ui().links.bulkConfirm(chosen.length, action)))
      return;
    await this.mutate(
      'links',
      async () => {
        const results: { ok: boolean }[] = [];
        for (let index = 0; index < chosen.length; index += MAX_LINK_BATCH_ROWS) {
          if (!this.mounted) return;
          const data = await api<{ results: { ok: boolean }[] }>('/links/bulk', 'POST', {
            action,
            items: chosen
              .slice(index, index + MAX_LINK_BATCH_ROWS)
              .map((link) => ({ id: link.id, version: link.version })),
          });
          results.push(...data.results);
        }
        const failed = results.filter((result) => !result.ok);
        if (failed.length) throw new Error(this.ui().links.bulkConflict(failed.length));
      },
      this.ui().links.bulkDone,
    );
  }

  async exportLinks(format: 'json' | 'csv') {
    if (this.exportRequest) return;
    const request = (this.exportRequest = new AbortController());
    this.setState({ exporting: true, error: '' });
    try {
      const count = await downloadExport(
        format,
        this.state.locale,
        this.state.session?.site_name,
        request.signal,
      );
      this.setState({ notice: this.ui().links.exportDone(count) });
    } catch (error) {
      if (this.mounted && !request.signal.aborted) this.setState({ error: this.message(error) });
    } finally {
      this.exportRequest = undefined;
      if (this.mounted) this.setState({ exporting: false });
    }
  }

  async chooseImport(file?: File) {
    if (!file || this.writing || this.state.modal?.type !== 'import') return;
    this.discardImport();
    const selection = this.importFileSequence;
    this.setState({
      importRows: [],
      importStatus: 'new',
      importName: '',
      importDone: 0,
      modalError: '',
    });
    try {
      if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error(this.ui().links.fileTooLarge);
      const source = await file.text();
      if (selection !== this.importFileSequence) return;
      const rows = parseImportFile(source, file.name, this.state.locale);
      this.setState({ importRows: rows, importName: file.name, modalError: '', importDone: 0 });
    } catch (error) {
      if (selection === this.importFileSequence)
        this.setState({ modalError: this.message(error), importRows: [] });
    }
  }

  private discardImport() {
    this.importFileSequence++;
    clearTimeout(this.importTimer);
    this.importPlan = undefined;
  }

  async submitImport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      this.state.modal?.type !== 'import' ||
      !this.state.importRows.length ||
      this.state.importStatus === 'review' ||
      ['waiting', 'retrying'].includes(this.state.importStatus) ||
      this.writing
    )
      return;
    try {
      if (!this.importPlan) {
        const fallback = String(new FormData(event.currentTarget).get('domain_id'));
        this.importPlan = {
          batches: planImport(
            this.state.importRows,
            this.state.domains,
            fallback,
            this.state.locale,
          ),
          next: 0,
          done: 0,
          retried: false,
        };
      }
      await this.sendImport(this.importPlan);
    } catch (error) {
      this.setState({ modalError: this.message(error) });
    }
  }

  private async sendImport(plan: ImportProgress) {
    if (!this.beginMutation()) return;
    try {
      while (plan.next < plan.batches.length) {
        if (!this.mounted || this.importPlan !== plan) return;
        const group = plan.batches[plan.next];
        await api('/links/import', 'POST', { links: group });
        plan.done += group.length;
        plan.next++;
        plan.retried = false;
        if (this.mounted) this.setState({ importDone: plan.done });
      }
      this.discardImport();
      this.finishMutation(
        { modal: null, importRows: [], selected: [], notice: this.ui().links.imported(plan.done) },
        'links',
      );
    } catch (error) {
      if (!this.mounted || this.importPlan !== plan) return;
      if (error instanceof APIError && error.status === 429 && error.code === 'rate_limited') {
        this.pauseRateLimitedImport(plan, error.retryAfterMs ?? 60_000);
      } else {
        this.discardImport();
        this.finishMutation({
          importStatus: 'review',
          modalError: this.ui().links.importReview(this.message(error), plan.done),
        });
      }
    }
  }

  private pauseRateLimitedImport(plan: ImportProgress, delay: number) {
    // Only the API's pre-handler limiter proves that this batch did not commit.
    const automatic = !plan.retried && delay <= 120_000;
    plan.retried = true;
    const retryAt = Date.now() + delay;
    this.finishMutation({
      importStatus: automatic ? 'retrying' : 'waiting',
      importRetryAt: retryAt,
    });
    const resume = () => {
      if (!this.mounted || this.importPlan !== plan) return;
      const remaining = retryAt - Date.now();
      if (remaining > 0) {
        this.importTimer = setTimeout(resume, Math.min(remaining, 2_147_483_647));
        return;
      }
      this.setState({ importStatus: 'resume' }, () => {
        if (automatic && this.importPlan === plan) void this.sendImport(plan);
      });
    };
    this.importTimer = setTimeout(resume, Math.min(delay, 2_147_483_647));
  }

  viewAnalytics = (ids: string[] | null) => {
    if (ids !== null && (!ids.length || ids.length > 50)) return;
    this.setState({ analyticsIds: ids, analytics: null }, () => {
      void this.navigate('analytics');
    });
  };
}
