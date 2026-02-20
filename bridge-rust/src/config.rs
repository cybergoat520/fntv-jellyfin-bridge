/// fnos-bridge 配置模块
/// 支持环境变量和默认值

#[derive(Debug, Clone)]
pub struct BridgeConfig {
    /// Bridge 服务监听端口
    pub port: u16,
    /// Bridge 服务监听地址
    pub host: String,
    /// 飞牛影视服务器地址（默认值，可被登录时覆盖）
    pub fnos_server: String,
    /// 是否跳过飞牛 HTTPS 证书验证
    pub ignore_cert: bool,
    /// 伪装的 Jellyfin 服务器版本
    pub jellyfin_version: String,
    /// 伪装的服务器名称
    pub server_name: String,
}

impl BridgeConfig {
    pub fn from_env() -> Self {
        Self {
            port: std::env::var("BRIDGE_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8096),
            host: std::env::var("BRIDGE_HOST").unwrap_or_else(|_| "0.0.0.0".into()),
            fnos_server: std::env::var("FNOS_SERVER")
                .unwrap_or_else(|_| "http://localhost:5666".into()),
            ignore_cert: std::env::var("FNOS_IGNORE_CERT")
                .map(|v| v == "true")
                .unwrap_or(false),
            jellyfin_version: "10.12.0".into(),
            server_name: std::env::var("SERVER_NAME").unwrap_or_else(|_| "fnos-bridge".into()),
        }
    }
}
