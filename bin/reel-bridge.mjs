#!/usr/bin/env node
import { PACKAGE } from '../src/package.mjs';

const args = process.argv.slice(2);
if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
  console.log(PACKAGE.version);
} else if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(`ReelBridge 影桥 ${PACKAGE.version}

Usage:
  npx -y github:chainlinn/ReelBridge#v${PACKAGE.version}
  reel-bridge [--help | --version]

Default: MCP stdio server; waits for requests from an MCP client.
A terminal launch alone does not initialize Docker or open a web UI.

Requirements: Node >=22.16; managed mode needs running Docker + Compose v2.
Configuration: MCP env or REEL_BRIDGE_ENV_FILE=/absolute/path/.env
Data directory: REEL_BRIDGE_DATA_DIR (default ~/.reel-bridge)
Set PANSOU_URL to connect an existing backend without managing Docker.
Read README for optional GYING_* and CMS_* settings.
`);
} else if (args.length) {
  process.stderr.write('[reel-bridge] 未知参数，请使用 --help\n');
  process.exitCode = 1;
} else {
  import('../src/main.mjs').then(({ main }) => main()).catch(() => {
    process.stderr.write('[reel-bridge] 启动失败，请检查配置文件与 Node 版本（需要 >=22.16）\n');
    process.exitCode = 1;
  });
}
