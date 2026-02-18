# fnos-bridge — 飞牛影视 → Jellyfin API 转换层

## 项目目标

构建一个 HTTP 服务器，对外暴露 Jellyfin 兼容的 API，内部将请求转换为飞牛影视 API 调用。让标准 Jellyfin 客户端（jellyfin-web、Xbox Jellyfin、Swiftfin、Findroid 等）可以直接连接并浏览、播放飞牛影视的内容。

## 架构概览

```
┌───────────────────┐     Jellyfin API      ┌───────────────┐     飞牛 API      ┌───────────────┐
│  Jellyfin 客户端  │  ──────────────────→  │  fnos-bridge  │  ──────────────→  │  飞牛影视 NAS  │
│  (Web/Xbox 等)    │  ←──────────────────  │  (Node.js)    │  ←──────────────  │               │
└───────────────────┘                       └───────────────┘                   └───────────────┘
```

核心思路：fnos-bridge 是一个"翻译器"，把 Jellyfin 客户端发出的标准请求翻译成飞牛影视能理解的请求，再把飞牛的响应翻译回 Jellyfin 客户端期望的格式。

## 技术选型

| 项目 | 选择 | 理由 |
|------|------|------|
| 运行时 | Node.js 24 | 原生 TypeScript，与 fnos-auth 一致 |
| HTTP 框架 | Hono + 原生 Node.js | Hono 处理 API 路由；原生 http 处理视频流代理（绕过框架超时限制） |
| 飞牛客户端 | fnos-auth (FnosClient) | 已有模块，自动签名/重试/重定向 |
| 视频代理 | 原生 Node.js pipe() | 参考 fntv-electron 的 proxy 模块逻辑，无超时限制 |
| HLS 转码 | 飞牛 play/play API | 飞牛支持服务端 HLS 转码（音频转 AAC） |
| ID 映射 | 确定性 UUID v5 生成 | 飞牛 GUID → Jellyfin UUID 的双向映射 |

## Jellyfin 客户端启动流程分析

Jellyfin 客户端连接服务器时的典型调用顺序：

1. `GET /System/Info/Public` — 获取服务器基本信息（版本、名称、ID）
2. `GET /Branding/Configuration` — 获取品牌配置
3. `POST /Users/AuthenticateByName` — 用户名密码登录
4. `GET /Users/{userId}` — 获取用户信息
5. `GET /UserViews` — 获取媒体库列表（电影、电视剧等）
6. `GET /Items` — 获取媒体库内容列表
7. `GET /Items/{itemId}` — 获取单个项目详情
8. `GET /Items/{itemId}/Images/{type}` — 获取封面图片
9. `GET /Shows/{seriesId}/Seasons` — 获取剧集的季列表
10. `GET /Shows/{seriesId}/Episodes` — 获取某季的集列表
11. `POST /Items/{itemId}/PlaybackInfo` — 获取播放信息（含 MediaSources）
12. `GET /Videos/{itemId}/stream` — DirectStream 视频流
13. `GET /{mediaGuid}/hls/main.m3u8` — HLS 转码流（不兼容音频时）
14. `POST /Sessions/Playing` — 报告播放开始
15. `POST /Sessions/Playing/Progress` — 报告播放进度
16. `POST /Sessions/Playing/Stopped` — 报告播放停止
17. `POST /UserPlayedItems/{itemId}` — 标记已观看

## 分阶段实施计划

### 第一阶段：基础框架 + 认证（可连接）✅ 已完成

目标：让 Jellyfin 客户端能成功连接服务器并登录。

#### 需要实现的端点

| Jellyfin 端点 | 飞牛 API 映射 | 状态 |
|---|---|---|
| `GET /System/Info/Public` | 静态返回 | ✅ |
| `GET /System/Info` | 静态返回 | ✅ |
| `GET /System/Ping` | 静态返回 | ✅ |
| `GET /Branding/Configuration` | 静态返回 | ✅ |
| `GET /Branding/Css` | 静态返回 | ✅ |
| `POST /Users/AuthenticateByName` | `POST /v/api/v1/login` | ✅ |
| `GET /Users/{userId}` | `GET /v/api/v1/user/info` | ✅ |
| `GET /Users/Me` | `GET /v/api/v1/user/info` | ✅ |

#### 关键设计

**认证映射**：
- Jellyfin 客户端发送 `AuthenticateByName(username, password)`
- Bridge 调用 fnos-auth 的 `login()` 获取飞牛 token
- 生成一个 Jellyfin 格式的 AccessToken（内部编码飞牛 token + server 信息）
- 后续请求通过 `Authorization: MediaBrowser Token="xxx"` 头传递

