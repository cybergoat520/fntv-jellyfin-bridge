/// Jellyfin 认证中间件
/// 解析 Authorization 头，提取会话信息

use axum::{
    extract::Request,
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use regex::Regex;
use serde_json::json;
use std::sync::LazyLock;

use crate::services::session::{get_session, SessionData};
use crate::types::jellyfin::JellyfinAuthHeader;

static AUTH_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(\w+)="([^"]*)""#).unwrap());

/// 解析 Jellyfin MediaBrowser Authorization 头
pub fn parse_auth_header(header: &str) -> Option<JellyfinAuthHeader> {
    if header.is_empty() {
        return None;
    }

    let raw = if header.to_lowercase().starts_with("mediabrowser ") {
        &header["mediabrowser ".len()..]
    } else {
        header
    };

    let mut params = std::collections::HashMap::new();
    for cap in AUTH_REGEX.captures_iter(raw) {
        let key = cap[1].to_lowercase();
        let value = cap[2].to_string();
        params.insert(key, value);
    }

    if params.get("client").is_none()
        && params.get("device").is_none()
        && params.get("token").is_none()
    {
        return None;
    }

    Some(JellyfinAuthHeader {
        client: params.get("client").cloned().unwrap_or_else(|| "Unknown".into()),
        device: params.get("device").cloned().unwrap_or_else(|| "Unknown".into()),
        device_id: params.get("deviceid").cloned().unwrap_or_else(|| "unknown".into()),
        version: params.get("version").cloned().unwrap_or_else(|| "0.0.0".into()),
        token: params.get("token").cloned(),
    })
}

/// 从请求中提取 token
pub fn extract_token(req: &Request) -> (Option<String>, Option<JellyfinAuthHeader>) {
    let headers = req.headers();

    // Authorization or X-Emby-Authorization header
    let auth_value = headers
        .get("Authorization")
        .or_else(|| headers.get("X-Emby-Authorization"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let parsed = if !auth_value.is_empty() {
        parse_auth_header(auth_value)
    } else {
        None
    };

    // 优先从 header 中获取 token
    if let Some(ref p) = parsed {
        if let Some(ref t) = p.token {
            return (Some(t.clone()), parsed);
        }
    }

    // 从 query parameter 获取
    let uri = req.uri();
    if let Some(query) = uri.query() {
        for pair in query.split('&') {
            if let Some((key, value)) = pair.split_once('=') {
                if key == "api_key" || key == "ApiKey" {
                    return (Some(value.to_string()), parsed);
                }
            }
        }
    }

    // X-MediaBrowser-Token / X-Emby-Token
    if let Some(t) = headers
        .get("X-MediaBrowser-Token")
        .or_else(|| headers.get("X-Emby-Token"))
        .and_then(|v| v.to_str().ok())
    {
        return (Some(t.to_string()), parsed);
    }

    // 如果 Authorization 不是 MediaBrowser 格式，可能直接是 token
    if !auth_value.is_empty() && parsed.is_none() {
        let raw_token = if let Some(stripped) = auth_value.strip_prefix("Bearer ") {
            stripped
        } else {
            auth_value
        };
        return (Some(raw_token.to_string()), None);
    }

    (None, parsed)
}

/// 从请求扩展中获取 session
pub fn get_session_from_ext(req: &Request) -> Option<SessionData> {
    req.extensions().get::<SessionData>().cloned()
}

/// 认证中间件 — 需要有效会话
pub async fn require_auth(mut req: Request, next: Next) -> Response {
    let (token, parsed) = extract_token(&req);

    let token = match token {
        Some(t) => t,
        None => {
            return (StatusCode::UNAUTHORIZED, Json(json!({"error": "Unauthorized"}))).into_response();
        }
    };

    let session = match get_session(&token) {
        Some(s) => s,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": "Invalid or expired token"})),
            )
                .into_response();
        }
    };

    req.extensions_mut().insert(session);
    if let Some(p) = parsed {
        req.extensions_mut().insert(p);
    }

    next.run(req).await
}
