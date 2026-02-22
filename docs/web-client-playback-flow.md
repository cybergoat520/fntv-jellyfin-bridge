# Jellyfin Web 客户端播放流程详解

本文档详细描述飞牛桥接项目中，Jellyfin Web 客户端从用户选择版本到开始播放的完整流程。

## 流程概览

```
用户选择版本
    ↓
点击播放
    ↓
playbackManager.play()
    ↓
getPlaybackMediaSource()
    ↓
getPlaybackInfo() ──→ 后端 POST /PlaybackInfo
    ↓
getOptimalMediaSource() ──→ 前端选择版本
    ↓
createStreamInfo() ──→ 构造播放 URL
    ↓
player.play() ──→ 开始播放
```

---

## 1. 用户选择版本

**代码位置**: `jellyfin-web/src/controllers/itemDetails/index.js`

### 获取选中的版本 ID
```javascript
// 第 132-135 行
function getSelectedMediaSource(page, mediaSources) {
    const mediaSourceId = page.querySelector('.selectSource').value;
    return mediaSources.filter(m => m.Id === mediaSourceId)[0];
}
```

### 构造播放选项
```javascript
// 第 1952-1966 行
function getPlayOptions(startPosition) {
    return {
        startPositionTicks: startPosition,
        mediaSourceId: view.querySelector('.selectSource').value,  // 用户选的版本
        audioStreamIndex: view.querySelector('.selectAudio').value,
        subtitleStreamIndex: view.querySelector('.selectSubtitles').value
    };
}

function playItem(item, startPosition) {
    const playOptions = getPlayOptions(startPosition);
    playOptions.items = [item];
    playbackManager.play(playOptions);  // 进入播放管理器
}
```

---

## 2. PlaybackManager 入口

**代码位置**: `jellyfin-web/src/components/playback/playbackmanager.js`

### play() 方法
```javascript
// 第 2640 行
let mediaSourceId = playOptions.mediaSourceId;  // 用户选的版本 ID

// 第 2694 行
return getPlaybackMediaSource(
    player, 
    apiClient, 
    deviceProfile, 
    item, 
    mediaSourceId,  // 传递给后续流程
    options
).then(async (mediaSource) => {
    // ...
});
```

---

## 3. 获取媒体源

### getPlaybackMediaSource()
**代码位置**: `jellyfin-web/src/components/playback/playbackmanager.js:2941`

```javascript
function getPlaybackMediaSource(player, apiClient, deviceProfile, item, mediaSourceId, options) {
    options.isPlayback = true;

    return getPlaybackInfo(..., mediaSourceId, ...)  // 请求后端
        .then(function (playbackInfoResult) {
            return getOptimalMediaSource(apiClient, item, playbackInfoResult.MediaSources)
                .then(function (mediaSource) {
                    // 返回选中的媒体源
                    return mediaSource;
                });
        });
}
```

**关键逻辑**:
1. 调用 `getPlaybackInfo()` 获取 PlaybackInfo（包含所有版本）
2. 调用 `getOptimalMediaSource()` 从返回的版本中选择最优版本
3. 返回选中的版本给后续流程

---

## 4. 请求后端 PlaybackInfo

### getPlaybackInfo()
**代码位置**: `jellyfin-web/src/components/playback/playbackmanager.js:415`

```javascript
async function getPlaybackInfo(player, apiClient, item, deviceProfile, mediaSourceId, liveStreamId, options) {
    const query = {
        UserId: apiClient.getCurrentUserId(),
        StartTimeTicks: options.startPosition || 0
    };

    // 第 473-475 行：设置 MediaSourceId
    if (mediaSourceId) {
        query.MediaSourceId = mediaSourceId;  // 用户选择的版本
    }

    // 其他参数
    query.DeviceProfile = deviceProfile;
    query.IsPlayback = true;
    // ...

    // 第 501 行：发送 POST 请求
    const res = await mediaInfoApi.getPostedPlaybackInfo({
        itemId: itemId,
        playbackInfoDto: query  // 包含 MediaSourceId
    });
    return res.data;
}
```

**请求示例**:
```http
POST /Items/{itemId}/PlaybackInfo
Content-Type: application/json

{
    "MediaSourceId": "33d73e2cc2b8467bbd9d0414ceef5520",
    "DeviceProfile": { ... },
    "IsPlayback": true,
    "StartTimeTicks": 0
}
```

