/// 视频流代理 + HLS 转码代理
/// 使用 reqwest 流式传输，零拷贝

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use reqwest::Client;
use serde::Deserialize;
use tracing::{error, info};

use crate::config::BridgeConfig;
use crate::fnos_client::signature::generate_authx_string;
use crate::mappers::id::to_fnos_guid;
use crate::middleware::auth::{extract_token, require_auth};
use crate::services::fnos::{fnos_get_play_info, fnos_get_stream};
use crate::services::hls_session::{clear_hls_session, get_cached_hls_session, get_or_create_hls_session};
use crate::services::session::{get_session, SessionData};

/// 从客户端透传到上游的请求头
const PASSTHROUGH_HEADERS: &[&str] = &[
    "user-agent", "accept", "accept-language", "accept-encoding",
    "cache-control", "pragma", "range", "if-range",
    "if-modified-since", "if-none-match",
];

/// 从上游转发到客户端的响应头
const FORWARD_HEADERS: &[&str] = &[
    "content-type", "content-length", "content-range",
    "accept-ranges", "cache-control", "etag", "last-modified",
];

pub fn router() -> Router<BridgeConfig> {
    Router::new()
        .route(
            "/Videos/{itemId}/stream",
            get(video_stream).layer(axum::middleware::from_fn(require_auth)),
        )
        .route("/Videos/{mediaGuid}/hls/{file}", get(hls_stream))
}

#[derive(Deserialize, Default)]
struct StreamQuery {
    #[serde(rename = "mediaSourceId")]
    media_source_id: Option<String>,
    #[allow(dead_code)]
    api_key: Option<String>,
    #[allow(dead_code)]
    #[serde(rename = "ApiKey")]
    api_key2: Option<String>,
}

async fn video_stream(
    State(config): State<BridgeConfig>,
    Path(item_id): Path<String>,
    Query(query): Query<StreamQuery>,
    req: axum::extract::Request,
) -> Response {
    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };

    let fnos_guid = match to_fnos_guid(&item_id) {
        Some(g) => g,
        None => return StatusCode::NOT_FOUND.into_response(),
    };

    let range_header = req.headers().get("range").and_then(|v| v.to_str().ok()).map(String::from);

    info!(
        "[VIDEO] 流请求: itemId={}, fnosGuid={}, range={}",
        item_id, fnos_guid, range_header.as_deref().unwrap_or("none")
    );

    // 优先使用 mediaSourceId
    let media_guid = if let Some(ref ms) = query.media_source_id {
        ms.clone()
    } else {
        match fnos_get_play_info(&session.fnos_server, &session.fnos_token, &fnos_guid, &config).await {
            r if r.success && r.data.is_some() => r.data.unwrap().media_guid,
            _ => return StatusCode::NOT_FOUND.into_response(),
        }
    };

    info!("[VIDEO] 使用 mediaGuid={}", media_guid);

    // 获取流信息
    let stream_result = fnos_get_stream(
        &session.fnos_server,
        &session.fnos_token,
        &media_guid,
        "127.0.0.1",
        &config,
    )
    .await;

    let (target_url, extra_headers, skip_verify) = build_upstream_target(
        &session, &media_guid, &stream_result, &config,
    );

    // 构建上游请求
    let client = Client::builder()
        .danger_accept_invalid_certs(skip_verify || config.ignore_cert)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_default();

    let mut upstream_req = client.get(&target_url);

    // 透传客户端头
    for h in PASSTHROUGH_HEADERS {
        if let Some(v) = req.headers().get(*h) {
            upstream_req = upstream_req.header(*h, v);
        }
    }

    // 额外头
    for (k, v) in &extra_headers {
        upstream_req = upstream_req.header(k.as_str(), v.as_str());
    }

    // 飞牛 media/range 要求必须有 Range 头
    let client_had_range = range_header.is_some();
    if !client_had_range {
        upstream_req = upstream_req.header("range", "bytes=0-");
    }

    match upstream_req.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let mut builder = Response::builder();

            // CORS
            builder = builder
                .header("access-control-allow-origin", "*")
                .header("access-control-allow-headers", "*");

            // 转发响应头
            for h in FORWARD_HEADERS {
                if let Some(v) = resp.headers().get(*h) {
                    builder = builder.header(*h, v);
                }
            }

            // MIME 类型修正
            let ct = resp.headers().get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream");
            if ct == "application/octet-stream" {
                builder = builder.header("content-type", "video/mp4");
            }

            // 206→200 转换
            let final_status = if !client_had_range && status == 206 {
                if let Some(cr) = resp.headers().get("content-range").and_then(|v| v.to_str().ok()) {
                    if let Some(total) = cr.rsplit('/').next().and_then(|s| s.parse::<u64>().ok()) {
                        builder = builder.header("content-length", total.to_string());
                    }
                }
                info!("[VIDEO] 206→200 转换");
                200
            } else {
                status
            };

            builder = builder.status(final_status);

            // 流式传输 body
            let stream = resp.bytes_stream();
            let body = Body::from_stream(stream);

            builder.body(body).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(e) => {
            error!("[VIDEO] 代理请求失败: {}", e);
            StatusCode::BAD_GATEWAY.into_response()
        }
    }
}

