import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { Runtime, readJSON, withLock } from '../src/runtime.mjs';

async function setup(t, extra = {}) {
  const dir = await mkdtemp(resolve(tmpdir(), 'reel-bridge-runtime-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return loadConfig({ REEL_BRIDGE_ENV_FILE: '', REEL_BRIDGE_DATA_DIR: dir, ...extra });
}

test('外部模式完全不调用 Docker，也不创建或接管容器', async t => {
  const c = await setup(t, { PANSOU_URL: 'http://localhost:7742' });
  const r = new Runtime(c, { docker: () => assert.fail('不得操作 Docker') });
  assert.equal((await r.start()).url, c.pansou.url);
  assert.equal(r.status().state, 'external');
});

test('托管模式生成受保护凭据；多客户端复用；使用 missing 而非 always 拉取', async t => {
  const c = await setup(t);
  let owned = false, owner;
  const commands = [];
  const docker = async (args, options) => {
    commands.push(args);
    if (args.includes('ps')) return owned ? 'container-id' : '';
    if (args[0] === 'inspect') return JSON.stringify([{ Config: { Labels: { 'dev.reel-bridge.owner': owner } } }]);
    if (args.includes('up')) { owned = true; owner = options.env.RB_OWNER; }
    return '';
  };
  let probes = 0;
  const options = { docker, probePort: async () => { probes++; } };
  const a = new Runtime(c, options);
  const b = new Runtime(c, options);
  const [ca, cb] = await Promise.all([a.start(), b.start()]);
  assert.equal(ca.pass, cb.pass);
  assert.ok(ca.pass.length >= 32);
  assert.equal(probes, 1);
  assert.equal((await stat(resolve(c.dataDir, 'runtime.json'))).mode & 0o777, 0o600);
  assert.equal((await readJSON(resolve(c.dataDir, 'runtime.json'))).pass, ca.pass);
  const up = commands.find(x => x.includes('up'));
  assert.ok(up.includes('missing'));
  assert.ok(up.includes('--wait'));
  assert.ok(!commands.some(x => x.includes('down')));
  assert.equal(a.status().state, 'ready');
});

test('拒绝接管未知容器，端口冲突不会执行 up', async t => {
  const c = await setup(t);
  let up = false;
  const docker = async args => {
    if (args.includes('ps')) return 'unknown';
    if (args[0] === 'inspect') return JSON.stringify([{ Config: { Labels: {} } }]);
    if (args.includes('up')) up = true;
    return '';
  };
  const r = new Runtime(c, { docker });
  await assert.rejects(r.start(), /拒绝接管/);
  assert.equal(up, false);
  const conflict = new Runtime(c, { docker: async args => { if (args.includes('up')) up = true; return ''; }, probePort: async () => { throw new Error('端口冲突'); } });
  await assert.rejects(conflict.start(), /端口冲突/);
  assert.equal(up, false);
});

test('启动锁串行化，异常会释放锁', async t => {
  const c = await setup(t);
  let active = 0, max = 0;
  const job = () => withLock(c.dataDir, async () => {
    max = Math.max(max, ++active);
    await new Promise(r => setTimeout(r, 20));
    active--;
  });
  await Promise.all([job(), job(), job()]);
  assert.equal(max, 1);
  await assert.rejects(withLock(c.dataDir, () => { throw new Error('fail'); }), /fail/);
  await job();
});

test('启动失败可再次尝试，凭据不重新生成', async t => {
  const c = await setup(t);
  let failed = false;
  const r = new Runtime(c, { probePort: async () => {}, docker: async args => {
    if (args.includes('up') && !failed) { failed = true; throw new Error('pull failed'); }
    return '';
  } });
  await assert.rejects(r.start(), /pull failed/);
  const before = await readJSON(resolve(c.dataDir, 'runtime.json'));
  const after = await r.start();
  assert.equal(before.pass, after.pass);
});
