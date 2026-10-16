// In-memory message store + known users + long-poll waiters. Single process, no persistence.

export const SYNC_PAGE_SIZE = 100;
export const MAX_WAIT_SECONDS = 30;

export class Store {
  constructor({ now = () => new Date() } = {}) {
    this.now = now;
    this.reset();
  }

  reset() {
    for (const w of this.waiters ?? []) w.abort();
    /** @type {Array<object>} ordered by seq */
    this.messages = [];
    this.byId = new Map();
    /** @type {Map<string, {name: string, online: boolean, lastSeenAt: string|null}>} */
    this.users = new Map();
    /** @type {Set<Waiter>} */
    this.waiters = new Set();
    this.seq = 0;
  }

  // ---- users / network flags (REQ-SIM-*) ----------------------------------

  touchUser(name, { seen = false } = {}) {
    let u = this.users.get(name);
    if (!u) {
      u = { name, online: true, lastSeenAt: null };
      this.users.set(name, u);
    }
    if (seen) u.lastSeenAt = this.now().toISOString();
    return u;
  }

  isOffline(name) {
    return this.users.get(name)?.online === false;
  }

  /** Sets a user's simulated network flag; going offline cuts their pending long-polls (REQ-SIM-002). */
  setOnline(name, online) {
    const u = this.touchUser(name);
    u.online = online;
    if (!online) {
      for (const w of [...this.waiters]) if (w.user === name) w.abort();
    }
    return this.userView(u);
  }

  userView(u) {
    let pendingPolls = 0;
    for (const w of this.waiters) if (w.user === u.name) pendingPolls++;
    return { name: u.name, online: u.online, pendingPolls, lastSeenAt: u.lastSeenAt };
  }

  state() {
    return {
      users: [...this.users.values()].map((u) => this.userView(u)).sort((a, b) => (a.name < b.name ? -1 : 1)),
      messages: this.messages,
    };
  }

  // ---- messages (REQ-PROTO-011/012/021) -----------------------------------

  /** @returns {{status: 200|201|409, message?: object}} */
  accept(req) {
    const kind = req.kind ?? 'text';
    const existing = this.byId.get(req.id);
    if (existing) {
      const same =
        existing.kind === kind &&
        existing.from === req.from &&
        existing.to === req.to &&
        existing.body === req.body &&
        existing.createdAt === req.createdAt;
      return same ? { status: 200, message: existing } : { status: 409 };
    }
    const message = {
      id: req.id,
      seq: ++this.seq,
      kind,
      from: req.from,
      to: req.to,
      body: req.body,
      createdAt: req.createdAt,
      receivedAt: this.now().toISOString(),
    };
    this.messages.push(message);
    this.byId.set(message.id, message);
    this.touchUser(message.to);
    for (const w of [...this.waiters]) {
      if (w.user === message.from || w.user === message.to) w.resolve(this.query(w.user, w.after));
    }
    return { status: 201, message };
  }

  query(user, after) {
    const matching = [];
    let hasMore = false;
    for (const m of this.messages) {
      if (m.seq <= after || (m.from !== user && m.to !== user)) continue;
      if (matching.length === SYNC_PAGE_SIZE) {
        hasMore = true;
        break;
      }
      matching.push(m);
    }
    const cursor = matching.length ? matching[matching.length - 1].seq : after;
    return { messages: matching, cursor, hasMore };
  }

  /**
   * Long-poll (REQ-PROTO-022). Resolves immediately if there is data or wait is 0.
   * `onResult` is called at most once with a sync response; `onAbort` when the poll is cut.
   */
  poll({ user, after, waitSeconds, onResult, onAbort }) {
    const now = this.query(user, after);
    if (now.messages.length > 0 || waitSeconds === 0) {
      onResult(now);
      return () => {};
    }
    const waiter = new Waiter(this, user, after, waitSeconds, onResult, onAbort);
    this.waiters.add(waiter);
    return () => waiter.cancel();
  }
}

class Waiter {
  constructor(store, user, after, waitSeconds, onResult, onAbort) {
    this.store = store;
    this.user = user;
    this.after = after;
    this.onResult = onResult;
    this.onAbort = onAbort;
    this.timer = setTimeout(
      () => this.resolve({ messages: [], cursor: after, hasMore: false }),
      waitSeconds * 1000,
    );
  }

  #finish() {
    if (!this.store.waiters.delete(this)) return false;
    clearTimeout(this.timer);
    return true;
  }

  resolve(result) {
    if (this.#finish()) this.onResult(result);
  }

  /** Cut by the server (simulated network loss or reset). */
  abort() {
    if (this.#finish()) this.onAbort();
  }

  /** Client went away. */
  cancel() {
    this.#finish();
  }
}
