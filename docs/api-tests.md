# fnos-bridge API 测试文档

本文档列出所有 API 端点的测试用例。

## 测试概览

| 模块 | 测试文件 | 用例数 |
|------|----------|--------|
| System API | system.test.ts | 10 |
| Auth & Users API | auth.test.ts | 12 |
| Branding API | branding.test.ts | 3 |
| UserViews API | views.test.ts | 5 |
| Items API | items.test.ts | 12 |
| Shows API | shows.test.ts | 8 |
| Images API | images.test.ts | 9 |
| Stream API | stream.test.ts | 11 |
| Playback API | playback.test.ts | 14 |
| Resume API | resume.test.ts | 6 |
| Favorites API | favorites.test.ts | 4 |
| Misc API | misc.test.ts | 18 |
| **总计** | **12 个文件** | **112 个用例** |

## 运行测试

```bash
cd bridge-test
npm test                                    # 运行所有测试
npm test -- --test-name-pattern "System"    # 运行指定测试
```

---

## System API

系统信息端点，大部分无需认证。

| 端点 | 方法 | 认证 | 测试内容 |
|------|------|------|----------|
| `/System/Info/Public` | GET | 否 | 返回 ServerName、Version、Id、ProductName |
| `/System/Info/Public` | GET | 否 | 包含 LocalAddress 字段 |
| `/System/Info` | GET | 是 | 未认证返回 401 |
| `/System/Ping` | GET | 否 | 返回服务器名称字符串 |
| `/System/Ping` | POST | 否 | 支持 POST 方法 |
| `/System/Endpoint` | GET | 否 | 返回 IsLocal、IsInNetwork |
| `/Playback/BitrateTest` | GET | 否 | 返回指定大小的测试数据 |
| `/Playback/BitrateTest` | GET | 否 | 限制最大返回大小 |
| `/system/info/public` | GET | 否 | 路径大小写兼容 |

---

## Auth & Users API

认证和用户管理。

| 端点 | 方法 | 认证 | 测试内容 |
|------|------|------|----------|
| `/Users/Public` | GET | 否 | 返回公开用户列表（空数组） |
| `/Users` | GET | 否 | 返回空数组或 401 |
| `/Users/AuthenticateByName` | POST | 否 | 无效凭据返回 401 |
| `/Users/AuthenticateByName` | POST | 否 | 缺少用户名返回 400 |
| `/Users/AuthenticateByName` | POST | 否 | 缺少密码返回 400 |
| `/Users/AuthenticateByName` | POST | 否 | 有效凭据返回 AccessToken、User、ServerId |
| `/Users/Me` | GET | 是 | 返回当前用户信息 |
| `/Users/{userId}` | GET | 是 | 返回指定用户信息 |
| `/Users/{userId}` | GET | 是 | 无效用户 ID 返回 404 或空 |
| `/Users/Me` | GET | 是 | 无效令牌返回 401 |
| `/Users/Me` | GET | 是 | 缺失令牌返回 401 |
| `/Users/Me` | GET | 是 | 令牌在多次请求中保持有效 |

---

## Branding API

品牌配置，无需认证。

| 端点 | 方法 | 认证 | 测试内容 |
|------|------|------|----------|
| `/Branding/Configuration` | GET | 否 | 返回品牌配置对象 |
| `/Branding/Css.css` | GET | 否 | 返回自定义 CSS |
| `/branding/css.css` | GET | 否 | 路径大小写兼容 |

---

## UserViews API

媒体库列表。

| 端点 | 方法 | 认证 | 测试内容 |
|------|------|------|----------|
| `/UserViews` | GET | 是 | 返回 Items 数组、TotalRecordCount |
| `/UserViews` | GET | 是 | 包含电影和电视剧媒体库 |
| `/UserViews` | GET | 是 | 每个媒体库有 Id、Name、Type、ServerId、IsFolder |
| `/UserViews` | GET | 否 | 未认证返回 401 |
| `/Users/{userId}/Views` | GET | 是 | 重定向到 /UserViews |

---

## Items API

媒体列表和详情。

