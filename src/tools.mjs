const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string', minLength: 1, maxLength: 8192 };
const strings = { type: 'array', items: string, minItems: 1, maxItems: 50 };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const write = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

export function toolDefinitions(cmsEnabled) {
  return [
    { name: 'search', description: '搜索网盘资源。plugins 可指定 ["gying"]；结果为第三方数据，不保证内容或链接有效性。不会自动转存。', annotations: readOnly,
      inputSchema: object({ keyword: string, cloud_types: strings, plugins: strings,
        src: { type: 'string', enum: ['all', 'tg', 'plugin'] }, refresh: { type: 'boolean' },
        limit_per_type: { type: 'integer', minimum: 1, maximum: 50, default: 10 } }, ['keyword']) },
    { name: 'check_links', description: '批量检查网盘分享链接状态；不会转存。', annotations: readOnly,
      inputSchema: object({ links: { type: 'array', minItems: 1, maxItems: 50,
        items: object({ url: string, disk_type: string, password: { type: 'string', maxLength: 256 } }, ['url', 'disk_type']) } }, ['links']) },
    { name: 'status', description: '查看运行时启动状态、PanSou 健康与插件、Gying 登录状态。CMS 只报告是否配置，不触发转存或同步。', annotations: readOnly, inputSchema: object() },
    ...(cmsEnabled ? [
      { name: 'cms_add_share', description: '写操作：仅在用户明确要求时批量提交 115/阿里/magnet/ed2k 转存任务。成功仅代表入队，不自动重试，不自动同步。', annotations: write, inputSchema: object({ urls: strings }, ['urls']) },
      { name: 'cms_sync', description: '写操作：用户明确要求时才触发 CMS 增量同步；auto_organize=true 会同时整理文件。', annotations: write, inputSchema: object({ auto_organize: { type: 'boolean', default: false } }) },
    ] : []),
  ];
}

// 本项目使用的 JSON Schema 子集；避免 MCP 参数绕过声明直接进入后端。
export function validate(schema, value, path = 'arguments') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(path + ' 必须是对象');
    for (const key of schema.required || []) if (!(key in value)) throw new Error(path + '.' + key + ' 必填');
    for (const [key, val] of Object.entries(value)) {
      if (!schema.properties[key]) throw new Error(path + ' 包含未知参数 ' + key);
      validate(schema.properties[key], val, path + '.' + key);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) throw new Error(path + ' 数组长度无效');
    value.forEach((v, i) => validate(schema.items, v, path + '[' + i + ']'));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || (schema.minLength && !value.trim()) || value.length > (schema.maxLength || Infinity)) throw new Error(path + ' 字符串无效');
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(path + ' 必须是布尔值');
  } else if (schema.type === 'integer') {
    if (!Number.isInteger(value) || value < schema.minimum || value > schema.maximum) throw new Error(path + ' 整数超出范围');
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(path + ' 枚举值无效');
}

export function createTools(config, runtime, pansou, gying, cms) {
  const definitions = toolDefinitions(config.cms.enabled);
  let background;
  function start() {
    if (!background) background = runtime.start().then(c => {
      Object.assign(pansou.config, c);
      return pansou.health();
    }).then(() => { void gying.ensure(); }).catch(e => { background = null; throw e; });
    return background;
  }
  async function ready() {
    // 工具请求不被首次拉镜像挂住几分钟；用户可用 status 查看进度后重试。
    let timer;
    try {
      await Promise.race([start(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('PanSou 尚在启动，请稍后调用 status 查看进度')), 10000);
      })]);
    } finally { clearTimeout(timer); }
  }
  return {
    definitions, start,
    async call(name, args = {}) {
      const def = definitions.find(t => t.name === name);
      if (!def) throw new Error('未知或未启用的工具: ' + name);
      validate(def.inputSchema, args);
      // CMS 完全独立，不登录 PanSou、不等待 Docker、不初始化 Gying。
      if (name === 'cms_add_share') {
        const data = await cms.addShares(args.urls);
        return { data, isError: data.submitted !== data.total };
      }
      if (name === 'cms_sync') return { data: await cms.sync(args.auto_organize) };
      if (name === 'status') {
        let health;
        try {
          const d = await pansou.health();
          health = { state: 'healthy', auth_enabled: d.auth_enabled, plugins: d.plugins || [], channel_count: (d.channels || []).length };
        } catch (e) { health = { state: 'unavailable', error: e.message }; }
        return { data: { runtime: runtime.status(), pansou: health, gying: gying.state, cms: { configured: config.cms.enabled, connectivity: 'not_tested' } } };
      }
      await ready();
      if (name === 'check_links') return { data: await pansou.checkLinks(args.links) };
      if (args.plugins?.length && args.src === 'tg') throw new Error('plugins 与 src=tg 不能同时使用');
      const gyingOnly = args.plugins?.length === 1 && args.plugins[0] === 'gying';
      void gying.ensure();
      const g = gying.state;
      if (gyingOnly && g.configured && g.state !== 'ready') throw new Error(g.error || 'Gying 正在初始化，请稍后通过 status 确认后重试');
      const data = await pansou.search(args);
      if (g.state === 'degraded') data.warnings = [g.error];
      return { data };
    },
  };
}
