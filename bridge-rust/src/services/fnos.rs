/// 飞牛 API 服务封装

use serde_json::json;

use crate::config::BridgeConfig;
use crate::fnos_client::client::{FnosClient, FnosClientOptions, RequestResult};
use crate::types::fnos::*;

fn make_client(server: &str, token: &str, config: &BridgeConfig) -> FnosClient {
    FnosClient::new(
        server,
        token,
        FnosClientOptions {
            ignore_cert: config.ignore_cert,
            ..Default::default()
        },
    )
}

/// 登录飞牛影视
pub async fn fnos_login(
    config: &BridgeConfig,
    username: &str,
    password: &str,
) -> Result<(String, String), String> {
    let client = make_client(&config.fnos_server, "", config);
    let result: RequestResult<FnosLoginResponse> = client
        .request(
            "post",
            "/v/api/v1/login",
            Some(json!({
                "app_name": "trimemedia-web",
                "username": username,
                "password": password,
            })),
        )
        .await;

    if !result.success {
        return Err(result.message.unwrap_or_else(|| "登录失败".into()));
    }

    let token = result
        .data
        .map(|d| d.token)
        .unwrap_or_default();
    if token.is_empty() {
        return Err("未获取到 token".into());
    }

    let actual_server = result
        .move_url
        .unwrap_or_else(|| config.fnos_server.clone());

    Ok((token, actual_server))
}

/// 获取用户信息
pub async fn fnos_get_user_info(
    server: &str,
    token: &str,
    config: &BridgeConfig,
) -> RequestResult<FnosUserInfo> {
    let client = make_client(server, token, config);
    client.request("get", "/v/api/v1/user/info", None).await
}

/// 获取播放信息
pub async fn fnos_get_play_info(
    server: &str,
    token: &str,
    item_guid: &str,
    config: &BridgeConfig,
) -> RequestResult<FnosPlayInfo> {
    let client = make_client(server, token, config);
    client
        .request(
            "post",
            "/v/api/v1/play/info",
            Some(json!({ "item_guid": item_guid })),
        )
        .await
}

/// 获取项目列表
pub async fn fnos_get_item_list(
    server: &str,
    token: &str,
    parent_guid: &str,
    sort_column: &str,
    sort_type: &str,
    config: &BridgeConfig,
) -> RequestResult<FnosItemListResponse> {
    let client = make_client(server, token, config);
    client
        .request(
            "post",
            "/v/api/v1/item/list",
            Some(json!({
                "parent_guid": parent_guid,
                "exclude_folder": 1,
                "sort_column": sort_column,
                "sort_type": sort_type,
            })),
        )
        .await
}

/// 获取季列表
pub async fn fnos_get_season_list(
    server: &str,
    token: &str,
    series_guid: &str,
    config: &BridgeConfig,
) -> RequestResult<Vec<FnosPlayListItem>> {
    let client = make_client(server, token, config);
    client
        .request("get", &format!("/v/api/v1/season/list/{}", series_guid), None)
        .await
}

/// 获取剧集列表
pub async fn fnos_get_episode_list(
    server: &str,
    token: &str,
    season_guid: &str,
    config: &BridgeConfig,
) -> RequestResult<Vec<FnosPlayListItem>> {
    let client = make_client(server, token, config);
    client
        .request("get", &format!("/v/api/v1/episode/list/{}", season_guid), None)
        .await
}

/// 获取流列表
pub async fn fnos_get_stream_list(
    server: &str,
    token: &str,
    item_guid: &str,
    config: &BridgeConfig,
) -> RequestResult<serde_json::Value> {
    let client = make_client(server, token, config);
    client
        .request("get", &format!("/v/api/v1/stream/list/{}", item_guid), None)
        .await
}

/// 获取流信息
pub async fn fnos_get_stream(
    server: &str,
    token: &str,
    media_guid: &str,
    ip: &str,
    config: &BridgeConfig,
) -> RequestResult<FnosStreamResponse> {
    let client = make_client(server, token, config);
    client
        .request(
            "post",
            "/v/api/v1/stream",
            Some(json!({
                "header": { "User-Agent": ["trim_player"] },
                "level": 1,
                "media_guid": media_guid,
                "ip": ip,
            })),
        )
        .await
}

/// 启动播放/转码会话
pub async fn fnos_start_play(
    server: &str,
    token: &str,
    data: serde_json::Value,
    config: &BridgeConfig,
) -> RequestResult<FnosPlayPlayResponse> {
    let client = make_client(server, token, config);
    client.request("post", "/v/api/v1/play/play", Some(data)).await
}

/// 标记已观看/取消观看
pub async fn fnos_set_watched(
    server: &str,
    token: &str,
    item_guid: &str,
    watched: bool,
    config: &BridgeConfig,
) -> RequestResult<serde_json::Value> {
    let client = make_client(server, token, config);
    let method = if watched { "post" } else { "delete" };
    client
        .request(method, "/v/api/v1/item/watched", Some(json!({ "item_guid": item_guid })))
        .await
}

/// 收藏/取消收藏
pub async fn fnos_set_favorite(
    server: &str,
    token: &str,
    item_guid: &str,
    is_favorite: bool,
    config: &BridgeConfig,
) -> RequestResult<serde_json::Value> {
    let client = make_client(server, token, config);
    let method = if is_favorite { "put" } else { "delete" };
    client
        .request(method, "/v/api/v1/item/favorite", Some(json!({ "item_guid": item_guid })))
        .await
}

/// 记录播放状态
pub async fn fnos_record_play_status(
    server: &str,
    token: &str,
    data: serde_json::Value,
    config: &BridgeConfig,
) -> RequestResult<serde_json::Value> {
    let client = make_client(server, token, config);
    client.request("post", "/v/api/v1/play/record", Some(data)).await
}
