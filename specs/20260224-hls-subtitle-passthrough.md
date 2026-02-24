# HLS 字幕直通方案：启用 HLS.js 原生字幕轨道

## 背景

飞牛影视 HLS 转码输出的 `preset.m3u8`（master playlist）包含字幕子播放列表引用：

```
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Chinese",URI="subtitle.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=...,SUBTITLES="subs"
main.m3u8
```

- `main.m3u8` — 视频+音频，4s 切片（`.ts`）
- `subtitle.m3u8` — VTT 字幕，4s 切片（`.vtt`）

每次转码只包含一条字幕轨道。切换字幕语言需要重新转码，生成新的 HLS 会话。

飞牛影视的字幕分为两类：
- **内置字幕**（嵌在视频容器内）— 只能通过 HLS 转码提取，无法通过独立 URL 获取
- **外置字幕**（独立字幕文件）— 可以通过飞牛 API 直接获取，bridge-rust 已实现 [`subtitle_stream`](bridge-rust/src/proxy/stream.rs:407) handler 处理

本方案仅针对**内置字幕**的 HLS 转码场景。外置字幕走现有的 `External` DeliveryMethod 路径，不受影响。

当前 jellyfin-web 完全忽略 HLS.js 的字幕功能，所有字幕通过 Jellyfin Server API（`/Videos/{id}/.../Subtitles/{index}/Stream.js`）获取。对于内置字幕，bridge-rust 无法提供这个 API 的数据源，因此需要让 jellyfin-web 直接使用 HLS manifest 内嵌的 VTT 字幕分片。

## 方案概述

- **内置字幕**：使用 `DeliveryMethod: "Embed"`。`Embed` + `Transcode` 模式下，jellyfin-web 的 `playbackmanager.js` 会在字幕切换时自动调用 `changeStream()` 触发重新转码，这与飞牛 HLS 的行为完全一致。在 jellyfin-web 侧启用 HLS.js 的字幕功能，让它加载 manifest 中声明的 VTT 字幕分片并渲染。
- **外置字幕**：使用 `DeliveryMethod: "External"`。jellyfin-web 通过 bridge-rust 的 [`subtitle_stream`](bridge-rust/src/proxy/stream.rs:407) handler 获取字幕文件，走现有流程，无需改动。

## 改动详情

### 一、bridge-rust 侧

#### 1.1 HLS 代理层（已支持，无需改动）

`bridge-rust/src/proxy/stream.rs` 的 [`hls_stream`](bridge-rust/src/proxy/stream.rs:256) handler 已经能正确代理所有 HLS 文件：

```rust
// L48-49: 路由匹配
.route("/Videos/{mediaGuid}/hls/{file}", get(hls_stream))
.route("/{mediaGuid}/hls/{file}", get(hls_stream))
```

当 HLS.js 解析 `preset.m3u8` 后发现 `subtitle.m3u8` 引用，会请求 `/{mediaGuid}/hls/subtitle.m3u8`，该路径被 [`hls_stream`](bridge-rust/src/proxy/stream.rs:256) 正确处理：

```rust
// L294: 非 main.m3u8 的文件直接透传
let actual_file = if file == "main.m3u8" { "preset.m3u8" } else { &file };
```

VTT 切片（如 `sub_0.vtt`）走非 `.m3u8` 的流式传输分支（L337-351），同样能正确代理。

#### 1.2 mediaSource 字幕轨道标记（需新增）

bridge-rust 在构造返回给 jellyfin-web 的 `MediaStreams` 时，需要根据字幕类型设置不同的 `DeliveryMethod`：

**改动位置**：[`bridge-rust/src/mappers/media.rs`](bridge-rust/src/mappers/media.rs)（构造 MediaStream 的地方）

**内置字幕**（嵌在视频容器内）：

```json
{
    "Index": 2,
    "Type": "Subtitle",
    "Codec": "webvtt",
    "Language": "chi",
    "DisplayTitle": "Chinese",
    "DeliveryMethod": "Embed",
    "IsExternal": false
}
```

**外置字幕**（独立字幕文件）：

```json
{
    "Index": 3,
    "Type": "Subtitle",
    "Codec": "srt",
    "Language": "eng",
    "DisplayTitle": "English",
    "DeliveryMethod": "External",
    "IsExternal": true
}
```

