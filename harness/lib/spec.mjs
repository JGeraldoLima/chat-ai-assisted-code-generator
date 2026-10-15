// Spec composition: manifest → ordered bundle → hash → requirement index.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import YAML from 'yaml';
import { ROOT } from './paths.mjs';

const SPEC_DIR = join(ROOT, 'spec');

export function loadManifest() {
  return YAML.parse(readFileSync(join(SPEC_DIR, 'manifest.yaml'), 'utf8'));
}

/**
 * Composes the spec bundle for one target, in manifest order:
 * core modules → enabled features → platform profile → schemas. Scenarios are listed by path.
 * The bundle is the exact input the generator sees; its sha256 is the spec hash stamped into GENERATED.md.
 */
export function composeBundle(targetId) {
  const manifest = loadManifest();
  const target = manifest.targets?.[targetId];
  if (!target) throw new Error(`spec/manifest.yaml has no target "${targetId}"`);

  const parts = [];
  const add = (relPath, kind) => {
    const abs = join(SPEC_DIR, relPath);
    if (!existsSync(abs)) throw new Error(`manifest references missing file spec/${relPath}`);
    parts.push({ path: `spec/${relPath}`, kind, text: readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') });
  };

  for (const p of manifest.core) add(p, 'core');
  for (const f of manifest.features?.enabled ?? []) add(`features/${f}.md`, 'feature');
  add(target.profile, 'platform');
  const schemaDir = join(SPEC_DIR, manifest.schemas);
  for (const f of readdirSync(schemaDir).filter((f) => f.endsWith('.json')).sort()) add(`${manifest.schemas}/${f}`, 'schema');
  const scenarioDir = join(SPEC_DIR, manifest.scenarios);
  const scenarios = readdirSync(scenarioDir).filter((f) => f.endsWith('.yaml')).sort();
  for (const f of scenarios) add(`${manifest.scenarios}/${f}`, 'scenario');

  const header = [
    `# Chat Generator spec bundle: target "${targetId}"`,
    '',
    `specVersion: ${manifest.specVersion} · protocol: ${manifest.protocol} · features: ${(manifest.features?.enabled ?? []).join(', ') || '(none)'}`,
    '',
    'This bundle is composed by harness/lib/spec.mjs from spec/manifest.yaml. Each section below is one spec file, verbatim.',
    '',
  ].join('\n');
  const body = parts
    .map((p) => {
      const fence = p.kind === 'schema' ? 'json' : p.kind === 'scenario' ? 'yaml' : null;
      const content = fence ? `\`\`\`${fence}\n${p.text.trimEnd()}\n\`\`\`` : p.text.trimEnd();
      return `\n\n<!-- ===== ${p.kind}: ${p.path} ===== -->\n\n${content}\n`;
    })
    .join('');
  const text = header + body;
  const hash = createHash('sha256').update(text).digest('hex');
  return { text, hash, shortHash: hash.slice(0, 12), manifest, files: parts.map((p) => p.path) };
}

/**
 * Extracts requirement definitions: lines like `- **REQ-AREA-NNN** [client] [server] text`.
 * @returns {Array<{id: string, tags: string[], file: string}>}
 */
export function extractRequirements(bundleText) {
  const reqs = [];
  let file = null;
  for (const line of bundleText.split('\n')) {
    const marker = line.match(/^<!-- ===== \w+: (\S+) ===== -->$/);
    if (marker) file = marker[1];
    const m = line.match(/\*\*(REQ-[A-Z]+-\d{3})\*\*((?:\s*\[[a-z]+\])+)/);
    if (m) reqs.push({ id: m[1], tags: [...m[2].matchAll(/\[([a-z]+)\]/g)].map((t) => t[1]), file });
  }
  return reqs;
}

/** Scenario coverage: REQ id → scenario ids that list it under `covers`. */
export function scenarioCoverage() {
  const manifest = loadManifest();
  const dir = join(SPEC_DIR, manifest.scenarios);
  const map = new Map();
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    const doc = YAML.parse(readFileSync(join(dir, f), 'utf8'));
    for (const id of doc.covers ?? []) map.set(id, [...(map.get(id) ?? []), doc.id]);
  }
  return map;
}
