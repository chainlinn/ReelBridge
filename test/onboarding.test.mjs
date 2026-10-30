import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { configPath, loadConfig, initConfig } from '../src/config.mjs';
import { createTools } from '../src/tools.mjs';
import { Runtime } from '../src/runtime.mjs';
const entry = fileURLToPath(new URL('../bin/reel-bridge.mjs', import.meta.url));
function temp(t) {
  const d = mkdtempSync(resolve(tmpdir(), 'reel-onboarding-'));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

test('用户目录配置与 XDG 优先级；不再加载源码/npx 的 .env', t => {
  const home = temp(t);
  const env = { HOME: home };
  assert.equal(configPath(env), resolve(home, '.config/reel-bridge/.env'));
  assert.equal(configPath({ ...env, XDG_CONFIG_HOME: 'relative' }), configPath(env));
  assert.equal(configPath({ ...env, XDG_CONFIG_HOME: resolve(home, 'cfg') }), resolve(home, 'cfg/reel-bridge/.env'));
  const c = loadConfig(env);
  assert.equal(c.configuration.state, 'absent');
  assert.equal(c.mode, 'managed');
  assert.equal(c.dataDir, resolve(home, '.reel-bridge'));
  assert.equal(existsSync(configPath(env)), false);
});

test('--init 不覆盖文件；权限 600；env 覆盖文件', t => {
  const home = temp(t);
  const env = { HOME: home };
  const first = initConfig(env);
  assert.equal(first.state, 'created');
  if (process.platform !== 'win32') assert.equal(statSync(first.path).mode & 0o777, 0o600);
  writeFileSync(first.path, 'PANSOU_URL=http://localhost:17742\nPANSOU_USER=test\nPANSOU_PASS=sentinel-secret\n');
  const before = readFileSync(first.path, 'utf8');
  assert.equal(initConfig(env).state, 'exists');
  assert.equal(readFileSync(first.path, 'utf8'), before);
  const c = loadConfig({ ...env, PANSOU_URL: 'http://localhost:27742' });
  assert.equal(c.configuration.state, 'loaded');
  assert.deepEqual(c.configuration.overridden_keys, ['PANSOU_URL']);
  assert.equal(c.pansou.url, 'http://localhost:27742');
  assert.equal(loadConfig({ ...env, REEL_BRIDGE_ENV_FILE: '' }).configuration.state, 'disabled');
});

test('CLI init 与错误配置诊断，不泄漏凭据', t => {
  const home = temp(t);
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: resolve(home, 'config'), REEL_BRIDGE_ENV_FILE: resolve(home, 'user.env') };
  const run = arg => spawnSync(process.execPath, [entry, arg], { env, encoding: 'utf8' });
  assert.equal(run('--init').status, 0);
  writeFileSync(env.REEL_BRIDGE_ENV_FILE, 'CMS_TOKEN=never-echo-this-secret\n');
  const r = run('status');
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).configuration.state, 'rejected');
  assert.ok(!(r.stdout + r.stderr).includes('never-echo-this-secret'));
  env.REEL_BRIDGE_ENV_FILE = resolve(home, 'missing.env');
  const absent = JSON.parse(run('status').stdout);
  assert.equal(absent.configuration.reason, 'file_not_found');
});

test('status 只诊断；search/check_links 才启动且共享准备过程', async () => {
  const c = loadConfig({ REEL_BRIDGE_ENV_FILE: '' });
  let starts = 0, inspections = 0, gyingCalls = 0;
  const tools = createTools(c, { inspect: async () => { inspections++; return { state: 'idle' }; }, start: async () => { starts++; return c.pansou; } },
    { config: {}, health: async () => ({ status: 'ok' }), search: async () => ({ total: 1 }), checkLinks: async () => ({ results: [] }) },
    { state: { configured: false, state: 'disabled' }, ensure: async () => { gyingCalls++; } }, {});
  await tools.call('status');
  assert.equal(inspections, 1); assert.equal(starts, 0); assert.equal(gyingCalls, 0);
  await Promise.all([tools.call('search', { keyword: 'test' }), tools.call('check_links', { links: [{ url: 'http://example.test/s/a', disk_type: 'quark' }] })]);
  assert.equal(starts, 1);
});

test('Docker inspect 诊断不创建数据目录，也不执行 compose up', async t => {
  const home = temp(t);
  const dir = resolve(home, 'not-created');
  const c = loadConfig({ REEL_BRIDGE_ENV_FILE: '', REEL_BRIDGE_DATA_DIR: dir });
  const calls = [];
  const r = new Runtime(c, { docker: async args => {
    calls.push(args);
    if (args[0] === 'ps') return '';
    return '1.0';
  } });
  assert.equal((await r.inspect()).docker, 'available');
  assert.equal(existsSync(dir), false);
  assert.ok(!calls.flat().includes('up'));
});

test('up 外部模式只检查健康，成功退出，不调用登录或写操作', async t => {
  const home = temp(t);
  const paths = [];
  const server = createServer((req, res) => {
    paths.push(req.url);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok' }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const r = await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [entry, 'up'], { env: { ...process.env, REEL_BRIDGE_ENV_FILE: '', HOME: home, PANSOU_URL: 'http://127.0.0.1:' + server.address().port, PANSOU_USER: '', PANSOU_PASS: '', CMS_URL: '', CMS_TOKEN: '', GYING_USER: '', GYING_PASS: '' } });
    let stdout = '';
    child.stdout.on('data', b => { stdout += b; });
    child.on('error', reject);
    child.on('close', code => resolvePromise({ code, stdout }));
  });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.stdout).state, 'ready');
  assert.deepEqual(paths, ['/api/health']);
  assert.equal(existsSync(resolve(home, '.reel-bridge')), false);
});
