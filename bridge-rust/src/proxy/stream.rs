/// 视频流代理 + HLS 转码代理
/// 使用 reqwest 流式传输，零拷贝

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use reqwest::Client;
use serde::Deserialize;
use std::error::Error as StdError;
use tracing::{debug, error, info};

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
        .route(
            "/Videos/{itemId}/stream/{ext}",
            get(video_stream_with_ext).layer(axum::middleware::from_fn(require_auth)),
        )
        // HLS 播放列表 - 支持带和不带 /Videos 前缀
        .route("/Videos/{mediaGuid}/hls/{file}", get(hls_stream))
        .route("/{mediaGuid}/hls/{file}", get(hls_stream))
        // 字幕流
        .route(
            "/Videos/{itemId}/{mediaSourceId}/Subtitles/{index}/Stream/{format}",
            get(subtitle_stream).layer(axum::middleware::from_fn(require_auth)),
        )
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

async fn video_stream_with_ext(
    State(config): State<BridgeConfig>,
    Path((item_id, _ext)): Path<(String, String)>,
    Query(query): Query<StreamQuery>,
    req: axum::extract::Request,
) -> Response {
    debug!("[STREAM_EXT] 收到带扩展名的流请求: item_id={}, ext={}, uri={}", item_id, _ext, req.uri());
    video_stream(State(config), Path(item_id), Query(query), req).await
}

async fn video_stream(
    State(config): State<BridgeConfig>,
    Path(item_id): Path<String>,
    Query(query): Query<StreamQuery>,
    req: axum::extract::Request,
) -> Response {
    debug!("[STREAM] ====== 开始处理视频流请求 ======");
    
    // 记录完整 URI 用于诊断
    let full_uri = req.uri().to_string();
    debug!("[STREAM] 完整请求 URI: {}", full_uri);
    
    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => {
            debug!("[STREAM] ❌ 未找到 session，返回 401");
            return StatusCode::UNAUTHORIZED.into_response();
        }
    };
    debug!("[STREAM] ✓ 获取 session 成功");

    let fnos_guid = match to_fnos_guid(&item_id) {
        Some(g) => g,
        None => {
            debug!("[STREAM] ❌ 无法转换 item_id 到 fnos_guid: {}", item_id);
            return StatusCode::NOT_FOUND.into_response();
        }
    };
    debug!("[STREAM] ✓ fnos_guid={}", fnos_guid);

    let range_header = req.headers().get("range").and_then(|v| v.to_str().ok()).map(String::from);

    debug!(
        "[VIDEO] 流请求: itemId={}, fnosGuid={}, range={}",
        item_id, fnos_guid, range_header.as_deref().unwrap_or("none")
    );

    // 记录客户端是否传了 mediaSourceId
    debug!(
        "[STREAM] mediaSourceId 参数: {:?}",
        query.media_source_id
    );

    // 优先使用 mediaSourceId
    let media_guid = if let Some(ref ms) = query.media_source_id {
        debug!("[STREAM] 客户端指定版本: media_source_id={}", ms);
        ms.clone()
    } else {
        debug!("[STREAM] 调用 fnos_get_play_info 获取 media_guid...");
        match fnos_get_play_info(&session.fnos_server, &session.fnos_token, &fnos_guid, &config).await {
            r if r.success && r.data.is_some() => {
                let mg = r.data.unwrap().media_guid;
                debug!("[STREAM] ✓ 获取 media_guid={}", mg);
                mg
            }
            r => {
                debug!("[STREAM] ❌ 获取 play_info 失败: success={}, has_data={}", r.success, r.data.is_some());
                return StatusCode::NOT_FOUND.into_response();
            }
        }
    };

    // 获取流信息
    debug!("[STREAM] 调用 fnos_get_stream...");
    let stream_result = fnos_get_stream(
        &session.fnos_server,
        &session.fnos_token,
        &media_guid,
        "127.0.0.1",
        &config,
    )
    .await;
    debug!("[STREAM] ✓ fnos_get_stream 完成, success={}", stream_result.success);

    let (target_url, extra_headers, skip_verify) = build_upstream_target(
        &session, &media_guid, &stream_result, &config,
    );
    debug!("[STREAM] target_url={}, skip_verify={}", target_url, skip_verify);

    // 构建上游请求
    debug!("[STREAM] 构建上游请求...");
    let client = Client::builder()
        .danger_accept_invalid_certs(skip_verify || config.ignore_cert)
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_default();

    let mut upstream_req = client.get(&target_url);
    debug!("[STREAM] ✓ 上游请求构建完成，准备发送...");

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

    debug!("[STREAM] 发送上游请求...");
    match upstream_req.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            debug!("[STREAM] ✓ 上游响应: status={}", status);
            
            // 先决定是否做 206→200 转换
            let (final_status, total_size) = if !client_had_range && status == 206 {
                let total = resp.headers().get("content-range")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|cr| cr.rsplit('/').next())
                    .and_then(|s| s.parse::<u64>().ok());
                debug!("[VIDEO] 206→200 转换, total_size={:?}", total);
                (200, total)
            } else {
                (status, None)
            };
            
            let mut builder = Response::builder().status(final_status);

            // CORS
            builder = builder
                .header("access-control-allow-origin", "*")
                .header("access-control-allow-headers", "*");

            // 206→200 转换时，需要移除 transfer-encoding: chunked 并设置 content-length
            let has_content_length = final_status == 200 && total_size.is_some();
            
            // 转发响应头
            for h in FORWARD_HEADERS {
                // 200 响应不应该有 content-range
                if final_status == 200 && h.eq_ignore_ascii_case("content-range") {
                    continue;
                }
                // 如果有 content-length，跳过 transfer-encoding: chunked
                if has_content_length && h.eq_ignore_ascii_case("transfer-encoding") {
                    continue;
                }
                if let Some(v) = resp.headers().get(*h) {
                    builder = builder.header(*h, v);
                }
            }
            
            // 206→200 转换时设置正确的 content-length
            if has_content_length {
                builder = builder.header("content-length", total_size.unwrap().to_string());
            }

            // MIME 类型修正
            let ct = resp.headers().get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream");
            if ct == "application/octet-stream" {
                builder = builder.header("content-type", "video/mp4");
            }

            // 流式传输 body
            debug!("[STREAM] 构建响应 body...");
            let stream = resp.bytes_stream();
            let body = Body::from_stream(stream);
            debug!("[STREAM] ====== 请求处理完成，返回 {} ======", final_status);
            builder.body(body).unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        Err(e) => {
            error!("[STREAM] ❌ 代理请求失败: {}", e);
            StatusCode::BAD_GATEWAY.into_response()
        }
    }
}

