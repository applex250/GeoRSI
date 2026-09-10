# GeoRSI Docker 部署指南

## 1. 架构说明

| 层 | 内容 |
|---|---|
| 镜像 | `node:22-bookworm-slim` + Python 3.11 + 科研栈 (numpy/scipy/pandas/sklearn/matplotlib/statsmodels/openai) |
| 容器 | 单服务 `georsi-lab`，`restart: unless-stopped`，`tini` 负责信号转发 |
| 隔离 | 容器内强制 `host-audit` (Linux 无 Sandboxie)，`execution_backend` 已在 compose 中设为 `host-audit` |
| 持久化 | `./runs`, `./knowledge`, `./rag` 绑定挂载；`config.json`/`config/` 热挂载 |

> Windows 原生 Sandboxie 仅在宿主机裸跑时生效；Docker 部署无需也无法使用 Sandboxie。

## 2. 前置要求

- Docker Desktop 4.x+ (Windows 需启用 WSL2 backend) 或 Docker Engine 24+
- `docker compose` v2.20+
- API Key (按 `config.json` 选择的模型):
  - `RSILAB_API_KEY` (zen: hy3/mimo)
  - `RSILAB_OR_KEY` (openrouter: z-ai/glm-5.3-flash)
  - `GEORSI_RESEARCH_API_KEY` (research Luna)
  - 见 `.env.example` 完整列表

## 3. 首次部署

```powershell
# Windows PowerShell (推荐)
copy .env.example .env
# 编辑 .env 填入真实 Key
notepad .env

# 一键构建+启动
.\deploy.ps1

# 或 CMD 双击
deploy.cmd

# 查看日志
docker compose logs -f georsi

# 验证 (无 LLM，纯本地)
docker compose run --rm georsi npx tsx src/run.ts selftest
```

```bash
# Linux / macOS / Git Bash
cp .env.example .env
nano .env
chmod +x deploy.sh
./deploy.sh
```

## 4. 一键更新 (核心需求)

> 每次更改代码后，运行一次脚本即可自动重建镜像并重启容器。

### Windows

```powershell
.\deploy.ps1              # 增量构建 (利用 cache)
.\deploy.ps1 -Clean       # 全量无缓存构建
.\deploy.ps1 -Logs        # 构建后跟踪日志
.\deploy.ps1 -SelfTest    # 构建后自检
.\deploy.ps1 -Smoke       # 构建后跑一次真实 episode (需 API Key)
```

### Linux / Git Bash

```bash
./deploy.sh
./deploy.sh --clean --logs --selftest
```

### 脚本行为

1. 检查 `docker` / `docker compose` 可用性
2. `mkdir -p runs knowledge rag` 确保挂载目录存在
3. 若缺 `.env` 则从 `.env.example` 复制模板
4. `docker pull node:22-bookworm-slim` (best-effort 更新基座)
5. `docker compose build --pull` (或 `--no-cache`)
6. `docker compose down --remove-orphans` 停止旧容器
7. `docker compose up -d` 拉起新容器
8. `docker image prune -f` 清理悬空镜像
9. 打印 `docker compose ps` 与镜像大小

> 无需手动 `git pull`，脚本基于本地工作区构建；若需拉远端，先 `git pull` 再执行脚本。

## 5. 常用运维

```powershell
# 查看状态
docker compose ps
docker compose logs -f georsi     # 跟踪
docker compose logs --tail 200 georsi

# 进入容器调试
docker compose exec georsi sh
# 容器内手动命令
npx tsx src/run.ts selftest
npx tsx src/run.ts smoke --config config/research-competition-luna.json
npx tsx src/run.ts rsi --gens 2 --run-name debug

# 切换研究网关
docker compose exec georsi npx tsx src/run.ts research-gateway --list
docker compose exec georsi npx tsx src/run.ts research-gateway alsl

# 停止 / 销毁
docker compose down
docker compose down -v   # 连同 volumes (慎用，会删 runs)

# 镜像
docker images georsi
docker compose build --no-cache
```

## 6. 配置热更新 vs 需重建

| 修改内容 | 是否需重建 | 操作 |
|---|---|---|
| `config.json` / `config/*.json` | 否 | 直接改宿主机文件，容器内实时可见 (bind mount) |
| `.env` 环境变量 | 需重启 | `docker compose up -d` (脚本已含) |
| `src/` / `problems/` / `scripts/` | 需重建 | `./deploy.ps1` |
| `package.json` / `Dockerfile` | 需重建 | `./deploy.ps1 -Clean` |

## 7. TUI

TUI 需要交互式 TTY，不适合 `up -d` 后台模式：

```powershell
docker compose run --rm georsi npx tsx src/run.ts tui --gens 4
# 或进入容器后运行
docker compose exec -it georsi npx tsx src/run.ts tui
```

## 8. 故障排查

- **compose 報 `api_key.txt` 是目录**: 已修复，新版 compose 不再 bind 单文件，改走 `.env`。若仍遇到，删除误创建的目录 `rm -rf api_key.txt`。
- **private truth 缺失**: `../rsi-lab-private` 不存在时 compose 会创建空目录，不影响公开分评测；私有分需真实真值，否则 fallback 为 0。
- **healthcheck 失败**: `docker inspect georsi-lab --format "{{json .State.Health}}"` ; 自检 `docker compose run --rm georsi npx tsx src/run.ts selftest`
- **构建慢**: 首次约 5-8 分钟 (含 Python 科学栈编译)，后续增量 <1 分钟。
- **Windows 路径问题**: 确保 Docker Desktop > Settings > Resources > File Sharing 已包含项目盘符。

## 9. 文件清单

```
Dockerfile              # 镜像定义
.dockerignore           # 构建上下文排除
docker-compose.yml      # 编排
.env.example            # 环境变量模板
deploy.sh               # 一键更新 (bash)
deploy.ps1              # 一键更新 (PowerShell)
deploy.cmd              # CMD 转发
scripts/docker-update.sh # 兼容旧路径
docs/DOCKER.md          # 本文
```
