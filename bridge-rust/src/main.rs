/// fnos-bridge 入口
/// 启动 HTTP + WebSocket 服务器

use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket},
        State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
    routing::{any, get, head, post},
    Json, Router,
};
use serde_json::json;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing::{info, warn};

use fnos_bridge::config::BridgeConfig;

#[tokio::main]
async fn main() {
    // 初始化日志
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let config = BridgeConfig::from_env();

    println!(
        r#"
╔══════════════════════════════════════╗
║       fnos-bridge v0.1.0 (Rust)      ║
║     飞牛影视 → Jellyfin 转换层       ║
╚══════════════════════════════════════╝
"#
    );
    println!("飞牛服务器: {}", config.fnos_server);
    println!("监听地址:   http://{}:{}", config.host, config.port);
    println!("服务器名称: {}", config.server_name);
    println!("伪装版本:   Jellyfin {}", config.jellyfin_version);
    println!();

    let app = build_router(config.clone());

    let addr = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind address");

    info!("✅ 服务已启动: http://{}", addr);
    info!("等待 Jellyfin 客户端连接...");

    axum::serve(listener, app).await.expect("Server error");
}

fn build_router(config: BridgeConfig) -> Router {
    // 路径大小写规范化中间件
    let normalize = axum::middleware::from_fn(path_normalize);

    Router::new()
        // 核心路由
        .merge(fnos_bridge::routes::system::router())
        .merge(fnos_bridge::routes::users::router())
        .merge(fnos_bridge::routes::views::router())
        .merge(fnos_bridge::routes::images::router())
        .merge(fnos_bridge::routes::items::router())
        .merge(fnos_bridge::routes::shows::router())
        .merge(fnos_bridge::routes::mediainfo::router())
        .merge(fnos_bridge::routes::playback::router())
        .merge(fnos_bridge::routes::extras::router())
        .merge(fnos_bridge::proxy::stream::router())
        // WebSocket
        .route("/socket", get(ws_handler))
        // QuickConnect
        .route("/QuickConnect/Enabled", get(|| async { Json(false) }))
        // Sessions/Capabilities
        .route("/Sessions/Capabilities", post(no_content))
        .route("/Sessions/Capabilities/Full", post(no_content))
        // Sessions 列表
        .route("/Sessions", get(sessions_list))
        // Localization
        .route("/Localization/Countries", get(empty_array))
        .route("/Localization/Cultures", get(empty_array))
        .route("/Localization/ParentalRatings", get(empty_array))
        // DisplayPreferences
        .route("/DisplayPreferences/{id}", get(display_prefs).post(no_content))
        // Intros
        .route("/Items/{itemId}/Intros", get(empty_items))
        .route("/Users/{userId}/Items/{itemId}/Intros", get(empty_items))
        // Similar
        .route("/Items/{itemId}/Similar", get(empty_items))
        // ThemeMedia
        .route("/Items/{itemId}/ThemeMedia", get(theme_media))
        // SpecialFeatures
        .route("/Items/{itemId}/SpecialFeatures", get(empty_array))
        .route("/Users/{userId}/Items/{itemId}/SpecialFeatures", get(empty_array))
        // SyncPlay
        .route("/SyncPlay/List", get(empty_array))
        // Studios
        .route("/Studios", get(empty_items))
        // System/Endpoint
        .route("/System/Endpoint", get(system_endpoint))
        // Playback/BitrateTest
        .route("/Playback/BitrateTest", get(bitrate_test))
        // 旧版路径兼容
        .route("/Users/{userId}/Views", get(redirect_user_views))
        // 根路径
        .route("/", head(root_head).get(root_get))
        .route("/web", get(|| async { Redirect::to("/web/") }))
        .nest_service("/web/", ServeDir::new("web"))
        .route("/favicon.ico", get(no_content))
        // 兜底
        .fallback(any(fallback))
        // 中间件
        .layer(normalize)
        .layer(CorsLayer::permissive())
        .with_state(config)
}

// --- 辅助 handler ---

async fn no_content() -> StatusCode {
    StatusCode::NO_CONTENT
}

async fn empty_array() -> Json<Vec<()>> {
    Json(vec![])
}

async fn empty_items() -> Json<serde_json::Value> {
    Json(json!({"Items": [], "TotalRecordCount": 0, "StartIndex": 0}))
}

