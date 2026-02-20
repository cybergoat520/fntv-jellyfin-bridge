/// Items 路由 — 媒体库浏览

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
use crate::mappers::media::build_media_sources;
use crate::middleware::auth::require_auth;
use crate::services::fnos::*;
use crate::services::session::SessionData;
use crate::types::jellyfin::{BaseItemDto, ItemsResult};

pub fn router() -> Router<BridgeConfig> {
    Router::new()
        .route(
            "/Items",
            get(items_list).layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Items/Latest",
            get(items_latest).layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Items/{itemId}",
            get(items_detail).layer(axum::middleware::from_fn(require_auth)),
        )
        // 旧版路径兼容
        .route(
            "/Users/{userId}/Items",
            get(items_list).layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Users/{userId}/Items/Resume",
            get(items_resume).layer(axum::middleware::from_fn(require_auth)),
        )
        .route(
            "/Users/{userId}/Items/{itemId}",
            get(items_detail_compat).layer(axum::middleware::from_fn(require_auth)),
        )
}

#[derive(Deserialize, Default)]
struct ItemsQuery {
    #[serde(rename = "ParentId")]
    parent_id: Option<String>,
    #[serde(rename = "IncludeItemTypes")]
    include_item_types: Option<String>,
    #[serde(rename = "SearchTerm")]
    search_term: Option<String>,
    #[serde(rename = "SortBy")]
    sort_by: Option<String>,
    #[serde(rename = "SortOrder")]
    sort_order: Option<String>,
    #[serde(rename = "Filters")]
    filters: Option<String>,
    #[serde(rename = "StartIndex")]
    start_index: Option<i64>,
    #[serde(rename = "Limit")]
    limit: Option<i64>,
    #[serde(rename = "Recursive")]
    recursive: Option<String>,
}

async fn items_list(
    State(config): State<BridgeConfig>,
    Query(query): Query<ItemsQuery>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;

    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({"error":"Unauthorized"}))).into_response(),
    };

    let server_id = generate_server_id(&config.fnos_server);

    // 确定 parent_guid
    let parent_id = query.parent_id.unwrap_or_default();
    let fnos_parent = if parent_id.is_empty() {
        String::new()
    } else {
        to_fnos_guid(&parent_id).unwrap_or_default()
    };

    // 处理虚拟媒体库
    let category = if fnos_parent == "view_movies" {
        "Movie"
    } else if fnos_parent == "view_tvshows" {
        "TV"
    } else if fnos_parent.starts_with("view_") {
        ""
    } else {
        // 从 IncludeItemTypes 推断
        match query.include_item_types.as_deref() {
            Some(t) if t.contains("Movie") => "Movie",
            Some(t) if t.contains("Series") => "TV",
            _ => "",
        }
    };

    // 排序
    let sort_column = match query.sort_by.as_deref() {
        Some(s) if s.contains("DateCreated") => "ts",
        Some(s) if s.contains("CommunityRating") => "vote_average",
        _ => "title",
    };
    let sort_type = match query.sort_order.as_deref() {
        Some("Descending") => "desc",
        _ => "asc",
    };

    // 收藏过滤
    let is_favorite = query.filters.as_deref().map_or(false, |f| f.contains("IsFavorite"));

    // 构建请求
    let parent_guid = if fnos_parent.starts_with("view_") || fnos_parent.is_empty() {
        String::new()
    } else {
        fnos_parent
    };

    let result = fnos_get_item_list(
        &session.fnos_server,
        &session.fnos_token,
        &parent_guid,
        sort_column,
        sort_type,
        &config,
    )
    .await;

    if !result.success || result.data.is_none() {
        return Json(ItemsResult {
            items: vec![],
            total_record_count: 0,
            start_index: 0,
        }).into_response();
    }

    let list_data = result.data.unwrap();
    let mut items: Vec<BaseItemDto> = list_data
        .list
        .iter()
        .filter(|item| {
            // 类型过滤
            if !category.is_empty() && item.item_type != category {
                return false;
            }
            // 收藏过滤
            if is_favorite && item.is_favorite != 1 {
                return false;
            }
            // 搜索过滤
            if let Some(ref term) = query.search_term {
                let lower = term.to_lowercase();
                let title_match = item.title.to_lowercase().contains(&lower);
                let tv_match = item.tv_title.to_lowercase().contains(&lower);
                if !title_match && !tv_match {
                    return false;
                }
            }
            true
        })
        .map(|item| map_playlist_item_to_dto(item, &server_id))
        .collect();

    let total = items.len() as i64;
    let start = query.start_index.unwrap_or(0) as usize;
    let limit = query.limit.unwrap_or(total) as usize;

    if start < items.len() {
        items = items[start..items.len().min(start + limit)].to_vec();
    } else {
        items.clear();
    }

    Json(ItemsResult {
        items,
        total_record_count: total,
        start_index: start as i64,
    }).into_response()
}