**Token 编码方案**：
```
Jellyfin AccessToken = Base64(JSON({ fnosToken, fnosServer }))
```
Bridge 从每个请求的 Authorization 头中解码出飞牛凭据，用于调用飞牛 API。

**服务器 ID**：
- 使用固定的 UUID 作为 ServerId（基于飞牛服务器地址的确定性哈希）

**WebSocket 心跳**：
- 支持 Jellyfin 客户端的 WebSocket 连接和心跳消息

### 第二阶段：媒体库浏览（可看到内容）✅ 已完成

目标：让客户端能浏览媒体库、看到电影和电视剧列表。

#### 需要实现的端点

| Jellyfin 端点 | 飞牛 API 映射 | 状态 |
|---|---|---|
| `GET /UserViews` | 构造虚拟媒体库 | ✅ |
| `GET /Items` | `POST /v/api/v1/item/list` | ✅ |
| `GET /Users/{userId}/Items` | `POST /v/api/v1/item/list` | ✅ |
| `GET /Users/{userId}/Items/{itemId}` | `POST /v/api/v1/play/info` | ✅ |
| `GET /Items/{itemId}/Images/{type}` | 飞牛图片 URL 代理 | ✅ |
| `GET /Shows/{seriesId}/Seasons` | `GET /v/api/v1/episode/list/{id}` | ✅ |
| `GET /Shows/{seriesId}/Episodes` | `GET /v/api/v1/episode/list/{id}` | ✅ |

#### 关键设计

**ID 映射系统**：
飞牛使用字符串 GUID（如 `fv_30006e2fdaa44c7aac2c3cb25c10121d`），Jellyfin 使用标准 UUID。

方案：使用 UUID v5（基于命名空间的确定性 UUID）
```typescript
const FNOS_NAMESPACE = 'a1b2c3d4-...'; // 固定命名空间
const jellyfinId = uuidv5(fnosGuid, FNOS_NAMESPACE);
```
同时维护一个内存缓存做反向查找（Jellyfin UUID → 飞牛 GUID）。

**内容类型映射**：

| 飞牛 type | Jellyfin BaseItemKind |
|---|---|
| Movie | Movie |
| Episode | Episode |
| TV (series) | Series |
| Season | Season |
| 媒体库分类 | CollectionFolder |

**BaseItemDto 构造**：
将飞牛的 `PlayListItem` / `PlayInfo.item` 转换为 Jellyfin 的 `BaseItemDto`，核心字段映射：

```
Name          ← title / tv_title
Id            ← uuidv5(guid)
Type          ← 类型映射
Overview      ← overview
CommunityRating ← parseFloat(vote_average)
RunTimeTicks  ← duration * 10_000_000 (秒→ticks)
IndexNumber   ← episode_number
ParentIndexNumber ← season_number
ImageTags     ← { Primary: hash }
UserData      ← { PlayedPercentage, Played, PlaybackPositionTicks }
```

**图片代理**：
- Jellyfin 客户端请求 `/Items/{id}/Images/Primary`
- Bridge 查找对应飞牛项目的 poster URL
- 反向代理飞牛的图片（附加 Authorization 和 Authx 签名）

### 第三阶段：视频播放（核心功能）✅ 基本完成

目标：让客户端能播放视频。

#### 需要实现的端点

| Jellyfin 端点 | 飞牛 API 映射 | 状态 |
|---|---|---|
| `POST /Items/{itemId}/PlaybackInfo` | `play/info` + `stream/list` + `stream` | ✅ |
| `GET /Videos/{itemId}/stream` | `/v/api/v1/media/range/{mediaGuid}` | ✅ DirectStream |
| `GET /Videos/{itemId}/stream.{container}` | 同上 | ✅ |
| `GET /{mediaGuid}/hls/main.m3u8` | `/v/api/v1/play/play` → `/v/media/{sessionGuid}/preset.m3u8` | ✅ HLS 转码 |
| `GET /{mediaGuid}/hls/*.ts` | `/v/media/{sessionGuid}/*.ts` | ✅ |
| `GET /Videos/{itemId}/{mediaSourceId}/Subtitles/{index}/Stream.{format}` | `/v/api/v1/subtitle/dl/{subtitleGuid}` | ⚠️ 基本实现 |

#### 关键设计