async fn sessions_list() -> Json<serde_json::Value> {
    Json(json!([{
        "Id": "dummy-session",
        "UserId": "",
        "UserName": "",
        "Client": "",
        "DeviceId": "",
        "DeviceName": "",
        "ApplicationVersion": "",
        "IsActive": true,
        "SupportsRemoteControl": false,
        "PlayState": { "CanSeek": true, "IsPaused": false, "IsMuted": false },
        "TranscodingInfo": { "IsVideoDirect": true, "IsAudioDirect": false }
    }]))
}

async fn display_prefs(
    axum::extract::Path(id): axum::extract::Path<String>,
) -> Json<serde_json::Value> {
    Json(json!({
        "Id": id,
        "SortBy": "SortName",
        "SortOrder": "Ascending",
        "RememberIndexing": false,
        "RememberSorting": false,
        "CustomPrefs": {}
    }))
}

async fn theme_media() -> Json<serde_json::Value> {
    Json(json!({
        "ThemeVideosResult": {"Items": [], "TotalRecordCount": 0},
        "ThemeSongsResult": {"Items": [], "TotalRecordCount": 0},
        "SoundtrackSongsResult": {"Items": [], "TotalRecordCount": 0}
    }))
}

async fn system_endpoint() -> Json<serde_json::Value> {
    Json(json!({"IsLocal": true, "IsInNetwork": true}))
}

async fn bitrate_test(
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
) -> Response {
    let size: usize = params
        .get("Size")
        .and_then(|s| s.parse().ok())
        .unwrap_or(500_000)
        .min(1_000_000);
    let data = vec![0u8; size];
    Response::builder()
        .header("content-type", "application/octet-stream")
        .body(Body::from(data))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn redirect_user_views(
    axum::extract::Path(_uid): axum::extract::Path<String>,
    req: axum::extract::Request,
) -> Redirect {
    let query = req.uri().query().map(|q| format!("?{}", q)).unwrap_or_default();
    Redirect::temporary(&format!("/UserViews{}", query))
}

async fn redirect_user_resume(
    axum::extract::Path(_uid): axum::extract::Path<String>,
    req: axum::extract::Request,
) -> Redirect {
    let query = req.uri().query().map(|q| format!("?{}", q)).unwrap_or_default();
    Redirect::temporary(&format!("/UserItems/Resume{}", query))
}

async fn root_head() -> StatusCode {
    StatusCode::OK
}

async fn root_get() -> Redirect {
    Redirect::to("/web/")
}

async fn web_index() -> Response {
    // 检查 web 目录是否存在
    let web_dir = std::path::Path::new("web");
    let index = web_dir.join("index.html");
    if index.exists() {
        match tokio::fs::read_to_string(&index).await {
            Ok(html) => Response::builder()
                .header("content-type", "text/html; charset=utf-8")
                .body(Body::from(html))
                .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response()),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        }
    } else {
        Response::builder()
            .header("content-type", "text/html; charset=utf-8")
            .body(Body::from(
                "<!DOCTYPE html><html><head><title>fnos-bridge</title></head><body>\
                <h1>fnos-bridge</h1>\
                <p>Jellyfin Web UI 未安装。</p>\
                <p>使用原生客户端（Findroid / Swiftfin / Jellyfin Media Player）连接。</p>\
                </body></html>",
            ))
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
    }
}

async fn fallback(req: axum::extract::Request) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().to_string();
    warn!("[STUB] 未实现的端点: {} {}", method, path);

    if path.contains("/Items") || path.contains("/Views") || path.contains("/NextUp") || path.contains("/Upcoming") {
        return Json(json!({"Items": [], "TotalRecordCount": 0, "StartIndex": 0})).into_response();
    }
    if path.contains("/DisplayPreferences") {
        return Json(json!({"Id": "usersettings", "SortBy": "SortName", "SortOrder": "Ascending", "CustomPrefs": {}})).into_response();
    }

    Json(json!({})).into_response()
}

// --- WebSocket ---

async fn ws_handler(ws: WebSocketUpgrade) -> Response {
    ws.on_upgrade(handle_ws)
}

