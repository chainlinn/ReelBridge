import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PACKAGE } from '../src/package.mjs';
const entry = fileURLToPath(new URL('../bin/reel-bridge.mjs', import.meta.url));
const env = { ...process.env, REEL_BRIDGE_ENV_FILE: '/nonexistent/config.env' };

test('GitHub bin 支持 version/help，无需读取凭据或启动后端', () => {
  assert.equal(execFileSync(process.execPath, [entry, '--version'], { env, encoding: 'utf8' }).trim(), PACKAGE.version);
  assert.match(execFileSync(process.execPath, [entry, '--help'], { env, encoding: 'utf8' }), /ReelBridge/);
  assert.equal(spawnSync(process.execPath, [entry, '--bad'], { env }).status, 1);
});

test('唯一 bin 与 MCP 品牌和版本使用同一个 package.json', () => {
  assert.equal(PACKAGE.name, 'reel-bridge');
  assert.deepEqual(Object.keys(PACKAGE.bin), ['reel-bridge']);
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } };
  const r = spawnSync(process.execPath, [entry], { env: { ...process.env, REEL_BRIDGE_ENV_FILE: '', CMS_URL: '', CMS_TOKEN: '', GYING_USER: '', GYING_PASS: '' }, input: JSON.stringify(init) + '\n', encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).result.serverInfo, { name: PACKAGE.name, version: PACKAGE.version });
});
