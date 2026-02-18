/**
 * 飞牛影视 API 类型定义
 * 从 fntv-electron 提取的核心类型
 */

/** 飞牛 API 通用响应 */
export interface FnosApiResponse<T = any> {
  code: number;
  msg: string;
  data: T;
}

/** 用户信息 */
export interface FnosUserInfo {
  uid: number;
  username: string;
  nickname: string;
  avatar: string;
  [key: string]: any;
}

/** 播放信息 */
export interface FnosPlayInfo {
  grand_guid: string;
  guid: string;
  parent_guid: string;
  play_config: {
    skip_opening: number | null;
    skip_ending: number | null;
  };
  ts: number;
  type: string;
  video_guid: string;
  audio_guid: string;
  subtitle_guid: string;
  media_guid: string;
  item: FnosItemDetail;
}

/** 项目详情 */
export interface FnosItemDetail {
  guid: string;
  trim_id: string;
  tv_title: string;
  parent_title: string;
  title: string;
  posters: string;
  poster_width: number;
  poster_height: number;
  vote_average: string;
  runtime: number;
  overview: string;
  is_favorite: number;
  is_watched: number;
  watched_ts: number;
  still_path: string;
  air_date: string;
  season_number: number;
  episode_number: number;
  number_of_seasons: number;
  number_of_episodes: number;
  local_number_of_episodes: number;
  local_number_of_seasons: number;
  can_play: number;
  type: string;
  play_error: string;
  parent_guid: string;
  ancestor_name: string;
  play_item_guid: string;
  duration: number;
  logic_type: number;
}

/** 播放列表项目 */
export interface FnosPlayListItem {
  guid: string;
  lan: string;
  douban_id: number;
  imdb_id: string;
  trim_id: string;
  tv_title: string;
  parent_guid: string;
  parent_title: string;
  title: string;
  type: string;
  poster: string;
  poster_width: number;
  poster_height: number;
  runtime: number;
  is_favorite: number;
  watched: number;
  watched_ts: number;
  vote_average: string;
  season_number: number;
  episode_number: number;
  air_date: string;
  number_of_seasons: number;
  number_of_episodes: number;
  local_number_of_seasons: number;
  local_number_of_episodes: number;
  status: string;
  overview: string;
  ancestor_guid: string;
  ancestor_name: string;
  ancestor_category: string;
  ts: number;
  duration: number;
  single_child_guid: string;
  video_guid: string;
  file_name: string;
}

/** 项目列表请求 */
export interface FnosItemListRequest {
  parent_guid: string;
  exclude_folder: number;
  sort_column: string;
  sort_type: string;
}

/** 项目列表响应 */
export interface FnosItemListResponse {
  mdb_name: string;
  mdb_category: string;
  top_dir: string;
  dir: string;
  total: number;
  list: FnosPlayListItem[];
}