async fn handle_ws(mut socket: WebSocket) {
    // 发送初始消息
    let _ = socket
        .send(Message::Text(
            serde_json::to_string(&json!({
                "MessageType": "ForceKeepAlive",
                "Data": 60
            }))
            .unwrap_or_default()
            .into(),
        ))
        .await;

    while let Some(Ok(msg)) = socket.recv().await {
        if let Message::Text(text) = msg {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                let msg_type = parsed["MessageType"].as_str().unwrap_or("");
                match msg_type {
                    "KeepAlive" => {} // 心跳，不响应
                    "SessionsStart" | "ScheduledTasksInfoStart" => {
                        let reply_type = msg_type.replace("Start", "");
                        let _ = socket
                            .send(Message::Text(
                                serde_json::to_string(&json!({
                                    "MessageType": reply_type,
                                    "Data": []
                                }))
                                .unwrap_or_default()
                                .into(),
                            ))
                            .await;
                    }
                    _ => {}
                }
            }
        }
    }
}

// --- 路径大小写规范化中间件 ---

async fn path_normalize(
    req: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    use std::collections::HashMap;

    static PATH_MAP_ENTRIES: &[(&str, &str)] = &[
        ("system", "System"), ("info", "Info"), ("public", "Public"), ("ping", "Ping"),
        ("branding", "Branding"), ("configuration", "Configuration"), ("css", "Css"),
        ("users", "Users"), ("authenticatebyname", "AuthenticateByName"), ("me", "Me"),
        ("userviews", "UserViews"), ("items", "Items"), ("resume", "Resume"),
        ("shows", "Shows"), ("seasons", "Seasons"), ("episodes", "Episodes"),
        ("images", "Images"), ("playbackinfo", "PlaybackInfo"), ("videos", "Videos"),
        ("sessions", "Sessions"), ("playing", "Playing"), ("progress", "Progress"),
        ("stopped", "Stopped"), ("capabilities", "Capabilities"), ("full", "Full"),
        ("userplayeditems", "UserPlayedItems"), ("useritems", "UserItems"),
        ("userfavoriteitems", "UserFavoriteItems"), ("favoriteitems", "FavoriteItems"),
        ("playeditems", "PlayedItems"), ("quickconnect", "QuickConnect"),
        ("enabled", "Enabled"), ("displaypreferences", "DisplayPreferences"),
        ("localization", "Localization"), ("countries", "Countries"),
        ("cultures", "Cultures"), ("parentalratings", "ParentalRatings"),
        ("filters", "Filters"), ("nextup", "NextUp"), ("latest", "Latest"),
        ("primary", "Primary"), ("backdrop", "Backdrop"), ("thumb", "Thumb"),
        ("logo", "Logo"), ("banner", "Banner"), ("views", "Views"),
        ("stream", "stream"), ("subtitles", "Subtitles"), ("intros", "Intros"),
        ("similar", "Similar"), ("thememedia", "ThemeMedia"),
        ("specialfeatures", "SpecialFeatures"), ("syncplay", "SyncPlay"),
        ("list", "List"), ("studios", "Studios"), ("endpoint", "Endpoint"),
        ("playback", "Playback"), ("bitratetest", "BitrateTest"),
        ("hls", "hls"), ("main.m3u8", "main.m3u8"), ("preset.m3u8", "preset.m3u8"),
    ];

    let path = req.uri().path().to_string();

    // 跳过静态文件
    if path.starts_with("/web/") {
        return next.run(req).await;
    }

    let path_map: HashMap<&str, &str> = PATH_MAP_ENTRIES.iter().copied().collect();

    let segments: Vec<&str> = path.split('/').collect();
    let mut changed = false;
    let new_segments: Vec<String> = segments
        .iter()
        .map(|seg| {
            let lower = seg.to_lowercase();
            // stream.xxx → stream (去掉扩展名)
            if lower.starts_with("stream.") && !path.to_lowercase().contains("subtitles") {
                changed = true;
                return "stream".to_string();
            }
            if let Some(canonical) = path_map.get(lower.as_str()) {
                if *seg != *canonical {
                    changed = true;
                    return canonical.to_string();
                }
            }
            seg.to_string()
        })
        .collect();

    if changed {
        let new_path = new_segments.join("/");
        let query = req.uri().query().map(|q| format!("?{}", q)).unwrap_or_default();
        let new_uri: axum::http::Uri = format!("{}{}", new_path, query)
            .parse()
            .unwrap_or_else(|_| req.uri().clone());

        let (mut parts, body) = req.into_parts();
        parts.uri = new_uri;
        let req = axum::extract::Request::from_parts(parts, body);
        return next.run(req).await;
    }

    next.run(req).await
}
