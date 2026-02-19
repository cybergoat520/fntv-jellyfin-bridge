# fnos-bridge 项目状态报告

> 日期：2026-02-19

## 项目出发点

飞牛影视（fnOS）是一款 NAS 媒体服务器，但只有自己的客户端（飞牛影视 App、fntv-electron 桌面端）。fnos-bridge 的目标是构建一个 Jellyfin 兼容的 API 转换层，让标准 Jellyfin 客户端（jellyfin-web、Xbox Jellyfin、Swiftfin、Android 等）可以直接连接飞牛 NAS 浏览和播放媒体内容。

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
- **安卓客户端支持**：修复 MediaBrowser Token 格式认证

#### 第二阶段：媒体库浏览
- 媒体库列表（`/UserViews`）— 电影、电视剧分类
- 媒体列表（`/Items`）— 飞牛 `item/list` → Jellyfin `BaseItemDto`
- 项目详情（`/Items/{id}`）— 飞牛 `play/info` → Jellyfin 详情
- **剧集完整支持**（`/Shows/{id}/Seasons`、`/Shows/{id}/Episodes`）
  - 使用飞牛 `season/list/{seriesGuid}` API 获取季列表
  - 使用飞牛 `episode/list/{seasonGuid}` API 获取集列表
  - 类型覆盖：play/info 返回 Episode 时，根据 originalType 显示为 Series/Season
- 图片代理 — 海报、剧照反向代理到飞牛，支持季和集的图片
- ID 映射 — 飞牛 GUID ↔ Jellyfin UUID（确定性 UUID v5）

#### 第三阶段：视频播放
- **DirectStream 播放**：兼容音频（AAC/MP3/FLAC 等）的文件通过原生 Node.js pipe 代理直接播放
- **HLS 转码播放**：不兼容音频（EAC3/DTS）的文件通过飞牛 HLS 转码播放
- **多清晰度支持**：按 `media_guid` 分组，支持同一影片的多个文件版本（4K/1080p 等）
- **智能音频选择**：优先选择浏览器兼容的音频轨作为默认
- **播放状态同步**：播放开始/进度/停止回传飞牛、标记已观看

#### 第四阶段：增强功能（已完成）
- **搜索**（`/Items?SearchTerm=xxx`）— 在媒体库内搜索影片
- **继续观看**（`/UserItems/Resume`）— 显示有播放进度但未看完的影片
- **最近添加**（`/Items/Latest`）— 按添加时间排序显示新内容
- **收藏夹**（`Filters=IsFavorite`）— 显示收藏的影片，支持收藏/取消收藏
- **标记已观看/未观看** — 支持标记影片观看状态
- **API 缓存优化** — item/list 5秒缓存、user/info 60秒缓存，并发去重

### 关键技术实现

| 功能 | 实现方式 |
|------|----------|
| 视频流代理 | 原生 Node.js `http.pipe()`，绕过 Hono 框架，无超时限制 |
| HLS 转码 | 调用飞牛 `play/play` API 启动转码会话，获取 `sessionGuid`，代理 m3u8/ts |
| HLS 认证 | m3u8 URL 注入 `api_key`；.ts 段请求从 HLS 会话缓存获取凭据 |
| 播放错误重试 | `handlePlaybackInfo` 解析 `EnableDirectStream`/`EnableDirectPlay` 参数，防止无限循环 |
| 云盘支持 | 参考 fntv-electron 逻辑，支持 115/百度/夸克等云盘直链代理 |
| Authx 签名 | 所有飞牛 API 请求自动附加 Authx 签名（nonce + timestamp + HMAC） |
| 剧集层级 | 使用飞牛 `season/list` 和 `episode/list` API，originalType 类型覆盖 |
| 认证兼容性 | 支持 `MediaBrowser Client="..."` 和 `MediaBrowser Token="..."` 两种格式 |

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

### 字幕
- 内嵌字幕通过 MediaStream 信息传递给客户端
- 外挂字幕代理尚未完整测试

### 演员/导演
- 飞牛 API 支持获取演员列表（`/v/api/v1/person/list/{itemGuid}`）
- 尚未映射到 Jellyfin 的 People 字段
- 收藏夹的"收藏的演员"、"收藏的艺术家"功能待实现

## 支持的客户端

| 客户端 | 状态 | 说明 |
|--------|------|------|
| jellyfin-web (浏览器) | ✅ 完整支持 | 推荐使用 Chrome/Edge |
| Android Jellyfin | ✅ 完整支持 | 需同一网络访问 |
| Xbox Jellyfin | 未测试 | 理论上支持 |
| Swiftfin (iOS) | 未测试 | 理论上支持 |

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
│   ├── items.ts             # /Items/* 媒体浏览 + 最近添加
│   ├── shows.ts             # /Shows/* 剧集（季/集完整支持）
│   ├── favorites.ts         # /UserFavoriteItems/* 收藏
│   ├── playstate.ts         # /UserPlayedItems/* 标记已观看
│   ├── resume.ts            # /UserItems/Resume 继续观看
│   ├── images.ts            # 图片代理
│   ├── videos.ts            # /Videos/* 视频流（Hono 版）
│   ├── mediainfo.ts         # /Items/*/PlaybackInfo 播放信息
│   ├── playback.ts          # /Sessions/Playing/* 播放状态
│   ├── hls.ts               # HLS 路由（Hono 版）
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

## 启动命令

```bash
cd bridge-node
# 设置环境变量
$env:FNOS_SERVER="http://192.168.9.5:5666"  # PowerShell
# 或
set FNOS_SERVER=http://192.168.9.5:5666      # CMD

npm run dev
```

服务启动后访问 `http://localhost:8096`，使用飞牛账号登录。

## 最近提交

- `fa55023` fix: 安卓客户端认证支持
- `739dc62` feat: 电视剧季/集完整支持
- `d57dd23` feat: 收藏夹、最近添加、API 请求缓存优化
- `52e55b7` feat: 实现收藏/取消收藏和标记未观看功能
