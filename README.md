# ReelBridge · 影桥

连接媒体搜索、网盘转存与入库同步的 MCP 服务。零 npm 运行依赖，支持自动启动 PanSou，也可连接已有实例。

## 使用

需要 Node.js ≥22.16、Git；自动部署另需已启动的 Docker + Compose v2。

```bash
npx -y github:chainlinn/ReelBridge#v0.1.0
```

这是 MCP stdio 服务，终端运行会等待协议输入。通常由客户端启动：

```json
{
  "mcpServers": {
    "reel-bridge": {
      "command": "npx",
      "args": ["-y", "github:chainlinn/ReelBridge#v0.1.0"]
    }
  }
}
```

首次连接自动启动 PanSou，默认 `127.0.0.1:7742`；凭据和数据保存在 `~/.reel-bridge`。启动中可用 `status` 查看进度。退出 MCP 不停止容器，启动不自动更新已有镜像。

验证安装（不启动 Docker）：

```bash
npx -y github:chainlinn/ReelBridge#v0.1.0 --version
```

## 可选配置

在 MCP 的 `env` 中设置，或通过 `REEL_BRIDGE_ENV_FILE` 指定 `.env` 的绝对路径。模板见 [.env.example](.env.example)。真实环境变量优先；修改后重连 MCP。

| 变量 | 用途 |
|---|---|
| `PANSOU_URL` | 连接已有实例，不操作 Docker |
| `PANSOU_USER` / `PANSOU_PASS` | 已有实例的认证账号 |
| `REEL_BRIDGE_ENV_FILE` | 独立配置文件；空字符串禁用自动加载 |
| `REEL_BRIDGE_DATA_DIR` | 状态目录，默认 `~/.reel-bridge` |
| `PANSOU_PORT` / `PANSOU_IMAGE` | 托管端口和镜像；默认 7742 / `ghcr.io/fish2018/pansou-web:latest` |
| `PROXY` | 托管后端代理，例如 `http://host.docker.internal:7890` |
| `GYING_URL` / `GYING_USER` / `GYING_PASS` | 可选观影站点与账号，自动管理登录 |
| `CMS_URL` / `CMS_TOKEN` | 可选 CloudMediaSync 服务，启用转存和同步 |

不要把真实凭据提交到 Git，或保存在 npx 缓存目录。源码运行默认读取仓库根目录 `.env`。CMS 和 Gying 的凭据需成对配置，详见模板。

## 工具

| 工具 | 用途 |
|---|---|
| `search` | 搜索资源；可用 `plugins: ["gying"]` 指定来源 |
| `check_links` | 批量校验分享链接 |
| `status` | 查看启动状态、PanSou 健康及 Gying 登录状态 |
| `cms_add_share` | 可选：提交 115、阿里、magnet、ed2k 转存任务 |
| `cms_sync` | 可选：增量同步；`auto_organize: true` 同时整理 |

**搜索不自动转存，启动不自动同步。** CMS 成功仅代表入队，超时后不要盲目重试。尚未提供独立 Emby API 工具，入库通知请在 CMS 配置。

## 开发

```bash
git clone https://github.com/chainlinn/ReelBridge.git
cd ReelBridge
npm test
node bin/reel-bridge.mjs --help
npm pack --dry-run
```

无需 `npm install`。`src/` 按协议、配置、运行时、PanSou、Gying、CMS 拆分；`assets/compose.yml` 是托管模板。根目录 Compose 是手动部署示例，使用 `./data`。

旧原型迁移：入口改为 `bin/reel-bridge.mjs`；`PANSOU_ENV_FILE` / `PANSOU_DATA_DIR` 改为 `REEL_BRIDGE_ENV_FILE` / `REEL_BRIDGE_DATA_DIR`。已有 PanSou 用 `PANSOU_URL` 连接，不自动迁移或接管旧容器。

仅支持 stdio MCP，不开放远程 MCP 端口。保护本地凭据文件；Docker 日志轮转不覆盖后端文件日志。第三方资源的有效性和授权需自行确认，本项目不是各后端的官方项目。
