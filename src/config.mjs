import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { homedir } from 'node:os';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

function endpoint(value, name) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error(name + ' 必须是 HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(name + ' 不允许 URL 凭据、查询参数或锚点');
  }
  return url.href.replace(/\/+$/, '');
}
function integer(value, fallback, name, max = 900000) {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(name + ' 超出有效范围');
  return n;
}
function directory(value) {
  const expanded = value.startsWith('~/') ? resolve(homedir(), value.slice(2)) : value;
  if (!isAbsolute(expanded)) throw new Error('REEL_BRIDGE_DATA_DIR 必须是绝对路径（也支持 ~/）');
  return resolve(expanded);
}

// 不修改 process.env；真实环境变量优先，显式指定但不存在的 env 文件应报错。
export function loadConfig(env = process.env) {
  const file = env.REEL_BRIDGE_ENV_FILE ? resolve(env.REEL_BRIDGE_ENV_FILE) : resolve(ROOT, '.env');
  let values = {};
  if (env.REEL_BRIDGE_ENV_FILE !== '') {
    try { values = parseEnv(readFileSync(file, 'utf8')); }
    catch (e) { if (env.REEL_BRIDGE_ENV_FILE || e.code !== 'ENOENT') throw new Error('.env 无法读取或解析'); }
  }
  const e = { ...values, ...env };
  const url = endpoint(e.PANSOU_URL, 'PANSOU_URL');
  const cmsUrl = endpoint(e.CMS_URL, 'CMS_URL');
  const gyingUrl = endpoint(e.GYING_URL, 'GYING_URL');
  if (gyingUrl && new URL(gyingUrl).pathname !== '/') throw new Error('GYING_URL 必须是纯站点地址');
  for (const [a, b] of [['CMS_URL', 'CMS_TOKEN'], ['GYING_USER', 'GYING_PASS'], ['PANSOU_USER', 'PANSOU_PASS']]) {
    if (Boolean(e[a]) !== Boolean(e[b])) throw new Error(a + ' 与 ' + b + ' 必须同时配置');
  }
  const port = integer(e.PANSOU_PORT, 7742, 'PANSOU_PORT', 65535);
  const dataDir = directory(e.REEL_BRIDGE_DATA_DIR || resolve(homedir(), '.reel-bridge'));
  const secretValues = [e.PANSOU_PASS, e.AUTH_JWT_SECRET, e.CMS_TOKEN, e.GYING_PASS].filter(Boolean);
  return {
    mode: url ? 'external' : 'managed', dataDir,
    pansou: { url: url || 'http://127.0.0.1:' + port, user: e.PANSOU_USER || '', pass: e.PANSOU_PASS || '', timeout: integer(e.PANSOU_TIMEOUT, 90000, 'PANSOU_TIMEOUT') },
    runtime: { port, image: e.PANSOU_IMAGE || 'ghcr.io/fish2018/pansou-web:latest', proxy: e.PROXY || '', startupTimeout: integer(e.PANSOU_STARTUP_TIMEOUT, 300000, 'PANSOU_STARTUP_TIMEOUT') },
    cms: { enabled: Boolean(cmsUrl && e.CMS_TOKEN), url: cmsUrl, token: e.CMS_TOKEN || '', timeout: integer(e.CMS_TIMEOUT, 30000, 'CMS_TIMEOUT') },
    gying: { enabled: Boolean(e.GYING_USER && e.GYING_PASS), url: gyingUrl, user: e.GYING_USER || '', pass: e.GYING_PASS || '', salt: e.GYING_HASH_SALT || 'pansou_gying_secret_2025' },
    redact: (message) => secretValues.reduce((s, value) => s.replaceAll(value, '[REDACTED]'), String(message)),
  };
}
