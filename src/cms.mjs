import { requestJSON } from './http.mjs';

export function shareType(value) {
  if (value.toLowerCase().startsWith('magnet:?xt=urn:btih:')) return 'magnet';
  if (value.toLowerCase().startsWith('ed2k://|file|')) return 'ed2k';
  let u;
  try { u = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !u.pathname.startsWith('/s/')) return null;
  const host = u.hostname.toLowerCase();
  const matches = (domain) => host === domain || host.endsWith('.' + domain);
  if (matches('115.com') || matches('115cdn.com')) return '115';
  if (matches('alipan.com') || matches('aliyundrive.com')) return 'aliyun';
  return null;
}

export class CMS {
  constructor(config, request = requestJSON) { this.config = config; this.request = request; }
  async api(path, body) {
    if (!this.config.enabled) throw new Error('CMS 未配置');
    const r = await this.request(this.config.url + path, { method: body === undefined ? 'GET' : 'POST', body, timeout: this.config.timeout });
    if (!r.ok || String(r.data?.code) !== '200') throw new Error('CMS 请求被拒绝，HTTP ' + r.status + '；请检查 token 与服务配置');
    return { accepted: true }; // 不回显上游消息，避免意外泄漏令牌。
  }
  async addShares(urls) {
    const unique = [...new Set(urls.map(u => u.trim()))];
    if (unique.some(u => !shareType(u))) throw new Error('仅支持 115/阿里分享、magnet 和 ed2k；本批未提交');
    const results = [];
    for (const url of unique) {
      try {
        await this.api('/api/cloud/add_share_down_by_token', { url, token: this.config.token });
        results.push({ url, accepted: true });
      } catch (e) { results.push({ url, accepted: false, error: e.message }); }
    }
    return { submitted: results.filter(r => r.accepted).length, total: unique.length, results, note: '仅代表入队，不代表转存完成。超时或连接中断时不要盲目重试，以免重复提交。' };
  }
  async sync(autoOrganize = false) {
    const type = autoOrganize ? 'auto_organize' : 'lift_sync';
    const query = new URLSearchParams({ type, token: this.config.token });
    await this.api('/api/sync/lift_by_token?' + query);
    return { accepted: true, type, note: '同步任务已提交，未等待完成。' };
  }
}
