/// stream/list 请求缓存
/// 详情页和 PlaybackInfo 会对同一个 item_guid 各调一次 stream/list，
/// 缓存避免重复请求

use dashmap::DashMap;
use std::sync::LazyLock;
use std::time::Instant;
use tokio::sync::Mutex;
use tracing::debug;

use crate::config::BridgeConfig;
use crate::fnos_client::client::RequestResult;
use crate::services::fnos::fnos_get_stream_list;

/// 缓存 TTL（秒）
const CACHE_TTL_SECS: u64 = 30;

struct CachedEntry {
    data: RequestResult<serde_json::Value>,
    created_at: Instant,
}

static CACHE: LazyLock<DashMap<String, CachedEntry>> = LazyLock::new(DashMap::new);
static LOCKS: LazyLock<DashMap<String, std::sync::Arc<Mutex<()>>>> = LazyLock::new(DashMap::new);

fn make_key(server: &str, item_guid: &str) -> String {
    format!("stream_list:{}:{}", server, item_guid)
}

pub async fn cached_get_stream_list(
    server: &str,
    token: &str,
    item_guid: &str,
    config: &BridgeConfig,
) -> RequestResult<serde_json::Value> {
    let key = make_key(server, item_guid);

    // 缓存命中
    if let Some(entry) = CACHE.get(&key) {
        if entry.created_at.elapsed().as_secs() < CACHE_TTL_SECS {
            debug!("[CACHE] stream_list 命中: {}", item_guid);
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
            debug!("[CACHE] stream_list 命中(double check): {}", item_guid);
            return entry.data.clone();
        }
    }

    let result = fnos_get_stream_list(server, token, item_guid, config).await;

    CACHE.insert(key.clone(), CachedEntry {
        data: result.clone(),
        created_at: Instant::now(),
    });

    // 清理过期条目
    CACHE.retain(|_, v| v.created_at.elapsed().as_secs() < CACHE_TTL_SECS * 2);

    result
}
