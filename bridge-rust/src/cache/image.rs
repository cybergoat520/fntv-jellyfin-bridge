/// 图片 URL 缓存
/// 在列表查询时缓存 poster/backdrop URL，供图片代理路由使用
/// 这样图片请求不需要再调用飞牛 API

use dashmap::DashMap;
use std::sync::LazyLock;

#[derive(Clone, Debug)]
pub struct CachedImage {
    pub poster: Option<String>,
    pub backdrop: Option<String>,
    pub server: String,
    pub token: String,
}

static CACHE: LazyLock<DashMap<String, CachedImage>> = LazyLock::new(DashMap::new);

pub fn set_image_cache(item_id: &str, data: CachedImage) {
    CACHE.insert(item_id.to_string(), data);
}

pub fn get_image_cache(item_id: &str) -> Option<CachedImage> {
    CACHE.get(item_id).map(|v| v.clone())
}

pub fn set_image_cache_batch(entries: &[(String, CachedImage)]) {
    for (item_id, data) in entries {
        CACHE.insert(item_id.clone(), data.clone());
    }
}
