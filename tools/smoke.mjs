/**
 * Runs tools/smoke.html in headless Chrome and reports the result.
 *
 *   node tools/smoke.mjs [port]
 *
 * The server has to live for the whole run and cannot be started in an earlier
 * command: this environment tears down child processes when their parent exits,
 * so a server started separately is already gone by the time Chrome asks for a
 * page. Owning it here is what makes the run self-contained.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8788;

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error(`No Chrome found. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
  process.exit(2);
}

const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs'), String(PORT)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const cleanup = () => {
  if (server && !server.killed) server.kill();
};
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/index.html`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

if (!(await waitForServer())) {
  console.error('the local server did not start');
  cleanup();
  process.exit(3);
}

/**
 * Loads a harness page in headless Chrome and returns its `#out` text.
 *
 * Each page gets a fresh profile so localStorage starts empty - the boot check
 * asserts on what a first-time player sees, and a leftover save from the
 * previous page would change that.
 */
function runPage(page, budgetMs) {
  const profile = path.join(process.env.TEMP || '/tmp', `deepcore-${page.replace(/\W/g, '')}-${Date.now()}`);
  const result = spawnSync(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    `--user-data-dir=${profile}`,
    `--virtual-time-budget=${budgetMs}`,
    '--dump-dom',
    `http://127.0.0.1:${PORT}/tools/${page}`,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 240000 });

  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* a locked profile directory is not worth failing the run over */
  }

  const dom = result.stdout || '';
  const match = /<pre id="out"[^>]*>([\s\S]*?)<\/pre>/.exec(dom);
  const text = match
    ? match[1]
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    : '';
  return { text, dom, status: result.status, stderr: result.stderr || '' };
}

/**
 * Two passes.
 *
 * `smoke.html` tests the game's parts. `boot.html` tests the wiring between
 * them by loading the real src/main.js. They are separate pages because
 * booting main.js mounts its own HUD and title screen, which would collide
 * with the first page's own DOM.
 */
const report = [];
let totalPassed = 0;
const allFailed = [];

for (const [page, budget] of [['smoke.html', 30000], ['boot.html', 30000]]) {
  const { text, dom, status, stderr } = runPage(page, budget);
  if (!text) {
    console.log(`\nNO OUTPUT FROM ${page}`);
    console.log(`  chrome exit ${status}, ${dom.length} chars of DOM`);
    if (stderr) console.log(stderr.split('\n').slice(0, 12).join('\n'));
    cleanup();
    process.exit(1);
  }
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const passed = lines.filter((l) => l.startsWith('PASS')).length;
  const failed = lines.filter((l) => l.startsWith('FAIL'));

  /*
   * A page that reports nothing must not be a pass.
   *
   * This is not hypothetical: a duplicate `const` in smoke.html was a parse
   * error, so the whole script never ran, the `<pre>` kept its placeholder text,
   * and this runner cheerfully printed "all browser checks passed" over 0
   * checks. A syntax error in the harness looked exactly like a clean run.
   *
   * The harnesses are the thing that is supposed to catch this, so a silent
   * page is treated as a failure and named as one.
   */
  if (passed === 0 && failed.length === 0) {
    failed.push(
      `the page ran no checks at all - it did not finish starting `
      + `(first output: ${JSON.stringify((lines[0] || '').slice(0, 60))})`,
    );
  }

  totalPassed += passed;
  allFailed.push(...failed.map((l) => `${page}: ${l.replace(/^FAIL\s+/, '')}`));
  report.push({ page, passed, failed: failed.length, lines });
}

writeFileSync(path.join(ROOT, 'tools', '.smoke.json'), JSON.stringify({ report }, null, 2));
cleanup();

console.log('');
for (const entry of report) {
  console.log(`  ${entry.page.padEnd(12)} ${entry.passed} passed, ${entry.failed} failed`);
}
console.log('');
console.log(`browser: ${totalPassed} passed, ${allFailed.length} failed`);
for (const line of allFailed) console.log(`  ${line}`);
if (allFailed.length) process.exit(1);
console.log('all browser checks passed. report: tools/.smoke.json');