内置字幕使用 `Embed`，在 `Transcode` 播放模式下，[`playbackmanager.js`](jellyfin-web/src/components/playback/playbackmanager.js:1528) 的字幕切换逻辑会自动调用 `changeStream()` 触发重新转码。外置字幕使用 `External`，客户端直接通过 [`subtitle_stream`](bridge-rust/src/proxy/stream.rs:407) handler 获取，不触发重新转码。

#### 1.3 m3u8 内容改写（无需改动）

飞牛返回的 `preset.m3u8` 中字幕 URI 使用相对路径（如 `subtitle.m3u8`），HLS.js 会基于 `preset.m3u8` 的 URL 自动拼接完整路径，请求会正确路由到 bridge-rust 的 [`hls_stream`](bridge-rust/src/proxy/stream.rs:256) handler。无需改写 m3u8 内容。

### 二、jellyfin-web 侧

#### 2.1 HLS.js 配置启用字幕

**文件**：[`plugin.js`](jellyfin-web/src/plugins/htmlVideoPlayer/plugin.js:455)  
**位置**：[`setSrcWithHlsJs()`](jellyfin-web/src/plugins/htmlVideoPlayer/plugin.js:440) 方法，约 L455

```js
// 改动前
const hls = new Hls({
    startPosition: options.playerStartPositionTicks / 10000000,
    manifestLoadingTimeOut: 20000,
    maxBufferLength: maxBufferLength,
    maxMaxBufferLength: maxBufferLength,
    videoPreference: { preferHDR: true },
    xhrSetup(xhr) {
        xhr.withCredentials = includeCorsCredentials;
    }
});

// 改动后
const hls = new Hls({
    startPosition: options.playerStartPositionTicks / 10000000,
    manifestLoadingTimeOut: 20000,
    maxBufferLength: maxBufferLength,
    maxMaxBufferLength: maxBufferLength,
    videoPreference: { preferHDR: true },
    subtitleDisplay: true,
    renderTextTracksNatively: true,
    xhrSetup(xhr) {
        xhr.withCredentials = includeCorsCredentials;
    }
});
```

- `subtitleDisplay: true` — 让 HLS.js 将 VTT cue 写入浏览器原生 TextTrack
- `renderTextTracksNatively: true` — 使用浏览器原生渲染

#### 2.2 字幕事件监听与自动激活

**文件**：[`htmlMediaHelper.js`](jellyfin-web/src/components/htmlMediaHelper.js:262)  
**位置**：[`bindEventsToHlsPlayer()`](jellyfin-web/src/components/htmlMediaHelper.js:262) 函数

新增 HLS.js 字幕事件监听，在 manifest 解析后自动激活字幕轨道：

```js
export function bindEventsToHlsPlayer(instance, hls, elem, onErrorFn, resolve, reject) {
    // ...现有的 MANIFEST_PARSED 和 ERROR 监听...

    // 新增：字幕轨道发现后自动激活
    hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, function (event, data) {
        if (data.subtitleTracks && data.subtitleTracks.length > 0) {
            // 飞牛 HLS 每次转码只包含一条字幕轨道，直接激活第一条
            hls.subtitleTrack = 0;
            console.debug('[HLS] 自动激活字幕轨道:', data.subtitleTracks[0].name);
        }
    });
}
```

因为飞牛每次转码只输出一条字幕轨道（用户选定的那条），所以直接激活 `subtitleTrack = 0` 即可。当用户切换字幕语言时，`playbackmanager.js` 会调用 `changeStream()` 触发重新转码，新的 HLS 会话会包含新的字幕轨道。

#### 2.3 renderTracksEvents 适配

**文件**：[`plugin.js`](jellyfin-web/src/plugins/htmlVideoPlayer/plugin.js:1440)  
**位置**：[`renderTracksEvents()`](jellyfin-web/src/plugins/htmlVideoPlayer/plugin.js:1440) 方法

当 HLS.js 已经在处理字幕时，需要跳过 [`fetchSubtitles()`](jellyfin-web/src/plugins/htmlVideoPlayer/plugin.js:1215) 的调用（否则会去请求不存在的 Server API）：

