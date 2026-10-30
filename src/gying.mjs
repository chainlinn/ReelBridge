import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { withLock, readJSON, saveJSON } from './runtime.mjs';
import { upstreamFailure } from './diagnostics.mjs';

export class Gying {
  constructor(config, pansou, stateDir) {
    this.config = config; this.pansou = pansou;
    this.hash = createHash('sha256').update(config.user + config.salt).digest('hex');
    // 站点配置是后端全局的，账号分别存状态，但共享初始化锁。
    const instance = createHash('sha256').update(pansou.config.url).digest('hex').slice(0, 24);
    this.directory = resolve(stateDir, 'gying', instance);
    this.state = { configured: config.enabled, state: config.enabled ? 'pending' : 'disabled' };
  }
  snapshot() {
    return { ...this.state, ...(this.state.state === 'degraded'
      ? { retry_after_ms: Math.max(0, (this.nextCheck || 0) - Date.now()) } : {}) };
  }
  ensure() {
    if (!this.config.enabled) return Promise.resolve(this.snapshot());
    if (this.promise) return this.promise;
    if (Date.now() < (this.nextCheck || 0)) return Promise.resolve(this.snapshot());
    const started = Date.now();
    this.state = { configured: true, state: 'initializing', stage: 'lock', started_at: new Date(started).toISOString() };
    this.promise = this.initialize().catch(error => {
      const stage = this.state.stage;
      const d = error.diagnostic || (['read_state', 'save_state', 'lock'].includes(stage)
        ? { code: 'GYING_LOCAL_STATE_FAILED', reason: '本地状态或初始化锁异常；请检查数据目录权限及已有进程' }
        : upstreamFailure(error.message));
      this.nextCheck = Date.now() + 60000;
      this.state = { configured: true, state: 'degraded', stage, code: d.code,
        error: `Gying 初始化失败，阶段=${stage} [${d.code}]：${d.reason}`,
        checked_at: new Date().toISOString(), elapsed_ms: Date.now() - started };
      return this.snapshot();
    }).finally(() => { this.promise = null; });
    return this.promise;
  }
  async waitUntilReady(timeout = 30000) {
    let timer;
    try {
      return await Promise.race([this.ensure(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          `Gying 初始化仍在进行，阶段=${this.state.stage}；可调用 status 查看，同一进程不会重复提交登录`
        )), timeout);
      })]);
    } finally { clearTimeout(timer); }
  }
  async initialize() {
    return withLock(this.directory, async () => {
      const c = this.config;
      const api = (action, extra) => {
        this.state.stage = action;
        return this.pansou.gying(this.hash, action, extra);
      };
      const current = await api('get_config');
      const desired = c.url || current.base_url;
      const siteChanged = Boolean(c.url && c.url !== String(current.base_url || '').replace(/\/+$/, ''));
      if (siteChanged) await api('update_config', { base_url: c.url });
      this.state.stage = 'read_state';
      const path = resolve(this.directory, this.hash + '.json');
      const old = await readJSON(path);
      const fingerprint = createHash('sha256').update(JSON.stringify([desired, c.user, c.pass])).digest('hex');
      let status = await api('get_status');
      if (siteChanged || !status.logged_in || status.status !== 'active' || (old && old.fingerprint !== fingerprint)) {
        await api('login', { username: c.user, password: c.pass });
        status = await api('get_status');
      }
      if (!status.logged_in || status.status !== 'active') {
        throw Object.assign(new Error('Gying 登录后状态仍未激活'), {
          diagnostic: { code: 'GYING_SESSION_INACTIVE', reason: '登录请求后会话未激活；请检查后端状态' },
        });
      }
      this.state.stage = 'save_state';
      await saveJSON(path, { fingerprint });
      this.state = { configured: true, state: 'ready', stage: 'ready', logged_in: true, site: desired,
        expires_in_days: status.expires_in_days, checked_at: new Date().toISOString() };
      this.nextCheck = Date.now() + 60000;
      return this.snapshot();
    }, 180000);
  }
}
