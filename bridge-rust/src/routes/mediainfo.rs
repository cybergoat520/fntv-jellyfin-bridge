/// PlaybackInfo 路由

use axum::{
    extract::{Path, State},
    routing::post,
    Json, Router,
};
use serde_json::json;

use crate::config::BridgeConfig;
use crate::mappers::id::*;
use crate::mappers::media::build_media_sources;
use crate::middleware::auth::{extract_token, require_auth};
use crate::services::fnos::*;
use crate::services::hls_session::{register_stream_meta, StreamMeta};
use crate::services::session::SessionData;

pub fn router() -> Router<BridgeConfig> {
    Router::new()
        .route(
            "/Items/{itemId}/PlaybackInfo",
            post(playback_info).layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Users/{userId}/Items/{itemId}/PlaybackInfo",
            post(playback_info_compat).layer(axum::middleware::from_fn(require_auth)),
        )
}

async fn playback_info(
    State(config): State<BridgeConfig>,
    Path(item_id): Path<String>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;

    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => return (StatusCode::UNAUTHORIZED, Json(json!({"error":"Unauthorized"}))).into_response(),
    };

    let (user_token, _) = extract_token(&req);

    let fnos_guid = match to_fnos_guid(&item_id) {
        Some(g) => g,
        None => return (StatusCode::NOT_FOUND, Json(json!({"error":"Item not found"}))).into_response(),
    };

    // 获取播放信息
    let play_result = fnos_get_play_info(
        &session.fnos_server,
        &session.fnos_token,
        &fnos_guid,
        &config,
    )
    .await;

    if !play_result.success || play_result.data.is_none() {
        return (StatusCode::NOT_FOUND, Json(json!({"error":"Play info not found"}))).into_response();
    }

    let play_info = play_result.data.unwrap();

    // 获取流列表
    let stream_result = fnos_get_stream_list(
        &session.fnos_server,
        &session.fnos_token,
        &fnos_guid,
        &config,
    )
    .await;

    if !stream_result.success || stream_result.data.is_none() {
        return (StatusCode::NOT_FOUND, Json(json!({"error":"Stream info not found"}))).into_response();
    }

    let sd = stream_result.data.unwrap();
    let files = sd["files"].as_array().cloned().unwrap_or_default();
    let video_streams = sd["video_streams"].as_array().cloned().unwrap_or_default();
    let audio_streams = sd["audio_streams"].as_array().cloned().unwrap_or_default();
    let subtitle_streams = sd["subtitle_streams"].as_array().cloned().unwrap_or_default();

    let mut media_sources = build_media_sources(
        &item_id,
        &files,
        &video_streams,
        &audio_streams,
        &subtitle_streams,
        play_info.item.duration,
    );

    // 注册流元数据 + 注入 api_key
    for ms in &mut media_sources {
        let ms_id = ms["Id"].as_str().unwrap_or("").to_string();
        register_media_guid(&ms_id, &fnos_guid);

        // 找到对应的视频/音频流信息用于 HLS 转码
        let vs0 = video_streams.iter().find(|v| v["media_guid"].as_str() == Some(&ms_id));
        let as0 = audio_streams.iter().find(|a| a["media_guid"].as_str() == Some(&ms_id));

        if let (Some(vs), Some(audio)) = (vs0, as0) {
            register_stream_meta(
                &ms_id,
                StreamMeta {
                    media_guid: ms_id.clone(),
                    item_guid: fnos_guid.clone(),
                    video_guid: vs["guid"].as_str().unwrap_or("").to_string(),
                    video_encoder: vs["codec_name"].as_str().unwrap_or("h264").to_string(),
                    resolution: vs["resolution_type"].as_str().unwrap_or("1080p").to_string(),
                    bitrate: vs["bps"].as_i64().unwrap_or(15_000_000),
                    audio_encoder: "aac".to_string(),
                    audio_guid: audio["guid"].as_str().unwrap_or("").to_string(),
                    subtitle_guid: String::new(),
                    channels: audio["channels"].as_i64().unwrap_or(2) as i32,
                    duration: play_info.item.duration,
                },
            );
        }

        // 注入 api_key 到 TranscodingUrl
        if let Some(token) = &user_token {
            if let Some(url) = ms["TranscodingUrl"].as_str() {
                let sep = if url.contains('?') { "&" } else { "?" };
                ms["TranscodingUrl"] = json!(format!("{}{}api_key={}", url, sep, token));
            }
            if let Some(url) = ms["DirectStreamUrl"].as_str() {
                let sep = if url.contains('?') { "&" } else { "?" };
                ms["DirectStreamUrl"] = json!(format!("{}{}api_key={}", url, sep, token));
            }
            // 字幕 DeliveryUrl 注入 api_key
            if let Some(streams) = ms["MediaStreams"].as_array_mut() {
                for stream in streams {
                    if stream["Type"].as_str() == Some("Subtitle") {
                        if let Some(url) = stream["DeliveryUrl"].as_str() {
                            let sep = if url.contains('?') { "&" } else { "?" };
                            stream["DeliveryUrl"] = json!(format!("{}{}api_key={}", url, sep, token));
                        }
                    }
                }
            }
        }
    }

    let play_session_id = uuid::Uuid::new_v4().to_string().replace('-', "");

    Json(json!({
        "MediaSources": media_sources,
        "PlaySessionId": play_session_id,
    })).into_response()
}

async fn playback_info_compat(
    State(config): State<BridgeConfig>,
    Path((_user_id, item_id)): Path<(String, String)>,
    req: axum::extract::Request,
) -> axum::response::Response {
    playback_info(State(config), Path(item_id), req).await
}
