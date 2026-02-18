# fnos-bridge — 飞牛影视 → Jellyfin API 转换层

## 项目目标

构建一个 HTTP 服务器，对外暴露 Jellyfin 兼容的 API，内部将请求转换为飞牛影视 API 调用。让标准 Jellyfin 客户端（Swiftfin、Jellyfin Media Player、Findroid 等）可以直接连接并浏览、播放飞牛影视的内容。

## 架构概览

```
┌─────────────────┐     Jellyfin API      ┌──────────────┐     飞牛 API      ┌──────────────┐
│  Jellyfin 客户端  │ ──────────────────→  │  fnos-bridge  │ ──────────────→  │  飞牛影视 NAS  │
│  (Swiftfin 等)   │ ←──────────────────  │  (Node.js)   │ ←──────────────  │              │
└─────────────────┘                       └──────────────┘                  └──────────────┘
```

核心思路：fnos-bridge 是一个"翻译器"，把 Jellyfin 客户端发出的标准请求翻译成飞牛影视能理解的请求，再把飞牛的响应翻译回 Jellyfin 客户端期望的格式。

## 技术选型

| 项目 | 选择 | 理由 |
|------|------|------|
| 运行时 | Node.js 24 | 原生 TypeScript，与 fnos-auth 一致 |
| HTTP 框架 | Hono | 轻量、类型安全、支持多运行时 |
| 飞牛客户端 | fnos-auth (FnosClient) | 已有模块，自动签名/重试/重定向 |
| 视频代理 | 透明反向代理 | 参考 fntv-electron 的 proxy 模块逻辑 |
| ID 映射 | 确定性 UUID 生成 | 飞牛 GUID → Jellyfin UUID 的双向映射 |

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
11. `GET /Items/{itemId}/PlaybackInfo` — 获取播放信息
12. `GET /Videos/{itemId}/stream` — 获取视频流
13. `POST /Sessions/Playing` — 报告播放开始
14. `POST /Sessions/Playing/Progress` — 报告播放进度
15. `POST /Sessions/Playing/Stopped` — 报告播放停止
16. `POST /UserPlayedItems/{itemId}` — 标记已观看

## 分阶段实施计划

### 第一阶段：基础框架 + 认证（可连接）

目标：让 Jellyfin 客户端能成功连接服务器并登录。

#### 需要实现的端点

| Jellyfin 端点 | 飞牛 API 映射 | 说明 |
|---|---|---|
| `GET /System/Info/Public` | 静态返回 | 返回伪造的 Jellyfin 服务器信息 |
| `GET /System/Info` | 静态返回 | 返回完整系统信息 |
| `GET /System/Ping` | 静态返回 | 心跳 |
| `GET /Branding/Configuration` | 静态返回 | 空品牌配置 |
| `GET /Branding/Css` | 静态返回 | 空 CSS |
| `POST /Users/AuthenticateByName` | `POST /v/api/v1/login` | 登录转换 |
| `GET /Users/{userId}` | `GET /v/api/v1/user/info` | 用户信息转换 |
| `GET /Users/Me` | `GET /v/api/v1/user/info` | 当前用户信息 |

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

### 第二阶段：媒体库浏览（可看到内容）

目标：让客户端能浏览媒体库、看到电影和电视剧列表。

#### 需要实现的端点

| Jellyfin 端点 | 飞牛 API 映射 | 说明 |
|---|---|---|
| `GET /UserViews` | 构造虚拟媒体库 | 基于飞牛的分类构造 |
| `GET /Items` | `POST /v/api/v1/item/list` | 媒体列表，需要参数转换 |
| `GET /Users/{userId}/Items` | `POST /v/api/v1/item/list` | 同上（旧版路径） |
| `GET /Users/{userId}/Items/{itemId}` | `POST /v/api/v1/play/info` | 单项详情 |
| `GET /Items/{itemId}/Images/{type}` | 飞牛图片 URL 代理 | 海报/剧照代理 |
| `GET /Shows/{seriesId}/Seasons` | `GET /v/api/v1/episode/list/{id}` | 季列表 |
| `GET /Shows/{seriesId}/Episodes` | `GET /v/api/v1/episode/list/{id}` | 集列表 |

