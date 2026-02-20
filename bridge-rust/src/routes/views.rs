/// UserViews 路由 — 媒体库列表

use axum::{extract::State, routing::get, Json, Router};

use crate::config::BridgeConfig;
use crate::mappers::id::{generate_server_id, to_jellyfin_id};
use crate::mappers::item::make_collection_folder;
use crate::middleware::auth::require_auth;
use crate::types::jellyfin::ItemsResult;

pub fn router() -> Router<BridgeConfig> {
    Router::new().route(
        "/UserViews",
        get(user_views).layer(axum::middleware::from_fn(require_auth)),
    )
}

async fn user_views(State(config): State<BridgeConfig>) -> Json<ItemsResult> {
    let server_id = generate_server_id(&config.fnos_server);

    let movies = make_collection_folder(
        "电影",
        &to_jellyfin_id("view_movies"),
        &server_id,
        "movies",
    );
    let tvshows = make_collection_folder(
        "电视剧",
        &to_jellyfin_id("view_tvshows"),
        &server_id,
        "tvshows",
    );

    Json(ItemsResult {
        items: vec![movies, tvshows],
        total_record_count: 2,
        start_index: 0,
    })
}
