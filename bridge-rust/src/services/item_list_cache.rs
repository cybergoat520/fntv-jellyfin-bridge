/// Item list 请求缓存
/// 相同参数的请求在 TTL 内只发一次给飞牛，避免重复请求

use dashmap::DashMap;
use std::sync::LazyLock;
use std::time::Instant;
use tokio::sync::Mutex;

use crate::config::BridgeConfig;
use crate::fnos_client::client::RequestResult;
use crate::services::fnos::fnos_get_item_list;
use crate::types::fnos::FnosItemListResponse;

/// 缓存 TTL（秒）
const CACHE_TTL_SECS: u64 = 30;

struct CachedEntry {
    data: RequestResult<FnosItemListResponse>,
    created_at: Instant,
}

static CACHE: LazyLock<DashMap<String, CachedEntry>> = LazyLock::new(DashMap::new);
static LOCKS: LazyLock<DashMap<String, std::sync::Arc<Mutex<()>>>> = LazyLock::new(DashMap::new);

fn make_key(server: &str, parent_guid: &str, sort_column: &str, sort_type: &str) -> String {
    format!("{}:{}:{}:{}", server, parent_guid, sort_column, sort_type)
}

pub async fn cached_get_item_list(
    server: &str,
    token: &str,
    parent_guid: &str,
    sort_column: &str,
    sort_type: &str,
    config: &BridgeConfig,
) -> RequestResult<FnosItemListResponse> {
    let key = make_key(server, parent_guid, sort_column, sort_type);

    // 缓存命中
    if let Some(entry) = CACHE.get(&key) {
        if entry.created_at.elapsed().as_secs() < CACHE_TTL_SECS {
            return entry.data.clone();
        }
    }

    // 并发去重：同一 key 只发一次请求
    let lock = LOCKS
        .entry(key.clone())
        .or_insert_with(|| std::sync::Arc::new(Mutex::new(())))
        .clone();

    let _guard = lock.lock().await;

    // double check：拿到锁后再查一次缓存
    if let Some(entry) = CACHE.get(&key) {
        if entry.created_at.elapsed().as_secs() < CACHE_TTL_SECS {
            return entry.data.clone();
        }
    }

    let result = fnos_get_item_list(server, token, parent_guid, sort_column, sort_type, config).await;

    CACHE.insert(key.clone(), CachedEntry {
        data: result.clone(),
        created_at: Instant::now(),
    });

    // 清理过期条目
    CACHE.retain(|_, v| v.created_at.elapsed().as_secs() < CACHE_TTL_SECS * 2);

    result
}