async fn hls_stream(
    State(config): State<BridgeConfig>,
    Path((media_guid, file)): Path<(String, String)>,
    req: axum::extract::Request,
) -> Response {
    info!("[HLS] hls_stream 收到请求: mediaGuid={}, file={}", media_guid, file);

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
            debug!("[HLS] 无转码会话: mediaGuid={}", media_guid);
            return StatusCode::NOT_FOUND.into_response();
        }
    };

    // 构建飞牛 HLS URL（preset.m3u8 由 TranscodingUrl 直接请求，main.m3u8 不再映射）
    let actual_file: &str = &file;
    let fnos_path = format!("/v/media/{}/{}", session_guid, actual_file);
    let target_url = format!("{}{}", fnos_server, fnos_path);
    let authx = generate_authx_string(&fnos_path, None);

    debug!(
        "[HLS] 代理: file={}, sessionGuid={}",
        actual_file, session_guid
    );

    let client = Client::builder()
        .danger_accept_invalid_certs(config.ignore_cert)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default();

    // VTT 字幕文件：缓冲代理 + 完整生命周期日志
    if actual_file.ends_with(".vtt") {
        let start = std::time::Instant::now();
        info!("[VTT] ===== 开始 VTT 请求 =====");
        info!("[VTT] target: {}", target_url);

        // 用和 .ts 一样的认证方式，1秒超时
        let req = client
            .get(&target_url)
            .header("Authorization", &fnos_token)
            .header("Cookie", "mode=relay")
            .header("Authx", &authx)
            .timeout(std::time::Duration::from_secs(1))
            .build();

        let req = match req {
            Ok(r) => r,
            Err(e) => {
                error!("[VTT] 构建请求失败: {} (耗时 {:?})", e, start.elapsed());
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        };

        info!("[VTT] 请求头:");
        info!("[VTT]   method={} url={}", req.method(), req.url());
        for (name, value) in req.headers().iter() {
            info!("[VTT]   {}: {:?}", name, value);
        }

        info!("[VTT] 发送请求中...");
        match client.execute(req).await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                info!("[VTT] 收到响应: status={} (耗时 {:?})", status, start.elapsed());
                info!("[VTT] 响应头:");
                for (name, value) in resp.headers().iter() {
                    info!("[VTT]   {}: {:?}", name, value);
                }

                info!("[VTT] 读取响应体...");
                match resp.bytes().await {
                    Ok(body) => {
                        info!("[VTT] 响应体大小: {} bytes (总耗时 {:?})", body.len(), start.elapsed());
                        info!("[VTT] ===== VTT 请求完成 =====");
                        return Response::builder()
                            .status(status)
                            .header("content-type", "text/vtt")
                            .header("access-control-allow-origin", "*")
                            .header("cache-control", "no-store, no-cache, must-revalidate")
                            .body(Body::from(body))
                            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
                    }
                    Err(e) => {
                        error!("[VTT] 读取响应体失败: {} (总耗时 {:?})", e, start.elapsed());
                        return Response::builder()
                            .status(200)
                            .header("content-type", "text/vtt")
                            .header("access-control-allow-origin", "*")
                            .body(Body::from("WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n\n"))
                            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
                    }
                }
            }
            Err(e) => {
                error!("[VTT] 请求失败/超时: {} (耗时 {:?})", e, start.elapsed());
                if e.is_timeout() {
                    error!("[VTT] 原因: 超时 (1秒)");
                }
                if e.is_connect() {
                    error!("[VTT] 原因: 连接失败");
                }
                if let Some(source) = e.source() {
                    error!("[VTT] 底层错误: {}", source);
                }
                // 超时/失败返回空 VTT，避免 HLS.js 报错
                return Response::builder()
                    .status(200)
                    .header("content-type", "text/vtt")
                    .header("access-control-allow-origin", "*")
                    .body(Body::from("WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n\n"))
                    .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
            }
        }
    }

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
                debug!("[HLS] 410 Gone → 清除会话 mediaGuid={}", media_guid);
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

