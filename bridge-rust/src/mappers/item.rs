/// Item 映射器
/// 飞牛 PlayListItem / ItemDetail → Jellyfin BaseItemDto

use base64::Engine;
use crate::types::fnos::{FnosPlayInfo, FnosPlayListItem};
use crate::types::jellyfin::{BaseItemDto, UserItemDataDto};
use super::id::{to_jellyfin_id, register_item_type};

/// 秒 → Jellyfin ticks (1 tick = 100ns)
pub fn seconds_to_ticks(seconds: f64) -> i64 {
    (seconds * 10_000_000.0).round() as i64
}

/// ticks → 秒
pub fn ticks_to_seconds(ticks: i64) -> f64 {
    ticks as f64 / 10_000_000.0
}

/// 飞牛内容类型 → Jellyfin 类型
fn map_type(fnos_type: &str) -> &'static str {
    match fnos_type {
        "Movie" => "Movie",
        "Episode" => "Episode",
        "TV" | "Series" => "Series",
        "Season" => "Season",
        "Directory" => "Folder",
        _ => "Video",
    }
}

/// 飞牛类型 → Jellyfin MediaType
fn map_media_type(jf_type: &str) -> Option<&'static str> {
    match jf_type {
        "Movie" | "Episode" | "Video" => Some("Video"),
        _ => None,
    }
}

/// 构造图片标签
fn make_image_tags(poster: &str) -> Option<serde_json::Value> {
    if poster.is_empty() {
        return Some(serde_json::json!({}));
    }
    let tag = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(poster.as_bytes());
    let tag = &tag[..tag.len().min(16)];
    Some(serde_json::json!({ "Primary": tag }))
}

/// 将飞牛 PlayListItem 映射为 Jellyfin BaseItemDto
pub fn map_playlist_item_to_dto(item: &FnosPlayListItem, server_id: &str) -> BaseItemDto {
    let jf_type = map_type(&item.item_type);
    let is_folder = matches!(jf_type, "Series" | "Season" | "Folder");
    let duration = if item.duration > 0.0 {
        item.duration
    } else if item.runtime > 0.0 {
        item.runtime * 60.0
    } else {
        0.0
    };

    register_item_type(&item.guid, &item.item_type);

    let mut dto = BaseItemDto {
        name: if !item.title.is_empty() {
            item.title.clone()
        } else {
            item.tv_title.clone()
        },
        server_id: server_id.to_string(),
        id: to_jellyfin_id(&item.guid),
        can_delete: false,
        can_download: false,
        overview: if item.overview.is_empty() { None } else { Some(item.overview.clone()) },
        community_rating: item.vote_average.parse::<f64>().ok().filter(|v| *v > 0.0),
        run_time_ticks: if duration > 0.0 { Some(seconds_to_ticks(duration)) } else { None },
        is_folder,
        item_type: jf_type.to_string(),
        media_type: map_media_type(jf_type).map(String::from),
        image_tags: make_image_tags(&item.poster),
        backdrop_image_tags: Some(vec![]),
        location_type: Some("FileSystem".into()),
        user_data: Some(UserItemDataDto {
            playback_position_ticks: if item.ts > 0.0 { seconds_to_ticks(item.ts) } else { 0 },
            play_count: if item.watched != 0 { 1 } else { 0 },
            is_favorite: item.is_favorite == 1,
            played: item.watched == 1,
            played_percentage: if duration > 0.0 && item.ts > 0.0 {
                Some((item.ts / duration * 100.0).min(100.0))
            } else {
                None
            },
            unplayed_item_count: None,
        }),
        ..Default::default()
    };

    // 剧集特有字段
    if jf_type == "Episode" {
        dto.index_number = Some(item.episode_number);
        dto.parent_index_number = Some(item.season_number);
        dto.series_name = Some(item.tv_title.clone());
        dto.season_name = Some(if !item.parent_title.is_empty() {
            item.parent_title.clone()
        } else {
            format!("第 {} 季", item.season_number)
        });
        if !item.ancestor_guid.is_empty() {
            dto.series_id = Some(to_jellyfin_id(&item.ancestor_guid));
        }
        if !item.parent_guid.is_empty() {
            dto.season_id = Some(to_jellyfin_id(&item.parent_guid));
            dto.parent_id = Some(to_jellyfin_id(&item.parent_guid));
        }
    }

    // 系列特有字段
    if jf_type == "Series" {
        let count = if item.local_number_of_seasons > 0 {
            item.local_number_of_seasons
        } else {
            item.number_of_seasons
        };
        dto.child_count = Some(count);
    }

    // 日期
    if !item.air_date.is_empty() {
        dto.premiere_date = Some(format!("{}T00:00:00.0000000Z", item.air_date));
        if let Some(year_str) = item.air_date.split('-').next() {
            if let Ok(year) = year_str.parse::<i32>() {
                if year > 0 {
                    dto.production_year = Some(year);
                }
            }
        }
    }

    dto
}

