import { createInterface } from 'node:readline';
import { PACKAGE } from './package.mjs';
import { loadConfig } from './config.mjs';
import { Runtime } from './runtime.mjs';
import { PanSou } from './pansou.mjs';
import { Gying } from './gying.mjs';
import { CMS } from './cms.mjs';
import { createTools } from './tools.mjs';

const versions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export function serve(tools, { input = process.stdin, output = process.stdout, redact = String, log = () => {} } = {}) {
  const send = message => output.write(JSON.stringify(message) + '\n');
  const result = (id, value) => send({ jsonrpc: '2.0', id, result: value });
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
  let initialized = false;
  let booted = false;
  const pending = new Set();
  const lines = createInterface({ input, crlfDelay: Infinity });
  const boot = () => {
    if (booted) return;
    booted = true;
    tools.start().catch(e => log(redact(e.message)));
  };
  async function dispatch(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      error(null, -32600, 'Invalid Request'); return;
    }
    const { id, method, params } = message;
    if (id === undefined) {
      if (method === 'notifications/initialized' && initialized) boot();
      return;
    }
    if (id === null || !['string', 'number'].includes(typeof id)) { error(null, -32600, 'Invalid id'); return; }
    if (method === 'initialize') {
      if (!params || typeof params.protocolVersion !== 'string') { error(id, -32602, 'protocolVersion required'); return; }
      initialized = true;
      result(id, {
        protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : versions[0],
        capabilities: { tools: {} }, serverInfo: { name: PACKAGE.name, version: PACKAGE.version },
        instructions: '使用 search 搜索（plugins 可指定 gying），check_links 校验，status 查看启动状态。CMS 是独立写操作，需用户明确要求；不要自动转存或同步。启动中可稍后重试。',
      });
      return;
    }
    if (method === 'ping') { result(id, {}); return; }
    if (!initialized) { error(id, -32000, 'Initialize first'); return; }
    if (method === 'tools/list') { result(id, { tools: tools.definitions }); return; }
    if (method === 'tools/call') {
      if (!params || typeof params.name !== 'string') { error(id, -32602, 'Tool name required'); return; }
      if (!tools.definitions.some(t => t.name === params.name)) { error(id, -32602, 'Unknown tool'); return; }
      // 正常客户端在 initialized 时启动；CMS-only 调用不隐式依赖后端。
      if (!params.name.startsWith('cms_')) boot();
      let progress;
      const progressToken = params._meta?.progressToken;
      if (typeof progressToken === 'string' || typeof progressToken === 'number') {
        let ticks = 0;
        progress = setInterval(() => send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress: ++ticks, message: '请求处理中' } }), 10000);
      }
      try {
        const response = await tools.call(params.name, params.arguments ?? {});
        const data = JSON.parse(redact(JSON.stringify(response.data)));
        result(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data, ...(response.isError ? { isError: true } : {}) });
      } catch (e) {
        result(id, { isError: true, content: [{ type: 'text', text: redact(e.message) }] });
      } finally { clearInterval(progress); }
      return;
    }
    error(id, -32601, 'Method not found');
  }
  lines.on('line', line => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); }
    catch { error(null, -32700, 'Parse error'); return; }
    const task = dispatch(message).catch(() => error(message?.id ?? null, -32603, 'Internal error'));
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  // 不调用 process.exit：让已收到的请求和 stdout 写入自然结束。
  return new Promise(resolve => lines.on('close', async () => { await Promise.allSettled([...pending]); resolve(); }));
}

export async function main() {
  const config = loadConfig();
  const log = message => process.stderr.write('[reel-bridge] ' + config.redact(message) + '\n');
  const runtime = new Runtime(config, { log });
  const pansou = new PanSou({ ...config.pansou });
  const gying = new Gying(config.gying, pansou, config.dataDir);
  const cms = new CMS(config.cms);
  const tools = createTools(config, runtime, pansou, gying, cms);
  log('模式: ' + config.mode + '；工具数: ' + tools.definitions.length);
  await serve(tools, { redact: config.redact, log });
}
