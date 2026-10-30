# ReelBridge · 影桥

连接媒体搜索、网盘转存与入库同步的 MCP 服务。零 npm 运行依赖，支持自动托管 PanSou 或连接已有实例。

## 使用

需要 **Node.js ≥22.16、Git**；自动托管另需 **Docker + Compose v2**。

添加到 MCP 客户端：

```json
{
  "mcpServers": {
    "reel-bridge": {
      "command": "npx",
      "args": ["-y", "github:chainlinn/ReelBridge#v0.1.2"]
    }
  }
}
```

首次搜索或校验时自动启动后端。直接在终端无参数运行会等待 MCP 请求，不是卡住；手动部署使用 `up`。

## 配置与命令

```bash
npx -y github:chainlinn/ReelBridge#v0.1.2 --init  # 生成配置，不覆盖
npx -y github:chainlinn/ReelBridge#v0.1.2 up      # 启动后端，就绪后退出
npx -y github:chainlinn/ReelBridge#v0.1.2 status  # 只检查状态
```

默认配置：`~/.config/reel-bridge/.env`（支持 `XDG_CONFIG_HOME`）。数据：`~/.reel-bridge`。模板见 [.env.example](.env.example)，修改后重连客户端。

| 可选变量 | 用途 |
|---|---|
| `PANSOU_URL` | 连接已有 PanSou，不操作 Docker |
| `PANSOU_USER` / `PANSOU_PASS` | 已有服务的认证账号 |
| `REEL_BRIDGE_ENV_FILE` | 指定 `.env` 文件绝对路径 |
| `REEL_BRIDGE_DATA_DIR` | 自定义数据目录 |
| `PANSOU_PORT` | 托管端口，默认 `127.0.0.1:7742` |
| `PROXY` | 托管后端代理 |
| `GYING_URL` / `GYING_USER` / `GYING_PASS` | 观影站点与账号 |
| `CMS_URL` / `CMS_TOKEN` | CloudMediaSync 地址与令牌 |

也可直接写入 MCP 配置的 `env`，优先于文件。基础搜索无需配置账号；CMS 和 Gying 按需启用。不要分享真实凭据。

## 工具

- `search`：搜索资源；`plugins: ["gying"]` 指定来源，首次会有限等待登录。
- `check_links`：批量校验链接。
- `status`：只读诊断，显示 Gying 初始化阶段、错误码及冷却时间，不启动或登录。
- `cms_add_share`：可选，提交转存任务。
- `cms_sync`：可选，增量同步；`auto_organize: true` 同时整理。

Gying 排错与无账号 PoW 探针见 [诊断说明](docs/gying.md)。搜索零结果不代表站点失效。

搜索不会自动转存，CMS 成功仅代表入队。退出 MCP 不停止后端。仅支持 stdio；跨机器使用请在客户端运行 MCP，并配置服务器的 `PANSOU_URL`。

## 开发

```bash
npm test
node bin/reel-bridge.mjs --help
```

无需 `npm install`。本项目为第三方集成工具，请仅处理有权访问的资源。