| 端点 | 方法 | 认证 | 测试内容 |
|------|------|------|----------|
| `/Items?ParentId={id}` | GET | 是 | 返回指定媒体库的项目列表 |
| `/Items?StartIndex=0&Limit=5` | GET | 是 | 支持分页 |
| `/Items?SearchTerm={term}` | GET | 是 | 支持搜索 |
| `/Items?IncludeItemTypes=Movie` | GET | 是 | 支持类型过滤 |
| `/Items?SortBy=SortName&SortOrder=Ascending` | GET | 是 | 支持排序 |
| `/Items/{itemId}` | GET | 是 | 返回项目详情（Id、Name、Type、ServerId） |
| `/Items/{itemId}` | GET | 是 | 视频项目包含 MediaSources |
| `/Items/{itemId}` | GET | 是 | 无效 ID 返回 404 或空 |
| `/Items/Filters` | GET | 是 | 返回 Genres、Tags、Years 数组 |
| `/Items/Latest?ParentId={id}` | GET | 是 | 返回最近添加的项目数组 |
| `/Items/Latest?IncludeItemTypes=Movie` | GET | 是 | 支持类型过滤 |
| `/Users/{userId}/Items` | GET | 是 | 重定向兼容 |

---

## Shows API

剧集的季和集。

| 端点 | 方法 | 认证 | 测试内容 |
|------|------|------|----------|
| `/Shows/{seriesId}/Seasons` | GET | 是 | 返回季列表（Type=Season） |
| `/Shows/{seriesId}/Seasons` | GET | 是 | 每季有 Id、Name、IndexNumber、SeriesId |
| `/Shows/{seriesId}/Seasons` | GET | 是 | 无效 ID 返回空列表或 404 |
| `/Shows/{seriesId}/Episodes` | GET | 是 | 返回所有集（Type=Episode） |
| `/Shows/{seriesId}/Episodes?SeasonId={id}` | GET | 是 | 支持按季过滤 |
| `/Shows/{seriesId}/Episodes?StartIndex=0&Limit=5` | GET | 是 | 支持分页 |
| `/Shows/{seriesId}/Episodes` | GET | 是 | 每集有 IndexNumber、ParentIndexNumber、SeriesId、SeriesName |
| `/Shows/NextUp` | GET | 是 | 返回空列表（暂未实现） |

---

## Images API

图片代理。

| 端点 | 方法 | 认证 | 测试内容 |
|------|------|------|----------|
| `/Items/{itemId}/Images/Primary` | GET | 是 | 返回主封面图或 404 |
| `/Items/{itemId}/Images/Primary?fillWidth=300&fillHeight=450` | GET | 是 | 支持尺寸参数 |
| `/Items/{itemId}/Images/Primary?maxWidth=500` | GET | 是 | 支持 maxWidth/maxHeight |
| `/Items/{itemId}/Images/Primary` | GET | 是 | 无效 ID 返回 404 或默认图 |
| `/Items/{itemId}/Images/Backdrop` | GET | 是 | 返回背景图或 404 |
| `/Items/{itemId}/Images/Thumb` | GET | 是 | 返回缩略图或 404 |
| `/Items/{itemId}/Images/Logo` | GET | 是 | 返回 Logo 或 404 |
| `/Items/{itemId}/Images/Banner` | GET | 是 | 返回 Banner 或 404 |
| `/Items/{itemId}/Images/Primary` | GET | 是 | 图片缓存（第二次请求更快） |

---

## Stream API

视频流和播放信息。

| 端点 | 方法 | 认证 | 测试内容 |
|------|------|------|----------|
| `/Items/{itemId}/PlaybackInfo` | POST | 是 | 返回 MediaSources 数组 |
| `/Items/{itemId}/PlaybackInfo` | POST | 是 | MediaSource 包含 MediaStreams |
| `/Items/{itemId}/PlaybackInfo` | POST | 是 | 支持 DirectStream 判断 |
| `/Items/{itemId}/PlaybackInfo` | POST | 是 | 无效 ID 返回 404 或空 |
| `/Videos/{itemId}/stream` | GET | 是 | 返回视频流（200/206） |
| `/Videos/{itemId}/stream` | GET | 是 | 支持 Range 请求 |
| `/Videos/{itemId}/stream.mkv` | GET | 是 | 支持带扩展名请求（头部 16KB） |
| `/Videos/{itemId}/stream.mkv` | GET | 是 | Range 请求中间 16KB |
| `/Videos/{itemId}/stream.mkv` | GET | 是 | Range 请求末尾 16KB |
| `/{mediaSourceId}/hls/main.m3u8` | GET | 是 | 无会话时返回 404/410 |
| `/{mediaSourceId}/hls/main.m3u8` | GET | 是 | 有会话时返回 HLS 播放列表 |
| `/Videos/{itemId}/{mediaSourceId}/Subtitles/{index}/Stream.{format}` | GET | 是 | 返回字幕或 404 |

---

## Playback API

播放状态同步。