**双播放模式**：
- **DirectStream**：音频兼容（AAC/MP3/FLAC 等）时，原生 Node.js pipe 代理直接播放
- **HLS 转码**：音频不兼容（EAC3/DTS 等）时，通过飞牛 HLS 转码（音频转 AAC）

**PlaybackInfoResponse 构造**：
```typescript
{
  MediaSources: [{
    Id: mediaGuid,
    Name: fileName,
    Container: 容器格式,
    SupportsDirectPlay: false,           // 始终 false（不支持本地文件播放）
    SupportsDirectStream: !needsTranscoding,  // 音频兼容时 true
    SupportsTranscoding: needsTranscoding,    // 音频不兼容时 true
    TranscodingUrl: "/{mediaGuid}/hls/main.m3u8?api_key=...",
    MediaStreams: [
      // 视频流 ← video_streams
      // 音频流 ← audio_streams（智能默认：优先浏览器兼容编解码器）
      // 字幕流 ← subtitle_streams
    ],
    DirectStreamUrl: "/Videos/{id}/stream?static=true&..."
  }]
}
```

**多清晰度支持**：
- 按 `media_guid` 分组流信息，同一影片的多个文件版本（4K/1080p 等）生成多个 MediaSource
- 每个 MediaSource 独立判断 DirectStream/HLS 转码

**飞牛 HLS 转码流程**：
```
1. PlaybackInfo 时注册流元数据（video_guid, audio_guid, codec 等）→ hls-session.ts
2. 首次 m3u8 请求 → 调用 POST /v/api/v1/play/play 启动转码会话
3. play/play 返回 play_link 含 sessionGuid（不同于 mediaGuid！）
4. 用 sessionGuid 代理 /v/media/{sessionGuid}/preset.m3u8
5. .ts 段请求从 HLS 会话缓存获取凭据和 sessionGuid（hls.js 不发 auth header）
```

**play/play 请求体**：
```json
{
  "media_guid": "...",
  "video_guid": "...",
  "video_encoder": "hevc",
  "resolution": "4k",
  "bitrate": 15000000,
  "startTimestamp": 0,
  "audio_encoder": "aac",       // 目标编解码器，始终 aac
  "audio_guid": "...",
  "subtitle_guid": "",
  "channels": 2,
  "forced_sdr": 0
}
```

**视频流代理**：
参考 fntv-electron 的 proxy 模块逻辑：
1. 解析请求中的 itemId → 查找对应的 mediaGuid
2. 调用飞牛 `POST /v/api/v1/stream` 获取流信息
3. 判断是本地 NAS 还是云盘
4. 本地：原生 Node.js pipe 代理 `/v/api/v1/media/range/{mediaGuid}`（附加 Authorization）
5. 云盘：代理直链 URL（附加对应 Cookie/UA）
6. 支持 Range 请求（断点续传）

**播放错误重试**：
- `handlePlaybackInfo` 解析 POST body 中的 `EnableDirectStream`/`EnableDirectPlay` 参数
- 当 jellyfin-web 播放失败重试时（`EnableDirectStream: false`），正确返回仅 HLS 转码的 MediaSource
- 防止 DirectStream ↔ HLS 无限循环

### 第四阶段：播放状态同步 ✅ 已完成

目标：播放进度、已观看状态同步回飞牛。

#### 需要实现的端点

| Jellyfin 端点 | 飞牛 API 映射 | 状态 |
|---|---|---|
| `POST /Sessions/Playing` | `POST /v/api/v1/play/record` | ✅ |
| `POST /Sessions/Playing/Progress` | `POST /v/api/v1/play/record` | ✅ |
| `POST /Sessions/Playing/Stopped` | `POST /v/api/v1/play/record` | ✅ |
| `POST /UserPlayedItems/{itemId}` | `POST /v/api/v1/item/watched` | ✅ |
| `DELETE /UserPlayedItems/{itemId}` | 无对应 | ✅ 返回成功 |

#### 关键设计

**Ticks 转换**：
Jellyfin 使用 ticks（1 tick = 100 纳秒），飞牛使用秒。
```typescript
const seconds = ticks / 10_000_000;
const ticks = seconds * 10_000_000;
```

### 第五阶段：增强功能（待实现）

| 功能 | 说明 | 状态 |
|---|---|---|
| 搜索 | `GET /Items` 带 searchTerm 参数 | ❌ |
| 继续观看 | `GET /Items?Filters=IsResumable` | ❌ |
| 最近添加 | `GET /Items?SortBy=DateCreated&SortOrder=Descending` | ❌ |
| 下一集 | `GET /Shows/NextUp` | ❌ |
| 收藏 | `POST /UserFavoriteItems/{itemId}` | ❌ |