async fn items_latest(
    State(config): State<BridgeConfig>,
    Query(query): Query<ItemsQuery>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;

    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({"error":"Unauthorized"}))).into_response(),
    };

    let server_id = generate_server_id(&config.fnos_server);

    let result = fnos_get_item_list(
        &session.fnos_server,
        &session.fnos_token,
        "",
        "ts",
        "desc",
        &config,
    )
    .await;

    if !result.success || result.data.is_none() {
        return Json::<Vec<BaseItemDto>>(vec![]).into_response();
    }

    let list_data = result.data.unwrap();
    let limit = query.limit.unwrap_or(20) as usize;

    let items: Vec<BaseItemDto> = list_data
        .list
        .iter()
        .take(limit)
        .map(|item| map_playlist_item_to_dto(item, &server_id))
        .collect();

    Json(items).into_response()
}

async fn items_detail(
    State(config): State<BridgeConfig>,
    Path(item_id): Path<String>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    use axum::http::StatusCode;

    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => return (StatusCode::UNAUTHORIZED, Json(json!({"error":"Unauthorized"}))).into_response(),
    };

    let server_id = generate_server_id(&config.fnos_server);
    let fnos_guid = to_fnos_guid(&item_id);

    // 处理虚拟媒体库 ID
    if let Some(ref guid) = fnos_guid {
        if guid.starts_with("view_") {
            let (name, ct) = match guid.as_str() {
                "view_movies" => ("电影", "movies"),
                "view_tvshows" => ("电视剧", "tvshows"),
                _ => ("未知", "unknown"),
            };
            return Json(make_collection_folder(name, &item_id, &server_id, ct)).into_response();
        }
    }

    // 缓存未命中，尝试 play/info 查询
    let fnos_guid = match fnos_guid {
        Some(g) => g,
        None => {
            let stripped = item_id.replace('-', "");
            match fnos_get_play_info(&session.fnos_server, &session.fnos_token, &stripped, &config).await {
                result if result.success && result.data.is_some() => {
                    let play_info = result.data.unwrap();
                    let real_guid = play_info.item.guid.clone();
                    register_item_type(&real_guid, &play_info.item.item_type);
                    register_reverse_mapping(&item_id, &real_guid);
                    return build_item_response(&session, &item_id, &real_guid, play_info, &server_id, &config).await.into_response();
                }
                _ => {
                    return (StatusCode::NOT_FOUND, Json(json!({"error":"Item not found"}))).into_response();
                }
            }
        }
    };

    let result = fnos_get_play_info(&session.fnos_server, &session.fnos_token, &fnos_guid, &config).await;
    if !result.success || result.data.is_none() {
        return (StatusCode::NOT_FOUND, Json(json!({"error":"Item not found"}))).into_response();
    }

    build_item_response(&session, &item_id, &fnos_guid, result.data.unwrap(), &server_id, &config).await.into_response()
}