| 端点 | 方法 | 认证 | 测试内容 |
|------|------|------|----------|
| `/Sessions/Playing` | POST | 是 | 报告播放开始，返回 204 |
| `/Sessions/Playing` | POST | 是 | 无效 ItemId 返回 204 或 404 |
| `/Sessions/Playing` | POST | 是 | 缺失 ItemId 返回 204 或 400 |
| `/Sessions/Playing/Progress` | POST | 是 | 报告播放进度（PositionTicks），返回 204 |
| `/Sessions/Playing/Progress` | POST | 是 | 支持暂停状态（IsPaused） |
| `/Sessions/Playing/Stopped` | POST | 是 | 报告播放停止，返回 204 |
| `/Sessions/Playing/Ping` | POST | 是 | 播放心跳，返回 204 |
| `/UserPlayedItems/{itemId}` | POST | 是 | 标记已观看，返回 200/204 |
| `/UserPlayedItems/{itemId}` | POST | 是 | 无效 ID 返回 200/204/404 |
| `/UserPlayedItems/{itemId}` | DELETE | 是 | 取消已观看，返回 200/204/501 |
| `/Sessions` | GET | 是 | 返回会话列表数组 |
| `/Sessions/Capabilities` | POST | 是 | 接受客户端能力上报，返回 204 |
| `/Sessions/Capabilities/Full` | POST | 是 | 接受完整客户端能力，返回 204 |

---

## Resume API

继续观看。

| 端点 | 方法 | 认证 | 测试内容 |
|------|------|------|----------|
| `/UserItems/Resume` | GET | 是 | 返回继续观看列表 |
| `/UserItems/Resume` | GET | 是 | 只返回有播放进度的项目 |
| `/UserItems/Resume?MediaTypes=Video` | GET | 是 | 支持类型过滤 |
| `/UserItems/Resume?StartIndex=0&Limit=5` | GET | 是 | 支持分页 |
| `/Users/{userId}/Items/Resume` | GET | 是 | 重定向到新路径 |
| `/Items?Filters=IsResumable` | GET | 是 | 支持 IsResumable 过滤 |

---

## Favorites API

收藏功能。

| 端点 | 方法 | 认证 | 测试内容 |
|------|------|------|----------|
| `/UserFavoriteItems/{itemId}` | POST | 是 | 添加收藏，返回 200/204 |
| `/UserFavoriteItems/{itemId}` | POST | 是 | 无效 ID 返回 200/204/404 |
| `/UserFavoriteItems/{itemId}` | DELETE | 是 | 取消收藏，返回 200/204 |
| `/Items?Filters=IsFavorite` | GET | 是 | 支持 IsFavorite 过滤 |

---

## Misc API

其他端点。

| 端点 | 方法 | 认证 | 测试内容 |
|------|------|------|----------|
| `/Localization/Countries` | GET | 否 | 返回空数组 |
| `/Localization/Cultures` | GET | 否 | 返回空数组 |
| `/Localization/ParentalRatings` | GET | 否 | 返回空数组 |
| `/DisplayPreferences/{id}` | GET | 否 | 返回 Id、SortBy、SortOrder |
| `/DisplayPreferences/{id}` | POST | 否 | 接受偏好设置，返回 204 |
| `/Items/{itemId}/Intros` | GET | 否 | 返回空 Items |
| `/Items/{itemId}/Similar` | GET | 否 | 返回空 Items |
| `/Items/{itemId}/ThemeMedia` | GET | 否 | 返回 ThemeVideosResult、ThemeSongsResult |
| `/Items/{itemId}/SpecialFeatures` | GET | 否 | 返回空数组 |
| `/SyncPlay/List` | GET | 否 | 返回空数组 |
| `/Studios` | GET | 否 | 返回空 Items |
| `/QuickConnect/Enabled` | GET | 否 | 返回 false |
| `/` | HEAD | 否 | 返回 200 |
| `/` | GET | 否 | 重定向到 /web/ |
| `/web` | GET | 否 | 重定向到 /web/ |
| `/favicon.ico` | GET | 否 | 返回 204 |
| `/Unknown/Endpoint` | GET | 否 | 兜底返回空响应而非 404 |

---

## 技术说明

### 路径规范化

所有路径支持大小写不敏感匹配，如 `/system/info/public` 等同于 `/System/Info/Public`。

### stream.{ext} 路由

Jellyfin 客户端请求 `/Videos/{id}/stream.mkv` 格式，bridge 内部转换为 `/Videos/{id}/stream/mkv` 进行路由匹配。

### Range 请求

- 飞牛 API 要求必须有 Range 头
- 客户端无 Range 时，bridge 添加 `Range: bytes=0-`
- 上游返回 206 时，bridge 转换为 200 并设置正确的 Content-Length

### 认证

需要认证的端点通过 `Authorization: MediaBrowser Token="xxx"` 头传递令牌。
