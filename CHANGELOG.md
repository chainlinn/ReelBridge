# Changelog

## 0.1.1

- 新增 `--init`、`up` 和只读 `status` 命令。
- 默认读取用户配置目录，支持 XDG；初始化不覆盖已有配置。
- 终端无参数运行时提示 stdio 用途，不再无说明等待。
- 仅搜索/校验按需准备后端；握手、工具发现、状态及 CMS 不触发部署。
- 诊断显示配置来源、Docker/Compose 与后端状态，不输出凭据。
- 升级需用 `REEL_BRIDGE_ENV_FILE` 显式引用旧源码目录 `.env`，数据目录不变。

## 0.1.0

首个公开版本：ReelBridge · 影桥。

- GitHub 直装：`npx -y github:chainlinn/ReelBridge#v0.1.0`。
- 自动托管或连接已有 PanSou，独立数据目录与持久凭据。
- `search`、`check_links`、`status`；可选 CMS 转存与同步。
- Gying 会话自动复用，失败降级不影响其他来源。
- 零 npm 运行依赖，模块化实现与自动化测试。

需要 Node.js ≥22.16、Git；托管模式需要 Docker + Compose v2。
