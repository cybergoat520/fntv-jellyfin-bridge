/// 会话管理服务
/// 管理 Jellyfin AccessToken → 飞牛凭据的映射
/// 支持文件持久化

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::LazyLock;
use tracing::{info, warn};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub fnos_token: String,
    pub fnos_server: String,
    pub user_id: String,
    pub username: String,
    pub client: String,
    pub device_id: String,
    pub device_name: String,
    pub app_version: String,
    pub created_at: i64,
    pub last_activity: i64,
}

static SESSIONS: LazyLock<DashMap<String, SessionData>> = LazyLock::new(|| {
    let map = DashMap::new();
    // 启动时加载
    if let Some(data) = load_sessions_from_file() {
        for (k, v) in data {
            map.insert(k, v);
        }
        info!("[SESSION] 已恢复 {} 个会话", map.len());
    }
    map
});

fn session_file_path() -> PathBuf {
    PathBuf::from(".sessions.json")
}

fn load_sessions_from_file() -> Option<std::collections::HashMap<String, SessionData>> {
    let path = session_file_path();
    let content = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

fn save_sessions() {
    let path = session_file_path();
    let mut data = std::collections::HashMap::new();
    for entry in SESSIONS.iter() {
        data.insert(entry.key().clone(), entry.value().clone());
    }
    if let Ok(json) = serde_json::to_string_pretty(&data) {
        if let Err(e) = std::fs::write(&path, json) {
            warn!("[SESSION] 保存会话失败: {}", e);
        }
    }
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// 创建新会话，返回 Jellyfin AccessToken
pub fn create_session(
    fnos_token: String,
    fnos_server: String,
    user_id: String,
    username: String,
    client: String,
    device_id: String,
    device_name: String,
    app_version: String,
) -> String {
    let access_token = Uuid::new_v4().to_string().replace('-', "");
    let now = now_millis();
    SESSIONS.insert(
        access_token.clone(),
        SessionData {
            fnos_token,
            fnos_server,
            user_id,
            username,
            client,
            device_id,
            device_name,
            app_version,
            created_at: now,
            last_activity: now,
        },
    );
    save_sessions();
    access_token
}

/// 根据 AccessToken 获取会话
pub fn get_session(access_token: &str) -> Option<SessionData> {
    let mut entry = SESSIONS.get_mut(access_token)?;
    entry.last_activity = now_millis();
    Some(entry.value().clone())
}

/// 删除会话
pub fn remove_session(access_token: &str) -> bool {
    let result = SESSIONS.remove(access_token).is_some();
    if result {
        save_sessions();
    }
    result
}

/// 获取所有活跃会话数
pub fn get_session_count() -> usize {
    SESSIONS.len()
}
