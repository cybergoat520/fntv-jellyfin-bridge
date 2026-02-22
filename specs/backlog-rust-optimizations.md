# fnos-bridge Rust 版 — 待优化项（低优先级）

可以做但不紧急的优化，按需推进。

## ~~1. stream/list 和 play/info 请求缓存~~ ✅

已实现（bf19f86）— `cached_get_stream_list` + `cached_get_user_info` TTL 缓存。

## ~~2. user/info 请求合并~~ ✅

已实现（bf19f86）— session 层 user_info 缓存。

## ~~3. fnos_client 日志级别调整~~ ✅

已实现（adc58f4）— 日志级别重构。

## ~~4. Windows 本地编译支持~~ ✅

已解决 — Visual Studio Build Tools 安装后可正常编译。

## 5. 路径规范化优化

**现状**：当前实现了大小写规范化（如 `/system/info/public` → `/System/Info/Public`），但未实现双斜杠规范化。bridge-node 版本有双斜杠处理（`//System/Info` → `/System/Info`），但 bridge-rust 没有。

**背景**：
- 标准客户端（jellyfin-web、Xbox、Android 等）都会发送正确的路径
- 大小写规范化是容错处理，防止第三方客户端或手动请求出错
- 双斜杠规范化在 bridge-node 中是为 Xbox 添加的，但实际上 Xbox 也不会产生双斜杠路径

**方案选项**：

**选项 A - 保持现状**：
- 维持现有大小写规范化
- 不添加双斜杠处理（因为没有实际需求）
- 移除相关的测试代码（已移到 `path-normalization.test.ts`，可删除）

**选项 B - 完整实现**：
- 在 `normalize_path` 中添加双斜杠处理：
  ```rust
  let path = path.replace("//", "/");
  ```
- 统一处理所有非标准路径变体

**选项 C - 移除大小写规范化**：
- 如果确认所有客户端都使用正确的大小写，可以移除该功能简化代码
- 需要充分测试各主流客户端（jellyfin-web、Xbox、Android、iOS）

**建议**：选项 A（保持现状），因为没有实际场景需要双斜杠支持，且大小写规范化对容错有帮助。`path-normalization.test.ts` 中的测试可以保留作为回归测试，但标记为可选/容错性质。

## 6. DeviceProfile 支持（精确 DirectStream 判断）

**现状**：当前 `SupportsDirectStream` 基于硬编码的浏览器兼容音频列表（AAC/MP3/FLAC/Opus 等）判断，不考虑客户端传来的实际能力：

```rust
const BROWSER_COMPATIBLE_CODECS: &[&str] = &["aac", "mp3", "flac", "opus", ...];
```

**问题**：
- 老浏览器可能不支持 FLAC/Opus，但我们显示 `SupportsDirectStream=true`
- Xbox、手机等客户端能力不同，但判断逻辑一样
- 客户端在 `PlaybackInfo` 请求中传了 `DeviceProfile`，我们未解析使用

**标准 Jellyfin 行为**：
客户端请求 `PlaybackInfo` 时传入 `DeviceProfile`，包含：
```json
{
  "DeviceProfile": {
    "DirectPlayProfiles": [{"Container": "mkv", "VideoCodec": "h264,hevc", "AudioCodec": "aac,mp3"}],
    "CodecProfiles": [...],
    "TranscodingProfiles": [...]
  }
}
```

服务器根据客户端声明的能力，精确计算每个版本的 `SupportsDirectStream`。

**方案**：
1. 在 `mediainfo.rs` 中解析 `DeviceProfile`
2. 根据 `DirectPlayProfiles` 和 `CodecProfiles` 判断视频/音频兼容性
3. 动态设置 `SupportsDirectStream`
4. 如果未传 `DeviceProfile`，回退到当前硬编码逻辑

**影响**：
- 客户端自动选择版本更准确
- 减少因误判导致的播放失败
- 多版本场景下用户体验更好（自动选最优版本而非保守选择）

**优先级**：低（当前硬编码覆盖大多数场景）

## 7. 内嵌字幕处理（飞牛 Range 抓取方案评估）— 方案 B 已实施 ✅

**研究时间**：2026-02-22

**飞牛客户端实现方式**：
通过抓包发现，飞牛客户端**不通过专门的字幕 API** 获取内嵌字幕，而是：
1. 通过 `media/range` HTTP Range 请求直接读取视频文件
2. 先请求文件头（moov box 或 MKV Segment）解析字幕轨道位置和样本偏移表
3. 再根据偏移表 Range 请求字幕数据段
4. 客户端本地解码 SRT/ASS/PGS 并渲染

**当前桥接项目的问题**：
- 飞牛没有提供字幕提取 API
- 我们的桥接层需要兼容 Jellyfin 的 `/Subtitles/{index}/Stream.vtt` 端点
- 文本字幕（SRT/ASS）已支持（通过飞牛字幕接口或外挂字幕）
- **内嵌字幕暂未支持**：Jellyfin Web 请求字幕时会失败

