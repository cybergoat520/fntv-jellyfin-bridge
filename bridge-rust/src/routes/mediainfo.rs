/// PlaybackInfo 路由

use axum::{
    body::to_bytes,
    extract::{Path, State},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Deserializer};
use serde_json::json;
use tracing::{debug, error, warn};

use crate::cache::stream_list::cached_get_stream_list;
use crate::config::BridgeConfig;
use crate::mappers::id::*;
use crate::mappers::media::{build_media_sources, get_subtitle_info};
use crate::middleware::auth::{extract_token, require_auth};
use crate::services::fnos::*;
use crate::services::hls_session::{clear_hls_session, register_stream_meta, StreamMeta};
use crate::services::session::SessionData;

/// 反序列化：支持数字或字符串形式的 i32（jellyfin-web 有时发字符串 "1" 而非数字 1）
fn deserialize_optional_i32_lenient<'de, D>(deserializer: D) -> Result<Option<i32>, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de;
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::Number(n) => {
            Ok(Some(n.as_i64().unwrap_or(0) as i32))
        }
        serde_json::Value::String(s) => {
            match s.parse::<i32>() {
                Ok(n) => Ok(Some(n)),
                Err(_) => Err(de::Error::custom(format!("invalid i32 string: {}", s))),
            }
        }
        _ => Err(de::Error::custom("expected number or string")),
    }
}

/// 反序列化：支持数字或字符串形式的 i64
fn deserialize_optional_i64_lenient<'de, D>(deserializer: D) -> Result<Option<i64>, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de;
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::Number(n) => {
            Ok(Some(n.as_i64().unwrap_or(0)))
        }
        serde_json::Value::String(s) => {
            match s.parse::<i64>() {
                Ok(n) => Ok(Some(n)),
                Err(_) => Err(de::Error::custom(format!("invalid i64 string: {}", s))),
            }
        }
        _ => Err(de::Error::custom("expected number or string")),
    }
}

/// 反序列化：支持 bool 或字符串 "true"/"false"
fn deserialize_optional_bool_lenient<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: Deserializer<'de>,
{
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
        serde_json::Value::Null => Ok(None),
        serde_json::Value::Bool(b) => Ok(Some(b)),
        serde_json::Value::String(s) => Ok(Some(s == "true")),
        _ => Ok(None),
    }
}

