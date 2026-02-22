/// 增强功能路由 — 收藏、已观看、继续观看

use axum::{
    extract::{Path, State},
    routing::post,
    Json, Router,
};
use tracing::{debug, warn};

use crate::config::BridgeConfig;
use crate::mappers::id::to_fnos_guid;
use crate::middleware::auth::require_auth;
use crate::services::fnos::{fnos_get_play_info, fnos_set_favorite, fnos_set_watched};
use crate::cache::item_list::update_item_from_play_info;
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
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;
    
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        debug!("[FAVORITE] 添加收藏: item_id={}, fnos_guid={}", item_id, guid);
        let result = fnos_set_favorite(&session.fnos_server, &session.fnos_token, &guid, true, &config).await;
        if result.success {
            // 获取最新状态并更新缓存
            let play_info = fnos_get_play_info(&session.fnos_server, &session.fnos_token, &guid, &config).await;
            if let Some(info) = play_info.data {
                update_item_from_play_info(&session.fnos_server, &info);
            }
        }
        debug!("[FAVORITE] 添加收藏结果: success={}, message={:?}", result.success, result.message);
        Json(default_user_data(true, false)).into_response()
    } else {
        warn!("[FAVORITE] 无法转换 item_id: {}", item_id);
        (StatusCode::NOT_FOUND, Json(default_user_data(false, false))).into_response()
    }
}

async fn favorite_remove(
    State(config): State<BridgeConfig>,
    Path(item_id): Path<String>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;
    
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        debug!("[FAVORITE] 取消收藏: item_id={}, fnos_guid={}", item_id, guid);
        let result = fnos_set_favorite(&session.fnos_server, &session.fnos_token, &guid, false, &config).await;
        if result.success {
            // 获取最新状态并更新缓存
            let play_info = fnos_get_play_info(&session.fnos_server, &session.fnos_token, &guid, &config).await;
            if let Some(info) = play_info.data {
                update_item_from_play_info(&session.fnos_server, &info);
            }
        }
        debug!("[FAVORITE] 取消收藏结果: success={}, message={:?}", result.success, result.message);
        Json(default_user_data(false, false)).into_response()
    } else {
        warn!("[FAVORITE] 无法转换 item_id: {}", item_id);
        (StatusCode::NOT_FOUND, Json(default_user_data(false, false))).into_response()
    }
}

async fn favorite_add_compat(
    State(config): State<BridgeConfig>,
    Path((_uid, item_id)): Path<(String, String)>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;
    
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        debug!("[FAVORITE] 添加收藏(compat): item_id={}, fnos_guid={}", item_id, guid);
        let result = fnos_set_favorite(&session.fnos_server, &session.fnos_token, &guid, true, &config).await;
        if result.success {
            let play_info = fnos_get_play_info(&session.fnos_server, &session.fnos_token, &guid, &config).await;
            if let Some(info) = play_info.data {
                update_item_from_play_info(&session.fnos_server, &info);
            }
        }
        debug!("[FAVORITE] 添加收藏结果: success={}, message={:?}", result.success, result.message);
        Json(default_user_data(true, false)).into_response()
    } else {
        warn!("[FAVORITE] 无法转换 item_id: {}", item_id);
        (StatusCode::NOT_FOUND, Json(default_user_data(false, false))).into_response()
    }
}

async fn favorite_remove_compat(
    State(config): State<BridgeConfig>,
    Path((_uid, item_id)): Path<(String, String)>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;
    
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        debug!("[FAVORITE] 取消收藏(compat): item_id={}, fnos_guid={}", item_id, guid);
        let result = fnos_set_favorite(&session.fnos_server, &session.fnos_token, &guid, false, &config).await;
        if result.success {
            let play_info = fnos_get_play_info(&session.fnos_server, &session.fnos_token, &guid, &config).await;
            if let Some(info) = play_info.data {
                update_item_from_play_info(&session.fnos_server, &info);
            }
        }
        debug!("[FAVORITE] 取消收藏结果: success={}, message={:?}", result.success, result.message);
        Json(default_user_data(false, false)).into_response()
    } else {
        warn!("[FAVORITE] 无法转换 item_id: {}", item_id);
        (StatusCode::NOT_FOUND, Json(default_user_data(false, false))).into_response()
    }
}

