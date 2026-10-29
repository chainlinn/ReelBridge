// 超时涵盖响应头和响应体；不跟随重定向，避免把凭据 POST 到另一站点。
export async function requestJSON(url, { method = 'GET', body, headers = {}, timeout = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      method, redirect: 'error', signal: controller.signal,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); }
    catch { throw new Error('服务返回非 JSON，HTTP ' + res.status); }
    return { status: res.status, ok: res.ok, data };
  } catch (e) {
    if (controller.signal.aborted) throw new Error('请求超时；写操作可能已提交，请核实后再试');
    // 不返回 URL、响应正文或 fetch cause（可能含 token）。
    if (e.message.startsWith('服务返回')) throw e;
    throw new Error('HTTP 连接失败，请检查服务地址、网络或重定向配置');
  } finally { clearTimeout(timer); }
}
