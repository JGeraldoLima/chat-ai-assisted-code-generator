import { createApp } from './app.js';
import { Store } from './store.js';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0'; // 0.0.0.0 so the Android emulator can reach it via 10.0.2.2
const QUIET = process.env.CHATGEN_QUIET === '1';

const store = new Store();
const app = createApp({ store, log: QUIET ? () => {} : (line) => console.log(`[${new Date().toISOString()}] ${line}`) });

const server = app.listen(PORT, HOST, () => {
  const { port } = server.address();
  console.log(`chat-server listening on http://localhost:${port}  (portal: http://localhost:${port}/admin)`);
});
// Long-polls hold requests for up to 30 s; keep Node's own timeouts out of the way.
server.requestTimeout = 0;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 5_000;

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    store.reset();
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
