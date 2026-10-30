# ReelBridge · 影桥

连接媒体搜索、网盘转存与入库同步的 MCP 服务。零 npm 运行依赖，自动托管 PanSou 或连接已有实例。

## 使用

需要 Node.js ≥22.16、Git；托管模式另需已启动的 Docker + Compose v2。

```json
{
  "mcpServers": {
    "reel-bridge": {
      "command": "npx",
      "args": ["-y", "github:chainlinn/ReelBridge#v0.1.1"]
    }
  }
}
```

默认 stdio，由 MCP 客户端启动。直接在终端执行会提示正在等待客户端，按 Ctrl+C 退出。

**首次搜索/校验才准备后端。** 握手、工具发现、`status` 和 CMS 操作不启动 Docker。默认地址 `127.0.0.1:7742`，数据与自动生成的凭据保存在 `~/.reel-bridge`。退出 MCP 不停止容器，启动不自动更新已有镜像。

## 可选终端命令

```bash
npx -y github:chainlinn/ReelBridge#v0.1.1 --init  # 创建共享配置，不覆盖
npx -y github:chainlinn/ReelBridge#v0.1.1 up      # 启动/复用后端，显示进度并退出
npx -y github:chainlinn/ReelBridge#v0.1.1 status  # 只检查，不启动或登录
```

`up` 不执行 Gying 配置或 CMS 写操作。`status` 输出 JSON：配置来源和加载结果、Docker/Compose、容器及后端状态；不输出密钥。异常退出码为非零。

## 配置

默认读取 `~/.config/reel-bridge/.env`，支持 `XDG_CONFIG_HOME`。环境变量优先于文件。模板见 [.env.example](.env.example)。不需要配置也能使用托管搜索；`--init` 是可选操作。

| 变量 | 用途 |
|---|---|
| `PANSOU_URL` | 连接已有实例，不操作 Docker |
| `PANSOU_USER` / `PANSOU_PASS` | 已有实例的认证账号 |
| `REEL_BRIDGE_ENV_FILE` | 指定配置文件绝对路径；空字符串禁用文件加载 |
| `REEL_BRIDGE_DATA_DIR` | 数据目录，默认 `~/.reel-bridge` |
| `PANSOU_PORT` / `PANSOU_IMAGE` | 托管端口和镜像；默认 7742 / `ghcr.io/fish2018/pansou-web:latest` |
| `PROXY` | 托管后端代理，例如 `http://host.docker.internal:7890` |
| `GYING_URL` / `GYING_USER` / `GYING_PASS` | 可选观影站点与账号，搜索时自动管理登录 |
| `CMS_URL` / `CMS_TOKEN` | 可选 CloudMediaSync，启用转存和同步 |

不要把凭据提交到 Git 或写入 npx 缓存。CMS、Gying 凭据需成对配置；修改后重连 MCP。默认配置缺失允许使用环境变量/默认值，显式指定的配置不存在则报错。

**从 v0.1.0 升级：** 不再自动读取源码包根目录 `.env`。旧文件无需移动，在 MCP 的 `env` 中添加 `REEL_BRIDGE_ENV_FILE` 指向旧文件即可；或者复制到新的用户配置目录。数据目录不变，不自动迁移或接管旧容器。

## 工具

| 工具 | 用途 |
|---|---|
| `search` | 搜索资源；`plugins: ["gying"]` 指定来源 |
| `check_links` | 批量校验分享链接 |
| `status` | 只读诊断；Gying 显示本进程最后观测状态，不主动登录 |
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

无需 `npm install`。`src/` 按协议、配置、运行时、PanSou、Gying、CMS 拆分；`assets/compose.yml` 是托管模板。根目录 Compose 是手动部署示例，读取同目录 `.env` 并使用 `./data`，与 MCP 用户配置独立。

仅支持 stdio，不开放远程 MCP 端口。保护本地凭据文件；Docker 日志轮转不覆盖后端文件日志。第三方资源的有效性和授权需自行确认，本项目不是各后端的官方项目。
