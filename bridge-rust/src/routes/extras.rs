/// 增强功能路由 — 收藏、已观看、继续观看

use axum::{
    extract::{Path, State},
    routing::{delete, get, post},
    Json, Router,
};
use serde_json::json;

use crate::config::BridgeConfig;
use crate::mappers::id::to_fnos_guid;
use crate::middleware::auth::require_auth;
use crate::services::fnos::{fnos_set_favorite, fnos_set_watched};
use crate::services::session::SessionData;
use crate::types::jellyfin::UserItemDataDto;

pub fn router() -> Router<BridgeConfig> {
    Router::new()
        // 收藏
        .route(
            "/UserFavoriteItems/{itemId}",
            post(favorite_add)
                .delete(favorite_remove)
                .layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Users/{userId}/FavoriteItems/{itemId}",
            post(favorite_add_compat)
                .delete(favorite_remove_compat)
                .layer(axum::middleware::from_fn(require_auth)),
        )
        // 已观看
        .route(
            "/UserPlayedItems/{itemId}",
            post(played_add)
                .delete(played_remove)
                .layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Users/{userId}/PlayedItems/{itemId}",
            post(played_add_compat)
                .delete(played_remove_compat)
                .layer(axum::middleware::from_fn(require_auth)),
        )
}

fn default_user_data(is_fav: bool, played: bool) -> UserItemDataDto {
    UserItemDataDto {
        playback_position_ticks: 0,
        play_count: if played { 1 } else { 0 },
        is_favorite: is_fav,
        played,
        played_percentage: None,
        unplayed_item_count: None,
    }
}

async fn favorite_add(
    State(config): State<BridgeConfig>,
    Path(item_id): Path<String>,
    req: axum::extract::Request,
) -> Json<UserItemDataDto> {
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        let _ = fnos_set_favorite(&session.fnos_server, &session.fnos_token, &guid, true, &config).await;
    }
    Json(default_user_data(true, false))
}

async fn favorite_remove(
    State(config): State<BridgeConfig>,
    Path(item_id): Path<String>,
    req: axum::extract::Request,
) -> Json<UserItemDataDto> {
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        let _ = fnos_set_favorite(&session.fnos_server, &session.fnos_token, &guid, false, &config).await;
    }
    Json(default_user_data(false, false))
}

async fn favorite_add_compat(
    State(config): State<BridgeConfig>,
    Path((_uid, item_id)): Path<(String, String)>,
    req: axum::extract::Request,
) -> Json<UserItemDataDto> {
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        let _ = fnos_set_favorite(&session.fnos_server, &session.fnos_token, &guid, true, &config).await;
    }
    Json(default_user_data(true, false))
}

async fn favorite_remove_compat(
    State(config): State<BridgeConfig>,
    Path((_uid, item_id)): Path<(String, String)>,
    req: axum::extract::Request,
) -> Json<UserItemDataDto> {
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        let _ = fnos_set_favorite(&session.fnos_server, &session.fnos_token, &guid, false, &config).await;
    }
    Json(default_user_data(false, false))
}

async fn played_add(
    State(config): State<BridgeConfig>,
    Path(item_id): Path<String>,
    req: axum::extract::Request,
) -> Json<UserItemDataDto> {
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        let _ = fnos_set_watched(&session.fnos_server, &session.fnos_token, &guid, true, &config).await;
    }
    Json(default_user_data(false, true))
}

async fn played_remove(
    State(config): State<BridgeConfig>,
    Path(item_id): Path<String>,
    req: axum::extract::Request,
) -> Json<UserItemDataDto> {
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        let _ = fnos_set_watched(&session.fnos_server, &session.fnos_token, &guid, false, &config).await;
    }
    Json(default_user_data(false, false))
}

async fn played_add_compat(
    State(config): State<BridgeConfig>,
    Path((_uid, item_id)): Path<(String, String)>,
    req: axum::extract::Request,
) -> Json<UserItemDataDto> {
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        let _ = fnos_set_watched(&session.fnos_server, &session.fnos_token, &guid, true, &config).await;
    }
    Json(default_user_data(false, true))
}

async fn played_remove_compat(
    State(config): State<BridgeConfig>,
    Path((_uid, item_id)): Path<(String, String)>,
    req: axum::extract::Request,
) -> Json<UserItemDataDto> {
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        let _ = fnos_set_watched(&session.fnos_server, &session.fnos_token, &guid, false, &config).await;
    }
    Json(default_user_data(false, false))
}