### 方案 A：Bridge 层实现 Range 抓取（文本字幕）

**技术实现**：
```
客户端请求 /Subtitles/{index}/Stream.vtt
    ↓
1. 查缓存 (media_guid, track_index) → 字幕数据偏移列表
2. 无缓存：
   a. Range 请求文件头（0-64KB 或 0-1MB）
   b. 解析 MP4 moov box 或 MKV Segment/Tracks，定位字幕轨道
   c. 提取样本偏移表（stsz/stco for MP4, Cluster/Block for MKV）
   d. 缓存偏移列表
3. Range 请求字幕数据段
4. SRT/ASS 解码（UTF-8/GBK 检测）
5. 时间轴转换，输出 WebVTT
```

**开发周期**（仅文本字幕，不含 PGS 位图）：

| 模块 | 工作量 | 技术细节 |
|------|--------|----------|
| **MP4 解析** | 3-5 天 | `mp4parse` crate，读取 trak → mdia → minf → stbl → stsz/stco，处理 moov 在文件头或尾部的情况 |
| **MKV 解析** | 5-7 天 | `matroska` crate，解析 Segment → Tracks → TrackEntry，定位 Cluster，处理 Cues 索引 |
| **字幕缓存** | 2 天 | DashMap<(media_guid, track_id), Vec<(offset, size)>>，TTL 5分钟 |
| **Range 请求** | 2 天 | 复用现有 `fnos_get_stream`，添加 Range header 支持 |
| **SRT 转 WebVTT** | 1 天 | 时间格式 00:00:00,000 → 00:00:00.000 |
| **ASS 转 WebVTT** | 2-3 天 | 解析 Events 段落，处理 Dialogue 行，丢弃样式，时间轴对齐 |
| **编码检测** | 1-2 天 | `chardetng` 或 `encoding_rs` 检测 UTF-8/GBK/BIG5 |
| **集成测试** | 2-3 天 | 不同工具封装的 MP4/MKV（ffmpeg、mkvtoolnix、HandBrake） |

**总计：2-3 周**（只做 MP4 可缩短至 1.5-2 周）

**运行时开销**：
- 首次播放延迟：+100-300ms（下载文件头解析）
- 内存占用：每片字幕索引约 50-200 字节（1000 条字幕约 100-200KB）
- 并发：字幕 Range 请求和视频流并发

**主要风险**：
| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| MKV Cluster 无索引 | 需要线性扫描找字幕位置，延迟高 | 只支持带 Cues 索引的 MKV |
| 字幕编码非 UTF-8 | 中文乱码 | chardetng 自动检测 |
| moov 在文件尾部 | 需要两次 Range | 首次请求最后 64KB |

### 方案 B：标记不支持（✅ 当前已实施，42d49b9）

**实现**：在 `map_subtitle_stream()` 中检测内嵌字幕，设置：
```rust
"IsTextSubtitleStream": false,
"SupportsExternalStream": false,
// 不提供 DeliveryUrl
```

**效果**：Jellyfin Web 不显示内嵌字幕轨道，播放正常进行。

**开发周期**：1 天

### 对比与建议

| 维度 | 方案 A（MP4 内嵌字幕） | 方案 B（禁用内嵌字幕） |
|------|---------------------|-----------------------|
| 开发周期 | **1.5-2 周** | 1 天 |
| 覆盖面 | MP4 内嵌 SRT/ASS（约 70% 场景） | 无 |
| 用户体验 | 内嵌字幕可用 | 需外挂字幕或飞牛客户端 |
| 维护成本 | 高（容器格式兼容性） | 无 |

**建议**：
- **短期**：实施方案 B，保证播放稳定性
- **中期**：根据用户反馈决定是否投入 1.5-2 周做 MP4 内嵌字幕（不做 MKV 和 PGS）
- **长期**：推动飞牛官方提供字幕提取 API

**相关代码**：
- `bridge-rust/src/mappers/media.rs`：`map_subtitle_stream()` 函数
- `bridge-rust/src/routes/stream.rs`：字幕流端点

## 8. 字幕搜索下载（飞牛字幕库集成）

**研究时间**：待研究（需抓包确认飞牛 API）

**背景**：
飞牛影视客户端支持从外部字幕库（射手网、字幕库等）搜索下载字幕。桥接项目目前不支持此功能，用户只能手动上传外挂字幕。

**可能的实现方案**：

### 方案 A：代理飞牛字幕搜索（推荐）
**前提**：飞牛提供字幕搜索 API（需抓包确认）

**假设的飞牛 API**（需验证）：
```http
# 搜索字幕
POST /v/api/v1/subtitle/search
{
  "item_guid": "视频ID",
  "language": "chi",
  "format": "srt"
}

# 返回示例
{
  "subtitles": [
    {"id": "xxx", "name": "xxx.srt", "language": "chi", "source": "shooter"}
  ]
}

# 下载字幕
POST /v/api/v1/subtitle/download
{
  "item_guid": "视频ID",
  "subtitle_id": "xxx"
}
```

