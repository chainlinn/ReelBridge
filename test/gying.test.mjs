import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Gying } from '../src/gying.mjs';
import { PanSou } from '../src/pansou.mjs';
import { gyingError } from '../src/diagnostics.mjs';
import { createTools } from '../src/tools.mjs';
import { loadConfig } from '../src/config.mjs';
const cfg = { enabled: true, user: 'test-user', pass: 'private-password', salt: 'salt', url: 'https://site.test' };
async function fixture(t, { delay = 0, loginError } = {}) {
  const dir = await mkdtemp(resolve(tmpdir(), 'reel-gying-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  let active = false;
  const p = { config: { url: 'http://pan.test' }, health: async () => ({ status: 'ok' }),
    async gying(hash, action) {
      calls.push(action);
      if (action === 'get_config') return { base_url: cfg.url };
      if (action === 'get_status') return { logged_in: active, status: active ? 'active' : 'pending' };
      if (action === 'login') {
        await new Promise(r => setTimeout(r, delay));
        if (loginError) throw loginError;
        active = true;
      }
      return {};
    },
    search: async () => ({ total: 1 }),
    checkLinks: async () => ({ results: [] }),
  };
  const g = new Gying(cfg, p, dir);
  const c = loadConfig({ REEL_BRIDGE_ENV_FILE: '' });
  const tools = createTools(c, { start: async () => p.config, inspect: async () => ({}) }, p, g, {});
  return { g, p, calls, tools };
}

test('Gying-only 首次搜索等待登录，不立即返回初始化；并发只登录一次', async t => {
  const { calls, tools } = await fixture(t, { delay: 30 });
  const results = await Promise.all([1, 2].map(() => tools.call('search', { keyword: 'test', plugins: ['gying'] })));
  assert.ok(results.every(r => r.data.total === 1 && r.data.gying.state === 'ready'));
  assert.equal(calls.filter(x => x === 'login').length, 1);
});

test('PoW 失败保留阶段、类型、重试时间，不泄漏原始响应或 credentials', async t => {
  const raw = '登录失败: 访问登录页面失败: 机器人验证失败; password=private-password Cookie=private-cookie';
  const { g, calls, tools } = await fixture(t, { loginError: gyingError('login', raw) });
  await assert.rejects(tools.call('search', { keyword: 'test', plugins: ['gying'] }), /GYING_POW_FAILED/);
  const s = g.snapshot();
  assert.equal(s.stage, 'login');
  assert.equal(s.state, 'degraded');
  assert.ok(s.retry_after_ms > 0);
  assert.ok(!JSON.stringify(s).includes('private-'));
  await assert.rejects(tools.call('search', { keyword: 'test', plugins: ['gying'] }), /秒后可重试/);
  assert.equal(calls.filter(x => x === 'login').length, 1);
});

test('等待上限只停止等待，后续复用同一登录而不重复提交', async t => {
  const { g, calls } = await fixture(t, { delay: 80 });
  await assert.rejects(g.waitUntilReady(10), /初始化仍在进行/);
  assert.equal(g.snapshot().state, 'initializing');
  await g.waitUntilReady(1000);
  assert.equal(g.snapshot().state, 'ready');
  assert.equal(calls.filter(x => x === 'login').length, 1);
});

test('普通搜索不被 Gying 登录阻塞，非 Gying 插件与 check_links 不初始化', async t => {
  const { calls, tools, g } = await fixture(t, { delay: 100 });
  await tools.call('check_links', { links: [{ url: 'http://test/s/a', disk_type: 'quark' }] });
  await tools.call('search', { keyword: 'test', plugins: ['labi'] });
  assert.equal(calls.length, 0);
  const r = await tools.call('search', { keyword: 'test' });
  assert.equal(r.data.total, 1);
  assert.equal(r.data.gying.state, 'initializing');
  assert.match(r.data.warnings[0], /可能不含该来源/);
  await g.ensure();
});

test('登录成功但零结果有明确限定，不误报站点失效', async t => {
  const { tools, p } = await fixture(t);
  p.search = async () => ({ total: 0, counts: {} });
  const r = await tools.call('search', { keyword: 'test', plugins: ['gying'] });
  assert.equal(r.data.gying.state, 'ready');
  assert.match(r.data.warnings[0], /不等于站点不可用/);
});

test('PanSou Gying 返回 HTML、未知字段和 Cookie 时仅透传固定诊断', async () => {
  for (const [message, code] of [
    ['登录失败: JSON解析失败: <!DOCTYPE html><title>浏览器安全验证</title> secret-value', 'GYING_CHALLENGE_PAGE'],
    ['登录失败: 访问登录页面失败: 机器人验证失败', 'GYING_POW_FAILED'],
    ['账号不存在，请检查是否填写正确 Cookie=secret-value', 'GYING_CREDENTIALS_REJECTED'],
    ['unknown Cookie=secret-value', 'GYING_UPSTREAM_FAILED'],
  ]) {
    const p = new PanSou({ url: 'http://pan.test' }, async () => ({ ok: true, status: 200, data: { success: false, message } }));
    await assert.rejects(p.gying('hash', 'login'), e => e.diagnostic.code === code && !e.message.includes('secret-value') && !e.message.includes('<!DOCTYPE'));
  }
});
