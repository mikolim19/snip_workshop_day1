import { spawnSync } from 'node:child_process';
import { closeSync, cpSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const components = ['backend', 'frontend', 'cli'];
const bundle = join(root, 'bundle');
const push = process.argv.includes('--push');
const trailers = [
  'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>',
  'Co-authored-by: OpenBot <335604065+openbotgit[bot]@users.noreply.github.com>',
];

function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}).\n${result.stderr ?? ''}`);
  }
  return result.stdout?.trim() ?? '';
}

function git(args, cwd = root) {
  return run('git', args, cwd, true);
}

function clean(cwd) {
  if (git(['status', '--porcelain', '--untracked-files=normal'], cwd)) {
    throw new Error(`Refusing to overwrite changes in ${cwd}. Commit or preserve them first.`);
  }
}

function npm(args) {
  if (process.platform === 'win32') {
    run(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'npm', ...args], join(root, 'frontend'));
  } else {
    run('npm', args, join(root, 'frontend'));
  }
}

function commitIfChanged(cwd, message) {
  if (!git(['diff', '--cached', '--name-only'], cwd)) {
    console.log(`${cwd === bundle ? 'bundle' : 'main'} unchanged; nothing to commit.`);
    return;
  }
  run('git', ['commit', '-m', message, ...trailers.flatMap((trailer) => ['-m', trailer])], cwd);
}

function isAncestor(older, newer) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', older, newer], {
    cwd: bundle, encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`Cannot compare bundle history: ${result.stderr}`);
  }
  return result.status === 0;
}

function build() {
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--push');
  if (unknown.length) throw new Error(`Unknown arguments: ${unknown.join(' ')}`);
  if (git(['branch', '--show-current']) !== 'main') {
    throw new Error('Run this script from the main superproject checkout.');
  }
  const changedPaths = [
    git(['diff', '--name-only']),
    git(['diff', '--cached', '--name-only']),
    git(['ls-files', '--others', '--exclude-standard']),
  ].join('\n').split('\n').filter(Boolean);
  if (changedPaths.some((path) => ![...components, 'bundle'].includes(path))) {
    throw new Error('Commit unrelated superproject changes before building a release.');
  }
  for (const component of [...components, 'bundle']) {
    if (existsSync(join(root, component, '.git'))) clean(join(root, component));
  }
  run('git', ['submodule', 'update', '--init', '--remote', ...components]);
  run('git', ['submodule', 'update', '--init', 'bundle']);
  clean(bundle);
  run('git', ['fetch', 'origin', 'bundle'], bundle);
  if (isAncestor('HEAD', 'origin/bundle')) {
    run('git', ['merge', '--ff-only', 'origin/bundle'], bundle);
  } else if (!isAncestor('origin/bundle', 'HEAD')) {
    throw new Error('Local and remote bundle histories diverged; reconcile them before releasing.');
  }

  // npm ci uses the committed lockfile; npm install could silently change the release.
  npm(['ci', '--no-fund', '--no-audit']);
  npm(['run', 'build', '--', '--progress=false']);
  const browser = join(root, 'frontend', 'dist', 'snip-frontend', 'browser');
  if (!existsSync(join(browser, 'index.html'))) {
    throw new Error('Missing frontend/dist/snip-frontend/browser/index.html.');
  }
  for (const component of components) clean(join(root, component));
  const sources = Object.fromEntries(components.map((name) => [
    name, git(['rev-parse', 'HEAD'], join(root, name)),
  ]));

  rmSync(join(bundle, 'public'), { recursive: true, force: true });
  cpSync(browser, join(bundle, 'public'), { recursive: true });
  cpSync(join(root, 'backend', 'server.js'), join(bundle, 'server.js'));
  cpSync(join(root, 'cli', 'cli.js'), join(bundle, 'cli.js'));
  const files = {
    'README.md': '# Generated Snip release\n\nDo not hand-edit. Run `node scripts/build-bundle.mjs --push` on `main`.\n\n`bun start` serves the UI, API and redirects. `node cli.js help` runs the CLI.\nSource commits are recorded in `sources.json`. Storage is in-memory by design.\n',
    '.env': 'PUBLIC_DIR=./public\n',
    '.gitattributes': '* text=auto eol=lf\n',
    '.dockerignore': '.git\nnode_modules\n*.log\n.env.*\n',
    'Dockerfile': 'FROM oven/bun:1-alpine\nWORKDIR /app\nCOPY . .\nENV PORT=3000\nEXPOSE 3000\nUSER bun\nCMD ["bun", "server.js"]\n',
    'package.json': `${JSON.stringify({
      name: 'snip-bundle', version: '1.0.0', private: true,
      scripts: { start: 'bun server.js' }, bin: { snip: './cli.js' },
    }, null, 2)}\n`,
    'railway.json': `${JSON.stringify({
      $schema: 'https://railway.com/railway.schema.json',
      build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile' },
      deploy: { healthcheckPath: '/api/links', healthcheckTimeout: 30, restartPolicyType: 'ON_FAILURE' },
    }, null, 2)}\n`,
    'sources.json': `${JSON.stringify(sources, null, 2)}\n`,
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(bundle, name), content);
  if (readFileSync(join(bundle, 'server.js')).compare(readFileSync(join(root, 'backend', 'server.js'))) ||
      readFileSync(join(bundle, 'cli.js')).compare(readFileSync(join(root, 'cli', 'cli.js')))) {
    throw new Error('Generated server or CLI differs from the pinned source.');
  }
  run('git', ['add', '--', ...Object.keys(files), 'server.js', 'cli.js', 'public'], bundle);
  commitIfChanged(bundle, 'Generate Snip bundle from pinned source commits');
  if (push) run('git', ['push', 'origin', 'HEAD:bundle'], bundle);
  run('git', ['add', '--', ...components, 'bundle']);
  commitIfChanged(root, 'Pin verified source revisions and generated bundle');
  // Push even after a no-op: previous local builds may contain unpushed commits.
  if (push) run('git', ['push', 'origin', 'HEAD:main']);
}

let lock;
const lockPath = join(root, '.release-build.lock');
try {
  lock = openSync(lockPath, 'wx');
  build();
} catch (error) {
  console.error(`Bundle build failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (lock !== undefined) {
    closeSync(lock);
    rmSync(lockPath);
  }
}