async fn hls_stream(
    State(config): State<BridgeConfig>,
    Path((media_guid, file)): Path<(String, String)>,
    req: axum::extract::Request,
) -> Response {
    // 认证：先从请求获取 session
    let (token, _) = extract_token(&req);
    let session = token.as_ref().and_then(|t| get_session(t));

    let (fnos_server, fnos_token) = if let Some(ref s) = session {
        (s.fnos_server.clone(), s.fnos_token.clone())
    } else {
        // 从 HLS 会话缓存获取凭据
        match get_cached_hls_session(&media_guid) {
            Some((_, server, token)) => (server, token),
            None => return StatusCode::UNAUTHORIZED.into_response(),
        }
    };

    // 获取或创建 HLS 转码会话
    let hls_session = if session.is_some() {
        get_or_create_hls_session(&fnos_server, &fnos_token, &media_guid, &config).await
    } else {
        get_cached_hls_session(&media_guid).map(|(sg, _, _)| {
            let pl = format!("/v/media/{}/preset.m3u8", sg);
            (sg, pl)
        })
    };

    let (session_guid, _play_link) = match hls_session {
        Some(s) => s,
        None => {
            error!("[HLS] 无法获取转码会话: mediaGuid={}", media_guid);
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    // 构建飞牛 HLS URL
    let actual_file = if file == "main.m3u8" { "preset.m3u8" } else { &file };
    let fnos_path = format!("/v/media/{}/{}", session_guid, actual_file);
    let target_url = format!("{}{}", fnos_server, fnos_path);
    let authx = generate_authx_string(&fnos_path, None);

    info!(
        "[HLS] 代理: mediaGuid={} → sessionGuid={}, file={}",
        media_guid, session_guid, actual_file
    );

    let client = Client::builder()
        .danger_accept_invalid_certs(config.ignore_cert)
        .build()
        .unwrap_or_default();

    let upstream_req = client
        .get(&target_url)
        .header("Authorization", &fnos_token)
        .header("Cookie", "mode=relay")
        .header("Authx", &authx);

    match upstream_req.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();

            // 410 Gone → 清除会话
            if status == 410 && session.is_some() {
                info!("[HLS] 410 Gone → 清除会话 mediaGuid={}", media_guid);
                clear_hls_session(&media_guid);
                return StatusCode::GONE.into_response();
            }

            // m3u8 文件需要读取内容处理
            if actual_file.ends_with(".m3u8") {
                let body_text = resp.text().await.unwrap_or_default();
                return Response::builder()
                    .status(200)
                    .header("content-type", "application/vnd.apple.mpegurl")
                    .header("cache-control", "no-store, no-cache, must-revalidate")
                    .body(Body::from(body_text))
                    .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
            }

            // .ts 段 → 流式传输
            let mut builder = Response::builder().status(status);
            for h in FORWARD_HEADERS {
                if let Some(v) = resp.headers().get(*h) {
                    builder = builder.header(*h, v);
                }
            }
            builder = builder
                .header("access-control-allow-origin", "*")
                .header("cache-control", "no-store, no-cache, must-revalidate");

            let stream = resp.bytes_stream();
            builder
                .body(Body::from_stream(stream))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(e) => {
            error!("[HLS] 代理请求失败: {}", e);
            StatusCode::BAD_GATEWAY.into_response()
        }
    }
}

fn build_upstream_target(
    session: &SessionData,
    media_guid: &str,
    stream_result: &crate::fnos_client::client::RequestResult<crate::types::fnos::FnosStreamResponse>,
    config: &BridgeConfig,
) -> (String, Vec<(String, String)>, bool) {
    let mut extra = Vec::new();
    let mut skip_verify = config.ignore_cert;

    if stream_result.success {
        if let Some(ref sd) = stream_result.data {
            let has_cloud = sd.cloud_storage_info.is_some()
                && sd.direct_link_qualities.as_ref().map_or(false, |q| !q.is_empty());

            if has_cloud {
                let url = sd.direct_link_qualities.as_ref().unwrap()[0].url.clone();
                skip_verify = false;
                if let Some(ref hdr) = sd.header {
                    if let Some(ref cookies) = hdr.cookie {
                        if !cookies.is_empty() {
                            extra.push(("Cookie".into(), cookies.join("; ")));
                        }
                    }
                }
                if let Some(ref ci) = sd.cloud_storage_info {
                    match ci.cloud_storage_type {
                        3 => extra.push(("User-Agent".into(), "trim_player".into())),
                        1 => extra.push(("User-Agent".into(), "pan.baidu.com".into())),
                        _ => {}
                    }
                }
                return (url, extra, skip_verify);
            }
        }
    }

    // 本地 NAS
    let media_path = format!("/v/api/v1/media/range/{}", media_guid);
    let target_url = format!("{}{}", session.fnos_server, media_path);
    extra.push(("Authorization".into(), session.fnos_token.clone()));
    extra.push(("Cookie".into(), "mode=relay".into()));
    extra.push(("Authx".into(), generate_authx_string(&media_path, None)));

    (target_url, extra, skip_verify)
}
