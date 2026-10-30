# Gying 故障诊断

指定 `plugins:["gying"]` 的搜索最多等待初始化 30 秒；超时后任务继续，下一次调用复用同一任务。失败后 60 秒冷却，`status.gying` 返回阶段、错误码和剩余等待时间。`status` 不会主动登录。

常见错误：

| code | 含义 |
|---|---|
| `GYING_POW_FAILED` | PanSou 提交机器人验证失败，尚未进入账号密码校验 |
| `GYING_CHALLENGE_PAGE` | 上游返回验证 HTML，不是预期业务响应 |
| `GYING_CREDENTIALS_REJECTED` | 上游明确拒绝账号或密码 |
| `PANSOU_AUTH_FAILED` | 本地 PanSou 认证失败 |
| `GYING_LOCAL_STATE_FAILED` | 本地状态文件或初始化锁异常 |
| `GYING_TIMEOUT` | 网络请求超时，后端操作可能仍在执行 |

登录成功而全局搜索为零，不足以认定站点失效：可能是无匹配、缓存或 PanSou 插件发布窗口截断。ReelBridge 不会凭零结果自动重登或切换域名。

## 同容器网络验证 PoW（无账号）

官方镜像通常没有 Python。使用临时 Python 容器共享 PanSou 网络，不修改原容器。先下载本仓库的 `scripts/gying-pow-probe.py` 到当前目录，再运行：

```bash
CID=$(docker ps -q --filter label=dev.reel-bridge.owner --filter label=com.docker.compose.service=pansou)
# 确保只选中一个目标容器；不确定时先 docker ps 查看并手动填写 CID。
export GYING_URL='https://你的观影域名'
# 必须与目标 PanSou 容器一致；这里是独立探针，不会自动读取 .env。
export PROXY='http://你的代理地址:7890'
docker run --rm --network "container:$CID" \
  --env GYING_URL --env PROXY \
  -v "$PWD/gying-pow-probe.py:/probe.py:ro" \
  python:3.12-alpine python /probe.py
```

只发送首页及 `/res/pow` 的挑战/验证请求，不登录、不搜索、不转存；只输出 Cookie 名称、HTTP 状态、解算耗时和验证结果，不输出 Cookie 值或挑战数据。仅支持 HTTP(S) 代理；不支持 SOCKS 时会报错而不是偷偷直连。

探针成功但 PanSou 失败，应继续对比同一出口下 cloudscraper 的 Cookie、请求头和 PoW 提交响应；不能直接认定需要浏览器，也不应自动把探针 Cookie 注入生产会话。本机两种架构的隔离镜像均曾全新登录成功，不代表所有出口都可用。

## PanSou 可选诊断补丁

`patches/pansou-gying-diagnostics.patch` 基于上游 `221665fb2c9279f22af4684ea2d8c0c331eac1cc`。这是诊断补丁，不改变算法、等待时间或代理策略，不等于已修复所有出口的 PoW 问题。

在独立 PanSou 源码副本中先执行 `git apply --check <补丁路径>`，确认兼容后 `git apply <补丁路径>`，然后构建后端二进制。使用 `go test ./plugin/gying -run 'TestPowResponseSummary|TestPowCookieSummary'` 验证。完整文件及关联修改都在补丁中，需保留 PanSou 的许可证。

将编译产物覆盖到测试镜像的 `/app/pansou`，并在派生镜像中设置 `ENV GYING_DIAGNOSTICS=true`（或显式传入容器 environment；仅写入 ReelBridge 的 .env 不会透传此变量）。先隔离部署，再通过 `PANSOU_IMAGE` 使用经过验证的镜像，不直接替换生产镜像。

日志形如：

```text
[Gying PoW] compute_ms=761 submit_elapsed_ms=761
[Gying PoW] before_cookies=browser_pow proxy=true
[Gying PoW] http=200 json=true success=true fields=success,challenge_id category=unspecified set_cookie_names=browser_pow,browser_verified
```

只记录固定字段名、类型、类别和 Cookie 名称。不会写入完整上游响应、Cookie 值、挑战 ID、账号密码或代理地址。不建议打开原有 `DebugLog`，因为其历史调试日志可能输出会话数据。此补丁已在本机 Go 容器编译、单元测试及派生镜像全新登录验证通过，远程拒绝的原因仍需远程日志确认。