async fn items_detail_compat(
    State(config): State<BridgeConfig>,
    Path((_user_id, item_id)): Path<(String, String)>,
    req: axum::extract::Request,
) -> axum::response::Response {
    items_detail(State(config), Path(item_id), req).await
}

async fn items_resume(
    State(config): State<BridgeConfig>,
    Query(query): Query<ItemsQuery>,
    req: axum::extract::Request,
) -> axum::response::Response {
    use axum::response::IntoResponse;

    let session = match req.extensions().get::<SessionData>() {
        Some(s) => s.clone(),
        None => return (axum::http::StatusCode::UNAUTHORIZED, Json(json!({"error":"Unauthorized"}))).into_response(),
    };

    let server_id = generate_server_id(&config.fnos_server);

    let result = fnos_get_item_list(
        &session.fnos_server,
        &session.fnos_token,
        "",
        "ts",
        "desc",
        &config,
    )
    .await;

    if !result.success || result.data.is_none() {
        return Json(ItemsResult { items: vec![], total_record_count: 0, start_index: 0 }).into_response();
    }

    let list_data = result.data.unwrap();
    let limit = query.limit.unwrap_or(12) as usize;

    let items: Vec<BaseItemDto> = list_data
        .list
        .iter()
        .filter(|item| item.ts > 0.0 && item.watched == 0)
        .take(limit)
        .map(|item| map_playlist_item_to_dto(item, &server_id))
        .collect();

    let total = items.len() as i64;
    Json(ItemsResult { items, total_record_count: total, start_index: 0 }).into_response()
}

async fn build_item_response(
    session: &SessionData,
    item_id: &str,
    fnos_guid: &str,
    mut play_info: crate::types::fnos::FnosPlayInfo,
    server_id: &str,
    config: &BridgeConfig,
) -> Json<BaseItemDto> {
    let original_type = get_item_type(fnos_guid);

    // 类型覆盖
    if matches!(original_type.as_deref(), Some("TV") | Some("Series")) {
        play_info.item.item_type = "TV".into();
        if !play_info.item.tv_title.is_empty() {
            play_info.item.title = play_info.item.tv_title.clone();
        }
        play_info.item.guid = fnos_guid.to_string();
        play_info.grand_guid = String::new();
        play_info.parent_guid = String::new();
    }

    if original_type.as_deref() == Some("Season") {
        play_info.item.item_type = "Season".into();
        if !play_info.item.parent_title.is_empty() {
            play_info.item.title = play_info.item.parent_title.clone();
        }
        play_info.item.guid = fnos_guid.to_string();
    }

    let mut dto = map_play_info_to_dto(&play_info, server_id);

    // 对可播放项目，获取流信息并附加 MediaSources
    if dto.media_type.as_deref() == Some("Video") && !play_info.media_guid.is_empty() {
        let result = fnos_get_stream_list(
            &session.fnos_server,
            &session.fnos_token,
            fnos_guid,
            config,
        )
        .await;
        if result.success {
            if let Some(sd) = result.data {
                let files = sd["files"].as_array().cloned().unwrap_or_default();
                let video_streams = sd["video_streams"].as_array().cloned().unwrap_or_default();
                let audio_streams = sd["audio_streams"].as_array().cloned().unwrap_or_default();
                let subtitle_streams = sd["subtitle_streams"].as_array().cloned().unwrap_or_default();

                let media_sources = build_media_sources(
                    item_id,
                    &files,
                    &video_streams,
                    &audio_streams,
                    &subtitle_streams,
                    play_info.item.duration,
                );

                // 注册 media_guid → item_guid 映射
                for ms in &media_sources {
                    if let Some(id) = ms["Id"].as_str() {
                        register_media_guid(id, fnos_guid);
                    }
                }

                if !media_sources.is_empty() {
                    dto.media_streams = media_sources[0]["MediaStreams"].as_array().map(|a| a.clone());
                }
                dto.media_sources = Some(media_sources);
            }
        }
    }

    Json(dto)
}