```js
async renderTracksEvents(videoElement, track, item, targetTextTrackIndex = PRIMARY_TEXT_TRACK_INDEX) {
    if (!itemHelper.isLocalItem(item) || track.IsExternal) {
        const format = (track.Codec || '').toLowerCase();

        // 新增：如果 HLS.js 已有字幕轨道，跳过 fetchSubtitles
        if (this._hlsPlayer && this._hlsPlayer.subtitleTracks?.length > 0) {
            // HLS.js 已经在处理字幕渲染，无需额外操作
            return;
        }

        if (format === 'ssa' || format === 'ass') {
            this.renderSsaAss(videoElement, track, item);
            return;
        }
        // ...原有逻辑...
    }
    // ...原有逻辑...
}
```

#### 2.4 playbackmanager 字幕关闭逻辑适配

**文件**：[`playbackmanager.js`](jellyfin-web/src/components/playback/playbackmanager.js:1509)
**位置**：[`setSubtitleStreamIndex()`](jellyfin-web/src/components/playback/playbackmanager.js:1509) 函数，L1527

当前逻辑中，`Embed` + `Transcode` 关闭字幕会触发 `changeStream()` 重新转码：

```js
// L1527-1530 原逻辑
if (currentStream && !newStream) {
    if (getDeliveryMethod(currentStream) === 'Encode'
        || (getDeliveryMethod(currentStream) === 'Embed' && currentPlayMethod === 'Transcode')) {
        changeStream(player, getCurrentTicks(player), { SubtitleStreamIndex: -1 });
    }
}
```

对于 HLS 内嵌字幕，关闭字幕不需要重新转码，只需在客户端禁用 HLS.js 字幕轨道。需要增加判断：

```js
// L1527-1530 改动后
if (currentStream && !newStream) {
    if (getDeliveryMethod(currentStream) === 'Encode') {
        changeStream(player, getCurrentTicks(player), { SubtitleStreamIndex: -1 });
    } else if (getDeliveryMethod(currentStream) === 'Embed' && currentPlayMethod === 'Transcode') {
        // 如果 HLS.js 有字幕轨道，关闭字幕走客户端处理，不重新转码
        if (player._hlsPlayer?.subtitleTracks?.length > 0) {
            selectedTrackElementIndex = -1;
        } else {
            changeStream(player, getCurrentTicks(player), { SubtitleStreamIndex: -1 });
        }
    }
}
```

#### 2.5 字幕关闭处理

当用户关闭字幕时，需要关闭 HLS.js 的字幕轨道（不触发重新转码）：

**位置**：[`setTrackForDisplay()`](jellyfin-web/src/plugins/htmlVideoPlayer/plugin.js:1237) 方法

```js
setTrackForDisplay(videoElement, track, targetTextTrackIndex = PRIMARY_TEXT_TRACK_INDEX) {
    if (!track) {
        // 新增：关闭 HLS.js 字幕轨道
        if (this._hlsPlayer) {
            this._hlsPlayer.subtitleTrack = -1;
        }
        this.destroyCustomTrack(videoElement, ...);
        return;
    }
    // ...原有逻辑...
}
```

### 三、数据流示意

```
用户点击播放（HLS 转码场景，带内置字幕）
│
├─ bridge-rust 返回 mediaSource
│  ├─ playMethod: "Transcode"
│  └─ MediaStreams 包含 { Type: "Subtitle", DeliveryMethod: "Embed" }
│
├─ jellyfin-web 初始化 HLS.js（subtitleDisplay: true）
│  └─ HLS.js 加载 preset.m3u8（通过 bridge-rust 代理）
│     ├─ 发现 subtitle.m3u8 引用
│     ├─ SUBTITLE_TRACKS_UPDATED 事件 → 自动激活 subtitleTrack = 0
│     └─ HLS.js 按需加载 VTT 切片 → 写入浏览器原生 TextTrack → 字幕显示
│
├─ 用户切换字幕语言（内置字幕之间切换）
│  ├─ playbackmanager: Embed + Transcode → changeStream()
│  ├─ bridge-rust 告诉飞牛重新转码（带新字幕轨道）
│  ├─ 新 HLS 会话 → 新 preset.m3u8 → 新 subtitle.m3u8
│  └─ HLS.js 重新加载 → 自动激活新字幕轨道
│
├─ 用户关闭字幕
│  ├─ playbackmanager: 检测到 HLS.js 有字幕轨道 → 客户端处理，不重新转码
│  ├─ setTrackForDisplay(null) → hls.subtitleTrack = -1
│  └─ 字幕停止显示，视频流不中断
│
└─ 用户选择外置字幕
   ├─ playbackmanager: External → 客户端处理，不重新转码
   └─ jellyfin-web 通过 bridge-rust subtitle_stream handler 获取字幕文件
```