/// 字幕流处理
async fn subtitle_stream(
    Path((item_id, media_source_id, index, format)): Path<(String, String, i32, String)>,
    req: axum::extract::Request,
) -> Response {
    use crate::mappers::media::get_subtitle_info;
    
    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };

    debug!(
        "[SUBTITLE] 字幕请求: itemId={}, mediaSourceId={}, index={}, format={}",
        item_id, media_source_id, index, format
    );

    // 从缓存获取字幕信息
    if let Some(sub_info) = get_subtitle_info(&media_source_id, index) {
        if !sub_info.guid.is_empty() {
            // 构建飞牛字幕 URL
            let subtitle_path = format!("/v/api/v1/media/subtitle?guid={}", sub_info.guid);
            let target_url = format!("{}{}", session.fnos_server, subtitle_path);
            let authx = generate_authx_string(&subtitle_path, None);

            let client = Client::builder()
                .danger_accept_invalid_certs(true)
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .unwrap_or_default();

            let upstream_req = client
                .get(&target_url)
                .header("Authorization", &session.fnos_token)
                .header("Cookie", "mode=relay")
                .header("Authx", &authx);

            match upstream_req.send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    if status == 200 {
                        let content_type = if format == "vtt" || format == "webvtt" {
                            "text/vtt"
                        } else {
                            "application/octet-stream"
                        };
                        
                        match resp.bytes().await {
                            Ok(body) => {
                                return Response::builder()
                                    .status(200)
                                    .header("content-type", content_type)
                                    .header("access-control-allow-origin", "*")
                                    .body(Body::from(body))
                                    .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
                            }
                            Err(e) => {
                                error!("[SUBTITLE] 读取字幕内容失败: {}", e);
                            }
                        }
                    }
                }
                Err(e) => {
                    error!("[SUBTITLE] 代理字幕请求失败: {}", e);
                }
            }
        }
    }

    // 未找到字幕，返回 404
    StatusCode::NOT_FOUND.into_response()
}