---

## 5. 后端处理 (bridge-rust)

**代码位置**: `bridge-rust/src/routes/mediainfo.rs`

### 处理流程

```rust
async fn playback_info(
    State(config): State<BridgeConfig>,
    Path(item_id): Path<String>,
    req: axum::extract::Request,
) -> Response {
    // 1. 读取请求 body
    let body_bytes = to_bytes(req.into_body(), 1024 * 64).await?;
    let body: PlaybackInfoDto = serde_json::from_slice(&body_bytes)?;
    
    let requested_media_source_id = body.media_source_id.unwrap_or_default();
    
    // 2. 获取飞牛的媒体信息
    let play_info = fnos_get_play_info(&fnos_guid).await?;
    let stream_list = fnos_get_stream_list(&fnos_guid).await?;
    
    // 3. 构建所有 MediaSources
    let mut media_sources = build_media_sources(...);
    
    // 4. 【关键】如果指定了 MediaSourceId，只返回那个版本
    if !requested_media_source_id.is_empty() {
        if let Some(pos) = media_sources.iter().position(|ms| {
            ms["Id"].as_str() == Some(&requested_media_source_id)
        }) {
            let selected = media_sources.remove(pos);
            media_sources = vec![selected];  // 只保留指定版本
        }
    }
    
    // 5. 返回
    Json(json!({
        "MediaSources": media_sources,  // 只有一个版本
        "PlaySessionId": play_session_id,
    }))
}
```

### 为什么要只返回指定版本？

如果返回所有版本，前端 `getOptimalMediaSource()` 会按以下优先级选择：
1. 支持 DirectPlay 的版本
2. 支持 DirectStream 的版本  ← 问题在这里！
3. 支持 Transcoding 的版本

如果用户选的版本音频编码不兼容（如 AC3），`SupportsDirectStream=false`，前端会自动**切换到其他版本**，导致用户选择失效。

**解决方案**: 只返回指定版本，前端没得选，只能用用户指定的版本。

---

## 6. 前端选择版本

### getOptimalMediaSource()
**代码位置**: `jellyfin-web/src/components/playback/playbackmanager.js:505`

```javascript
function getOptimalMediaSource(apiClient, item, versions) {
    return Promise.all(promises).then(function (results) {
        // 第 518-520 行：优先 DirectPlay
        let optimalVersion = versions.filter(function (v) {
            return v.enableDirectPlay;
        })[0];

        // 第 522-526 行：其次 DirectStream
        if (!optimalVersion) {
            optimalVersion = versions.filter(function (v) {
                return v.SupportsDirectStream;  // 关键判断！
            })[0];
        }

        // 第 528-530 行：最后 Transcoding
        if (!optimalVersion) {
            optimalVersion = versions.filter(function (s) {
                return s.SupportsTranscoding;
            })[0];
        }

        return optimalVersion || versions[0];
    });
}
```

**原版 Jellyfin 行为**:
- 如果传了 `MediaSourceId`，后端只返回那个版本
- `getOptimalMediaSource([versionA])` 只能返回 `versionA`
- 即使需要转码，也会使用用户指定的版本

---

## 7. 构造播放 URL

### createStreamInfo()
**代码位置**: `jellyfin-web/src/components/playback/playbackmanager.js:2807`

```javascript
function createStreamInfo(apiClient, type, item, mediaSource, startPosition, player) {
    const mediaSourceContainer = (mediaSource.Container || '').toLowerCase();
    
    if (mediaSource.enableDirectPlay) {
        // DirectPlay：直接使用 Path
        mediaUrl = mediaSource.Path;
        playMethod = 'DirectPlay';
        
    } else if (mediaSource.SupportsDirectStream) {
        // DirectStream：构造流 URL
        directOptions = {
            Static: true,
            mediaSourceId: mediaSource.Id,  // 选中的版本 ID
            deviceId: apiClient.deviceId(),
            ApiKey: apiClient.accessToken()
        };
        
        const prefix = type === 'Video' ? 'Videos' : 'Audio';
        mediaUrl = apiClient.getUrl(
            prefix + '/' + item.Id + '/stream.' + mediaSourceContainer, 
            directOptions
        );
        playMethod = 'DirectStream';
        
    } else if (mediaSource.SupportsTranscoding) {
        // Transcoding：使用转码 URL
        mediaUrl = apiClient.getUrl(mediaSource.TranscodingUrl);
        playMethod = 'Transcode';
    }
    
    return {
        url: mediaUrl,           // 最终播放 URL
        playMethod: playMethod,  // DirectPlay/DirectStream/Transcode
        mediaSource: mediaSource,
        // ...
    };
}
```