### 四、改动量估算

jellyfin-web 总计约 **20 行代码**，涉及 3 个文件，无新增文件、无新增依赖、无 UI 改动：

| 文件 | 改动点 | 行数 |
|------|--------|------|
| [`plugin.js`](jellyfin-web/src/plugins/htmlVideoPlayer/plugin.js) | HLS 配置 + renderTracksEvents + setTrackForDisplay | ~12 行 |
| [`htmlMediaHelper.js`](jellyfin-web/src/components/htmlMediaHelper.js) | SUBTITLE_TRACKS_UPDATED 事件监听 + 自动激活 | ~5 行 |
| [`playbackmanager.js`](jellyfin-web/src/components/playback/playbackmanager.js) | 关闭字幕时跳过 changeStream | ~4 行 |

bridge-rust 侧仅需在 [`media.rs`](bridge-rust/src/mappers/media.rs) 中为内置/外置字幕设置正确的 `DeliveryMethod`。

### 五、bridge-rust web 静态文件自动更新

#### 5.1 背景

当前 bridge-rust 通过 [`ServeDir::new("web")`](bridge-rust/src/main.rs:113) 提供 jellyfin-web 静态文件服务，需要手动维护 `web` 目录。为简化更新流程，改为支持 `web.zip` 自动解压。

#### 5.2 启动时自动解压逻辑

**文件**：[`bridge-rust/src/main.rs`](bridge-rust/src/main.rs)
**位置**：`main()` 函数，在启动 HTTP 服务之前

```rust
use std::fs;
use std::path::Path;

fn extract_web_zip_if_needed() {
    let zip_path = Path::new("web.zip");
    if !zip_path.exists() {
        return;
    }

    println!("发现 web.zip，开始更新 web 目录...");

    // 1. 删除旧的 web 目录
    let web_dir = Path::new("web");
    if web_dir.exists() {
        if let Err(e) = fs::remove_dir_all(web_dir) {
            eprintln!("删除 web 目录失败: {}", e);
            return;
        }
    }

    // 2. 解压 web.zip 到 web 目录
    let file = fs::File::open(zip_path).expect("无法打开 web.zip");
    let mut archive = zip::ZipArchive::new(file).expect("无法解析 web.zip");
    archive.extract("web").expect("解压 web.zip 失败");

    // 3. 删除 web.zip
    if let Err(e) = fs::remove_file(zip_path) {
        eprintln!("删除 web.zip 失败: {}", e);
    }

    println!("web 目录更新完成");
}
```

在 `main()` 中调用：

```rust
#[tokio::main]
async fn main() {
    // 在启动服务之前执行
    extract_web_zip_if_needed();

    // ...现有启动逻辑...
}
```

#### 5.3 新增依赖

`Cargo.toml` 中添加 `zip` crate：

```toml
[dependencies]
zip = "2"
```

#### 5.4 更新流程

更新 jellyfin-web 只需：
1. 将新的 `web.zip` 放到 bridge-rust 工作目录
2. 重启 bridge-rust
3. 启动时自动：删除旧 `web` 目录 → 解压 `web.zip` → 删除 `web.zip`

路由层 [`ServeDir::new("web")`](bridge-rust/src/main.rs:113) 无需改动。

#### 5.5 改动量

bridge-rust 约 **15 行代码**（`main.rs`）+ 1 个新依赖（`zip` crate）。

### 六、已确认 / 待确认

1. ~~**飞牛 `preset.m3u8` 中字幕 URI 格式**~~ — 已确认为相对路径，无需改写。

2. **直接播放时的内置字幕** — 飞牛目前无法在直接播放（非转码）模式下提供内置字幕的字幕流。此问题暂时搁置，后续再处理。本方案仅覆盖 HLS 转码场景。

3. **外置字幕 + HLS 转码** — 当用户在 HLS 转码模式下选择外置字幕时，`DeliveryMethod: "External"` 会让 playbackmanager 走客户端处理路径（不触发 changeStream），jellyfin-web 通过 bridge-rust 的 subtitle_stream handler 获取字幕文件。需要确认此路径在 HLS 转码场景下正常工作。
