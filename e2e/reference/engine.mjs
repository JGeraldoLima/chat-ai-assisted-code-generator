// Reference sync engine: a literal transcription of the cycle in spec/core/40-connectivity.md.
import { upsert } from './domain.mjs';

export const BACKOFF_MS = [1000, 2000, 4000, 8000];
const POST_TIMEOUT_MS = 10_000;
const LONG_POLL_WAIT_S = 25;

class NetworkFailure extends Error {}

export class SyncEngine {
  /**
   * @param {{ baseUrl: string, state: object, me: string, onChange: () => void, persist: () => void }} deps
   *   `state` is the persisted client state ({messages, outbox, cursor}); `persist` writes it atomically.
   */
  constructor({ baseUrl, state, me, onChange, persist }) {
    Object.assign(this, { baseUrl, state, me, onChange, persist });
    this.connection = 'offline'; // REQ-CONN-001
    this.running = false;
    this.phase = 'idle';
    this.wakePending = false;
    this.wakeSleep = null;
    this.pollController = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.done = this.#run();
  }

  async stop() {
    this.running = false;
    this.pollController?.abort('stop');
    this.wakePoll?.();
    this.wakeSleep?.();
    await this.done;
  }

  /** REQ-CONN-005 */
  wake() {
    this.wakePending = true;
    if (this.phase === 'backoff') this.wakeSleep?.();
    if (this.phase === 'poll') this.wakePoll?.();
  }

  #mark(state) {
    if (this.connection !== state) {
      this.connection = state;
      this.onChange();
    }
  }

  async #run() {
    let failures = 0;
    let probe = true; // REQ-SYNC-001
    let hasMore = false;
    while (this.running) {
      try {
        // Phase A: flush (REQ-OUTBOX-*)
        this.phase = 'flush';
        this.wakePending = false;
        while (this.running && this.state.outbox.length) {
          const head = this.state.messages[this.state.outbox[0]];
          const r = await this.#request('POST', '/v1/messages', {
            body: { id: head.id, kind: head.kind, from: head.from, to: head.to, body: head.body, createdAt: head.createdAt },
            timeoutMs: POST_TIMEOUT_MS,
          });
          if (r.status === 200 || r.status === 201) {
            upsert(this.state, r.json, this.me); // sets seq/receivedAt, status sent, dequeues
          } else if (r.status === 400 || r.status === 409) {
            this.state.messages[head.id] = { ...head, status: 'failed', errorCode: r.json?.error?.code ?? null };
            this.state.outbox.shift();
          } else {
            throw new NetworkFailure(`POST ${r.status}`);
          }
          this.persist();
          this.#mark('online');
          failures = 0;
          this.onChange();
        }
        if (!this.running) break;

        // Phase B: one sync request (REQ-SYNC-*)
        this.phase = 'poll';
        if (this.wakePending) continue; // a wake arrived between phases: start a new cycle
        const wait = probe || hasMore ? 0 : LONG_POLL_WAIT_S;
        // The long-poll races a wake signal. We don't rely on an aborted fetch settling promptly:
        // on wake we abandon the request (and abort it to free the socket) and start a new cycle.
        const controller = (this.pollController = new AbortController());
        const WOKEN = Symbol('woken');
        const woken = new Promise((resolve) => (this.wakePoll = () => resolve(WOKEN)));
        const request = this.#request('GET', `/v1/messages?after=${this.state.cursor}&wait=${wait}`, {
          timeoutMs: (wait + 10) * 1000,
          controller,
        });
        let r;
        try {
          r = await Promise.race([request, woken]);
        } catch (e) {
          if (!this.running) break;
          throw e;
        } finally {
          this.pollController = null;
          this.wakePoll = null;
        }
        if (r === WOKEN) {
          request.catch(() => {});
          controller.abort('wake'); // not a failure (REQ-CONN-005)
          continue;
        }
        if (r.status !== 200) throw new NetworkFailure(`GET ${r.status}`);
        for (const m of r.json.messages) upsert(this.state, m, this.me);
        this.state.cursor = r.json.cursor; // REQ-PROTO-023
        this.persist();
        hasMore = r.json.hasMore;
        probe = false;
        this.#mark('online');
        failures = 0;
        this.onChange();
      } catch (e) {
        if (!this.running) break;
        this.#mark('offline'); // REQ-CONN-003
        probe = true;
        this.phase = 'backoff';
        const delay = BACKOFF_MS[Math.min(failures, 3)];
        failures++;
        if (!this.wakePending) {
          await new Promise((resolve) => {
            const t = setTimeout(resolve, delay);
            this.wakeSleep = () => {
              clearTimeout(t);
              resolve();
            };
          });
        }
        this.wakeSleep = null;
      }
    }
    this.phase = 'idle';
  }

  async #request(method, path, { body, timeoutMs, controller = new AbortController() }) {
    const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
    try {
      const res = await fetch(this.baseUrl + path, {
        method,
        signal: controller.signal,
        headers: { 'X-Chat-User': this.me, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
      if (res.status >= 500) throw new NetworkFailure(`${method} ${res.status}`);
      return { status: res.status, json };
    } catch (e) {
      if (controller.signal.aborted && controller.signal.reason !== 'timeout') throw e; // wake/stop abort
      throw new NetworkFailure(String(e?.message ?? e));
    } finally {
      clearTimeout(timer);
    }
  }
}
