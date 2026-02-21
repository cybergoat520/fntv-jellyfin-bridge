/// Item list 请求缓存
/// 相同参数的请求在 TTL 内只发一次给飞牛，避免重复请求

use dashmap::DashMap;
use std::sync::LazyLock;
use std::time::Instant;
use tokio::sync::Mutex;
use tracing::debug;

use crate::config::BridgeConfig;
use crate::fnos_client::client::RequestResult;
use crate::services::fnos::fnos_get_item_list;
use crate::types::fnos::{FnosItemListResponse, FnosPlayInfo};

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

/// 根据 FnosPlayInfo 更新缓存中的 item 状态
/// 包括 is_favorite、watched、ts
pub fn update_item_from_play_info(server: &str, play_info: &FnosPlayInfo) {
    let item_guid = &play_info.guid;
    let is_favorite = play_info.item.is_favorite;
    let watched = play_info.item.is_watched;
    let ts = play_info.ts;
    
    let mut updated = 0;
    
    for mut entry in CACHE.iter_mut() {
        if !entry.key().starts_with(server) {
            continue;
        }
        if let Some(ref mut data) = entry.value_mut().data.data {
            for item in data.list.iter_mut() {
                if item.guid == *item_guid {
                    item.is_favorite = is_favorite;
                    item.watched = watched;
                    item.ts = ts;
                    updated += 1;
                }
            }
        }
    }
    
    debug!(
        "[CACHE] 更新 item: guid={}, is_favorite={}, watched={}, ts={:.1}s, 影响 {} 条缓存",
        item_guid, is_favorite, watched, ts, updated
    );
}

/// 更新缓存中指定 item 的 is_favorite 状态
pub fn update_item_favorite(server: &str, item_guid: &str, is_favorite: bool) {
    let value = if is_favorite { 1 } else { 0 };
    let mut updated = 0;
    
    for mut entry in CACHE.iter_mut() {
        if !entry.key().starts_with(server) {
            continue;
        }
        if let Some(ref mut data) = entry.value_mut().data.data {
            for item in data.list.iter_mut() {
                if item.guid == item_guid {
                    item.is_favorite = value;
                    updated += 1;
                }
            }
        }
    }
    
    debug!("[CACHE] 更新 is_favorite: item={}, value={}, 影响 {} 条缓存", item_guid, value, updated);
}

/// 更新缓存中指定 item 的 watched 状态
pub fn update_item_watched(server: &str, item_guid: &str, watched: bool) {
    let value = if watched { 1 } else { 0 };
    let mut updated = 0;
    
    for mut entry in CACHE.iter_mut() {
        if !entry.key().starts_with(server) {
            continue;
        }
        if let Some(ref mut data) = entry.value_mut().data.data {
            for item in data.list.iter_mut() {
                if item.guid == item_guid {
                    item.watched = value;
                    updated += 1;
                }
            }
        }
    }
    
    debug!("[CACHE] 更新 watched: item={}, value={}, 影响 {} 条缓存", item_guid, value, updated);
}

/// 更新缓存中指定 item 的播放进度
pub fn update_item_progress(server: &str, item_guid: &str, ts: f64) {
    let mut updated = 0;
    
    for mut entry in CACHE.iter_mut() {
        if !entry.key().starts_with(server) {
            continue;
        }
        if let Some(ref mut data) = entry.value_mut().data.data {
            for item in data.list.iter_mut() {
                if item.guid == item_guid {
                    item.ts = ts;
                    updated += 1;
                }
            }
        }
    }
    
    debug!("[CACHE] 更新 ts: item={}, value={:.1}s, 影响 {} 条缓存", item_guid, ts, updated);
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
