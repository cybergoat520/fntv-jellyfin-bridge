# 修复播放信息"播放方式"显示 null

日期: 2026-02-22

## 问题

播放信息面板中"播放方式"显示为 `null`。

## 根因分析

### 客户端调用链

1. `playerstats.js` 调用 `apiClient.getSessions({ deviceId })` 请求 `/Sessions` 接口
2. 取返回数组的第一个 session，传给 `playmethodhelper.getDisplayPlayMethod(session)`
3. `getDisplayPlayMethod` 第一行检查 `if (!session.NowPlayingItem) return null`
4. 返回的 `null` 被直接渲染为字符串 "null"

### Bridge 端问题

`/Sessions` 接口（`main.rs:sessions_list`）返回写死的假数据：
- 缺少 `NowPlayingItem` 字段 → 导致 `getDisplayPlayMethod` 返回 null
- `UserId`、`DeviceId` 等全部为空字符串
- `PlayState` 中缺少 `PlayMethod` 字段
- 没有认证中间件，无法识别当前用户

## 修复方案

### 1. session 服务添加播放状态跟踪

文件: `bridge-rust/src/services/session.rs`

新增内存级"正在播放"状态存储（不需要持久化）：

```rust
pub struct NowPlayingState {
    pub item_id: String,        // Jellyfin item ID
    pub position_ticks: i64,
    pub is_paused: bool,
    pub started_at: i64,        // 毫秒时间戳
}

// 全局: access_token → NowPlayingState
static NOW_PLAYING: LazyLock<DashMap<String, NowPlayingState>> = LazyLock::new(DashMap::new);

pub fn set_now_playing(token: &str, state: NowPlayingState);
pub fn update_now_playing_progress(token: &str, position_ticks: i64, is_paused: bool);
pub fn clear_now_playing(token: &str);
pub fn get_now_playing(token: &str) -> Option<NowPlayingState>;
```

### 2. SessionData 添加 access_token 字段

文件: `bridge-rust/src/services/session.rs`

在 `SessionData` 中新增 `access_token: String` 字段，`get_session()` 时填入。

这样 playback 路由可以从 `req.extensions().get::<SessionData>()` 拿到 token，用于更新播放状态。

### 3. playback 路由更新播放状态

文件: `bridge-rust/src/routes/playback.rs`

在 `handle_play_report` 中根据 event 类型更新状态：

- `"start"`: 调用 `set_now_playing(token, ...)` — 从 body 提取 `ItemId`、`PositionTicks`、`IsPaused`
- `"progress"`: 调用 `update_now_playing_progress(token, ...)` — 更新进度和暂停状态
- `"stopped"`: 调用 `clear_now_playing(token)` — 清除播放状态

token 从 `session.access_token` 获取。

### 4. 改造 sessions_list 接口

文件: `bridge-rust/src/main.rs`

- 路由加上 `require_auth` 中间件
- 从 `SessionData` 填充真实字段
- 根据 `get_now_playing()` 决定是否包含 `NowPlayingItem`

```rust
async fn sessions_list(req: axum::extract::Request) -> Json<serde_json::Value> {
    let session = req.extensions().get::<SessionData>().unwrap();
    let now_playing = get_now_playing(&session.access_token);

    let mut session_json = json!({
        "Id": session.access_token,
        "UserId": session.user_id,
        "UserName": session.username,
        "Client": session.client,
        "DeviceId": session.device_id,
        "DeviceName": session.device_name,
        "ApplicationVersion": session.app_version,
        "IsActive": true,
        "SupportsRemoteControl": false,
    });

    if let Some(np) = now_playing {
        session_json["NowPlayingItem"] = json!({ "Id": np.item_id });
        session_json["PlayState"] = json!({
            "CanSeek": true,
            "IsPaused": np.is_paused,
            "IsMuted": false,
            "PlayMethod": "Transcode",
            "PositionTicks": np.position_ticks,
        });
    } else {
        session_json["PlayState"] = json!({
            "CanSeek": false,
            "IsPaused": true,
            "IsMuted": false,
        });
    }

    Json(json!([session_json]))
}
```

### 5. 关于 PlayMethod 值

Jellyfin SDK 定义了三种 PlayMethod：

| PlayMethod | 含义 |
|---|---|
| `DirectPlay` | 直接播放原始文件，不经过任何处理 |
| `DirectStream` | 直接串流，容器可能被重新封装（remux），但视频/音频流不转码 |
| `Transcode` | 转码，视频或音频被重新编码 |

Bridge 的场景：飞牛 NAS 端将 MKV 转为 HLS 串流，虽然视频音频流本身可能未重编码，但经过了飞牛端的转码服务处理，统一视为转码。

设置：
- `PlayState.PlayMethod`: `"Transcode"`
- `TranscodingInfo`: 不设置（null）

`getDisplayPlayMethod` 判断逻辑：
- 有 `NowPlayingItem` + `PlayMethod == "Transcode"` + 无 TranscodingInfo 直传标记 → 返回 `"Transcode"` → 显示"转码"

## 涉及文件

| 文件 | 改动 |
|------|------|
| `bridge-rust/src/services/session.rs` | 新增 NowPlayingState 存储 + SessionData 加 access_token |
| `bridge-rust/src/routes/playback.rs` | 在 start/progress/stopped 中更新播放状态 |
| `bridge-rust/src/main.rs` | 改造 sessions_list 为真实数据接口 |

预计改动量: ~60 行
