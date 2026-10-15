// Reference client: the spec's identity, send and UI-state rules on top of the reference engine,
// with a headless "screen" model the E2E driver reads. `persisted` plays the role of disk storage:
// it survives restart() and is wiped by launch()/logout().
import { randomUUID } from 'node:crypto';
import { SyncEngine } from './engine.mjs';
import {
  NAME_ERROR, SELF_ERROR, bodyError, conversations, displayBody, normalizeName, peerOf, repairOutbox, threadOrder,
} from './domain.mjs';

const emptyState = () => ({ identity: null, messages: {}, outbox: [], cursor: 0 });

export class ReferenceClient {
  constructor({ baseUrl }) {
    this.baseUrl = baseUrl;
    this.disk = JSON.stringify(emptyState());
  }

  // ---- process lifecycle ----------------------------------------------------------------
  async launch() {
    await this.engine?.stop();
    this.disk = JSON.stringify(emptyState());
    this.#boot();
  }

  async restart() {
    await this.engine?.stop();
    this.#boot();
  }

  async close() {
    await this.engine?.stop();
  }

  #boot() {
    this.state = JSON.parse(this.disk);
    if (repairOutbox(this.state)) this.#persist(); // REQ-PERSIST-003 (a no-op here: the disk blob is written atomically)
    this.ui = { screen: this.state.identity ? 'conversations' : 'login', loginError: null, newConvError: null, composerError: null, peer: null };
    this.engine = null;
    if (this.state.identity) this.#startEngine(); // REQ-ID-001
  }

  #persist() {
    this.disk = JSON.stringify(this.state); // atomic by construction
  }

  #startEngine() {
    this.engine = new SyncEngine({
      baseUrl: this.baseUrl,
      state: this.state,
      me: this.state.identity,
      persist: () => this.#persist(),
      onChange: () => {},
    });
    this.engine.start();
  }

  // ---- intents (what a user does) ------------------------------------------------------------
  login(raw) {
    const name = normalizeName(raw);
    if (!name) {
      this.ui.loginError = NAME_ERROR; // REQ-ID-002
      return;
    }
    this.state.identity = name; // REQ-ID-003
    this.#persist();
    this.ui = { ...this.ui, screen: 'conversations', loginError: null };
    this.#startEngine();
  }

  async logout() {
    await this.engine?.stop(); // REQ-ID-004
    this.state = emptyState();
    this.#persist();
    this.engine = null;
    this.ui = { screen: 'login', loginError: null, newConvError: null, composerError: null, peer: null };
  }

  openThread(raw) {
    const name = normalizeName(raw);
    if (!name) return void (this.ui.newConvError = NAME_ERROR);
    if (name === this.state.identity) return void (this.ui.newConvError = SELF_ERROR);
    this.ui = { ...this.ui, screen: 'thread', peer: name, newConvError: null, composerError: null };
  }

  back() {
    this.ui = { ...this.ui, screen: 'conversations', peer: null };
  }

  send(body) {
    const err = bodyError(body);
    if (err) {
      this.ui.composerError = err; // REQ-SEND-001
      return false;
    }
    // REQ-SEND-002: createdAt strictly increases across my messages.
    const mine = Object.values(this.state.messages).filter((x) => x.from === this.state.identity).map((x) => Date.parse(x.createdAt));
    const createdAt = new Date(Math.max(Date.now(), mine.length ? Math.max(...mine) + 1 : 0)).toISOString();
    const m = {
      id: randomUUID(), kind: 'text', from: this.state.identity, to: this.ui.peer, body,
      createdAt, seq: null, receivedAt: null, status: 'queued', errorCode: null,
    };
    this.state.messages[m.id] = m; // REQ-SEND-003: store, then outbox, then persist
    this.state.outbox.push(m.id);
    this.#persist();
    this.ui.composerError = null;
    this.engine.wake(); // REQ-SEND-004
    return true;
  }

  // ---- what the screen shows -------------------------------------------------------------------
  view() {
    const me = this.state.identity;
    const all = Object.values(this.state.messages);
    return {
      screen: this.ui.screen,
      loginError: this.ui.loginError,
      meName: me,
      newConversationError: this.ui.newConvError,
      composerError: this.ui.composerError,
      threadPeer: this.ui.peer,
      connection: this.engine?.connection ?? 'offline',
      queued: this.state.outbox.length,
      conversations: me ? conversations(all, me).map((c) => ({ peer: c.peer, preview: displayBody(c.last) })) : [],
      thread: this.ui.peer
        ? all.filter((m) => peerOf(m, me) === this.ui.peer).sort(threadOrder).map((m) => ({ from: m.from, body: displayBody(m), status: m.status }))
        : [],
    };
  }
}
