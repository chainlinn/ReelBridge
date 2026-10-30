import { requestJSON } from './http.mjs';
import { gyingError } from './diagnostics.mjs';

export class PanSou {
  constructor(config, request = requestJSON) { this.config = config; this.request = request; this.token = ''; }
  async login() {
    if (!this.config.user || !this.config.pass) throw new Error('PanSou 需要认证，请配置 PANSOU_USER/PANSOU_PASS');
    if (!this.loginPromise) {
      this.loginPromise = (async () => {
        const r = await this.request(this.config.url + '/api/auth/login', {
          method: 'POST', body: { username: this.config.user, password: this.config.pass }, timeout: this.config.timeout,
        });
        if (!r.ok || !r.data?.token) throw new Error('PanSou 登录失败，请检查凭据');
        this.token = r.data.token;
      })().finally(() => { this.loginPromise = null; });
    }
    return this.loginPromise;
  }
  async api(path, body) {
    const usedToken = this.token;
    const send = () => this.request(this.config.url + path, {
      method: body === undefined ? 'GET' : 'POST', body, timeout: this.config.timeout,
      headers: this.token ? { Authorization: 'Bearer ' + this.token } : {},
    });
    let r = await send();
    if (r.status === 401) {
      if (!this.token || this.token === usedToken) await this.login();
      r = await send(); // 仅重试被拒绝的认证请求，不重试网络/业务失败。
    }
    if (!r.ok) throw new Error('PanSou HTTP ' + r.status);
    if (r.data?.code !== undefined && !['0', '200'].includes(String(r.data.code))) throw new Error('PanSou 业务错误 code=' + r.data.code);
    return r.data;
  }
  async health() {
    const r = await this.request(this.config.url + '/api/health', { timeout: 3000 });
    if (!r.ok || r.data?.status !== 'ok') throw new Error('PanSou 健康检查未通过');
    return r.data;
  }
  async search(args) {
    const body = { kw: args.keyword.trim(), res: 'merge', src: args.src || (args.plugins?.length ? 'plugin' : 'all'), refresh: args.refresh || false };
    for (const key of ['cloud_types', 'plugins']) if (args[key]?.length) body[key] = args[key];
    const r = await this.api('/api/search', body);
    const data = r.data ?? r;
    const merged = data.merged_by_type || {};
    const counts = Object.fromEntries(Object.entries(merged).map(([type, links]) => [type, links.length]));
    return {
      total: data.total || 0, counts,
      merged_by_type: Object.fromEntries(Object.entries(merged).map(([type, links]) => [type, links.slice(0, args.limit_per_type ?? 10)])),
      note: '结果可能来自缓存或异步部分结果；链接标题、集数与内容未经核实。',
    };
  }
  async checkLinks(links) {
    const r = await this.api('/api/check/links', { items: links });
    return r.data ?? r;
  }
  async gying(hash, action, extra = {}) {
    const r = await this.api('/gying/' + hash, { action, ...extra });
    if (r?.success !== true) throw gyingError(action, r?.message || r?.msg);
    return r.data || {};
  }
}
