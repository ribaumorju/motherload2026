/**
 * Screenshots the visual sheet in tools/shots.html.
 *
 *   node tools/shots.mjs
 *
 * Writes tools/shots/*.png, one per stage, so the look of the game at every
 * depth can be reviewed without playing to 12,000 feet. It is not a test: it is
 * how the visuals get checked at all, since "does it look right" is not
 * something an assertion can answer.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8799;
const OUT = path.join(ROOT, 'tools', 'shots');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome found.');
  process.exit(2);
}

const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs'), String(PORT)], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const cleanup = () => { if (server && !server.killed) server.kill(); };
process.on('exit', cleanup);

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/index.html`)).ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

if (!(await waitForServer())) {
  console.error('the local server did not start');
  cleanup();
  process.exit(3);
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const profile = path.join(process.env.TEMP || '/tmp', `deepcore-shots-${Date.now()}`);

// The sheet is taller than a window, so the shot is taken at full page height.
const result = spawnSync(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--no-first-run',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  `--user-data-dir=${profile}`,
  '--virtual-time-budget=20000',
  '--window-size=2560,3400',
  `--screenshot=${path.join(OUT, 'sheet.png')}`,
  `http://127.0.0.1:${PORT}/tools/shots.html`,
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 180000 });

cleanup();

const files = existsSync(OUT) ? readdirSync(OUT) : [];
console.log('');
if (!files.length) {
  console.error('no screenshot was written');
  if (result.stderr) console.error(result.stderr.split('\n').slice(0, 10).join('\n'));
  process.exit(1);
}

for (const file of files) {
  const size = existsSync(path.join(OUT, file)) ? 'ok' : 'missing';
  console.log(`  ${file} ${size}`);
}
console.log(`\nshots written to ${OUT}`);
console.log('open the sheet to review the game at every depth.');
