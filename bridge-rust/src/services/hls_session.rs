/// HLS 转码会话管理

use dashmap::DashMap;
use regex::Regex;
use serde_json::json;
use std::sync::LazyLock;
use tracing::{error, info};

use crate::config::BridgeConfig;
use crate::services::fnos::fnos_start_play;

/// 流元数据，用于调用 play/play
#[derive(Debug, Clone)]
pub struct StreamMeta {
    pub media_guid: String,
    pub item_guid: String,
    pub video_guid: String,
    pub video_encoder: String,
    pub resolution: String,
    pub bitrate: i64,
    pub audio_encoder: String,
    pub audio_guid: String,
    pub subtitle_guid: String,
    pub channels: i32,
    pub duration: f64,
}

/// HLS 会话信息
#[derive(Debug, Clone)]
struct HlsSession {
    play_link: String,
    session_guid: String,
    fnos_server: String,
    fnos_token: String,
    #[allow(dead_code)]
    created_at: i64,
}

/// mediaGuid → 流元数据
static STREAM_META_MAP: LazyLock<DashMap<String, StreamMeta>> = LazyLock::new(DashMap::new);

/// mediaGuid → HLS 会话
static HLS_SESSION_MAP: LazyLock<DashMap<String, HlsSession>> = LazyLock::new(DashMap::new);

/// 注册流元数据
pub fn register_stream_meta(media_guid: &str, meta: StreamMeta) {
    STREAM_META_MAP.insert(media_guid.to_string(), meta);
}

/// 获取流元数据
pub fn get_stream_meta(media_guid: &str) -> Option<StreamMeta> {
    STREAM_META_MAP.get(media_guid).map(|v| v.value().clone())
}

/// 获取 HLS 会话的 play_link
pub fn get_hls_play_link(media_guid: &str) -> String {
    HLS_SESSION_MAP
        .get(media_guid)
        .map(|v| v.play_link.clone())
        .unwrap_or_default()
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// 获取或创建 HLS 转码会话
pub async fn get_or_create_hls_session(
    server: &str,
    token: &str,
    media_guid: &str,
    config: &BridgeConfig,
) -> Option<(String, String)> {
    // 检查缓存
    if let Some(cached) = HLS_SESSION_MAP.get(media_guid) {
        return Some((cached.session_guid.clone(), cached.play_link.clone()));
    }

    // 获取流元数据
    let meta = STREAM_META_MAP.get(media_guid)?;
    let meta = meta.value().clone();

    info!("[HLS] 启动转码会话: mediaGuid={}", media_guid);

    let result = fnos_start_play(
        server,
        token,
        json!({
            "media_guid": meta.media_guid,
            "video_guid": meta.video_guid,
            "video_encoder": meta.video_encoder,
            "resolution": meta.resolution,
            "bitrate": meta.bitrate,
            "startTimestamp": 0,
            "audio_encoder": meta.audio_encoder,
            "audio_guid": meta.audio_guid,
            "subtitle_guid": meta.subtitle_guid,
            "channels": meta.channels,
            "forced_sdr": 0,
        }),
        config,
    )
    .await;

    if !result.success {
        error!("[HLS] play/play 失败: {:?}", result.message);
        return None;
    }

    let play_link = result.data.as_ref()?.play_link.clone();
    if play_link.is_empty() {
        error!("[HLS] play/play 返回空 play_link");
        return None;
    }

    // 从 play_link 提取 session GUID
    let re = Regex::new(r"/v/media/([^/]+)/").ok()?;
    let session_guid = re
        .captures(&play_link)?
        .get(1)?
        .as_str()
        .to_string();

    HLS_SESSION_MAP.insert(
        media_guid.to_string(),
        HlsSession {
            play_link: play_link.clone(),
            session_guid: session_guid.clone(),
            fnos_server: server.to_string(),
            fnos_token: token.to_string(),
            created_at: now_millis(),
        },
    );

    info!(
        "[HLS] 转码会话已创建: mediaGuid={} → sessionGuid={}",
        media_guid, session_guid
    );

    Some((session_guid, play_link))
}

/// 获取已缓存的 HLS 会话
pub fn get_cached_hls_session(media_guid: &str) -> Option<(String, String, String)> {
    let cached = HLS_SESSION_MAP.get(media_guid)?;
    Some((
        cached.session_guid.clone(),
        cached.fnos_server.clone(),
        cached.fnos_token.clone(),
    ))
}

/// 清除 HLS 会话缓存
pub fn clear_hls_session(media_guid: &str) {
    HLS_SESSION_MAP.remove(media_guid);
}
