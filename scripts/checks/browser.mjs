/** 启动独立后端和前端并运行真实 Chromium；失败也写报告，退出时清理数据库与凭据。 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const frontend = path.join(root, 'frontend');
const python = process.env.CHECK_PYTHON || 'python';
const startedAt = new Date().toISOString();
const runId = randomUUID();
const reportRoot = path.resolve(root, process.env.CHECK_REPORT_DIR || 'tmp/pr-checks/browser');
const reportDir = path.join(reportRoot, `${startedAt.replaceAll(/[:.]/g, '-')}-${runId.slice(0, 8)}`);
const children = [];
const streams = [];
let runtime;
let exitCode = 1;
let stopping = false;
let failure;
let interruptedSignal;
const cleanup = { processesStopped: false, runtimeRemoved: false };

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    interruptedSignal = signal;
    for (const { child, closed } of children) if (!closed) child.kill('SIGTERM');
  });
}

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`无法记录 Git 状态：${result.error?.message || result.stderr}`);
  return result.stdout.trim();
}

function start(command, args, name, env) {
  const log = createWriteStream(path.join(reportDir, `${name}.log`));
  streams.push(log);
  const child = spawn(command, args, { cwd: frontend, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const state = { child, name, error: null, closed: false };
  child.on('error', error => { state.error = error; });
  child.on('close', () => { state.closed = true; });
  children.push(state);
  return state;
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function ready(url, states) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    for (const state of states) {
      if (state.error || state.closed) throw new Error(`${state.name} 启动失败：${state.error?.message || '进程已退出，请查看对应日志'}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok && (await response.json()).run === runId) return;
    } catch { /* 只等待本次随机握手，绝不接受既有业务服务。 */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('独立服务未在 90 秒内就绪，请查看后端与 Vite 日志');
}

async function stop() {
  if (stopping) return;
  stopping = true;
  const results = await Promise.all(children.map(async ({ child, closed }) => {
    if (closed) return true;
    const ended = new Promise(resolve => child.once('close', () => resolve(true)));
    child.kill('SIGTERM');
    const result = await Promise.race([ended, new Promise(resolve => setTimeout(() => resolve(false), 5000).unref())]);
    if (result) return true;
    // 全部子进程均禁用 reloader/复用服务，仅强制结束本次启动的进程。
    child.kill('SIGKILL');
    return Promise.race([ended, new Promise(resolve => setTimeout(() => resolve(false), 5000).unref())]);
  }));
  cleanup.processesStopped = results.every(Boolean);
  for (const stream of streams) await new Promise(resolve => stream.end(resolve));
  if (runtime) {
    // 递归清理前验证是本入口在系统临时目录创建的绝对路径。
    const resolved = path.resolve(runtime);
    const relative = path.relative(path.resolve(os.tmpdir()), resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !(await readFile(path.join(resolved, '.browser-smoke'), 'utf8'))?.includes(runId)) {
      throw new Error('拒绝清理未确认的临时目录');
    }
    await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    cleanup.runtimeRemoved = true;
  }
}

await mkdir(reportDir, { recursive: true });
const metadata = {
  startedAt, runId, command: 'npm run test:browser',
  os: { platform: os.platform(), release: os.release(), arch: os.arch() },
  node: process.version,
  npm: process.env.npm_config_user_agent,
  scope: '隔离 SQLite、虚构项目和维保账号、生产 API 与完整应用、真实无头 Chromium；未连接业务数据库或执行构建。',
};

try {
  metadata.commit = git(['rev-parse', 'HEAD']);
  metadata.dirty = git(['status', '--porcelain']);
  metadata.lockfileSha256 = createHash('sha256').update(await readFile(path.join(frontend, 'package-lock.json'))).digest('hex');
  metadata.playwright = JSON.parse(await readFile(path.join(frontend, 'node_modules/@playwright/test/package.json'), 'utf8')).version;
  const pythonVersion = spawnSync(python, ['--version'], { encoding: 'utf8', windowsHide: true });
  if (pythonVersion.status !== 0) throw new Error(`无法执行验收 Python：${pythonVersion.error?.message || pythonVersion.stderr}`);
  metadata.python = pythonVersion.stdout.trim();
  runtime = await mkdtemp(path.join(os.tmpdir(), 'trace-ship-browser-'));
  await writeFile(path.join(runtime, '.browser-smoke'), runId);
  const backendPort = await unusedPort();
  const frontendPort = await unusedPort();
  if (backendPort === frontendPort) throw new Error('分配到重复端口，请重新执行');
  const backendURL = `http://127.0.0.1:${backendPort}`;
  const baseURL = `http://127.0.0.1:${frontendPort}`;
  const env = {
    ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', SMOKE_RUN_ID: runId, SMOKE_BASE_URL: baseURL,
    SMOKE_BACKEND_URL: backendURL, SMOKE_FRONTEND_PORT: String(frontendPort),
    SMOKE_REPORT_DIR: reportDir, SMOKE_MANIFEST: path.join(runtime, 'manifest.json'),
    SMOKE_VITE_CACHE: path.join(runtime, 'vite-cache'), SMOKE_DIST: path.join(runtime, 'dist'), VITE_API_BASE_URL: '/api', CHECK_PYTHON: python,
    // 防止调用者的开发环境变量启用 LDAP 或外部服务；Django 强制使用测试配置。
    LDAP_SERVER_URI: '', LDAP_BIND_DN: '', LDAP_BIND_PASSWORD: '', LDAP_USER_SEARCH_BASE: '',
  };
  const backend = start(python, [path.join(root, 'scripts/checks/browser_seed.py'), '--runtime', runtime, '--port', String(backendPort)], 'backend', env);
  await ready(`${backendURL}/__browser_smoke__/${runId}`, [backend]);
  const build = start(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.smoke.config.ts'], 'build', env);
  const buildCode = await new Promise(resolve => {
    build.child.once('error', () => resolve(1));
    build.child.once('close', code => resolve(code ?? 1));
  });
  if (buildCode !== 0) throw new Error(`浏览器使用的生产构建失败（退出码 ${buildCode}），请查看 build.log`);
  const vite = start(process.execPath, [path.join(frontend, 'node_modules/vite/bin/vite.js'), 'preview', '--config', 'vite.smoke.config.ts'], 'vite', env);
  await ready(`${baseURL}/__browser_smoke__/${runId}`, [backend, vite]);
  const runner = start(process.execPath, [path.join(frontend, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.config.ts'], 'playwright', env);
  exitCode = await new Promise(resolve => {
    runner.child.once('error', () => resolve(1));
    runner.child.once('close', code => resolve(code ?? 1));
  });
  if (backend.closed || vite.closed) throw new Error('浏览器验收期间独立服务意外退出');
} catch (error) {
  failure = error instanceof Error ? error.stack : String(error);
  exitCode = 1;
} finally {
  try { await stop(); } catch (error) { failure = `${failure || ''}\n清理失败：${error.stack || error}`; exitCode = 1; }
  if (interruptedSignal) { failure = `${failure || ''}\n执行被 ${interruptedSignal} 中断`; exitCode = 1; }
  if (!cleanup.processesStopped || !cleanup.runtimeRemoved) exitCode = 1;
  await writeFile(path.join(reportDir, 'report.json'), JSON.stringify({ ...metadata, finishedAt: new Date().toISOString(), exitCode, failure, cleanup }, null, 2));
  console.log(`真实浏览器冒烟${exitCode === 0 ? '通过' : '失败'}；证据：${reportDir}`);
  if (failure) console.error(failure);
  process.exitCode = exitCode;
}
