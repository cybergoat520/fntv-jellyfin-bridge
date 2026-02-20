/// System + Branding 路由

use axum::{routing::get, Json, Router};

use crate::config::BridgeConfig;
use crate::mappers::id::generate_server_id;
use crate::middleware::auth::require_auth;
use crate::types::jellyfin::{BrandingOptions, PublicSystemInfo, SystemInfo};

pub fn router() -> Router<BridgeConfig> {
    Router::new()
        // System
        .route("/System/Info/Public", get(system_info_public))
        .route("/System/Info", get(system_info).layer(axum::middleware::from_fn(require_auth)))
        .route("/System/Ping", get(system_ping).post(system_ping))
        // Branding
        .route("/Branding/Configuration", get(branding_config))
        .route("/Branding/Css", get(branding_css))
        .route("/Branding/Css.css", get(branding_css))
}

async fn system_info_public(
    axum::extract::State(config): axum::extract::State<BridgeConfig>,
    req: axum::extract::Request,
) -> Json<PublicSystemInfo> {
    let host = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost:8096");
    let proto = req
        .headers()
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");

    let server_id = generate_server_id(&config.fnos_server);

    Json(PublicSystemInfo {
        local_address: format!("{}://{}", proto, host),
        server_name: config.server_name.clone(),
        version: config.jellyfin_version.clone(),
        product_name: "Jellyfin Server".into(),
        operating_system: String::new(),
        id: server_id,
        startup_wizard_completed: true,
    })
}

async fn system_info(
    axum::extract::State(config): axum::extract::State<BridgeConfig>,
    req: axum::extract::Request,
) -> Json<SystemInfo> {
    let host = req
        .headers()
        .get("host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost:8096");
    let proto = req
        .headers()
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");

    let server_id = generate_server_id(&config.fnos_server);

    Json(SystemInfo {
        public: PublicSystemInfo {
            local_address: format!("{}://{}", proto, host),
            server_name: config.server_name.clone(),
            version: config.jellyfin_version.clone(),
            product_name: "Jellyfin Server".into(),
            operating_system: String::new(),
            id: server_id,
            startup_wizard_completed: true,
        },
        os_display_name: "fnos-bridge".into(),
        has_pending_restart: false,
        is_shutting_down: false,
        supports_library_monitor: false,
        websocket_port: config.port,
        can_self_restart: false,
        can_launch_web_browser: false,
        has_update_available: false,
        transcoding_temp_path: String::new(),
        log_path: String::new(),
        internal_metadata_path: String::new(),
        cache_path: String::new(),
    })
}

async fn system_ping(
    axum::extract::State(config): axum::extract::State<BridgeConfig>,
) -> Json<String> {
    Json(config.server_name)
}

async fn branding_config() -> Json<BrandingOptions> {
    Json(BrandingOptions {
        login_disclaimer: String::new(),
        custom_css: String::new(),
        splashscreen_enabled: false,
    })
}

async fn branding_css() -> &'static str {
    ""
}
