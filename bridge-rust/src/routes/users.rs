/// Users 路由 — 认证 + 用户信息

use axum::{
    extract::{Path, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use tracing::{info, warn};

use crate::config::BridgeConfig;
use crate::mappers::id::{generate_server_id, to_jellyfin_id};
use crate::mappers::user::map_user_to_jellyfin;
use crate::middleware::auth::require_auth;
use crate::cache::user_info::cached_get_user_info;
use crate::services::fnos::fnos_login;
use crate::services::session::{create_session, SessionData};
use crate::types::fnos::FnosUserInfo;
use crate::types::jellyfin::{
    AuthenticationResult, PlayStateInfo, SessionInfoDto,
};

pub fn router() -> Router<BridgeConfig> {
    Router::new()
        .route("/Users/AuthenticateByName", post(authenticate_by_name))
        .route("/Users/Public", get(users_public))
        .route("/Users", get(users_list))
        .route(
            "/Users/Me",
            get(users_me).layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Users/{userId}",
            get(users_by_id).layer(axum::middleware::from_fn(require_auth)),
        )
}

#[derive(Deserialize)]
struct AuthenticateBody {
    #[serde(rename = "Username")]
    username: String,
    #[serde(rename = "Pw")]
    pw: String,
}

async fn authenticate_by_name(
    State(config): State<BridgeConfig>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;

    // 解析 Authorization 头获取客户端信息
    let auth_value = req
        .headers()
        .get("Authorization")
        .or_else(|| req.headers().get("X-Emby-Authorization"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let auth_header = crate::middleware::auth::parse_auth_header(auth_value);

    // 解析请求体
    let body: AuthenticateBody = match axum::body::to_bytes(req.into_body(), 1024 * 64).await {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(b) => b,
            Err(_) => {
                return (StatusCode::BAD_REQUEST, Json(json!({"error": "Invalid request body"}))).into_response();
            }
        },
        Err(_) => {
            return (StatusCode::BAD_REQUEST, Json(json!({"error": "Failed to read body"}))).into_response();
        }
    };

    if body.username.is_empty() || body.pw.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error": "Username and password are required"})),
        ).into_response();
    }

    // 调用飞牛登录
    let (token, actual_server) = match fnos_login(&config, &body.username, &body.pw).await {
        Ok(r) => r,
        Err(e) => {
            warn!("[AUTH] 登录失败: user={}, error={}", body.username, e);
            return (StatusCode::UNAUTHORIZED, Json(json!({"error": e}))).into_response();
        }
    };

    let server_id = generate_server_id(&config.fnos_server);
    let user_id = to_jellyfin_id(&format!("user_{}", body.username));

    let ah = auth_header.unwrap_or_default();

    // 创建会话
    let access_token = create_session(
        token.clone(),
        actual_server.clone(),
        user_id.clone(),
        body.username.clone(),
        ah.client.clone(),
        ah.device_id.clone(),
        ah.device.clone(),
        ah.version.clone(),
    );

    info!("[AUTH] 登录成功: user={}, client={}, device={}", body.username, ah.client, ah.device);

    // 获取用户详细信息
    let mut user_info = FnosUserInfo {
        username: body.username.clone(),
        nickname: body.username.clone(),
        ..Default::default()
    };
    let result = cached_get_user_info(&actual_server, &token, &config).await;
    if result.success {
        if let Some(data) = result.data {
            user_info = data;
        }
    }

    let user_dto = map_user_to_jellyfin(&user_info, &user_id, &server_id);
    let now = chrono::Utc::now().to_rfc3339();

    let session_info = SessionInfoDto {
        play_state: PlayStateInfo {
            can_seek: false,
            is_paused: false,
            is_muted: false,
            repeat_mode: "RepeatNone".into(),
        },
        id: access_token[..8].to_string(),
        user_id: user_id.clone(),
        user_name: body.username.clone(),
        client: ah.client,
        device_id: ah.device_id,
        device_name: ah.device,
        application_version: ah.version,
        last_activity_date: now,
        server_id: server_id.clone(),
        is_active: true,
        supports_remote_control: false,
        has_custom_device_name: false,
    };

    let result = AuthenticationResult {
        user: user_dto,
        session_info,
        access_token,
        server_id,
    };

    Json(result).into_response()
}

async fn users_public() -> Json<Vec<()>> {
    Json(vec![])
}

async fn users_list() -> Json<Vec<()>> {
    Json(vec![])
}

async fn users_me(
    State(config): State<BridgeConfig>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;

    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => {
            return (StatusCode::UNAUTHORIZED, Json(json!({"error": "Unauthorized"}))).into_response();
        }
    };

    let server_id = generate_server_id(&config.fnos_server);
    let mut user_info = FnosUserInfo {
        username: session.username.clone(),
        nickname: session.username.clone(),
        ..Default::default()
    };

    let result = cached_get_user_info(&session.fnos_server, &session.fnos_token, &config).await;
    if result.success {
        if let Some(data) = result.data {
            user_info = data;
        }
    }

    let user_dto = map_user_to_jellyfin(&user_info, &session.user_id, &server_id);
    Json(user_dto).into_response()
}

async fn users_by_id(
    State(config): State<BridgeConfig>,
    Path(_user_id): Path<String>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;

    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => {
            return (StatusCode::UNAUTHORIZED, Json(json!({"error": "Unauthorized"}))).into_response();
        }
    };

    let server_id = generate_server_id(&config.fnos_server);
    let mut user_info = FnosUserInfo {
        username: session.username.clone(),
        nickname: session.username.clone(),
        ..Default::default()
    };

    let result = cached_get_user_info(&session.fnos_server, &session.fnos_token, &config).await;
    if result.success {
        if let Some(data) = result.data {
            user_info = data;
        }
    }

    let user_dto = map_user_to_jellyfin(&user_info, &session.user_id, &server_id);
    Json(user_dto).into_response()
}
