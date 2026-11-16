import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = join(root, 'bundle');
let child;
let output = '';

function git(args, cwd = root) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function verifyPins() {
  const sources = JSON.parse(readFileSync(join(bundle, 'sources.json')));
  for (const component of ['backend', 'frontend', 'cli', 'bundle']) {
    const pinned = git(['ls-tree', 'HEAD', component]).split(/\s+/)[2];
    assert.equal(git(['rev-parse', 'HEAD'], join(root, component)), pinned, `${component} gitlink differs`);
    if (component !== 'bundle') assert.equal(sources[component], pinned, `${component} manifest differs`);
  }
  for (const [component, file] of [['backend', 'server.js'], ['cli', 'cli.js']]) {
    assert.equal(git(['show', `HEAD:${file}`], bundle), git(['show', `HEAD:${file}`], join(root, component)));
  }
  console.log('PASS: all four gitlinks, source manifest, and unchanged server/CLI match pinned revisions.');
}

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function check(url) {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Bun exited before readiness: ${output}`);
    }
    try {
      ready = (await fetch(`${url}/api/links`, { signal: AbortSignal.timeout(1000) })).ok;
    } catch (error) {
      if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
    }
    if (ready) break;
    await setTimeout(500);
  }
  assert(ready, `Server did not become ready: ${url}\n${output}`);

  const page = await fetch(url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<app-root/);
  const scripts = [...html.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1]);
  assert(scripts.length > 0, 'Built UI has no JavaScript assets');
  for (const script of scripts) {
    const asset = await fetch(new URL(script, `${url}/`));
    assert.equal(asset.status, 200);
    assert(!(await asset.text()).includes('http://localhost:3000/api/links'), 'UI hard-codes localhost');
  }
  assert.equal((await fetch(`${url}/api/links`, { method: 'OPTIONS' })).status, 204);
  for (const body of ['{', JSON.stringify({ url: 'ftp://example.com' })]) {
    const invalid = await fetch(`${url}/api/links`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    assert.equal(invalid.status, 400);
    assert.equal(typeof (await invalid.json()).error, 'string');
  }
  const target = `https://example.com/snip-smoke-${Date.now()}`;
  const created = await fetch(`${url}/api/links`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: target }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get('access-control-allow-origin'), '*');
  const link = await created.json();
  assert.deepEqual(Object.keys(link).sort(), ['code', 'createdAt', 'hits', 'shortUrl', 'url']);
  assert.match(link.code, /^[a-zA-Z0-9]{6}$/);
  assert.equal(link.url, target);
  assert.equal(link.hits, 0);
  assert.equal(new Date(link.createdAt).toISOString(), link.createdAt);
  assert.equal(new URL(link.shortUrl).pathname, `/${link.code}`);
  const redirect = await fetch(`${url}/${link.code}`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), target);
  const links = await (await fetch(`${url}/api/links`)).json();
  assert.equal(links.find((item) => item.code === link.code)?.hits, 1);
  assert.equal((await fetch(`${url}/not-a-valid-code`)).status, 404);

  function cli(args) {
    const result = spawnSync(process.execPath, [join(bundle, 'cli.js'), ...args], {
      env: { ...process.env, SNIP_API: url }, encoding: 'utf8', timeout: 15000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  assert.match(cli(['help']), /Usage:/);
  assert(cli(['ls']).includes(target), 'CLI did not see the same API link');
  const cliTarget = `https://example.com/snip-cli-${Date.now()}`;
  assert.match(cli(['add', cliTarget]).trim(), /^https?:\/\/.+\/[a-zA-Z0-9]{6}$/);
  assert((await (await fetch(`${url}/api/links`)).json()).some((item) => item.url === cliTarget));
  console.log('PASS: built UI/assets, API contract/errors/CORS, redirect/hits, and shared CLI add/list.');
}

try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--url')) {
    throw new Error('Usage: node scripts/smoke-test.mjs [--url http://127.0.0.1:3000]');
  }
  verifyPins();
  let url = args[1];
  if (!url) {
    const port = await unusedPort();
    url = `http://127.0.0.1:${port}`;
    child = spawn(process.env.BUN_BIN || 'bun', ['server.js'], {
      cwd: bundle, env: { ...process.env, PORT: String(port), BASE_URL: url, PUBLIC_DIR: './public' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
  }
  await check(url.replace(/\/+$/, ''));
  assert.equal(JSON.parse(readFileSync(join(bundle, 'package.json'))).type, undefined);
} catch (error) {
  console.error(`Smoke test failed: ${error.stack}`);
  process.exitCode = 1;
} finally {
  if (child && child.exitCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await exited;
  }
}
