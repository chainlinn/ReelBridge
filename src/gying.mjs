import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { withLock, readJSON, saveJSON } from './runtime.mjs';

export class Gying {
  constructor(config, pansou, stateDir) {
    this.config = config; this.pansou = pansou;
    this.hash = createHash('sha256').update(config.user + config.salt).digest('hex');
    const instance = createHash('sha256').update(pansou.config.url + this.hash).digest('hex').slice(0, 24);
    this.directory = resolve(stateDir, 'gying', instance);
    this.state = { configured: config.enabled, state: config.enabled ? 'pending' : 'disabled' };
  }
  ensure() {
    if (!this.config.enabled) return Promise.resolve(this.state);
    if (this.promise) return this.promise;
    if (Date.now() < (this.nextCheck || 0)) return Promise.resolve(this.state);
    this.promise = this.initialize().catch(() => {
      this.state = { configured: true, state: 'degraded', error: 'Gying 初始化失败；其他搜索源仍可用，请检查站点、凭据和后端日志' };
      this.nextCheck = Date.now() + 60000;
      return this.state;
    }).finally(() => { this.promise = null; });
    return this.promise;
  }
  async initialize() {
    return withLock(this.directory, async () => {
      const c = this.config;
      const api = (action, extra) => this.pansou.gying(this.hash, action, extra);
      const current = await api('get_config');
      const desired = c.url || current.base_url;
      const siteChanged = Boolean(c.url && c.url !== String(current.base_url || '').replace(/\/+$/, ''));
      if (siteChanged) await api('update_config', { base_url: c.url });
      const path = resolve(this.directory, 'state.json');
      const old = await readJSON(path);
      const fingerprint = createHash('sha256').update(JSON.stringify([desired, c.user, c.pass])).digest('hex');
      let status = await api('get_status');
      // 第一次接入已有有效会话时复用；之后凭据改变或失效才重新登录。
      if (siteChanged || !status.logged_in || status.status !== 'active' || (old && old.fingerprint !== fingerprint)) {
        await api('login', { username: c.user, password: c.pass });
        status = await api('get_status');
      }
      if (!status.logged_in || status.status !== 'active') throw new Error('Gying 未登录');
      await saveJSON(path, { fingerprint });
      this.state = { configured: true, state: 'ready', logged_in: true, site: desired, expires_in_days: status.expires_in_days };
      this.nextCheck = Date.now() + 60000;
      return this.state;
    }, 180000);
  }
}
