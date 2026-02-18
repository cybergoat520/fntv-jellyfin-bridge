#!/usr/bin/env bash
# fnos-bridge 启动脚本
# 用法: ./start.sh

# ========== 配置区域 ==========

# 飞牛 NAS 地址（必填，改成你的实际地址）
export FNOS_SERVER="http://192.168.1.50:5666"

# Bridge 监听端口（Jellyfin 客户端连接用）
export BRIDGE_PORT="8096"

# Bridge 监听地址（0.0.0.0 允许局域网访问）
export BRIDGE_HOST="0.0.0.0"

# 客户端显示的服务器名称
export SERVER_NAME="fnos-bridge"

# 跳过飞牛 HTTPS 证书验证（自签证书时设为 true）
export FNOS_IGNORE_CERT="false"

# ==============================

cd "$(dirname "$0")/bridge-node" || exit 1

echo "启动 fnos-bridge..."
echo "飞牛地址: $FNOS_SERVER"
echo "监听端口: $BRIDGE_PORT"
echo ""

exec node --experimental-strip-types src/index.ts
