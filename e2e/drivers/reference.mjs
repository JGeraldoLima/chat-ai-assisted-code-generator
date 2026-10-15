// Driver for the headless reference client (e2e/reference). No UI, no emulator: fast and deterministic.
import { ReferenceClient } from '../reference/client.mjs';

export async function createReferenceDriver({ serverUrl }) {
  const client = new ReferenceClient({ baseUrl: serverUrl });
  let composerText = '';
  return {
    kind: 'reference',
    launch: () => client.launch(),
    restart: () => client.restart(),
    close: () => client.close(),
    login: async (name) => client.login(name),
    logout: () => client.logout(),
    openThreadRaw: async (peer) => client.openThread(peer),
    back: async () => client.back(),
    send: async (body) => {
      composerText = body;
      if (client.send(body)) composerText = '';
    },
    read: async () => {
      const v = client.view();
      return {
        ...v,
        composerText,
        lastRowVisible: true,
        conversationsEmpty: v.screen === 'conversations' && v.conversations.length === 0,
        threadEmpty: v.screen === 'thread' && v.thread.length === 0,
      };
    },
  };
}