## 项目结构

```
fnos-bridge/
├── fnos-auth/                    # 子模块：飞牛认证
├── fntv-electron/                # 子模块：参考资料
├── jellyfin-web/                 # 子模块：参考资料
├── jellyfin-xbox/                # 子模块：参考资料
├── specs/                        # 设计文档
├── bridge-node/
│   ├── package.json
│   ├── tsconfig.json
│   ├── tests/
│   │   └── smoke.test.ts         # 冒烟测试
│   └── src/
│       ├── index.ts              # 入口，HTTP + WebSocket 服务器
│       ├── server.ts             # Hono 应用配置 + 路由注册
│       ├── config.ts             # 配置（端口、飞牛地址等）
│       ├── middleware/
│       │   └── auth.ts           # Jellyfin Authorization 头解析 + 认证中间件
│       ├── routes/
│       │   ├── system.ts         # /System/* 端点
│       │   ├── branding.ts       # /Branding/* 端点
│       │   ├── users.ts          # /Users/* 认证 + 用户信息
│       │   ├── items.ts          # /Items/* 媒体浏览
│       │   ├── shows.ts          # /Shows/* 剧集
│       │   ├── images.ts         # 图片代理
│       │   ├── videos.ts         # /Videos/* 视频流（Hono 路由，转发到原生代理）
│       │   ├── mediainfo.ts      # /Items/*/PlaybackInfo 播放信息 + 流元数据注册
│       │   ├── playback.ts       # /Sessions/Playing/* 播放状态
│       │   ├── hls.ts            # HLS 路由（Hono 版，转发到原生代理）
│       │   └── subtitles.ts      # 字幕代理
│       ├── proxy/
│       │   └── stream.ts         # 原生 Node.js 流式代理（DirectStream + HLS）
│       ├── services/
│       │   ├── fnos.ts           # 飞牛 API 封装（login, play/info, play/play 等）
│       │   ├── session.ts        # 会话管理（token 映射、持久化）
│       │   └── hls-session.ts    # HLS 转码会话管理（StreamMeta + sessionGuid 缓存）
│       ├── mappers/
│       │   ├── id.ts             # ID 映射（飞牛 GUID ↔ Jellyfin UUID v5）
│       │   ├── item.ts           # 飞牛 Item → Jellyfin BaseItemDto
│       │   ├── user.ts           # 飞牛 UserInfo → Jellyfin UserDto
│       │   └── media.ts          # 飞牛 Stream → Jellyfin MediaSource/MediaStream
│       ├── fnos-client/
│       │   ├── client.ts         # 飞牛 HTTP 客户端（Authx 签名、重试）
│       │   └── signature.ts      # Authx 签名计算
│       └── types/
│           └── fnos.ts           # 飞牛 API 类型定义
```

## 已知限制与风险

1. **HLS 转码限制**：飞牛支持 HLS 转码（音频转 AAC），但多码流文件（同一影片有两个文件版本）的 HLS 转码还有问题，可能是流元数据注册或 session 管理冲突。
2. **云盘播放**：云盘直链有过期时间和速率限制，需要参考 fntv-electron proxy 模块的处理逻辑。已有基本支持但未充分测试。
3. **飞牛 API 稳定性**：飞牛影视 API 非公开文档，可能随版本更新变化。
4. **并发限制**：飞牛 API 的 Authx 签名基于时间戳，高并发下可能出现签名冲突（fnos-auth 已有重试机制）。
5. **媒体库结构差异**：飞牛的媒体组织方式与 Jellyfin 不完全一致，需要在映射层做适配。
6. **Quality 菜单**：兼容音频文件的 `SupportsTranscoding` 为 `false`，Quality 菜单不显示。需要更精细的策略。
7. **外挂字幕**：基本实现但未充分测试。

## 开发优先级

```
第一阶段（P0）：基础框架 + 认证     → ✅ 客户端能连接登录
第二阶段（P0）：媒体库浏览          → ✅ 客户端能看到内容列表和封面
第三阶段（P0）：视频播放            → ✅ 单码流 DirectStream + HLS 转码均可用
第四阶段（P1）：播放状态同步        → ✅ 进度和已观看状态回传
第五阶段（P2）：增强功能            → ❌ 搜索、继续观看、收藏等
```
