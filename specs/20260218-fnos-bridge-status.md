# fnos-bridge 项目状态报告

> 日期：2026-02-18

## 项目出发点

飞牛影视（fnOS）是一款 NAS 媒体服务器，但只有自己的客户端（飞牛影视 App、fntv-electron 桌面端）。fnos-bridge 的目标是构建一个 Jellyfin 兼容的 API 转换层，让标准 Jellyfin 客户端（jellyfin-web、Xbox Jellyfin、Swiftfin 等）可以直接连接飞牛 NAS 浏览和播放媒体内容。

## 架构

```
Jellyfin 客户端  ──Jellyfin API──▶  fnos-bridge (Node.js/Hono)  ──飞牛 API──▶  飞牛影视 NAS
```

fnos-bridge 是一个"翻译器"：接收 Jellyfin 标准请求，转换为飞牛 API 调用，再把飞牛响应翻译回 Jellyfin 格式。

## 核心功能

### ✅ 已完成

#### 第一阶段：连接 + 登录
- 伪装为 Jellyfin 服务器（`/System/Info/Public`、`/Branding/Configuration` 等）
- 用户认证：Jellyfin `AuthenticateByName` → 飞牛 `login` API
- 会话管理：token 映射、持久化存储
- WebSocket 心跳支持

#### 第二阶段：媒体库浏览
- 媒体库列表（`/UserViews`）— 电影、电视剧分类
- 媒体列表（`/Items`）— 飞牛 `item/list` → Jellyfin `BaseItemDto`
- 项目详情（`/Items/{id}`）— 飞牛 `play/info` → Jellyfin 详情
- 剧集浏览（`/Shows/{id}/Seasons`、`/Episodes`）
- 图片代理 — 海报、剧照反向代理到飞牛
- ID 映射 — 飞牛 GUID ↔ Jellyfin UUID（确定性 UUID v5）

#### 第三阶段：视频播放
- **DirectStream 播放**：兼容音频（AAC/MP3/FLAC 等）的文件通过原生 Node.js pipe 代理直接播放
- **HLS 转码播放**：不兼容音频（EAC3/DTS）的文件通过飞牛 HLS 转码播放
- **多清晰度支持**：按 `media_guid` 分组，支持同一影片的多个文件版本（4K/1080p 等）
- **智能音频选择**：优先选择浏览器兼容的音频轨作为默认
- **播放状态同步**：播放开始/进度/停止回传飞牛、标记已观看

### 关键技术实现

| 功能 | 实现方式 |
|------|----------|
| 视频流代理 | 原生 Node.js `http.pipe()`，绕过 Hono 框架，无超时限制 |
| HLS 转码 | 调用飞牛 `play/play` API 启动转码会话，获取 `sessionGuid`，代理 m3u8/ts |
| HLS 认证 | m3u8 URL 注入 `api_key`；.ts 段请求从 HLS 会话缓存获取凭据 |
| 播放错误重试 | `handlePlaybackInfo` 解析 `EnableDirectStream`/`EnableDirectPlay` 参数，防止无限循环 |
| 云盘支持 | 参考 fntv-electron 逻辑，支持 115/百度/夸克等云盘直链代理 |
| Authx 签名 | 所有飞牛 API 请求自动附加 Authx 签名（nonce + timestamp + HMAC） |

### 飞牛 HLS 转码流程（已实现）

```
1. PlaybackInfo 时注册流元数据（video_guid, audio_guid, codec 等）
2. 首次 m3u8 请求 → 调用 /v/api/v1/play/play 启动转码会话
3. play/play 返回 play_link 含 sessionGuid（不同于 mediaGuid）
4. 用 sessionGuid 代理 /v/media/{sessionGuid}/preset.m3u8
5. .ts 段请求从 HLS 会话缓存获取凭据和 sessionGuid
```

## ❌ 已知问题 / 待解决

### 多码流 HLS 转码
- 单码流文件的 HLS 转码已正常工作
- 多码流文件（同一影片有两个文件版本）的 HLS 转码还有问题
- 可能原因：多个 MediaSource 的流元数据注册或 session 管理冲突

### Quality 菜单
- jellyfin-web 的 Quality 菜单依赖 `MediaSource.SupportsTranscoding`
- 对于兼容音频的文件，`SupportsTranscoding` 为 `false`，Quality 菜单不显示
- 如果强制设为 `true`，会导致播放错误时尝试 HLS 回退失败（因为飞牛没有启动转码）
- 需要更精细的策略：始终提供 TranscodingUrl 但按需启动转码会话

### PlayMethod 显示
- 兼容音频文件的 `playMethod` 显示为 `DirectStream`（正确）
- 不兼容音频文件的 `playMethod` 显示为 `Transcode`（正确）

### 字幕
- 内嵌字幕通过 MediaStream 信息传递给客户端
- 外挂字幕代理尚未完整测试

## 项目文件结构

```
bridge-node/src/
├── index.ts                 # 入口，HTTP + WebSocket 服务器
├── server.ts                # Hono 应用配置 + 路由注册
├── config.ts                # 配置（端口、飞牛地址等）
├── middleware/auth.ts        # Jellyfin Authorization 头解析
├── routes/
│   ├── system.ts            # /System/* 端点
│   ├── branding.ts          # /Branding/* 端点
│   ├── users.ts             # /Users/* 认证 + 用户信息
│   ├── items.ts             # /Items/* 媒体浏览
│   ├── shows.ts             # /Shows/* 剧集
│   ├── images.ts            # 图片代理
│   ├── videos.ts            # /Videos/* 视频流（Hono 版，已被原生代理替代）
│   ├── mediainfo.ts         # /Items/*/PlaybackInfo 播放信息
│   ├── playback.ts          # /Sessions/Playing/* 播放状态
│   ├── hls.ts               # HLS 路由（Hono 版，已被原生代理替代）
│   └── subtitles.ts         # 字幕代理
├── proxy/stream.ts           # 原生 Node.js 流式代理（视频 + HLS）
├── services/
│   ├── fnos.ts              # 飞牛 API 封装
│   ├── session.ts           # 会话管理
│   └── hls-session.ts       # HLS 转码会话管理
├── mappers/
│   ├── id.ts                # ID 映射（飞牛 GUID ↔ Jellyfin UUID）
│   ├── item.ts              # 飞牛 Item → Jellyfin BaseItemDto
│   ├── user.ts              # 飞牛 UserInfo → Jellyfin UserDto
│   └── media.ts             # 飞牛 Stream → Jellyfin MediaSource/MediaStream
├── fnos-client/
│   ├── client.ts            # 飞牛 HTTP 客户端（Authx 签名、重试）
│   └── signature.ts         # Authx 签名计算
└── types/fnos.ts             # 飞牛 API 类型定义
```
