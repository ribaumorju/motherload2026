/**
 * Runs everything that can fail.
 *
 *   node tools/verify.mjs
 *
 * Three layers, in the order they are worth fixing:
 *
 *   1. syntax   - every module parses. Catches the typo before anything else
 *                 has an opinion about it.
 *   2. sim      - tests/selftest.mjs. The game's rules, in Node, fast.
 *   3. browser  - tools/smoke.mjs. The real page in real Chrome: imports,
 *                 canvas, DOM, audio, pixels.
 *
 * Exits non-zero on the first failing layer, because a syntax error makes the
 * other two meaningless.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const run = (label, args) => {
  process.stdout.write(`\n=== ${label} ===\n`);
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  return result.status === 0;
};

/** Every .js/.mjs under a directory, recursively. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.m?js$/.test(entry)) out.push(full);
  }
  return out;
}

/* ---- 1. syntax ---- */

process.stdout.write('=== syntax ===\n');
const sources = [
  ...walk(path.join(ROOT, 'src')),
  ...walk(path.join(ROOT, 'tools')),
  ...walk(path.join(ROOT, 'tests')),
];
let syntaxOk = true;
for (const file of sources) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    syntaxOk = false;
    console.error(`  SYNTAX ${path.relative(ROOT, file)}`);
    const message = (result.stderr || '').split('\n').filter((l) => l.trim() && !l.includes('node:internal')).slice(0, 4);
    console.error(`  ${message.join('\n  ')}`);
  }
}
if (syntaxOk) process.stdout.write(`  ${sources.length} files parse\n`);

/* ---- 2. sim ---- */

if (!syntaxOk) {
  console.error('\nsyntax errors above; stopping.');
  process.exit(1);
}
if (!run('sim (tests/selftest.mjs)', [path.join(ROOT, 'tests', 'selftest.mjs')])) {
  console.error('\nsim checks failed; stopping before the browser run.');
  process.exit(1);
}

/* ---- 3. browser ---- */

if (!run('browser (tools/smoke.mjs)', [path.join(ROOT, 'tools', 'smoke.mjs')])) {
  console.error('\nbrowser checks failed.');
  process.exit(1);
}

process.stdout.write('\nAll layers passed.\n');