**生成的 URL 示例**:
```
http://localhost:8096/Videos/60a5de75-7843-5f7e-9719-0fa8406d1a8b/stream.mp4
    ?Static=true
    &mediaSourceId=33d73e2cc2b8467bbd9d0414ceef5520
    &deviceId=...
    &ApiKey=...
```

---

## 8. 开始播放

```javascript
// playbackmanager.js 第 2724 行
return player.play(streamInfo).then(function () {
    onPlaybackStartedFn();
    onPlaybackStarted(player, playOptions, streamInfo, mediaSource);
});
```

播放器使用 `streamInfo.url` 开始加载视频流。

---

## 常见问题与解决方案

### 问题 1: 版本选择无效

**现象**: 用户选择 4K 版本，实际播放 1080p

**原因**: 
- 后端返回所有版本
- 前端 `getOptimalMediaSource` 优先选择 `SupportsDirectStream=true` 的版本
- 4K 版本音频是 AC3，`SupportsDirectStream=false`
- 前端自动切换到 1080p AAC 版本

**解决方案**: 
```rust
// mediainfo.rs
if !requested_media_source_id.is_empty() {
    // 只返回指定版本，前端没得选
    media_sources = vec![selected_version];
}
```

### 问题 2: 客户端崩溃

**现象**: Web 客户端崩溃或黑屏

**原因**:
- 强制设置 `SupportsDirectStream=true` 给所有版本
- 浏览器尝试 DirectStream 播放不兼容的格式（如 AC3）
- 解码失败导致崩溃

**解决方案**:
- 正确设置 `SupportsDirectStream`（根据音频编码兼容性）
- 让不兼容的版本走 Transcoding 流程

### 问题 3: MediaSourceId 传递方式

**误区**: `MediaSourceId` 通过 URL query 参数传递

**实际**: `MediaSourceId` 在 **POST body** 中传递

```http
POST /Items/{itemId}/PlaybackInfo
{
    "MediaSourceId": "xxx",  // 在 body 中
    "DeviceProfile": {...}
}
```

后端需要从 body 读取，不是从 query。

---

## 关键文件索引

| 文件 | 作用 |
|------|------|
| `jellyfin-web/src/controllers/itemDetails/index.js:132` | 获取选中的版本 |
| `jellyfin-web/src/components/playback/playbackmanager.js:2640` | 入口 play() |
| `jellyfin-web/src/components/playback/playbackmanager.js:2941` | getPlaybackMediaSource() |
| `jellyfin-web/src/components/playback/playbackmanager.js:415` | getPlaybackInfo() |
| `jellyfin-web/src/components/playback/playbackmanager.js:505` | getOptimalMediaSource() |
| `jellyfin-web/src/components/playback/playbackmanager.js:2807` | createStreamInfo() |
| `bridge-rust/src/routes/mediainfo.rs` | 后端 PlaybackInfo 处理 |
| `bridge-rust/src/routes/stream.rs` | 后端流代理 |
| `bridge-rust/src/mappers/media.rs` | MediaSource 构建 |

---

## 总结

飞牛桥接项目正确处理版本选择的关键：

1. **前端传递**: `playbackManager.play()` → `getPlaybackInfo()` 将 `MediaSourceId` 放入 POST body
2. **后端处理**: 读取 body 中的 `MediaSourceId`，只返回指定版本
3. **前端选择**: `getOptimalMediaSource()` 只有一个选项，只能使用指定版本
4. **播放构造**: `createStreamInfo()` 用指定版本的 ID 构造流 URL
5. **实际播放**: 浏览器请求流，后端代理到飞牛 NAS（支持 DirectStream 或 Transcoding）
