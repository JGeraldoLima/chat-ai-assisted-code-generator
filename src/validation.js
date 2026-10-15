// Value rules from spec/core/10-identity.md and spec/core/20-protocol.md.

export const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const MAX_BODY_CODE_POINTS = 1000;
export const SUPPORTED_KINDS = new Set(['text']);

export const isValidName = (v) => typeof v === 'string' && NAME_RE.test(v);
export const isValidId = (v) => typeof v === 'string' && UUID_RE.test(v);

/** Exact format AND a real calendar instant (rejects e.g. 2026-02-30). */
export function isValidTimestamp(v) {
  if (typeof v !== 'string' || !TIMESTAMP_RE.test(v)) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime()) && d.toISOString() === v;
}

export function isValidBody(v) {
  return typeof v === 'string' && v.trim() !== '' && [...v].length <= MAX_BODY_CODE_POINTS;
}

/**
 * REQ-PROTO-010: validate a send request in the normative order; first failure wins.
 * @returns {{code: string, message: string} | null}
 */
export function validateSendRequest(user, body) {
  if (!isValidName(user)) return { code: 'invalid_user', message: 'X-Chat-User header missing or not a valid name' };
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { code: 'invalid_json', message: 'Request body must be a JSON object' };
  }
  if (body.from !== user) return { code: 'sender_mismatch', message: '"from" must equal the X-Chat-User header' };
  if (!isValidId(body.id)) return { code: 'invalid_id', message: '"id" must be a lowercase UUID' };
  if (body.kind !== undefined && !SUPPORTED_KINDS.has(body.kind)) {
    return { code: 'unsupported_kind', message: `Unsupported kind "${body.kind}"` };
  }
  if (!isValidName(body.to)) return { code: 'invalid_recipient', message: '"to" is not a valid name' };
  if (body.to === body.from) return { code: 'self_message', message: 'Cannot send a message to yourself' };
  if (!isValidBody(body.body)) {
    return { code: 'invalid_body', message: `"body" must be non-blank and at most ${MAX_BODY_CODE_POINTS} characters` };
  }
  if (!isValidTimestamp(body.createdAt)) {
    return { code: 'invalid_created_at', message: '"createdAt" must be YYYY-MM-DDTHH:mm:ss.sssZ' };
  }
  return null;
}

/** Parses a non-negative integer query param; undefined → fallback, malformed → null. */
export function parseNonNegativeInt(raw, fallback) {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) return null;
  return Number(raw);
}