**桥接实现**：
1. 添加 `/Items/{itemId}/RemoteSearch/Subtitles` 端点
2. 转发请求到飞牛字幕搜索 API
3. 映射返回格式到 Jellyfin 的 RemoteSubtitleInfo
4. 添加字幕下载端点，代理到飞牛下载 API

**开发周期**：3-5 天（确认 API 后）

### 方案 B：Jellyfin 原生字幕提供商
**实现**：实现 Jellyfin 的 `ISubtitleProvider` 接口，集成飞牛字幕库

**缺点**：
- 复杂度高（1-2 周）
- 需要适配 Jellyfin 插件架构

**不建议**：桥接层应保持轻量，不应深入 Jellyfin 内部机制。

### 当前状态
- 未开始研究
- 需抓包确认飞牛字幕搜索 API 的具体端点和参数

**下一步**：
1. 抓包飞牛客户端的字幕搜索请求
2. 确认 API 端点、请求参数、返回格式
3. 评估方案 A 可行性

**相关代码**（Node 版参考）：
- `bridge-node/src/routes/subtitles.ts`：字幕路由

## 9. PlaybackInfo 完整 body 解析 + StartTimeTicks 支持

**研究时间**：2026-02-22

**背景**：
jellyfin-web 在切换音频/字幕/质量时，会 POST `/Items/{itemId}/PlaybackInfo`，body 包含完整的播放参数。当前 bridge-rust 只解析了部分字段。

**实际抓包的 PlaybackInfo body**：
```json
{
  "UserId": "6ed3f552-98cf-5eab-912b-2d493de87625",
  "StartTimeTicks": 510000000,
  "IsPlayback": true,
  "AutoOpenLiveStream": true,
  "AudioStreamIndex": "1",
  "SubtitleStreamIndex": "-1",
  "MediaSourceId": "08523386ed554328a14bc4845f0fb42c",
  "MaxStreamingBitrate": 40000000,
  "AlwaysBurnInSubtitleWhenTranscoding": false,
  "DeviceProfile": {
    "MaxStreamingBitrate": 120000000,
    "MaxStaticBitrate": 100000000,
    "MusicStreamingTranscodingBitrate": 384000,
    "DirectPlayProfiles": [
      {"Container": "webm", "Type": "Video", "VideoCodec": "vp8,vp9,av1", "AudioCodec": "vorbis,opus"},
      {"Container": "mp4,m4v", "Type": "Video", "VideoCodec": "h264,hevc,vp9,av1", "AudioCodec": "aac,mp3,ac3,eac3,flac,alac,vorbis,opus,dts"},
      ...
    ],
    "CodecProfiles": [...],
    "TranscodingProfiles": [...]
  }
}
```

**注意**：`AudioStreamIndex` 和 `SubtitleStreamIndex` 是**字符串**（`"1"`、`"-1"`），不是数字！已通过 lenient 反序列化修复。

**当前已解析的字段**：
- `MediaSourceId` ✓
- `AudioStreamIndex` ✓（lenient 反序列化）
- `SubtitleStreamIndex` ✓（lenient 反序列化）
- `MaxStreamingBitrate` ✓（lenient 反序列化）
- `EnableDirectPlay` ✓（lenient 反序列化）
- `EnableDirectStream` ✓（lenient 反序列化）

**待实现**：

### 9a. StartTimeTicks → HLS 转码起始位置
**现状**：切换音频走 HLS 转码时，`get_or_create_hls_session` 的 `startTimestamp` 固定为 0，导致从头开始转码。
**方案**：
1. `PlaybackInfoDto` 加 `StartTimeTicks` 字段
2. `StreamMeta` 加 `start_timestamp: f64`（秒）
3. `get_or_create_hls_session` 使用 `meta.start_timestamp` 传给飞牛 `play/play`
4. ticks → 秒转换：`start_time_ticks / 10_000_000.0`

**开发周期**：0.5 天

### 9b. DeviceProfile 解析（见 backlog #6）
**现状**：`DeviceProfile` 包含客户端支持的编解码器列表，可用于精确判断 `SupportsDirectStream`。
**方案**：见 backlog #6

### 9c. SubtitleStreamIndex 处理
**现状**：已解析但未使用。
**方案**：
1. 根据 `SubtitleStreamIndex` 更新 `DefaultSubtitleStreamIndex`
2. 如果字幕需要转码（如 PGS → 烧录），影响 HLS 转码参数

**开发周期**：1 天

**相关代码**：
- `bridge-rust/src/routes/mediainfo.rs`：`PlaybackInfoDto` 结构体
- `bridge-rust/src/services/hls_session.rs`：`StreamMeta` 和 `get_or_create_hls_session`
