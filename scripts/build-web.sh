#!/usr/bin/env bash
# 构建 jellyfin-web 并复制到 bridge-node/web/
# 用法: ./scripts/build-web.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_SRC="$ROOT_DIR/jellyfin-web"
WEB_DEST="$ROOT_DIR/bridge-node/web"

echo "=== 构建 jellyfin-web ==="

# 检查 jellyfin-web 子模块是否存在
if [ ! -f "$WEB_SRC/package.json" ]; then
  echo "错误: jellyfin-web 子模块未初始化"
  echo "运行: git submodule update --init jellyfin-web"
  exit 1
fi

# 检查 Node.js 版本
NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 24 ]; then
  echo "警告: jellyfin-web 要求 Node.js >= 24，当前版本: $(node -v)"
  echo "建议使用 nvm 切换: nvm use 24"
fi

cd "$WEB_SRC"

echo "[1/3] 安装依赖..."
npm ci

echo "[2/3] 构建生产版本..."
npx cross-env NODE_ENV=production webpack --config webpack.prod.js

echo "[3/3] 复制到 bridge-node/web/..."
rm -rf "$WEB_DEST"
cp -r "$WEB_SRC/dist" "$WEB_DEST"

echo ""
echo "完成! Web UI 已输出到: $WEB_DEST"
echo "文件数: $(find "$WEB_DEST" -type f | wc -l)"
echo "总大小: $(du -sh "$WEB_DEST" | cut -f1)"
