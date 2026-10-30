// 上游错误可能包含整页 HTML、Cookie 或登录参数。只传递已识别的原因，
// 不回显原始响应，未知原因由阶段 + code 定位，详细抓取留给本机探针。
export function upstreamFailure(message) {
  const text = typeof message === 'string' ? message : '';
  if (/重试后仍然进入机器人验证页|机器人验证出现循环/.test(text)) {
    return { code: 'GYING_POW_LOOP', reason: '浏览器验证循环，未建立有效验证会话' };
  }
  if (/机器人验证失败|PoW验证|PoW 验证/.test(text)) {
    return { code: 'GYING_POW_FAILED', reason: 'PanSou 的 PoW 验证失败；尚不能据此判断账号密码错误' };
  }
  if (/浏览器安全验证|powSolve-|pow\.worker-|\/res\/pow/.test(text)) {
    return { code: 'GYING_CHALLENGE_PAGE', reason: '目标站返回浏览器验证页，不是预期的业务响应' };
  }
  const rejected = ['密码错误', '密码不正确', '用户名或密码', '账号不存在', '账户不存在', '帐号不存在'];
  if (rejected.some(fragment => text.includes(fragment))) {
    return { code: 'GYING_CREDENTIALS_REJECTED', reason: '目标站拒绝账号或密码，请检查凭据' };
  }
  if (/超时|timeout|deadline exceeded/i.test(text)) {
    return { code: 'GYING_TIMEOUT', reason: 'Gying 请求超时；后台登录可能仍在进行，不要立即重复提交' };
  }
  if (/HTTP 401|PanSou.*认证|PanSou.*登录失败|PanSou 需要认证/.test(text)) {
    return { code: 'PANSOU_AUTH_FAILED', reason: '本地 PanSou 认证失败，不是 Gying 站点登录失败' };
  }
  if (/HTTP 403/.test(text)) {
    return { code: 'GYING_HTTP_FORBIDDEN', reason: '请求返回 HTTP 403；可能是本地权限或目标站拒绝，需结合阶段确认' };
  }
  if (/HTTP 404/.test(text)) {
    return { code: 'GYING_ROUTE_NOT_FOUND', reason: '接口返回 HTTP 404，请检查插件是否启用及镜像版本' };
  }
  if (/JSON|连接失败|网络错误|connection|ECONN|ENOTFOUND|访问登录页面失败/i.test(text)) {
    return { code: 'GYING_CONNECTION_FAILED', reason: '请求连接或响应格式异常，请检查后端网络、代理和站点' };
  }
  return { code: 'GYING_UPSTREAM_FAILED', reason: '上游未提供可安全展示的已识别原因，请检查后端响应' };
}

export function gyingError(action, message) {
  const { code, reason } = upstreamFailure(message);
  return Object.assign(new Error(`Gying ${action} 失败 [${code}]：${reason}`), {
    diagnostic: { code, reason },
  });
}
