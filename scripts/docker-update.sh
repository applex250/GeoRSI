#!/usr/bin/env bash
# 兼容旧路径: 转发到根目录 deploy.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec bash "$ROOT/deploy.sh" "$@"
