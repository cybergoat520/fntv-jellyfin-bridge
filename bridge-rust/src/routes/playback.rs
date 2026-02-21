/// 播放状态路由 — Sessions/Playing/*

use axum::{
    extract::State,
    routing::post,
    Json, Router,
};
use dashmap::DashMap;
use serde_json::{json, Value};
use std::sync::LazyLock;
use std::time::Instant;
use tracing::debug;

use crate::config::BridgeConfig;
use crate::mappers::id::to_fnos_guid;
use crate::mappers::item::ticks_to_seconds;
use crate::middleware::auth::require_auth;
use crate::services::fnos::{fnos_get_play_info, fnos_record_play_status};
use crate::services::hls_session::{get_hls_play_link, get_stream_meta};
use crate::services::item_list_cache::update_item_progress;
use crate::services::session::SessionData;

/// 播放信息缓存
struct PlayInfoCacheEntry {
    media_guid: String,
    video_guid: String,
    audio_guid: String,
    subtitle_guid: String,
    duration: f64,
    cached_at: Instant,
}

/// 缓存 TTL：5 分钟
const CACHE_TTL_SECS: u64 = 5 * 60;

/// item_guid → PlayInfo 缓存
static PLAY_INFO_CACHE: LazyLock<DashMap<String, PlayInfoCacheEntry>> = LazyLock::new(DashMap::new);

pub fn router() -> Router<BridgeConfig> {
    Router::new()
        .route(
            "/Sessions/Playing",
            post(playing_start).layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Sessions/Playing/Progress",
            post(playing_progress).layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Sessions/Playing/Stopped",
            post(playing_stopped).layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Sessions/Playing/Ping",
            post(playing_ping).layer(axum::middleware::from_fn(require_auth)),
        )
}

async fn playing_start(
    State(config): State<BridgeConfig>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    handle_play_report(&config, req, "start").await.into_response()
}

async fn playing_progress(
    State(config): State<BridgeConfig>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    handle_play_report(&config, req, "progress").await.into_response()
}

async fn playing_stopped(
    State(config): State<BridgeConfig>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    handle_play_report(&config, req, "stopped").await.into_response()
}

async fn playing_ping() -> axum::http::StatusCode {
    axum::http::StatusCode::NO_CONTENT
}

async fn handle_play_report(
    config: &BridgeConfig,
    req: axum::extract::Request,
    event: &str,
) -> axum::http::StatusCode {
    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => return axum::http::StatusCode::UNAUTHORIZED,
    };

    let body: Value = match axum::body::to_bytes(req.into_body(), 1024 * 64).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or(json!({})),
        Err(_) => json!({}),
    };

    let item_id = body["ItemId"].as_str().unwrap_or("");
    let position_ticks = body["PositionTicks"].as_i64().unwrap_or(0);

    let fnos_guid = to_fnos_guid(item_id).unwrap_or_default();
    if fnos_guid.is_empty() {
        return axum::http::StatusCode::NO_CONTENT;
    }

    let ts = ticks_to_seconds(position_ticks);

    // 优先从缓存获取播放信息
    let play_data = if let Some(cached) = PLAY_INFO_CACHE.get(&fnos_guid) {
        if cached.cached_at.elapsed().as_secs() < CACHE_TTL_SECS {
            Some((
                cached.media_guid.clone(),
                cached.video_guid.clone(),
                cached.audio_guid.clone(),
                cached.subtitle_guid.clone(),
                cached.duration,
            ))
        } else {
            None
        }
    } else {
        None
    };

    // 缓存未命中，请求 play/info
    let (media_guid, video_guid, audio_guid, subtitle_guid, duration) = match play_data {
        Some(data) => data,
        None => {
            let result = fnos_get_play_info(
                &session.fnos_server,
                &session.fnos_token,
                &fnos_guid,
                config,
            )
            .await;

            if result.success && result.data.is_some() {
                let info = result.data.unwrap();
                let duration = info.item.duration;

                // 写入缓存
                PLAY_INFO_CACHE.insert(
                    fnos_guid.clone(),
                    PlayInfoCacheEntry {
                        media_guid: info.media_guid.clone(),
                        video_guid: info.video_guid.clone(),
                        audio_guid: info.audio_guid.clone(),
                        subtitle_guid: info.subtitle_guid.clone(),
                        duration,
                        cached_at: Instant::now(),
                    },
                );

                (
                    info.media_guid,
                    info.video_guid,
                    info.audio_guid,
                    info.subtitle_guid,
                    duration,
                )
            } else {
                // 请求失败，尝试从 stream_meta 获取（HLS 场景）
                let media_source_id = body["MediaSourceId"].as_str().unwrap_or("");
                let meta = get_stream_meta(media_source_id);
                (
                    media_source_id.to_string(),
                    meta.as_ref().map(|m| m.video_guid.clone()).unwrap_or_default(),
                    meta.as_ref().map(|m| m.audio_guid.clone()).unwrap_or_default(),
                    meta.as_ref().map(|m| m.subtitle_guid.clone()).unwrap_or_default(),
                    meta.as_ref().map(|m| m.duration).unwrap_or(0.0),
                )
            }
        }
    };

    let play_link = get_hls_play_link(&media_guid);

    debug!(
        "[PLAYBACK] {}: item={}, media={}, ts={:.1}s, duration={:.1}s",
        event, fnos_guid, media_guid, ts, duration
    );

    let ts_rounded = ts.round() as i64;
    let duration_rounded = duration.round() as i64;

    let result = fnos_record_play_status(
        &session.fnos_server,
        &session.fnos_token,
        json!({
            "item_guid": fnos_guid,
            "media_guid": media_guid,
            "video_guid": video_guid,
            "audio_guid": audio_guid,
            "subtitle_guid": subtitle_guid,
            "play_link": play_link,
            "ts": ts_rounded,
            "duration": duration_rounded,
        }),
        config,
    )
    .await;

    debug!(
        "[PLAYBACK] 上报结果: success={}, message={:?}",
        result.success, result.message
    );

    // 更新列表缓存中的播放进度
    update_item_progress(&session.fnos_server, &fnos_guid, ts);

    // 清理过期缓存
    PLAY_INFO_CACHE.retain(|_, v| v.cached_at.elapsed().as_secs() < CACHE_TTL_SECS * 2);

    axum::http::StatusCode::NO_CONTENT
}
