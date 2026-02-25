#!/usr/bin/env bash
# 构建 jellyfin-web 并打包为 bridge-rust/web.zip
# 用法: ./scripts/build-web.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_SRC="$ROOT_DIR/jellyfin-web"
ZIP_DEST="$ROOT_DIR/bridge-rust/web.zip"

echo "=== 构建 jellyfin-web ==="

# 检查 jellyfin-web 子模块是否存在
if [ ! -f "$WEB_SRC/package.json" ]; then
  echo "错误: jellyfin-web 子模块未初始化"
  echo "运行: git submodule update --init jellyfin-web"
  exit 1
fi

cd "$WEB_SRC"

echo "[1/3] 安装依赖..."
npm ci

echo "[2/3] 构建生产版本..."
npx cross-env NODE_ENV=production webpack --config webpack.prod.js

echo "[3/3] 打包为 web.zip..."
rm -f "$ZIP_DEST"
cd "$WEB_SRC/dist"
zip -r "$ZIP_DEST" .

echo ""
echo "完成! web.zip 已输出到: $ZIP_DEST"
echo "文件数: $(find . -type f | wc -l)"
echo "ZIP 大小: $(du -sh "$ZIP_DEST" | cut -f1)"
echo ""
echo "将 web.zip 放到 bridge-rust 工作目录后重启服务即可自动解压。"