/// 将飞牛 PlayInfo 映射为 Jellyfin BaseItemDto
pub fn map_play_info_to_dto(info: &FnosPlayInfo, server_id: &str) -> BaseItemDto {
    let item = &info.item;
    let jf_type = map_type(&item.item_type);
    let is_folder = matches!(jf_type, "Series" | "Season");
    let duration = if item.duration > 0.0 {
        item.duration
    } else if item.runtime > 0.0 {
        item.runtime * 60.0
    } else {
        0.0
    };

    let mut dto = BaseItemDto {
        name: if !item.title.is_empty() {
            item.title.clone()
        } else {
            item.tv_title.clone()
        },
        server_id: server_id.to_string(),
        id: to_jellyfin_id(&item.guid),
        can_delete: false,
        can_download: false,
        overview: if item.overview.is_empty() { None } else { Some(item.overview.clone()) },
        community_rating: item.vote_average.parse::<f64>().ok().filter(|v| *v > 0.0),
        run_time_ticks: if duration > 0.0 { Some(seconds_to_ticks(duration)) } else { None },
        is_folder,
        item_type: jf_type.to_string(),
        media_type: map_media_type(jf_type).map(String::from),
        image_tags: make_image_tags(&item.posters),
        backdrop_image_tags: if !item.still_path.is_empty() {
            make_image_tags(&item.still_path)
                .and_then(|v| v.get("Primary").map(|p| vec![p.as_str().unwrap_or("").to_string()]))
        } else {
            Some(vec![])
        },
        location_type: Some("FileSystem".into()),
        user_data: Some(UserItemDataDto {
            playback_position_ticks: if item.watched_ts > 0.0 {
                seconds_to_ticks(item.watched_ts)
            } else {
                0
            },
            play_count: if item.is_watched != 0 { 1 } else { 0 },
            is_favorite: item.is_favorite == 1,
            played: item.is_watched == 1,
            played_percentage: if duration > 0.0 && item.watched_ts > 0.0 {
                Some((item.watched_ts / duration * 100.0).min(100.0))
            } else {
                None
            },
            unplayed_item_count: None,
        }),
        ..Default::default()
    };

    if jf_type == "Episode" {
        dto.index_number = Some(item.episode_number);
        dto.parent_index_number = Some(item.season_number);
        dto.series_name = Some(item.tv_title.clone());
        dto.season_name = Some(if !item.parent_title.is_empty() {
            item.parent_title.clone()
        } else {
            format!("第 {} 季", item.season_number)
        });
        if !info.grand_guid.is_empty() {
            dto.series_id = Some(to_jellyfin_id(&info.grand_guid));
        }
        if !info.parent_guid.is_empty() {
            dto.season_id = Some(to_jellyfin_id(&info.parent_guid));
            dto.parent_id = Some(to_jellyfin_id(&info.parent_guid));
        }
    }

    if jf_type == "Series" {
        let count = if item.local_number_of_seasons > 0 {
            item.local_number_of_seasons
        } else {
            item.number_of_seasons
        };
        dto.child_count = Some(count);
    }

    if !item.air_date.is_empty() {
        dto.premiere_date = Some(format!("{}T00:00:00.0000000Z", item.air_date));
        if let Some(year_str) = item.air_date.split('-').next() {
            if let Ok(year) = year_str.parse::<i32>() {
                if year > 0 {
                    dto.production_year = Some(year);
                }
            }
        }
    }

    dto
}

/// 构造一个虚拟的媒体库 CollectionFolder
pub fn make_collection_folder(
    name: &str,
    id: &str,
    server_id: &str,
    collection_type: &str,
) -> BaseItemDto {
    BaseItemDto {
        name: name.to_string(),
        server_id: server_id.to_string(),
        id: id.to_string(),
        can_delete: false,
        can_download: false,
        is_folder: true,
        item_type: "CollectionFolder".to_string(),
        collection_type: Some(collection_type.to_string()),
        image_tags: Some(serde_json::json!({})),
        backdrop_image_tags: Some(vec![]),
        location_type: Some("FileSystem".into()),
        ..Default::default()
    }
}
