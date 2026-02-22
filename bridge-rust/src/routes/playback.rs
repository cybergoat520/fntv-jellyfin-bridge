/// 播放状态路由 — Sessions/Playing/*

use axum::{
    extract::State,
    routing::post,
    Router,
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
use crate::cache::item_list::update_item_progress;
use crate::services::session::{SessionData, NowPlayingState, set_now_playing, update_now_playing_progress, clear_now_playing};

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

    let item_id = body["ItemId"].as_str().unwrap_or("").to_string();
    let position_ticks = body["PositionTicks"].as_i64().unwrap_or(0);
    let is_paused = body["IsPaused"].as_bool().unwrap_or(false);

    // 更新正在播放状态
    let token = &session.access_token;
    match event {
        "start" => {
            set_now_playing(token, NowPlayingState {
                item_id: item_id.clone(),
                position_ticks,
                is_paused,
            });
        }
        "progress" => {
            update_now_playing_progress(token, position_ticks, is_paused);
        }
        "stopped" => {
            clear_now_playing(token);
        }
        _ => {}
    }

    let fnos_guid = to_fnos_guid(&item_id).unwrap_or_default();
    if fnos_guid.is_empty() {
        return axum::http::StatusCode::NO_CONTENT;
    }

    let ts = ticks_to_seconds(position_ticks);

    // 获取客户端指定的 MediaSourceId（版本选择）
    let requested_media_source_id = body["MediaSourceId"].as_str().unwrap_or("").to_string();

    // 优先从缓存获取播放信息（仅在未指定版本时使用缓存）
    let play_data = if requested_media_source_id.is_empty() {
        PLAY_INFO_CACHE.get(&fnos_guid).and_then(|cached| {
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
        })
    } else {
        None
    };

    // 缓存未命中或指定了版本，请求 play/info 或从 stream_meta 获取
    let (media_guid, video_guid, audio_guid, subtitle_guid, duration) = match play_data {
        Some(data) => data,
        None => {
            // 如果客户端指定了 MediaSourceId，优先从 stream_meta 获取该版本的信息
            if !requested_media_source_id.is_empty() {
                if let Some(meta) = get_stream_meta(&requested_media_source_id) {
                    debug!(
                        "[PLAYBACK] 使用客户端指定的版本: media_source_id={}",
                        requested_media_source_id
                    );
                    (
                        requested_media_source_id.clone(),
                        meta.video_guid,
                        meta.audio_guid,
                        meta.subtitle_guid,
                        meta.duration,
                    )
                } else {
                    // stream_meta 中未找到，尝试请求 play/info 获取默认版本
                    debug!(
                        "[PLAYBACK] 未找到指定版本的流元数据，使用默认版本: media_source_id={}",
                        requested_media_source_id
                    );
                    fetch_play_info_and_cache(&session, &fnos_guid, config).await
                }
            } else {
                // 未指定版本，请求 play/info 获取默认版本
                fetch_play_info_and_cache(&session, &fnos_guid, config).await
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

/// 请求 play/info 并将结果写入缓存
async fn fetch_play_info_and_cache(
    session: &SessionData,
    fnos_guid: &str,
    config: &BridgeConfig,
) -> (String, String, String, String, f64) {
    let result = fnos_get_play_info(
        &session.fnos_server,
        &session.fnos_token,
        fnos_guid,
        config,
    )
    .await;

    if result.success && result.data.is_some() {
        let info = result.data.unwrap();
        let duration = info.item.duration;

        // 写入缓存
        PLAY_INFO_CACHE.insert(
            fnos_guid.to_string(),
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
        // 请求失败，返回空值
        debug!("[PLAYBACK] 获取 play/info 失败: {:?}", result.message);
        (String::new(), String::new(), String::new(), String::new(), 0.0)
    }
}
