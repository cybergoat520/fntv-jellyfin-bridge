/// user/info 请求缓存
/// 首页加载时 users_me + users_by_id 会并发多次相同请求，
/// 缓存避免重复请求

use dashmap::DashMap;
use std::sync::LazyLock;
use std::time::Instant;
use tokio::sync::Mutex;
use tracing::debug;

use crate::config::BridgeConfig;
use crate::fnos_client::client::RequestResult;
use crate::services::fnos::fnos_get_user_info;
use crate::types::fnos::FnosUserInfo;

/// 缓存 TTL（秒）
const CACHE_TTL_SECS: u64 = 60;

struct CachedEntry {
    data: RequestResult<FnosUserInfo>,
    created_at: Instant,
}

static CACHE: LazyLock<DashMap<String, CachedEntry>> = LazyLock::new(DashMap::new);
static LOCKS: LazyLock<DashMap<String, std::sync::Arc<Mutex<()>>>> = LazyLock::new(DashMap::new);

fn make_key(server: &str, token: &str) -> String {
    format!("user_info:{}:{}", server, token)
}

pub async fn cached_get_user_info(
    server: &str,
    token: &str,
    config: &BridgeConfig,
) -> RequestResult<FnosUserInfo> {
    let key = make_key(server, token);

    // 缓存命中
    if let Some(entry) = CACHE.get(&key) {
        if entry.created_at.elapsed().as_secs() < CACHE_TTL_SECS {
            debug!("[CACHE] user_info 命中");
            return entry.data.clone();
        }
    }

    // 并发去重
    let lock = LOCKS
        .entry(key.clone())
        .or_insert_with(|| std::sync::Arc::new(Mutex::new(())))
        .clone();

    let _guard = lock.lock().await;

    // double check
    if let Some(entry) = CACHE.get(&key) {
        if entry.created_at.elapsed().as_secs() < CACHE_TTL_SECS {
            debug!("[CACHE] user_info 命中(double check)");
            return entry.data.clone();
        }
    }

    let result = fnos_get_user_info(server, token, config).await;

    CACHE.insert(key.clone(), CachedEntry {
        data: result.clone(),
        created_at: Instant::now(),
    });

    // 清理过期条目
    CACHE.retain(|_, v| v.created_at.elapsed().as_secs() < CACHE_TTL_SECS * 2);

    result
}