/// PlaybackInfo POST body
#[derive(Deserialize, Default, Debug)]
#[serde(default)]
struct PlaybackInfoDto {
    #[serde(rename = "MediaSourceId")]
    media_source_id: Option<String>,
    #[serde(rename = "AudioStreamIndex", deserialize_with = "deserialize_optional_i32_lenient")]
    audio_stream_index: Option<i32>,
    #[serde(rename = "SubtitleStreamIndex", deserialize_with = "deserialize_optional_i32_lenient")]
    subtitle_stream_index: Option<i32>,
    #[serde(rename = "MaxStreamingBitrate", deserialize_with = "deserialize_optional_i64_lenient")]
    max_streaming_bitrate: Option<i64>,
    #[serde(rename = "EnableDirectPlay", deserialize_with = "deserialize_optional_bool_lenient")]
    enable_direct_play: Option<bool>,
    #[serde(rename = "EnableDirectStream", deserialize_with = "deserialize_optional_bool_lenient")]
    enable_direct_stream: Option<bool>,
}

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
    use axum::http::StatusCode;

    // 先提取 session
    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => return (StatusCode::UNAUTHORIZED, Json(json!({"error":"Unauthorized"}))).into_response(),
    };

    let (user_token, _) = extract_token(&req);

    // 读取请求 body（因为 axum 还没有消费它）
    let body_bytes = match to_bytes(req.into_body(), 1024 * 64).await {
        Ok(bytes) => bytes,
        Err(e) => {
            error!("[PlaybackInfo] 读取 body 失败: {}", e);
            return (StatusCode::BAD_REQUEST, Json(json!({"error":"Bad request"}))).into_response();
        }
    };

    // 解析 body
    let body: PlaybackInfoDto = match serde_json::from_slice(&body_bytes) {
        Ok(dto) => {
            debug!("[PlaybackInfo] 解析成功: {:?}", dto);
            dto
        }
        Err(e) => {
            let body_str = String::from_utf8_lossy(&body_bytes);
            error!("[PlaybackInfo] 解析 body 失败: {}, body={}", e, &body_str[..body_str.len().min(200)]);
            PlaybackInfoDto::default()
        }
    };

    let requested_media_source_id = body.media_source_id.unwrap_or_default();
    let audio_stream_index = body.audio_stream_index;
    let subtitle_stream_index = body.subtitle_stream_index;
    let max_streaming_bitrate = body.max_streaming_bitrate;
    let enable_direct_play = body.enable_direct_play;
    let enable_direct_stream = body.enable_direct_stream;

    debug!(
        "[PlaybackInfo] item={}, MediaSourceId={}, AudioStreamIndex={:?}, MaxBitrate={:?}, EnableDP={:?}, EnableDS={:?}",
        item_id,
        if requested_media_source_id.is_empty() { "none" } else { &requested_media_source_id },
        audio_stream_index,
        max_streaming_bitrate,
        enable_direct_play,
        enable_direct_stream,
    );

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

    // 获取流列表（使用缓存）
    let stream_result = cached_get_stream_list(
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

    // 如果客户端指定了 MediaSourceId，只返回那个版本
    // 这样前端就会使用用户明确选择的版本
    if !requested_media_source_id.is_empty() {
        if let Some(pos) = media_sources.iter().position(|ms| {
            ms["Id"].as_str() == Some(&requested_media_source_id)
        }) {
            let selected = media_sources.remove(pos);
            media_sources = vec![selected];
            debug!("[PlaybackInfo] 只返回指定版本: {}", requested_media_source_id);
        } else {
            warn!("[PlaybackInfo] 指定的版本未找到: {}", requested_media_source_id);
        }
    }

    // 注册流元数据 + 注入 api_key + 处理音频切换
    for ms in &mut media_sources {
        let ms_id = ms["Id"].as_str().unwrap_or("").to_string();
        register_media_guid(&ms_id, &fnos_guid);

        // 找到对应的视频/音频流信息用于 HLS 转码
        let vs0 = video_streams.iter().find(|v| v["media_guid"].as_str() == Some(&ms_id));
        let my_audio_streams: Vec<&serde_json::Value> = audio_streams.iter()
            .filter(|a| a["media_guid"].as_str() == Some(&ms_id))
            .collect();
        let fallback_audio = my_audio_streams.first().copied()
            .or_else(|| audio_streams.first());

        // 如果客户端指定了 AudioStreamIndex，找到对应的飞牛音频流
        let mut selected_audio = fallback_audio;
        if let Some(req_audio_idx) = audio_stream_index {
            if let Some(media_streams) = ms["MediaStreams"].as_array() {
                let audio_in_ms: Vec<(usize, &serde_json::Value)> = media_streams.iter()
                    .enumerate()
                    .filter(|(_, s)| s["Type"].as_str() == Some("Audio"))
                    .collect();

                debug!(
                    "  [AUDIO-MATCH] 请求 audioStreamIndex={}, MediaSource 音频流: {:?}",
                    req_audio_idx,
                    audio_in_ms.iter().map(|(_, s)| {
                        format!("Index={} Codec={} Title={}",
                            s["Index"].as_i64().unwrap_or(-1),
                            s["Codec"].as_str().unwrap_or("?"),
                            s["DisplayTitle"].as_str().unwrap_or("?"))
                    }).collect::<Vec<_>>()
                );
                debug!(
                    "  [AUDIO-MATCH] 飞牛音频流: {:?}",
                    my_audio_streams.iter().map(|a| {
                        format!("guid={} codec={} lang={} ch={}",
                            a["guid"].as_str().unwrap_or("?"),
                            a["codec_name"].as_str().unwrap_or("?"),
                            a["language"].as_str().unwrap_or("?"),
                            a["channels"].as_i64().unwrap_or(0))
                    }).collect::<Vec<_>>()
                );

                // 找到第一条音频流的 Index，计算偏移
                if let Some(first_audio) = audio_in_ms.first() {
                    let first_audio_index = first_audio.1["Index"].as_i64().unwrap_or(0) as i32;
                    let match_idx = (req_audio_idx - first_audio_index) as usize;
                    if match_idx < my_audio_streams.len() {
                        selected_audio = Some(my_audio_streams[match_idx]);
                        debug!(
                            "  [AUDIO-MATCH] ✓ 匹配到飞牛音频流: guid={}, codec={}",
                            my_audio_streams[match_idx]["guid"].as_str().unwrap_or("?"),
                            my_audio_streams[match_idx]["codec_name"].as_str().unwrap_or("?"),
                        );
                    } else {
                        warn!("  [AUDIO-MATCH] ✗ matchIdx={} 越界 (共{}条), 使用 fallback", match_idx, my_audio_streams.len());
                    }
                }
            }

            // 更新 DefaultAudioStreamIndex
            ms["DefaultAudioStreamIndex"] = json!(req_audio_idx);
        }

        if let (Some(vs), Some(audio)) = (vs0, selected_audio) {
            debug!(
                "  [AUDIO-META] registerStreamMeta: mediaGuid={}, audio_guid={}, audio_codec={}, channels={}",
                ms_id,
                audio["guid"].as_str().unwrap_or("none"),
                audio["codec_name"].as_str().unwrap_or("?"),
                audio["channels"].as_i64().unwrap_or(0),
            );
            // 字幕匹配：根据 SubtitleStreamIndex 查找内置字幕的飞牛 guid
            let mut selected_subtitle_guid = String::new();
            if let Some(req_sub_idx) = subtitle_stream_index {
                if req_sub_idx >= 0 {
                    if let Some(sub_info) = get_subtitle_info(&ms_id, req_sub_idx) {
                        if !sub_info.is_external {
                            selected_subtitle_guid = sub_info.guid.clone();
                            debug!(
                                "  [SUB-MATCH] ✓ 内置字幕: guid={}, lang={}",
                                sub_info.guid, sub_info.language
                            );
                        }
                    }
                }
            }

            // 字幕变更时清除旧的 HLS 会话，以便创建包含新字幕的转码会话
            if !selected_subtitle_guid.is_empty() {
                clear_hls_session(&ms_id);
            }

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
                    subtitle_guid: selected_subtitle_guid,
                    channels: audio["channels"].as_i64().unwrap_or(2) as i32,
                    duration: play_info.item.duration,
                },
            );
        }

        // 客户端请求禁用 DirectPlay/DirectStream 时，覆盖对应标志
        if enable_direct_play == Some(false) {
            ms["SupportsDirectPlay"] = json!(false);
        }
        if enable_direct_stream == Some(false) {
            ms["SupportsDirectStream"] = json!(false);
            ms["TranscodingSubProtocol"] = json!("hls");
        }

        // 质量菜单选择低码率时，禁用 DirectStream 强制走 HLS 转码
        if let Some(max_br) = max_streaming_bitrate {
            if let Some(src_br) = ms["Bitrate"].as_i64() {
                if max_br < src_br && ms["SupportsDirectStream"].as_bool().unwrap_or(false) {
                    ms["SupportsDirectStream"] = json!(false);
                    ms["TranscodingSubProtocol"] = json!("hls");
                    debug!("  [QUALITY] 码率限制 {:.1}Mbps < 源码率 {:.1}Mbps → 强制 HLS 转码",
                        max_br as f64 / 1e6, src_br as f64 / 1e6);
                }
            }
        }

        // 注入 api_key 到 TranscodingUrl
        if let Some(token) = &user_token {
            if let Some(url) = ms["TranscodingUrl"].as_str() {
                let sep = if url.contains('?') { "&" } else { "?" };
                let mut new_url = format!("{}{}api_key={}", url, sep, token);
                // 附加 MaxStreamingBitrate 作为 cache buster
                if let Some(max_br) = max_streaming_bitrate {
                    new_url = format!("{}&MaxStreamingBitrate={}", new_url, max_br);
                }
                // 附加 AudioStreamIndex 作为 cache buster，让音频切换产生不同 URL
                if let Some(audio_idx) = audio_stream_index {
                    new_url = format!("{}&AudioStreamIndex={}", new_url, audio_idx);
                }
                ms["TranscodingUrl"] = json!(new_url);
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

        // 音频切换 / 质量切换 / DirectStream 禁用时清除 HLS 会话缓存
        if audio_stream_index.is_some() || enable_direct_stream == Some(false) || enable_direct_play == Some(false) {
            debug!("  [HLS] 清除 HLS 会话: mediaGuid={}, audioIdx={:?}", ms_id, audio_stream_index);
            clear_hls_session(&ms_id);
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
