/// 播放状态路由 — Sessions/Playing/*

use axum::{
    extract::State,
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};
use tracing::info;

use crate::config::BridgeConfig;
use crate::mappers::id::to_fnos_guid;
use crate::mappers::item::ticks_to_seconds;
use crate::middleware::auth::require_auth;
use crate::services::fnos::fnos_record_play_status;
use crate::services::hls_session::{get_hls_play_link, get_stream_meta};
use crate::services::session::SessionData;

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
    let media_source_id = body["MediaSourceId"].as_str().unwrap_or("");
    let position_ticks = body["PositionTicks"].as_i64().unwrap_or(0);

    let fnos_guid = to_fnos_guid(item_id).unwrap_or_default();
    if fnos_guid.is_empty() {
        return axum::http::StatusCode::NO_CONTENT;
    }

    let ts = ticks_to_seconds(position_ticks);
    let media_guid = if !media_source_id.is_empty() {
        media_source_id.to_string()
    } else {
        String::new()
    };

    // 获取流元数据
    let meta = get_stream_meta(&media_guid);
    let play_link = get_hls_play_link(&media_guid);

    let video_guid = meta.as_ref().map(|m| m.video_guid.as_str()).unwrap_or("");
    let audio_guid = meta.as_ref().map(|m| m.audio_guid.as_str()).unwrap_or("");
    let subtitle_guid = meta.as_ref().map(|m| m.subtitle_guid.as_str()).unwrap_or("");
    let duration = meta.as_ref().map(|m| m.duration).unwrap_or(0.0);

    info!(
        "[PLAYBACK] {}: item={}, ts={:.1}s, duration={:.1}s",
        event, fnos_guid, ts, duration
    );

    let _ = fnos_record_play_status(
        &session.fnos_server,
        &session.fnos_token,
        json!({
            "item_guid": fnos_guid,
            "media_guid": media_guid,
            "video_guid": video_guid,
            "audio_guid": audio_guid,
            "subtitle_guid": subtitle_guid,
            "play_link": play_link,
            "ts": ts,
            "duration": duration,
        }),
        config,
    )
    .await;

    axum::http::StatusCode::NO_CONTENT
}
