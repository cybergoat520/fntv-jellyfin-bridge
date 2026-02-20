/// Shows 路由 — 剧集（季/集）

use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use crate::config::BridgeConfig;
use crate::mappers::id::*;
use crate::mappers::item::*;
use crate::middleware::auth::require_auth;
use crate::services::fnos::*;
use crate::services::session::SessionData;
use crate::types::jellyfin::{BaseItemDto, ItemsResult};

pub fn router() -> Router<BridgeConfig> {
    Router::new()
        .route(
            "/Shows/{seriesId}/Seasons",
            get(seasons).layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Shows/{seriesId}/Episodes",
            get(episodes).layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Shows/NextUp",
            get(next_up).layer(axum::middleware::from_fn(require_auth)),
        )
}

#[derive(Deserialize, Default)]
struct SeasonsQuery {
    #[serde(rename = "UserId")]
    user_id: Option<String>,
}

#[derive(Deserialize, Default)]
struct EpisodesQuery {
    #[serde(rename = "SeasonId")]
    season_id: Option<String>,
    #[serde(rename = "Season")]
    season: Option<i32>,
    #[serde(rename = "UserId")]
    user_id: Option<String>,
}

async fn seasons(
    State(config): State<BridgeConfig>,
    Path(series_id): Path<String>,
    Query(_query): Query<SeasonsQuery>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;

    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => return (StatusCode::UNAUTHORIZED, Json(json!({"error":"Unauthorized"}))).into_response(),
    };

    let server_id = generate_server_id(&config.fnos_server);
    let fnos_guid = match to_fnos_guid(&series_id) {
        Some(g) => g,
        None => return Json(ItemsResult { items: vec![], total_record_count: 0, start_index: 0 }).into_response(),
    };

    let result = fnos_get_season_list(
        &session.fnos_server,
        &session.fnos_token,
        &fnos_guid,
        &config,
    )
    .await;

    if !result.success || result.data.is_none() {
        return Json(ItemsResult { items: vec![], total_record_count: 0, start_index: 0 }).into_response();
    }

    let seasons = result.data.unwrap();
    let items: Vec<BaseItemDto> = seasons
        .iter()
        .map(|s| {
            register_item_type(&s.guid, "Season");
            let mut dto = map_playlist_item_to_dto(s, &server_id);
            dto.item_type = "Season".into();
            dto.index_number = Some(s.season_number);
            dto.series_id = Some(to_jellyfin_id(&fnos_guid));
            dto.series_name = Some(s.tv_title.clone());
            if dto.name.is_empty() {
                dto.name = format!("第 {} 季", s.season_number);
            }
            dto
        })
        .collect();

    let total = items.len() as i64;
    Json(ItemsResult { items, total_record_count: total, start_index: 0 }).into_response()
}

async fn episodes(
    State(config): State<BridgeConfig>,
    Path(series_id): Path<String>,
    Query(query): Query<EpisodesQuery>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;

    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => return (StatusCode::UNAUTHORIZED, Json(json!({"error":"Unauthorized"}))).into_response(),
    };

    let server_id = generate_server_id(&config.fnos_server);

    // 优先用 SeasonId 获取集列表
    let season_guid = query
        .season_id
        .as_ref()
        .and_then(|sid| to_fnos_guid(sid));

    let season_guid = match season_guid {
        Some(g) => g,
        None => {
            // 没有 SeasonId，用 series 的第一季
            let series_guid = match to_fnos_guid(&series_id) {
                Some(g) => g,
                None => return Json(ItemsResult { items: vec![], total_record_count: 0, start_index: 0 }).into_response(),
            };
            let seasons_result = fnos_get_season_list(
                &session.fnos_server,
                &session.fnos_token,
                &series_guid,
                &config,
            )
            .await;
            if !seasons_result.success || seasons_result.data.is_none() {
                return Json(ItemsResult { items: vec![], total_record_count: 0, start_index: 0 }).into_response();
            }
            let seasons = seasons_result.data.unwrap();
            let target_season = query.season.unwrap_or(1);
            match seasons.iter().find(|s| s.season_number == target_season) {
                Some(s) => s.guid.clone(),
                None => match seasons.first() {
                    Some(s) => s.guid.clone(),
                    None => return Json(ItemsResult { items: vec![], total_record_count: 0, start_index: 0 }).into_response(),
                },
            }
        }
    };

    let result = fnos_get_episode_list(
        &session.fnos_server,
        &session.fnos_token,
        &season_guid,
        &config,
    )
    .await;

    if !result.success || result.data.is_none() {
        return Json(ItemsResult { items: vec![], total_record_count: 0, start_index: 0 }).into_response();
    }

    let episodes = result.data.unwrap();
    let items: Vec<BaseItemDto> = episodes
        .iter()
        .map(|ep| {
            let mut dto = map_playlist_item_to_dto(ep, &server_id);
            dto.series_id = Some(to_jellyfin_id(
                &to_fnos_guid(&series_id).unwrap_or_default(),
            ));
            dto
        })
        .collect();

    let total = items.len() as i64;
    Json(ItemsResult { items, total_record_count: total, start_index: 0 }).into_response()
}

async fn next_up() -> Json<ItemsResult> {
    Json(ItemsResult {
        items: vec![],
        total_record_count: 0,
        start_index: 0,
    })
}
