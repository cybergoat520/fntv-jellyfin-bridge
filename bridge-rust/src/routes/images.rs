/// 图片代理路由
/// 优先从 imageCache 获取图片路径，fallback 到 fnosGetPlayInfo

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Extension, Router,
};
use std::collections::HashMap;

use crate::config::BridgeConfig;
use crate::fnos_client::signature::generate_authx_string;
use crate::mappers::id::to_fnos_guid;
use crate::middleware::auth::optional_auth;
use crate::services::fnos::fnos_get_play_info;
use crate::cache::image::{get_image_cache, set_image_cache, CachedImage};
use crate::services::session::SessionData;

pub fn router() -> Router<BridgeConfig> {
    Router::new()
        .route(
            "/Items/{itemId}/Images/{imageType}",
            get(proxy_image).layer(axum::middleware::from_fn(optional_auth)),
        )
        .route(
            "/Items/{itemId}/Images/{imageType}/{index}",
            get(proxy_image_indexed).layer(axum::middleware::from_fn(optional_auth)),
        )
}

async fn proxy_image(
    State(config): State<BridgeConfig>,
    Path((item_id, image_type)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
    session: Option<Extension<SessionData>>,
) -> Response {
    do_proxy_image(&config, &item_id, &image_type, &query, session.map(|e| e.0)).await
}

async fn proxy_image_indexed(
    State(config): State<BridgeConfig>,
    Path((item_id, image_type, _index)): Path<(String, String, String)>,
    Query(query): Query<HashMap<String, String>>,
    session: Option<Extension<SessionData>>,
) -> Response {
    do_proxy_image(&config, &item_id, &image_type, &query, session.map(|e| e.0)).await
}

async fn do_proxy_image(
    config: &BridgeConfig,
    item_id: &str,
    image_type: &str,
    query: &HashMap<String, String>,
    session: Option<SessionData>,
) -> Response {
    // 1. 先查缓存
    let mut cached = get_image_cache(item_id);

    // 2. 缓存未命中，尝试用 session 调 API
    if cached.is_none() {
        if let Some(ref session) = session {
            if let Some(fnos_guid) = to_fnos_guid(item_id) {
                let result = fnos_get_play_info(
                    &session.fnos_server,
                    &session.fnos_token,
                    &fnos_guid,
                    config,
                )
                .await;

                if result.success {
                    if let Some(ref data) = result.data {
                        let img = CachedImage {
                            poster: if data.item.posters.is_empty() { None } else { Some(data.item.posters.clone()) },
                            backdrop: if data.item.still_path.is_empty() { None } else { Some(data.item.still_path.clone()) },
                            server: session.fnos_server.clone(),
                            token: session.fnos_token.clone(),
                        };
                        set_image_cache(item_id, img.clone());
                        cached = Some(img);
                    }
                }
            }
        }
    }

    let cached = match cached {
        Some(c) => c,
        None => return StatusCode::NOT_FOUND.into_response(),
    };

    // 选择图片路径
    let image_path = match image_type.to_lowercase().as_str() {
        "primary" | "poster" => cached.poster.as_deref(),
        "backdrop" | "thumb" | "banner" => {
            cached.backdrop.as_deref().or(cached.poster.as_deref())
        }
        _ => cached.poster.as_deref(),
    };

    let image_path = match image_path {
        Some(p) if !p.is_empty() => p,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };

    // 构造完整图片 URL
    let image_url = if image_path.starts_with("http") {
        image_path.to_string()
    } else if image_path.starts_with("/v/api/") {
        format!("{}{}", cached.server, image_path)
    } else {
        let clean = if image_path.starts_with('/') { image_path.to_string() } else { format!("/{}", image_path) };
        format!("{}/v/api/v1/sys/img{}", cached.server, clean)
    };

    // 添加尺寸参数
    let fill_width = query.get("fillWidth").or(query.get("maxWidth"));
    let final_url = if let Some(w) = fill_width {
        if !image_url.contains("w=") {
            let sep = if image_url.contains('?') { "&" } else { "?" };
            format!("{}{}w={}", image_url, sep, w)
        } else {
            image_url
        }
    } else {
        image_url
    };

    // 从 URL 提取 API 路径用于签名
    let api_path = if let Ok(url) = reqwest::Url::parse(&final_url) {
        url.path().to_string()
    } else {
        image_path.to_string()
    };
    let authx = generate_authx_string(&api_path, None);

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(config.ignore_cert)
        .build()
        .unwrap_or_default();

    let upstream = client
        .get(&final_url)
        .header("Authorization", &cached.token)
        .header("Cookie", "mode=relay")
        .header("Authx", &authx)
        .send()
        .await;

    match upstream {
        Ok(resp) if resp.status().is_success() => {
            let content_type = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("image/jpeg")
                .to_string();

            let bytes = resp.bytes().await.unwrap_or_default();

            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, content_type)
                .header(header::CACHE_CONTROL, "public, max-age=86400")
                .body(Body::from(bytes))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}
