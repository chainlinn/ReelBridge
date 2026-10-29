import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { serve } from '../src/main.mjs';
import { toolDefinitions } from '../src/tools.mjs';

const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } };
async function session(messages, override = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  let raw = '';
  output.on('data', b => { raw += b; });
  const tools = { definitions: toolDefinitions(true), start: async () => {}, call: async () => ({ data: { ok: true } }), ...override };
  const done = serve(tools, { input, output, redact: s => s.replaceAll('top-secret', '[REDACTED]') });
  input.end(messages.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join('\n') + '\n');
  await done;
  return raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('initialize 不等待后端启动，工具列表不阻塞，无 stdout 杂音', async () => {
  const replies = await session([initialize, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }], { start: () => new Promise(() => {}) });
  assert.equal(replies[0].result.protocolVersion, '2025-11-25');
  assert.equal(replies[1].result.tools.length, 5);
});

test('EOF 后异步请求仍完成，错误消息脱敏', async () => {
  const replies = await session([initialize, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'status', arguments: {} } }], {
    call: async () => { await new Promise(r => setTimeout(r, 20)); throw new Error('top-secret'); },
  });
  assert.equal(replies[1].result.isError, true);
  assert.equal(replies[1].result.content[0].text, '[REDACTED]');
});

test('非法 JSON、非法 request、未知工具和未知方法返回正确 JSON-RPC 错误', async () => {
  const replies = await session(['{bad', [], initialize,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'gying_setup' } },
    { jsonrpc: '2.0', id: 3, method: 'missing' },
  ]);
  assert.deepEqual(replies.filter(r => r.error).map(r => r.error.code), [-32700, -32600, -32602, -32601]);
});

test('CMS 调用在未发 initialized 通知时也不启动 PanSou', async () => {
  let starts = 0;
  const replies = await session([initialize, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'cms_sync' } }], { start: async () => { starts++; } });
  assert.equal(starts, 0);
  assert.equal(replies[1].result.structuredContent.ok, true);
});
