import express from 'express';
import { readFileSync } from 'node:fs';
import { Store, MAX_WAIT_SECONDS } from './store.js';
import { isValidName, parseNonNegativeInt, validateSendRequest } from './validation.js';

const PORTAL_HTML = readFileSync(new URL('./admin/portal.html', import.meta.url), 'utf8');

const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });

/**
 * Builds the Express app. Exposed as a factory so tests can create isolated instances.
 * @param {{ store?: Store, log?: (line: string) => void }} [opts]
 */
export function createApp({ store = new Store(), log = () => {} } = {}) {
  const app = express();
  app.disable('x-powered-by');

  // Request log (method, path, user, status, duration). Kept tiny on purpose.
  app.use((req, res, next) => {
    const started = Date.now();
    res.on('finish', () => {
      log(`${req.method} ${req.originalUrl} user=${req.get('x-chat-user') ?? '-'} ${res.statusCode} ${Date.now() - started}ms`);
    });
    next();
  });

  // REQ-PROTO-002: permissive CORS for the Vite dev server and any local origin.
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, X-Chat-User');
      res.set('Access-Control-Max-Age', '600');
      return res.status(204).end();
    }
    next();
  });

  // ---- /v1 --------------------------------------------------------------

  app.get('/v1/health', (_req, res) => res.json({ status: 'ok', serverTime: store.now().toISOString() }));

  // REQ-SIM-001: a simulated-offline user's requests are cut at the TCP level, before anything else.
  // REQ-PROTO-010 step 1: the header is validated before the body is parsed.
  const v1User = (req, res, next) => {
    const user = req.get('x-chat-user');
    if (user !== undefined && store.isOffline(user)) {
      log(`SIMULATED OFFLINE: dropping ${req.method} ${req.originalUrl} for ${user}`);
      req.socket.destroy();
      return;
    }
    if (!isValidName(user)) return sendError(res, 400, 'invalid_user', 'X-Chat-User header missing or not a valid name');
    store.touchUser(user, { seen: true });
    req.chatUser = user;
    next();
  };

  const json = express.json({ limit: '64kb', type: () => true });
  const parseJson = (req, res, next) =>
    json(req, res, (err) => (err ? sendError(res, 400, 'invalid_json', 'Request body must be valid JSON') : next()));

  app.post('/v1/messages', v1User, parseJson, (req, res) => {
    const invalid = validateSendRequest(req.chatUser, req.body);
    if (invalid) return sendError(res, 400, invalid.code, invalid.message);
    const result = store.accept(req.body);
    if (result.status === 409) return sendError(res, 409, 'id_conflict', 'A different message with this id already exists');
    res.status(result.status).json(result.message);
  });

  app.get('/v1/messages', v1User, (req, res) => {
    const after = parseNonNegativeInt(req.query.after, 0);
    if (after === null) return sendError(res, 400, 'invalid_cursor', '"after" must be a non-negative integer');
    const wait = parseNonNegativeInt(req.query.wait, 0);
    if (wait === null) return sendError(res, 400, 'invalid_wait', '"wait" must be a non-negative integer');

    const cancel = store.poll({
      user: req.chatUser,
      after,
      waitSeconds: Math.min(wait, MAX_WAIT_SECONDS),
      onResult: (result) => {
        if (!res.writableEnded && !res.destroyed) res.json(result);
      },
      // REQ-SIM-002 / reset: cut the connection without a response.
      onAbort: () => req.socket.destroy(),
    });
    res.on('close', cancel);
  });

  // ---- /admin (never subject to simulation, REQ-SIM-003) -----------------

  app.get('/', (_req, res) => res.redirect('/admin'));
  app.get('/admin', (_req, res) => res.type('html').send(PORTAL_HTML));
  app.get('/admin/api/state', (_req, res) => res.json(store.state()));

  app.post('/admin/api/users/:name/network', express.json(), (req, res) => {
    const { name } = req.params;
    if (!isValidName(name)) return sendError(res, 400, 'invalid_user', 'Not a valid name');
    if (typeof req.body?.online !== 'boolean') return sendError(res, 400, 'invalid_json', 'Body must be {"online": boolean}');
    log(`NETWORK ${name} -> ${req.body.online ? 'online' : 'OFFLINE'}`);
    res.json(store.setOnline(name, req.body.online));
  });

  app.post('/admin/api/reset', (_req, res) => {
    store.reset();
    log('RESET');
    res.json({ ok: true });
  });

  // ---- fallbacks ---------------------------------------------------------

  app.use((_req, res) => sendError(res, 404, 'not_found', 'Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    log(`ERROR ${err?.stack ?? err}`);
    sendError(res, 500, 'internal', 'Internal server error');
  });

  return app;
}
