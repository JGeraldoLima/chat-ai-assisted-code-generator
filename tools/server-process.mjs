// Starts/stops the Chat Generator server as a child process. Shared by conformance/, e2e/ and the harness.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER_ENTRY = fileURLToPath(new URL('../server/src/index.js', import.meta.url));

/**
 * @param {{ port?: number, quiet?: boolean, onLog?: (line: string) => void }} [opts]
 *   port 0 (default) picks a free port.
 * @returns {Promise<{ baseUrl: string, port: number, stop: () => Promise<void> }>}
 */
export function startServer({ port = 0, quiet = true, onLog } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      env: { ...process.env, PORT: String(port), CHATGEN_QUIET: quiet ? '1' : '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trimEnd();
        buf = buf.slice(i + 1);
        onLog?.(line);
        const m = !settled && line.match(/listening on http:\/\/localhost:(\d+)/);
        if (m) {
          settled = true;
          const actualPort = Number(m[1]);
          resolve({
            port: actualPort,
            baseUrl: `http://localhost:${actualPort}`,
            stop: () =>
              new Promise((res) => {
                if (child.exitCode !== null) return res();
                child.once('exit', () => res());
                child.kill();
              }),
          });
        }
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => onLog?.(d.trimEnd()));
    child.once('exit', (code) => {
      if (!settled) reject(new Error(`server exited early with code ${code}`));
    });
  });
}

/** True if something answers /v1/health at baseUrl. */
export async function isServerUp(baseUrl) {
  try {
    const r = await fetch(`${baseUrl}/v1/health`, { signal: AbortSignal.timeout(1000) });
    return r.ok;
  } catch {
    return false;
  }
}
