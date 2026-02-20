/// 图片代理路由

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};

use crate::config::BridgeConfig;
use crate::fnos_client::signature::generate_authx_string;
use crate::mappers::id::to_fnos_guid;
use crate::services::fnos::fnos_get_play_info;
use crate::services::session::SessionData;
use crate::middleware::auth::require_auth;

pub fn router() -> Router<BridgeConfig> {
    Router::new()
        .route(
            "/Items/{itemId}/Images/{imageType}",
            get(proxy_image).layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Items/{itemId}/Images/{imageType}/{index}",
            get(proxy_image_indexed).layer(axum::middleware::from_fn(require_auth)),
        )
}

async fn proxy_image(
    State(config): State<BridgeConfig>,
    Path((item_id, image_type)): Path<(String, String)>,
    req: axum::extract::Request,
) -> Response {
    do_proxy_image(&config, &item_id, &image_type, &req).await
}

async fn proxy_image_indexed(
    State(config): State<BridgeConfig>,
    Path((item_id, image_type, _index)): Path<(String, String, String)>,
    req: axum::extract::Request,
) -> Response {
    do_proxy_image(&config, &item_id, &image_type, &req).await
}

async fn do_proxy_image(
    config: &BridgeConfig,
    item_id: &str,
    image_type: &str,
    req: &axum::extract::Request,
) -> Response {
    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => return StatusCode::UNAUTHORIZED.into_response(),
    };

    let fnos_guid = match to_fnos_guid(item_id) {
        Some(g) => g,
        None => return StatusCode::NOT_FOUND.into_response(),
    };

    // 获取 play/info 来拿到图片 URL
    let result = fnos_get_play_info(
        &session.fnos_server,
        &session.fnos_token,
        &fnos_guid,
        config,
    )
    .await;

    if !result.success || result.data.is_none() {
        return StatusCode::NOT_FOUND.into_response();
    }

    let play_info = result.data.unwrap();
    let image_path = match image_type.to_lowercase().as_str() {
        "primary" => &play_info.item.posters,
        "backdrop" => &play_info.item.still_path,
        "thumb" => {
            if !play_info.item.still_path.is_empty() {
                &play_info.item.still_path
            } else {
                &play_info.item.posters
            }
        }
        _ => &play_info.item.posters,
    };

    if image_path.is_empty() {
        return StatusCode::NOT_FOUND.into_response();
    }

    // 构建飞牛图片 URL
    let image_url = if image_path.starts_with("http") {
        image_path.to_string()
    } else {
        format!("{}{}", session.fnos_server, image_path)
    };

    let authx = generate_authx_string(image_path, None);

    // 代理请求
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(config.ignore_cert)
        .build()
        .unwrap_or_default();

    let upstream = client
        .get(&image_url)
        .header("Authorization", &session.fnos_token)
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
