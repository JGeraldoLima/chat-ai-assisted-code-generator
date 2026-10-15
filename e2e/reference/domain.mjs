// Reference implementation of the pure client rules in spec/core (hand-directed, not generated).
// Used by the `reference` E2E driver as a known-good counterpart for the generated clients.

export const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const NAME_ERROR = "Name must be 1-32 characters: letters, digits, '_' or '-'.";
export const SELF_ERROR = 'You cannot message yourself.';
export const EMPTY_BODY_ERROR = 'Message cannot be empty.';
export const LONG_BODY_ERROR = 'Message is too long (max 1000 characters).';
export const UNSUPPORTED_BODY = 'Unsupported message';

/** Name rule (10-identity): trim White_Space, then validate. Returns the normalized name or null. */
export function normalizeName(raw) {
  const n = String(raw).trim();
  return NAME_RE.test(n) ? n : null;
}

/** REQ-SEND-001: returns an error string or null. */
export function bodyError(body) {
  if (body.trim() === '') return EMPTY_BODY_ERROR;
  if ([...body].length > 1000) return LONG_BODY_ERROR;
  return null;
}

export const peerOf = (m, me) => (m.from === me ? m.to : m.from);
export const displayBody = (m) => (m.kind === 'text' ? m.body : UNSUPPORTED_BODY);

/** REQ-ORDER-001 */
export function threadOrder(a, b) {
  const as = a.seq != null;
  const bs = b.seq != null;
  if (as && bs) return a.seq - b.seq;
  if (as !== bs) return as ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** REQ-ORDER-002: conversations newest first by the activity time of their last (thread-order) message. */
export function conversations(messages, me) {
  const byPeer = new Map();
  for (const m of messages) {
    const p = peerOf(m, me);
    byPeer.set(p, [...(byPeer.get(p) ?? []), m]);
  }
  const rows = [...byPeer.entries()].map(([peer, ms]) => {
    const last = ms.sort(threadOrder).at(-1);
    return { peer, last, activity: last.receivedAt ?? last.createdAt };
  });
  rows.sort((a, b) => (a.activity !== b.activity ? (a.activity < b.activity ? 1 : -1) : a.peer < b.peer ? -1 : a.peer > b.peer ? 1 : 0));
  return rows;
}

/** REQ-SYNC-002: upsert a server message into the store; returns the stored local message. */
export function upsert(store, server, me) {
  const status = server.from === me ? 'sent' : 'received';
  const local = { ...store.messages[server.id], ...server, status, errorCode: null };
  store.messages[server.id] = local;
  store.outbox = store.outbox.filter((id) => id !== server.id);
  return local;
}
