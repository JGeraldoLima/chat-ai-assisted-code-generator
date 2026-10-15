// Web driver: Playwright (Chromium). One browser context per actor, so localStorage is isolated per actor.
// Elements are located only by the spec's element IDs (data-testid), per spec/platforms/web.md.

let browserPromise = null;
async function browser({ headed }) {
  if (!browserPromise) {
    const { chromium } = await import('playwright');
    browserPromise = chromium.launch({ headless: !headed }).catch(() => chromium.launch({ headless: !headed, channel: 'chrome' }));
  }
  return browserPromise;
}

export async function closeWebBrowser() {
  if (browserPromise) (await browserPromise).close();
  browserPromise = null;
}

/** Reads the whole screen in one evaluate() call. Runs in the page. */
function snapshot() {
  const q = (id, root = document) => root.querySelector(`[data-testid="${id}"]`);
  const text = (el) => (el ? ('value' in el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') ? el.value : el.textContent.trim()) : null);
  const t = (id, root) => text(q(id, root));
  const screen = q('login-name') ? 'login' : q('thread-peer') ? 'thread' : q('me-name') ? 'conversations' : 'unknown';
  const rows = [...document.querySelectorAll('[data-testid="message-row"]')];
  const last = rows.at(-1);
  let lastRowVisible = false;
  if (last) {
    const r = last.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 10));
    lastRowVisible = r.height > 0 && r.bottom <= window.innerHeight + 1 && r.top >= 0 && !!hit && last.contains(hit);
  }
  const statusText = t('queued-count');
  return {
    screen,
    loginError: t('login-error'),
    meName: t('me-name'),
    newConversationError: t('new-conversation-error'),
    composerError: t('composer-error'),
    composerText: t('composer-input'),
    threadPeer: t('thread-peer'),
    connection: t('connection-status'),
    queued: statusText && /^\d+ queued$/.test(statusText) ? Number(statusText.split(' ')[0]) : statusText,
    conversationsEmpty: !!q('conversations-empty'),
    threadEmpty: !!q('thread-empty'),
    conversations: [...document.querySelectorAll('[data-testid="conversation-row"]')].map((r) => ({
      peer: t('conversation-peer', r),
      preview: t('conversation-preview', r),
    })),
    thread: rows.map((r) => ({ from: t('message-from', r), body: t('message-body', r), status: t('message-status', r) })),
    lastRowVisible,
  };
}

export async function createWebDriver({ webUrl, headed = false }) {
  const b = await browser({ headed });
  let context = null;
  let page = null;
  const open = async () => {
    page = await context.newPage();
    await page.goto(webUrl);
  };
  const byId = (id) => page.getByTestId(id);
  return {
    kind: 'web',
    async launch() {
      await context?.close();
      context = await b.newContext({ viewport: { width: 420, height: 760 } });
      await open();
    },
    async restart() {
      await page.close();
      await open();
    },
    close: () => context?.close(),
    async login(name) {
      await byId('login-name').fill(name);
      await byId('login-submit').click();
    },
    logout: () => byId('logout').click(),
    async openThreadRaw(peer) {
      await byId('new-conversation-peer').fill(peer);
      await byId('new-conversation-open').click();
    },
    back: () => byId('thread-back').click(),
    async send(body) {
      await byId('composer-input').fill(body);
      await byId('composer-send').click();
    },
    read: () => page.evaluate(snapshot),
    screenshot: (path) => page.screenshot({ path, fullPage: true }),
  };
}
