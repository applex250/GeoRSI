# GeoRSI Lab - Docker Image
# Base: Node 22 + Python 3.11 科研栈
# Windows Sandboxie 在容器内不可用，自动回落为 host-audit (Linux 唯一可用后端)
# 构建: docker build -t georsi:latest .
# 运行: docker compose up -d

FROM node:22-bookworm-slim

LABEL maintainer="GeoRSI Lab"
LABEL description="Self-evolving geoscience research system (pi harness + Python science stack)"

# 1) 系统依赖: Python + 构建工具 + git (生成 run-manifest 需要) + tini (信号转发)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    python3-dev \
    git \
    curl \
    tini \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && python3 --version && node --version

WORKDIR /app

# 2) 先拷贝依赖清单，利用 Docker layer cache 加速
COPY package.json package-lock.json ./
COPY tsconfig.json ./

# 3) 安装 Node 依赖 (pi-agent 0.84.2 pinned)
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

# 4) 安装 Python 科研栈
#    - numpy / scipy / pandas / sklearn / matplotlib / statsmodels 是地学题目内层 agent 常用库
#    - openai 是 LLM judge 所需
#    - undici 已由 Node 依赖提供，无需重复
RUN pip install --no-cache-dir --break-system-packages \
    "numpy>=1.24" \
    "scipy>=1.11" \
    "pandas>=2.0" \
    "scikit-learn>=1.3" \
    "matplotlib>=3.7" \
    "statsmodels>=0.14" \
    "openai>=1.0" \
    "tqdm>=4.66"
RUN pip install --no-cache-dir --break-system-packages pypdf openpyxl xlrd rasterio geopandas

# 5) 拷贝源码与配置 (放在最后，改代码时不重装依赖)
COPY config ./config
COPY src ./src
COPY extensions ./extensions
COPY problems ./problems
COPY scripts ./scripts
COPY docs ./docs
COPY scaffolds ./scaffolds
COPY knowledge ./knowledge
COPY rag ./rag
COPY config.json ./config.json
COPY README.md ./README.md

# 6) 创建运行时目录 (runs / episodes 产物需持久化，见 docker-compose.yml volumes)
RUN mkdir -p runs knowledge rag \
    && git config --global --add safe.directory /app

# 7) 环境变量
ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    EXECUTION_BACKEND=host-audit \
    TZ=Asia/Shanghai

# 8) 健康检查: 轻量 selftest (无 LLM) 验证镜像完整性
HEALTHCHECK --interval=60s --timeout=15s --start-period=20s --retries=3 \
    CMD node --loader tsx --no-warnings src/run.ts selftest || exit 1

# 9) 入口: tini 负责信号转发 + 僵尸进程回收，默认启动 rsi 流程
#    可被 docker compose command 覆盖为 selftest / smoke / exam 等
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npx", "tsx", "src/run.ts", "rsi", "--gens", "4"]
