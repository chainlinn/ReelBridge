#!/usr/bin/env node
import { PACKAGE } from '../src/package.mjs';

const args = process.argv.slice(2);
async function cli() {
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
    console.log(PACKAGE.version);
    return;
  }
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(`ReelBridge 影桥 ${PACKAGE.version}

Usage: reel-bridge [--init | up | status | --help | --version]
  --init   创建用户配置模板，不覆盖已有文件
  up       启动/复用 PanSou，等待就绪后退出
  status   只检查配置、Docker 与后端状态，不启动服务
  无参数   MCP stdio，由客户端启动；首次搜索/校验才准备后端

Configuration: ~/.config/reel-bridge/.env (支持 XDG_CONFIG_HOME)
Override: REEL_BRIDGE_ENV_FILE=/absolute/path/.env
Data: REEL_BRIDGE_DATA_DIR (default ~/.reel-bridge)
Set PANSOU_URL to connect an existing backend without Docker management.
Requires Node >=22.16; managed mode needs running Docker + Compose v2.`);
    return;
  }
  if (args.length > 1 || (args.length && !['--init', 'up', 'status'].includes(args[0]))) {
    throw new Error('未知参数，请使用 --help');
  }
  if (!args.length) {
    if (process.stdin.isTTY) {
      process.stderr.write('[reel-bridge] 正在等待 MCP 客户端连接。部署后端请用 up，创建配置请用 --init；按 Ctrl+C 退出。\n');
    }
    const { main } = await import('../src/main.mjs');
    await main();
    return;
  }
  const { initConfig, loadConfig } = await import('../src/config.mjs');
  if (args[0] === '--init') {
    const result = initConfig();
    console.log((result.state === 'created' ? '已创建配置模板：' : '配置已存在，未覆盖：') + result.path);
    return;
  }
  let config;
  try { config = loadConfig(); }
  catch (e) {
    if (args[0] !== 'status') throw e;
    console.log(JSON.stringify({ configuration: e.configuration || { state: 'rejected' }, error: e.message, hint: '检查配置路径与成对凭据；需要模板可运行 --init' }, null, 2));
    process.exitCode = 1;
    return;
  }
  const { createApp } = await import('../src/main.mjs');
  const log = message => process.stderr.write('[reel-bridge] ' + config.redact(message) + '\n');
  const app = createApp(config, log);
  if (args[0] === 'status') {
    const { data } = await app.tools.call('status');
    console.log(config.redact(JSON.stringify(data, null, 2)));
    if (data.pansou.state !== 'healthy' || data.runtime.docker === 'unavailable') process.exitCode = 1;
    return;
  }
  // 仅准备后端；不触发 Gying 站点修改、CMS 转存或同步。
  Object.assign(app.pansou.config, await app.runtime.start());
  await app.pansou.health();
  console.log(config.redact(JSON.stringify({ state: 'ready', mode: config.mode, url: config.pansou.url, configuration: config.configuration, runtime: app.runtime.status() }, null, 2)));
}
cli().catch(e => {
  // 配置及运行时错误消息不回显凭据或上游响应。
  process.stderr.write('[reel-bridge] ' + e.message + '\n');
  process.exitCode = 1;
});
