import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { startServer } from '../tools/server-process.mjs';

// ---- JSON Schemas straight from the spec ---------------------------------------
const SCHEMA_DIR = new URL('../spec/core/schemas/', import.meta.url);
const ajv = new Ajv2020({ allErrors: true, strict: false });
for (const f of readdirSync(SCHEMA_DIR)) {
  if (f.endsWith('.schema.json')) ajv.addSchema(JSON.parse(readFileSync(new URL(f, SCHEMA_DIR), 'utf8')), f);
}

/** Asserts `value` validates against spec/core/schemas/<name>. */
export function assertSchema(name, value) {
  const validate = ajv.getSchema(name);
  if (!validate(value)) {
    throw new Error(`${name} violation: ${ajv.errorsText(validate.errors)}\n${JSON.stringify(value, null, 2)}`);
  }
}

// ---- server under test -------------------------------------------------------------
/** Uses CHATGEN_BASE_URL if set (external server), otherwise spawns one on a free port. */
export async function serverUnderTest() {
  if (process.env.CHATGEN_BASE_URL) return { baseUrl: process.env.CHATGEN_BASE_URL, stop: async () => {} };
  return startServer();
}

export function client(baseUrl) {
  const call = async (method, path, { user, body, raw, headers = {} } = {}) => {
    const h = { ...headers };
    if (user !== undefined) h['X-Chat-User'] = user;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      h['Content-Type'] = 'application/json';
    }
    const res = await fetch(baseUrl + path, { method, headers: h, body: payload });
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
    return { status: res.status, headers: res.headers, json, text };
  };
  return {
    call,
    send: (user, msg) => call('POST', '/v1/messages', { user, body: msg }),
    sync: (user, query = '') => call('GET', `/v1/messages${query}`, { user }),
    reset: () => call('POST', '/admin/api/reset'),
    network: (name, online) => call('POST', `/admin/api/users/${name}/network`, { body: { online } }),
    state: () => call('GET', '/admin/api/state'),
  };
}

export const nowTs = () => new Date().toISOString();

export function newMessage(from, to, body = 'hello', extra = {}) {
  return { id: randomUUID(), kind: 'text', from, to, body, createdAt: nowTs(), ...extra };
}

/** Resolves to 'reset' if the connection is dropped without an HTTP response, else the status. */
export async function outcome(promise) {
  try {
    return (await promise).status;
  } catch (e) {
    if (e instanceof TypeError) return 'reset';
    throw e;
  }
}
