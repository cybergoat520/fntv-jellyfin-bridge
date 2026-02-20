/// 飞牛影视 API 类型定义

use serde::{Deserialize, Serialize};

/// 用户信息
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FnosUserInfo {
    pub uid: i64,
    pub username: String,
    pub nickname: String,
    pub avatar: String,
}

/// 播放信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FnosPlayInfo {
    #[serde(default)]
    pub grand_guid: String,
    #[serde(default)]
    pub guid: String,
    #[serde(default)]
    pub parent_guid: String,
    #[serde(default)]
    pub ts: f64,
    #[serde(rename = "type", default)]
    pub item_type: String,
    #[serde(default)]
    pub video_guid: String,
    #[serde(default)]
    pub audio_guid: String,
    #[serde(default)]
    pub subtitle_guid: String,
    #[serde(default)]
    pub media_guid: String,
    #[serde(default)]
    pub item: FnosItemDetail,
}

/// 项目详情
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FnosItemDetail {
    #[serde(default)]
    pub guid: String,
    #[serde(default)]
    pub trim_id: String,
    #[serde(default)]
    pub tv_title: String,
    #[serde(default)]
    pub parent_title: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub posters: String,
    #[serde(default)]
    pub poster_width: i32,
    #[serde(default)]
    pub poster_height: i32,
    #[serde(default)]
    pub vote_average: String,
    #[serde(default)]
    pub runtime: f64,
    #[serde(default)]
    pub overview: String,
    #[serde(default)]
    pub is_favorite: i32,
    #[serde(default)]
    pub is_watched: i32,
    #[serde(default)]
    pub watched_ts: f64,
    #[serde(default)]
    pub still_path: String,
    #[serde(default)]
    pub air_date: String,
    #[serde(default)]
    pub season_number: i32,
    #[serde(default)]
    pub episode_number: i32,
    #[serde(default)]
    pub number_of_seasons: i32,
    #[serde(default)]
    pub number_of_episodes: i32,
    #[serde(default)]
    pub local_number_of_episodes: i32,
    #[serde(default)]
    pub local_number_of_seasons: i32,
    #[serde(default)]
    pub can_play: i32,
    #[serde(rename = "type", default)]
    pub item_type: String,
    #[serde(default)]
    pub play_error: String,
    #[serde(default)]
    pub parent_guid: String,
    #[serde(default)]
    pub ancestor_name: String,
    #[serde(default)]
    pub play_item_guid: String,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub logic_type: i32,
}

/// 播放列表项目
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FnosPlayListItem {
    #[serde(default)]
    pub guid: String,
    #[serde(default)]
    pub lan: String,
    #[serde(default)]
    pub douban_id: i64,
    #[serde(default)]
    pub imdb_id: String,
    #[serde(default)]
    pub trim_id: String,
    #[serde(default)]
    pub tv_title: String,
    #[serde(default)]
    pub parent_guid: String,
    #[serde(default)]
    pub parent_title: String,
    #[serde(default)]
    pub title: String,
    #[serde(rename = "type", default)]
    pub item_type: String,
    #[serde(default)]
    pub poster: String,
    #[serde(default)]
    pub poster_width: i32,
    #[serde(default)]
    pub poster_height: i32,
    #[serde(default)]
    pub runtime: f64,
    #[serde(default)]
    pub is_favorite: i32,
    #[serde(default)]
    pub watched: i32,
    #[serde(default)]
    pub watched_ts: f64,
    #[serde(default)]
    pub vote_average: String,
    #[serde(default)]
    pub season_number: i32,
    #[serde(default)]
    pub episode_number: i32,
    #[serde(default)]
    pub air_date: String,
    #[serde(default)]
    pub number_of_seasons: i32,
    #[serde(default)]
    pub number_of_episodes: i32,
    #[serde(default)]
    pub local_number_of_seasons: i32,
    #[serde(default)]
    pub local_number_of_episodes: i32,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub overview: String,
    #[serde(default)]
    pub ancestor_guid: String,
    #[serde(default)]
    pub ancestor_name: String,
    #[serde(default)]
    pub ancestor_category: String,
    #[serde(default)]
    pub ts: f64,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub single_child_guid: String,
    #[serde(default)]
    pub video_guid: String,
    #[serde(default)]
    pub file_name: String,
}

/// 项目列表响应
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FnosItemListResponse {
    #[serde(default)]
    pub mdb_name: String,
    #[serde(default)]
    pub mdb_category: String,
    #[serde(default)]
    pub top_dir: String,
    #[serde(default)]
    pub dir: String,
    #[serde(default)]
    pub total: i64,
    #[serde(default)]
    pub list: Vec<FnosPlayListItem>,
}

/// 登录响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FnosLoginResponse {
    pub token: String,
}

/// play/play 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FnosPlayPlayResponse {
    pub play_link: String,
    #[serde(default)]
    pub media_guid: String,
    #[serde(default)]
    pub video_guid: String,
    #[serde(default)]
    pub audio_guid: String,
    #[serde(default)]
    pub hls_time: i32,
}

/// stream 响应
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FnosStreamResponse {
    #[serde(default)]
    pub cloud_storage_info: Option<CloudStorageInfo>,
    #[serde(default)]
    pub direct_link_qualities: Option<Vec<DirectLinkQuality>>,
    #[serde(default)]
    pub header: Option<StreamHeader>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CloudStorageInfo {
    #[serde(default)]
    pub cloud_storage_type: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DirectLinkQuality {
    #[serde(default)]
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct StreamHeader {
    #[serde(default, rename = "Cookie")]
    pub cookie: Option<Vec<String>>,
}
