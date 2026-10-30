import { readFileSync, mkdirSync, openSync, writeFileSync, closeSync } from 'node:fs';
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

export function configPath(env = process.env) {
  if (env.REEL_BRIDGE_ENV_FILE) return resolve(env.REEL_BRIDGE_ENV_FILE);
  const home = env.HOME || env.USERPROFILE || homedir();
  const base = env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
    ? env.XDG_CONFIG_HOME : resolve(home, '.config');
  return resolve(base, 'reel-bridge', '.env');
}

export function initConfig(env = process.env) {
  if (env.REEL_BRIDGE_ENV_FILE === '') throw new Error('REEL_BRIDGE_ENV_FILE 为空，已禁用文件配置；请取消该变量或指定路径');
  const path = configPath(env);
  const template = readFileSync(resolve(ROOT, '.env.example'), 'utf8');
  mkdirSync(resolve(path, '..'), { recursive: true, mode: 0o700 });
  let fd;
  try { fd = openSync(path, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') return { path, state: 'exists' }; throw new Error('无法创建配置文件，请检查目录权限'); }
  try { writeFileSync(fd, template); } finally { closeSync(fd); }
  return { path, state: 'created' };
}

// 不自动搜索工作目录或 npx 包目录，避免读取错误部署的凭据。
export function loadConfig(env = process.env) {
  const file = configPath(env);
  const configuration = { path: file, source: env.REEL_BRIDGE_ENV_FILE ? 'explicit' : 'user', state: 'absent', overridden_keys: [] };
  let values = {};
  if (env.REEL_BRIDGE_ENV_FILE === '') configuration.state = 'disabled';
  else {
    try { values = parseEnv(readFileSync(file, 'utf8')); configuration.state = 'loaded'; }
    catch (e) {
      if (e.code !== 'ENOENT' || env.REEL_BRIDGE_ENV_FILE) {
        const error = new Error('.env 无法读取或解析；请检查路径与权限');
        error.configuration = { ...configuration, state: 'rejected', reason: e.code === 'ENOENT' ? 'file_not_found' : 'unreadable_or_invalid' };
        throw error;
      }
    }
  }
  configuration.overridden_keys = Object.keys(values).filter(key => Object.hasOwn(env, key));
  const e = { ...values, ...env };
  try {
    return buildConfig(e, configuration);
  } catch (error) {
    error.configuration = { ...configuration, state: 'rejected', reason: error.message };
    throw error;
  }
}

function buildConfig(e, configuration) {
  const url = endpoint(e.PANSOU_URL, 'PANSOU_URL');
  const cmsUrl = endpoint(e.CMS_URL, 'CMS_URL');
  const gyingUrl = endpoint(e.GYING_URL, 'GYING_URL');
  if (gyingUrl && new URL(gyingUrl).pathname !== '/') throw new Error('GYING_URL 必须是纯站点地址');
  for (const [a, b] of [['CMS_URL', 'CMS_TOKEN'], ['GYING_USER', 'GYING_PASS'], ['PANSOU_USER', 'PANSOU_PASS']]) {
    if (Boolean(e[a]) !== Boolean(e[b])) throw new Error(a + ' 与 ' + b + ' 必须同时配置');
  }
  const port = integer(e.PANSOU_PORT, 7742, 'PANSOU_PORT', 65535);
  const dataDir = directory(e.REEL_BRIDGE_DATA_DIR || resolve(e.HOME || e.USERPROFILE || homedir(), '.reel-bridge'));
  const secretValues = [e.PANSOU_PASS, e.AUTH_JWT_SECRET, e.CMS_TOKEN, e.GYING_PASS].filter(Boolean);
  return {
    mode: url ? 'external' : 'managed', dataDir, configuration,
    pansou: { url: url || 'http://127.0.0.1:' + port, user: e.PANSOU_USER || '', pass: e.PANSOU_PASS || '', timeout: integer(e.PANSOU_TIMEOUT, 90000, 'PANSOU_TIMEOUT') },
    runtime: { port, image: e.PANSOU_IMAGE || 'ghcr.io/fish2018/pansou-web:latest', proxy: e.PROXY || '', startupTimeout: integer(e.PANSOU_STARTUP_TIMEOUT, 300000, 'PANSOU_STARTUP_TIMEOUT') },
    cms: { enabled: Boolean(cmsUrl && e.CMS_TOKEN), url: cmsUrl, token: e.CMS_TOKEN || '', timeout: integer(e.CMS_TIMEOUT, 30000, 'CMS_TIMEOUT') },
    gying: { enabled: Boolean(e.GYING_USER && e.GYING_PASS), url: gyingUrl, user: e.GYING_USER || '', pass: e.GYING_PASS || '', salt: e.GYING_HASH_SALT || 'pansou_gying_secret_2025' },
    redact: (message) => secretValues.reduce((s, value) => s.replaceAll(value, '[REDACTED]'), String(message)),
  };
}
