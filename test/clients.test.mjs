import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { loadConfig } from '../src/config.mjs';
import { PanSou } from '../src/pansou.mjs';
import { CMS, shareType } from '../src/cms.mjs';
import { Gying } from '../src/gying.mjs';
import { requestJSON } from '../src/http.mjs';
import { createTools, toolDefinitions, validate } from '../src/tools.mjs';

const config = extra => loadConfig({ REEL_BRIDGE_ENV_FILE: '', ...extra });
const reply = data => ({ ok: true, status: 200, data });
const temp = async t => {
  const dir = await mkdtemp(resolve(tmpdir(), 'reel-bridge-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

test('配置默认托管，指定 URL 外部模式；env 覆盖 .env', async t => {
  assert.equal(config().mode, 'managed');
  const dir = await temp(t);
  const path = resolve(dir, '.env');
  await writeFile(path, 'PANSOU_URL=http://localhost:7742\nPANSOU_USER=user\nPANSOU_PASS="a$#=b"\n');
  const c = loadConfig({ REEL_BRIDGE_ENV_FILE: path, PANSOU_USER: 'override' });
  assert.equal(c.mode, 'external');
  assert.equal(c.pansou.user, 'override');
  assert.equal(c.pansou.pass, 'a$#=b');
  assert.equal(c.redact('secret a$#=b'), 'secret [REDACTED]');
});

test('配置拒绝半套凭据、非法 URL、相对数据路径与无效数值', () => {
  for (const bad of [{ CMS_URL: 'http://cms.test' }, { GYING_USER: 'user' }, { PANSOU_URL: 'file:///tmp/x' }, { PANSOU_URL: 'http://user:example-password@host' }, { PANSOU_PORT: 'NaN' }, { REEL_BRIDGE_DATA_DIR: './data' }]) {
    assert.throws(() => config(bad));
  }
  assert.match(config({ GYING_URL: 'https://楚门的世界.com' }).gying.url, /xn--/);
});

test('工具收敛为 3/5 个，CMS 明确是写操作，校验参数', () => {
  assert.deepEqual(toolDefinitions(false).map(x => x.name), ['search', 'check_links', 'status']);
  assert.equal(toolDefinitions(true).length, 5);
  assert.equal(toolDefinitions(true)[3].annotations.readOnlyHint, false);
  const schema = toolDefinitions(false)[0].inputSchema;
  for (const args of [{}, { keyword: ' ' }, { keyword: 'test', limit_per_type: -1 }, { keyword: 'test', token: 'oops' }, { keyword: 'test', refresh: 'true' }]) assert.throws(() => validate(schema, args));
  validate(schema, { keyword: 'test', plugins: ['gying'], limit_per_type: 2 });
});

test('PanSou 401 单飞登录；新 token 可复用；plugins 参数与限量结果保留', async () => {
  let logins = 0;
  let body;
  const p = new PanSou({ url: 'http://pan.test', user: 'user', pass: 'pass', timeout: 1000 }, async (url, init) => {
    if (url.endsWith('/api/auth/login')) {
      logins++;
      await new Promise(r => setTimeout(r, 10));
      return reply({ token: 'new-token' });
    }
    if (!init.headers.Authorization) return { ok: false, status: 401, data: {} };
    body = init.body;
    return reply({ code: 0, data: { total: 2, merged_by_type: { quark: [{ url: 'a' }, { url: 'b' }] } } });
  });
  const results = await Promise.all([p.search({ keyword: ' test ', plugins: ['gying'], limit_per_type: 1 }), p.search({ keyword: 'test', plugins: ['gying'], limit_per_type: 1 })]);
  assert.equal(logins, 1);
  assert.deepEqual(body.plugins, ['gying']);
  assert.equal(body.src, 'plugin');
  assert.equal(body.kw, 'test');
  assert.equal(results[0].counts.quark, 2);
  assert.equal(results[0].merged_by_type.quark.length, 1);
});

test('PanSou HTTP 200 内的业务失败不会被当成零结果', async () => {
  const p = new PanSou({ url: 'http://pan.test' }, async () => reply({ code: 500, message: 'bad' }));
  await assert.rejects(p.search({ keyword: 'test' }), /业务错误/);
});

test('CMS 不依赖 PanSou 或 Docker；接受字符串 code，去重与部分失败', async () => {
  const c = config({ CMS_URL: 'https://cms.test', CMS_TOKEN: 'secret' });
  let calls = 0;
  const cms = new CMS(c.cms, async (url, init) => {
    calls++;
    assert.equal(init.body.token, 'secret');
    return reply(calls === 1 ? { code: '200' } : { code: '400', message: 'secret' });
  });
  const fail = () => { throw new Error('不应调用 PanSou 或 Docker'); };
  const tools = createTools(c, { start: fail }, { login: fail }, { ensure: fail }, cms);
  const r = await tools.call('cms_add_share', { urls: ['https://115cdn.com/s/a', 'https://115cdn.com/s/a', 'https://alipan.com/s/b'] });
  assert.equal(calls, 2);
  assert.equal(r.data.submitted, 1);
  assert.equal(r.isError, true);
  assert.ok(!JSON.stringify(r).includes('secret'));
});

test('CMS URL 校验不接受伪造域名，失败不自动重试；sync 编码 token', async () => {
  assert.equal(shareType('https://evil.test/115.com/s/a'), null);
  assert.equal(shareType('https://115cdn.com.evil.test/s/a'), null);
  assert.equal(shareType('https://115cdn.com/s/a?password=x'), '115');
  let calls = 0;
  const cms = new CMS({ enabled: true, url: 'https://cms.test', token: 'a&b=?', timeout: 1000 }, async url => {
    calls++;
    assert.equal(new URL(url).searchParams.get('token'), 'a&b=?');
    return reply({ code: 200 });
  });
  await assert.rejects(cms.addShares(['https://quark.cn/s/a']), /不支持|仅支持/);
  assert.equal(calls, 0);
  await cms.sync(true);
  assert.equal(calls, 1);
});

test('Gying 复用有效会话、不无故改站点；变更密码才登录', async t => {
  const dir = await temp(t);
  const calls = [];
  const p = { config: { url: 'http://pan.test' }, async gying(hash, action) {
    calls.push(action);
    if (action === 'get_config') return { base_url: 'https://gying.test' };
    if (action === 'get_status') return { logged_in: true, status: 'active', expires_in_days: 100 };
    return {};
  } };
  const cfg = { enabled: true, url: 'https://gying.test', user: 'user', pass: 'pass', salt: 'salt' };
  const g = new Gying(cfg, p, dir);
  await Promise.all([g.ensure(), g.ensure()]);
  assert.deepEqual(calls, ['get_config', 'get_status']);
  assert.equal(g.state.state, 'ready');
  await new Gying({ ...cfg, pass: 'changed' }, p, dir).ensure();
  assert.equal(calls.filter(x => x === 'login').length, 1);
  assert.ok(!calls.includes('update_config'));
});

test('Gying 改站点仅更新一次；登录失败降级而非阻止其他搜索', async t => {
  const calls = [];
  const dir = await temp(t);
  const p = { config: { url: 'http://pan.test' }, async gying(hash, action) {
    calls.push(action);
    if (action === 'get_config') return { base_url: 'https://old.test' };
    if (action === 'get_status') return { logged_in: false };
    if (action === 'login') throw new Error('sensitive password');
    return {};
  } };
  const g = new Gying({ enabled: true, url: 'https://new.test', user: 'user', pass: 'pass', salt: 'salt' }, p, dir);
  const state = await g.ensure();
  assert.equal(state.state, 'degraded');
  assert.ok(!JSON.stringify(state).includes('sensitive'));
  await g.ensure();
  assert.equal(calls.filter(x => x === 'update_config').length, 1);
});

test('Gying 故障不阻塞普通搜索；只指定 gying 时明确报错', async () => {
  const c = config();
  let searched = 0;
  const degraded = { configured: true, state: 'degraded', error: 'Gying unavailable' };
  const tools = createTools(c, { start: async () => c.pansou }, {
    config: {}, health: async () => ({ status: 'ok' }),
    search: async () => { searched++; return { total: 1 }; },
  }, { state: degraded, ensure: async () => degraded }, {});
  const r = await tools.call('search', { keyword: 'test' });
  assert.equal(r.data.total, 1);
  assert.deepEqual(r.data.warnings, ['Gying unavailable']);
  await assert.rejects(tools.call('search', { keyword: 'test', plugins: ['gying'] }), /Gying unavailable/);
  assert.equal(searched, 1);
});

test('未配置 CMS 时不能通过手工 tools/call 偷调隐藏工具', async () => {
  const c = config();
  const tools = createTools(c, {}, {}, {}, { sync: () => assert.fail('未启用的工具不能执行') });
  await assert.rejects(tools.call('cms_sync', {}), /未启用/);
});

test('HTTP 超时覆盖读取响应体；拒绝重定向并且不泄露请求 URL', async t => {
  const server = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://example.test' }); res.end(); }
    else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = 'http://127.0.0.1:' + server.address().port;
  await assert.rejects(requestJSON(base + '/slow?token=secret', { timeout: 30 }), /超时/);
  await assert.rejects(requestJSON(base + '/redirect'), e => !e.message.includes('secret') && e.message.includes('连接失败'));
});
