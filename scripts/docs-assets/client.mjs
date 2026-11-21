// This script is inlined by build-docs.mjs. It makes no network requests and
// keeps search terms and language selection only in this page's memory.
(() => {
  const pages = [...document.querySelectorAll('article[data-page]')];
  const navigation = [...document.querySelectorAll('[data-nav-language]')];
  const search = document.getElementById('search');
  const results = document.getElementById('search-results');
  const status = document.getElementById('search-status');
  let lang = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh';
  let currentKey = 'readme';

  // A Pages site served from /docs cannot serve files in the repository root.
  // Offline copies keep their relative links to the accompanying source tree.
  const pagesOwner = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname)?.[1];
  if (pagesOwner) {
    const project = location.pathname.split('/')[1];
    const repository = !project || project === 'index.html' ? location.hostname : project;
    for (const link of document.querySelectorAll('a[href^="../"]')) {
      const path = link.getAttribute('href').slice(3);
      const view = path.split(/[?#]/, 1)[0].endsWith('/') ? 'tree' : 'blob';
      link.href = `https://github.com/${pagesOwner}/${repository}/${view}/HEAD/${path}`;
    }
  }
  const labels = {
    zh: {
      book: '使用手册',
      search: '搜索全部文档',
      placeholder: '试试：密码、部署、API',
      print: '打印本页',
      offline: '内容已包含在此文件中，可断网阅读。外部参考链接需要联网。',
      results: '搜索结果',
      empty: '没有找到匹配内容。请换一个词，或试试字段名。',
      count: (n) => `找到 ${n} 个匹配章节`,
      more: '最多显示前 40 个结果。',
    },
    en: {
      book: 'Handbook',
      search: 'Search every document',
      placeholder: 'Try: password, deploy, API',
      print: 'Print this page',
      offline:
        'The content is in this file and works offline. External reference links need an Internet connection.',
      results: 'Search results',
      empty: 'No matching text. Try another word or a field name.',
      count: (n) => `${n} matching sections`,
      more: 'Showing up to 40 results.',
    },
  };
  // Index real chapter text, including code and tables. No duplicate JSON copy.
  const index = pages.flatMap((page) => {
    const sections = [];
    let row = { page, anchor: page.id, title: page.getAttribute('aria-label'), text: '' };
    for (const element of page.children) {
      if (element.matches('.source-link,.page-toc')) continue;
      if (element.matches('h1,h2,h3,h4')) {
        if (row.text.trim() || row.anchor !== page.id) sections.push(row);
        row = {
          page,
          anchor: element.id,
          title: element.textContent.replace(/#$/, '').trim(),
          text: '',
        };
      } else row.text += ' ' + element.textContent;
    }
    sections.push(row);
    return sections.map((entry) => ({ ...entry, text: entry.text.replace(/\s+/g, ' ').trim() }));
  });
  function setLabels() {
    const text = labels[lang];
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.getElementById('book-label').textContent = text.book;
    document.querySelector('.brand').href = `#${lang}-readme`;
    document.getElementById('search-label').textContent = text.search;
    search.placeholder = text.placeholder;
    document.getElementById('print-button').textContent = text.print;
    document.getElementById('offline-note').textContent = text.offline;
    const button = document.getElementById('language-button');
    button.textContent = lang === 'zh' ? 'English' : '中文';
    button.setAttribute('aria-label', lang === 'zh' ? 'Switch to English' : '切换为中文');
    for (const link of navigation) {
      link.hidden = link.dataset.navLanguage !== lang;
      if (link.dataset.navLanguage === lang && link.dataset.navPage === currentKey)
        link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
  function showPage(key, language = lang, anchor = '') {
    lang = language;
    currentKey = key;
    search.value = '';
    status.textContent = '';
    results.hidden = true;
    for (const page of pages)
      page.hidden = page.dataset.page !== key || page.dataset.language !== lang;
    setLabels();
    if (anchor)
      requestAnimationFrame(() =>
        document.getElementById(anchor)?.scrollIntoView({ block: 'start' }),
      );
  }
  function followFragment() {
    let id;
    try {
      id = decodeURIComponent(location.hash.slice(1));
    } catch {
      id = '';
    }
    let target = document.getElementById(id);
    let page = target?.closest('article[data-page]');
    if (!page) {
      // Keep common links from the previous standalone guide useful.
      const guideAnchors = new Set([
        'install',
        'usage',
        'configuration',
        'permissions',
        'upgrade',
        'troubleshooting',
        'architecture',
      ]);
      if (guideAnchors.has(id)) {
        page = document.getElementById(`${lang}-guide`);
        target = page;
      } else if (id === 'api-reference') {
        page = document.getElementById(`${lang}-api`);
        target = page;
      }
    }
    if (page) showPage(page.dataset.page, page.dataset.language, target.id);
    else showPage(currentKey);
  }
  function snippet(text, term) {
    const match = text.toLocaleLowerCase().indexOf(term);
    const start = Math.max(0, match - 55);
    return (
      (start ? '…' : '') + text.slice(start, start + 200) + (text.length > start + 200 ? '…' : '')
    );
  }
  function runSearch() {
    const term = search.value.trim().toLocaleLowerCase();
    if (!term) {
      showPage(currentKey);
      return;
    }
    for (const page of pages) page.hidden = true;
    results.replaceChildren();
    results.hidden = false;
    const heading = document.createElement('h1');
    heading.textContent = labels[lang].results;
    results.append(heading);
    const matches = index.filter(
      (row) =>
        row.page.dataset.language === lang &&
        `${row.title} ${row.text}`.toLocaleLowerCase().includes(term),
    );
    status.textContent = labels[lang].count(matches.length);
    for (const row of matches.slice(0, 40)) {
      const item = document.createElement('div');
      item.className = 'search-item';
      const title = document.createElement('h3');
      const link = document.createElement('a');
      link.href = '#' + row.anchor;
      link.textContent = `${row.page.getAttribute('aria-label')} · ${row.title}`;
      title.append(link);
      const description = document.createElement('p');
      description.textContent = snippet(row.text, term);
      item.append(title, description);
      results.append(item);
    }
    if (!matches.length || matches.length > 40) {
      const note = document.createElement('p');
      note.className = 'search-hint';
      note.textContent = matches.length ? labels[lang].more : labels[lang].empty;
      results.append(note);
    }
  }
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || link.hash === '#content') return;
    if (link.hash === location.hash) {
      event.preventDefault();
      followFragment();
    }
  });
  document.getElementById('language-button').addEventListener('click', () => {
    const next = lang === 'zh' ? 'en' : 'zh';
    location.hash = `${next}-${currentKey}`;
  });
  document.getElementById('print-button').addEventListener('click', () => {
    if (search.value.trim()) showPage(currentKey);
    window.print();
  });
  search.addEventListener('input', runSearch);
  window.addEventListener('hashchange', followFragment);
  followFragment();
})();
