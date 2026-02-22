/// fnos-bridge 入口
/// 启动 HTTP + WebSocket 服务器

use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket},
        WebSocketUpgrade,
    },
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
    routing::{any, get, head, post},
    Json, Router,
};
use serde_json::json;
use tower::ServiceExt;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tracing::{debug, info, warn};

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
    let inner = Router::new()
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
        .route("/Sessions", get(sessions_list).layer(axum::middleware::from_fn(fnos_bridge::middleware::auth::require_auth)))
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
        .route("/web", get(web_redirect_or_index))
        .nest_service("/web/", ServeDir::new("web"))
        .route("/favicon.ico", get(no_content))
        // 兜底
        .fallback(any(fallback))
        .layer(CorsLayer::permissive())
        .with_state(config);

    // 路径规范化必须在路由匹配之前，用外层 Router 包裹
    Router::new()
        .fallback(any(move |req: axum::extract::Request| {
            let router = inner.clone();
            async move {
                let normalized = normalize_path(req);
                router.oneshot(normalized).await.into_response()
            }
        }))
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

async fn sessions_list(req: axum::extract::Request) -> Json<serde_json::Value> {
    use fnos_bridge::services::session::{SessionData, get_now_playing};

    let session = req.extensions().get::<SessionData>().cloned().unwrap();
    let now_playing = get_now_playing(&session.access_token);

    let mut s = json!({
        "Id": session.access_token,
        "UserId": session.user_id,
        "UserName": session.username,
        "Client": session.client,
        "DeviceId": session.device_id,
        "DeviceName": session.device_name,
        "ApplicationVersion": session.app_version,
        "IsActive": true,
        "SupportsRemoteControl": false,
    });

    if let Some(np) = now_playing {
        s["NowPlayingItem"] = json!({ "Id": np.item_id });
        s["PlayState"] = json!({
            "CanSeek": true,
            "IsPaused": np.is_paused,
            "IsMuted": false,
            "PlayMethod": "Transcode",
            "PositionTicks": np.position_ticks,
        });
    } else {
        s["PlayState"] = json!({
            "CanSeek": false,
            "IsPaused": true,
            "IsMuted": false,
        });
    }

    Json(json!([s]))
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

#[allow(dead_code)]
async fn redirect_user_resume(
    axum::extract::Path(_uid): axum::extract::Path<String>,
    req: axum::extract::Request,
) -> Redirect {
    let query = req.uri().query().map(|q| format!("?{}", q)).unwrap_or_default();
    Redirect::temporary(&format!("/UserItems/Resume{}", query))
}

async fn root_head() -> Response {
    debug!("[ROOT] HEAD /");
    Redirect::to("/web/").into_response()
}

async fn root_get() -> Response {
    debug!("[ROOT] GET /");
    // 如果 web 目录存在，重定向到 /web/，否则返回简单页面
    let web_dir = std::path::Path::new("web");
    if web_dir.exists() {
        debug!("[ROOT] → 重定向到 /web/");
        Redirect::to("/web/").into_response()
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

async fn web_redirect_or_index() -> Response {
    debug!("[ROOT] GET /web");
    // 如果 web 目录存在，重定向到 /web/，否则返回根页面
    let web_dir = std::path::Path::new("web");
    if web_dir.exists() {
        debug!("[ROOT] → 重定向到 /web/");
        Redirect::to("/web/").into_response()
    } else {
        root_get().await
    }
}

#[allow(dead_code)]
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

// --- 路径大小写规范化 ---

fn normalize_path(req: axum::extract::Request) -> axum::extract::Request {
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
    debug!("[PATH] 原始路径: {}", path);

    // 跳过静态文件
    if path.starts_with("/web/") {
        return req;
    }

    let path_map: HashMap<&str, &str> = PATH_MAP_ENTRIES.iter().copied().collect();

    let segments: Vec<&str> = path.split('/').collect();
    let mut changed = false;
    let new_segments: Vec<String> = segments
        .iter()
        .flat_map(|seg| {
            let lower = seg.to_lowercase();
            
            // 检测 stream.ext 或 Stream.ext 格式（如 stream.mkv, Stream.vtt）
            // 转换为 stream/ext 或 Stream/ext 格式
            if lower.starts_with("stream.") && lower.len() > 7 {
                let ext = &seg[7..]; // 取 "stream." 之后的部分
                let prefix = if seg.starts_with('S') { "Stream" } else { "stream" };
                changed = true;
                return vec![prefix.to_string(), ext.to_string()];
            }
            
            // 正常的大小写规范化
            if let Some(canonical) = path_map.get(lower.as_str()) {
                if *seg != *canonical {
                    changed = true;
                    return vec![canonical.to_string()];
                }
            }
            vec![seg.to_string()]
        })
        .collect();

    if changed {
        let new_path = new_segments.join("/");
        debug!("[PATH] 规范化后: {}", new_path);
        let query = req.uri().query().map(|q| format!("?{}", q)).unwrap_or_default();
        let new_uri: axum::http::Uri = format!("{}{}", new_path, query)
            .parse()
            .unwrap_or_else(|_| req.uri().clone());

        let (mut parts, body) = req.into_parts();
        parts.uri = new_uri;
        return axum::extract::Request::from_parts(parts, body);
    }

    req
}
