# fnos-bridge (Rust)

飞牛影视 → Jellyfin API 转换层的 Rust 实现。

## 前置要求

### Windows
安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选 "C++ build tools" 工作负载。

或者安装 MinGW-w64 并在 `.cargo/config.toml` 中切换到 GNU 目标。

### Linux / macOS
```bash
# 安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

## 编译

```bash
cd bridge-rust
cargo build --release
```

## 运行

```bash
# 设置环境变量
export FNOS_SERVER=http://192.168.9.5:5666
export BRIDGE_PORT=8096

# 运行
cargo run --release
# 或直接运行编译产物
./target/release/fnos-bridge
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `BRIDGE_PORT` | `8096` | 监听端口 |
| `BRIDGE_HOST` | `0.0.0.0` | 监听地址 |
| `FNOS_SERVER` | `http://localhost:5666` | 飞牛影视服务器地址 |
| `FNOS_IGNORE_CERT` | `false` | 跳过 HTTPS 证书验证 |
| `SERVER_NAME` | `fnos-bridge` | 服务器名称 |

## 项目结构

```
bridge-rust/src/
├── main.rs                  # 入口，HTTP + WebSocket 服务器 + 路由注册
├── lib.rs                   # 模块声明
├── config.rs                # 配置（端口、飞牛地址等）
├── middleware/
│   └── auth.rs              # Jellyfin Authorization 头解析 + 认证中间件
├── routes/
│   ├── system.rs            # /System/* + /Branding/* 端点
│   ├── users.rs             # /Users/* 认证 + 用户信息
│   ├── views.rs             # /UserViews 媒体库列表
│   ├── items.rs             # /Items/* 媒体浏览 + 最近添加
│   ├── shows.rs             # /Shows/* 剧集（季/集）
│   ├── images.rs            # 图片代理
│   ├── mediainfo.rs         # /Items/*/PlaybackInfo 播放信息
│   ├── playback.rs          # /Sessions/Playing/* 播放状态
│   └── extras.rs            # 收藏、已观看
├── proxy/
│   └── stream.rs            # 视频流 + HLS 转码代理（reqwest 流式传输）
├── services/
│   ├── fnos.rs              # 飞牛 API 封装
│   ├── session.rs           # 会话管理（token 映射、持久化）
│   └── hls_session.rs       # HLS 转码会话管理
├── mappers/
│   ├── id.rs                # ID 映射（飞牛 GUID ↔ Jellyfin UUID v5）
│   ├── item.rs              # 飞牛 Item → Jellyfin BaseItemDto
│   ├── user.rs              # 飞牛 UserInfo → Jellyfin UserDto
│   └── media.rs             # 飞牛 Stream → Jellyfin MediaSource/MediaStream
├── fnos_client/
│   ├── client.rs            # 飞牛 HTTP 客户端（Authx 签名、重试）
│   └── signature.rs         # Authx 签名计算
└── types/
    ├── fnos.rs              # 飞牛 API 类型定义
    └── jellyfin.rs          # Jellyfin API 类型定义
```