#### 关键设计

**ID 映射系统**：
飞牛使用字符串 GUID（如 `fv_30006e2fdaa44c7aac2c3cb25c10121d`），Jellyfin 使用标准 UUID。

方案：使用 UUID v5（基于命名空间的确定性 UUID）
```typescript
import { v5 as uuidv5 } from 'uuid';
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

### 第三阶段：视频播放（核心功能）

目标：让客户端能播放视频。

#### 需要实现的端点

| Jellyfin 端点 | 飞牛 API 映射 | 说明 |
|---|---|---|
| `GET /Items/{itemId}/PlaybackInfo` | `POST /v/api/v1/play/info` + `GET /v/api/v1/stream/list/{id}` | 播放信息 |
| `POST /Items/{itemId}/PlaybackInfo` | 同上 | 播放信息（POST 版） |
| `GET /Videos/{itemId}/stream` | `/v/api/v1/media/range/{mediaGuid}` | 视频流代理 |
| `GET /Videos/{itemId}/stream.{container}` | 同上 | 视频流代理（带容器格式） |
| `GET /Items/{itemId}/PlaybackInfo` → MediaSources | `POST /v/api/v1/stream` + `POST /v/api/v1/play/quality` | 媒体源信息 |

#### 关键设计

**PlaybackInfoResponse 构造**：
```typescript
{
  MediaSources: [{
    Id: mediaGuid,
    Name: fileName,
    Path: videoUrl,
    Protocol: "Http",
    Type: "Default",
    Container: 容器格式,
    SupportsDirectPlay: true,
    SupportsDirectStream: true,
    SupportsTranscoding: false,  // 飞牛不支持转码
    MediaStreams: [
      // 视频流 ← video_streams
      // 音频流 ← audio_streams  
      // 字幕流 ← subtitle_streams
    ],
    DirectStreamUrl: "/Videos/{id}/stream?static=true&..."
  }]
}
```

**视频流代理**：
参考 fntv-electron 的 proxy 模块逻辑：
1. 解析请求中的 itemId → 查找对应的 mediaGuid
2. 调用飞牛 `POST /v/api/v1/stream` 获取流信息
3. 判断是本地 NAS 还是云盘
4. 本地：透明代理 `/v/api/v1/media/range/{mediaGuid}`（附加 Authorization）
5. 云盘：代理直链 URL（附加对应 Cookie/UA）
6. 支持 Range 请求（断点续传）

**字幕处理**：
- `GET /Videos/{itemId}/{mediaSourceId}/Subtitles/{index}/Stream.{format}`
- 代理飞牛的 `/v/api/v1/subtitle/dl/{subtitleGuid}`

### 第四阶段：播放状态同步

目标：播放进度、已观看状态同步回飞牛。

#### 需要实现的端点

| Jellyfin 端点 | 飞牛 API 映射 | 说明 |
|---|---|---|
| `POST /Sessions/Playing` | `POST /v/api/v1/play/record` | 开始播放 |
| `POST /Sessions/Playing/Progress` | `POST /v/api/v1/play/record` | 播放进度 |
| `POST /Sessions/Playing/Stopped` | `POST /v/api/v1/play/record` | 停止播放 |
| `POST /UserPlayedItems/{itemId}` | `POST /v/api/v1/item/watched` | 标记已观看 |
| `DELETE /UserPlayedItems/{itemId}` | 无对应 | 返回成功但不操作 |

#### 关键设计

**Ticks 转换**：
Jellyfin 使用 ticks（1 tick = 100 纳秒），飞牛使用秒。
```typescript
const seconds = ticks / 10_000_000;
const ticks = seconds * 10_000_000;
```

### 第五阶段：增强功能

| 功能 | 说明 |
|---|---|
| 搜索 | `GET /Items` 带 searchTerm 参数 |
| 继续观看 | `GET /Items?Filters=IsResumable` |
| 最近添加 | `GET /Items?SortBy=DateCreated&SortOrder=Descending` |
| 下一集 | `GET /Shows/NextUp` |
| 收藏 | `POST /UserFavoriteItems/{itemId}` |

## 项目结构

```
fnos-bridge/
├── fnos-auth/              # 子模块：飞牛认证
├── fntv-electron/          # 子模块：参考资料
├── jellyfin/               # 子模块：参考资料
├── specs/                  # 设计文档
├── src/
│   ├── index.ts            # 入口，启动 HTTP 服务器
│   ├── server.ts           # Hono 应用配置
│   ├── config.ts           # 配置（端口、飞牛地址等）
│   ├── middleware/
│   │   ├── auth.ts         # 解析 Jellyfin Authorization 头，提取飞牛凭据
│   │   └── logger.ts       # 请求日志
│   ├── routes/
│   │   ├── system.ts       # /System/* 端点
│   │   ├── branding.ts     # /Branding/* 端点
│   │   ├── users.ts        # /Users/* 端点（认证 + 用户信息）
│   │   ├── items.ts        # /Items/* 端点（媒体浏览）
│   │   ├── shows.ts        # /Shows/* 端点（剧集）
│   │   ├── images.ts       # 图片代理
│   │   ├── videos.ts       # /Videos/* 端点（视频流代理）
│   │   ├── playback.ts     # /Sessions/Playing/* 端点
│   │   └── subtitles.ts    # 字幕代理
│   ├── services/
│   │   ├── fnos.ts         # 飞牛 API 服务封装（基于 FnosClient）
│   │   └── session.ts      # 会话管理（token 映射）
│   ├── mappers/
│   │   ├── id.ts           # ID 映射（飞牛 GUID ↔ Jellyfin UUID）
│   │   ├── item.ts         # 飞牛 Item → Jellyfin BaseItemDto
│   │   ├── user.ts         # 飞牛 UserInfo → Jellyfin UserDto
│   │   ├── media.ts        # 飞牛 Stream → Jellyfin MediaSource/MediaStream
│   │   └── playstate.ts    # Jellyfin PlayState → 飞牛 PlayRecord
│   ├── proxy/
│   │   ├── video.ts        # 视频流反向代理（支持 Range）
│   │   └── image.ts        # 图片反向代理
│   └── types/
│       ├── jellyfin.ts     # Jellyfin API 类型定义
│       └── fnos.ts         # 飞牛 API 类型（从 fntv-electron 提取）
├── tests/
│   ├── mappers/            # 映射器单元测试
│   └── routes/             # 路由集成测试
├── package.json
└── tsconfig.json
```

## 已知限制与风险

1. **无转码能力**：飞牛影视不提供服务端转码 API，客户端必须能直接播放原始格式。大部分 Jellyfin 客户端支持直接播放，但某些格式可能不兼容。
2. **云盘播放**：云盘直链有过期时间和速率限制，需要参考 fntv-electron proxy 模块的处理逻辑。
3. **飞牛 API 稳定性**：飞牛影视 API 非公开文档，可能随版本更新变化。
4. **并发限制**：飞牛 API 的 Authx 签名基于时间戳，高并发下可能出现签名冲突（fnos-auth 已有重试机制）。
5. **媒体库结构差异**：飞牛的媒体组织方式与 Jellyfin 不完全一致，需要在映射层做适配。

## 开发优先级

```
第一阶段（P0）：基础框架 + 认证     → 客户端能连接登录
第二阶段（P0）：媒体库浏览          → 客户端能看到内容列表和封面
第三阶段（P0）：视频播放            → 客户端能播放视频
第四阶段（P1）：播放状态同步        → 进度和已观看状态回传
第五阶段（P2）：增强功能            → 搜索、继续观看、收藏等
```
