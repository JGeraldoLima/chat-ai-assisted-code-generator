import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RUNS_DIR = join(ROOT, 'harness', 'runs');

/**
 * Environment for child processes (gates, generator).
 * Windows: Gradle's JDK fails with "Unable to establish loopback connection" when TEMP is an
 * 8.3 short path (e.g. C:\Users\ABCDEF~1.XYZ\...). Point TEMP/TMP at a long path instead.
 */
export function childEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  if (process.platform === 'win32' && /~\d/.test(env.TEMP ?? '')) {
    const tmp = join(ROOT, 'harness', 'runs', '.tmp');
    mkdirSync(tmp, { recursive: true });
    env.TEMP = tmp;
    env.TMP = tmp;
  }
  return env;
}