async fn played_add(
    State(config): State<BridgeConfig>,
    Path(item_id): Path<String>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;
    
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        debug!("[PLAYED] 标记已看: item_id={}, fnos_guid={}", item_id, guid);
        let result = fnos_set_watched(&session.fnos_server, &session.fnos_token, &guid, true, &config).await;
        if result.success {
            // 获取最新状态并更新缓存
            let play_info = fnos_get_play_info(&session.fnos_server, &session.fnos_token, &guid, &config).await;
            if let Some(info) = play_info.data {
                update_item_from_play_info(&session.fnos_server, &info);
            }
        }
        debug!("[PLAYED] 标记已看结果: success={}, message={:?}", result.success, result.message);
        Json(default_user_data(false, true)).into_response()
    } else {
        warn!("[PLAYED] 无法转换 item_id: {}", item_id);
        (StatusCode::NOT_FOUND, Json(default_user_data(false, false))).into_response()
    }
}

async fn played_remove(
    State(config): State<BridgeConfig>,
    Path(item_id): Path<String>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;
    
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        debug!("[PLAYED] 取消已看: item_id={}, fnos_guid={}", item_id, guid);
        let result = fnos_set_watched(&session.fnos_server, &session.fnos_token, &guid, false, &config).await;
        if result.success {
            // 获取最新状态并更新缓存
            let play_info = fnos_get_play_info(&session.fnos_server, &session.fnos_token, &guid, &config).await;
            if let Some(info) = play_info.data {
                update_item_from_play_info(&session.fnos_server, &info);
            }
        }
        debug!("[PLAYED] 取消已看结果: success={}, message={:?}", result.success, result.message);
        Json(default_user_data(false, false)).into_response()
    } else {
        warn!("[PLAYED] 无法转换 item_id: {}", item_id);
        (StatusCode::NOT_FOUND, Json(default_user_data(false, false))).into_response()
    }
}

async fn played_add_compat(
    State(config): State<BridgeConfig>,
    Path((_uid, item_id)): Path<(String, String)>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;
    
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        debug!("[PLAYED] 标记已看(compat): item_id={}, fnos_guid={}", item_id, guid);
        let result = fnos_set_watched(&session.fnos_server, &session.fnos_token, &guid, true, &config).await;
        if result.success {
            let play_info = fnos_get_play_info(&session.fnos_server, &session.fnos_token, &guid, &config).await;
            if let Some(info) = play_info.data {
                update_item_from_play_info(&session.fnos_server, &info);
            }
        }
        debug!("[PLAYED] 标记已看结果: success={}, message={:?}", result.success, result.message);
        Json(default_user_data(false, true)).into_response()
    } else {
        warn!("[PLAYED] 无法转换 item_id: {}", item_id);
        (StatusCode::NOT_FOUND, Json(default_user_data(false, false))).into_response()
    }
}

async fn played_remove_compat(
    State(config): State<BridgeConfig>,
    Path((_uid, item_id)): Path<(String, String)>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;
    
    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    if let Some(guid) = to_fnos_guid(&item_id) {
        debug!("[PLAYED] 取消已看(compat): item_id={}, fnos_guid={}", item_id, guid);
        let result = fnos_set_watched(&session.fnos_server, &session.fnos_token, &guid, false, &config).await;
        if result.success {
            let play_info = fnos_get_play_info(&session.fnos_server, &session.fnos_token, &guid, &config).await;
            if let Some(info) = play_info.data {
                update_item_from_play_info(&session.fnos_server, &info);
            }
        }
        debug!("[PLAYED] 取消已看结果: success={}, message={:?}", result.success, result.message);
        Json(default_user_data(false, false)).into_response()
    } else {
        warn!("[PLAYED] 无法转换 item_id: {}", item_id);
        (StatusCode::NOT_FOUND, Json(default_user_data(false, false))).into_response()
    }
}
