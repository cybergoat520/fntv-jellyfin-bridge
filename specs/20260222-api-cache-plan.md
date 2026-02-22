# stream/list 和 user/info 请求缓存

> 日期：2026-02-22
> 对应 backlog：#1 stream/list 请求缓存、#2 user/info 请求合并

## 问题

1. **stream/list 重复请求**：打开详情页时，`items_detail`（build_item_response）和 `PlaybackInfo`（mediainfo.rs）会对同一个 item_guid 各调一次 `fnos_get_stream_list`，数据完全相同。

2. **user/info 重复请求**：首页加载时 `users_me` + `users_by_id` 并发 4-5 次相同的 `/v/api/v1/user/info` 请求。

## 方案

### 缓存目录重组

把分散在 `services/` 的缓存文件集中到 `cache/` 模块：

```
bridge-rust/src/cache/
├── mod.rs              # pub mod 声明
├── item_list.rs        # 原 services/item_list_cache.rs
├── image.rs            # 原 services/image_cache.rs
├── stream_list.rs      # 新增：stream/list 缓存（TTL 30s + 并发去重）
└── user_info.rs        # 新增：user/info 缓存（TTL 60s + 并发去重）
```

### 不缓存 play/info

`fnos_get_play_info` 调用场景分散（详情、播放、收藏、标记等），extras.rs 操作后需要立即拿最新数据，缓存反而增加复杂度，不做。

### 未来计划：TTL 缓存通用化

当前 `item_list`、`stream_list`、`user_info` 三个 TTL 缓存的模式相同（DashMap + Mutex 并发去重 + TTL 过期），但各自独立实现。未来可以抽取一个泛型 `TtlCache<K, V>` struct，统一提供 `get_or_fetch()` 方法，减少重复代码。暂不做是因为 `item_list` 有额外的业务状态更新方法（favorite/watched/progress），泛型抽象需要额外设计。

## 修改清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `cache/mod.rs` | `pub mod item_list; pub mod image; pub mod stream_list; pub mod user_info;` |
| 移动 | `services/item_list_cache.rs` → `cache/item_list.rs` | 内容不变 |
| 移动 | `services/image_cache.rs` → `cache/image.rs` | 内容不变 |
| 新建 | `cache/stream_list.rs` | TTL 30s + 并发去重 |
| 新建 | `cache/user_info.rs` | TTL 60s + 并发去重 |
| 修改 | `services/mod.rs` | 删除 `pub mod item_list_cache` 和 `pub mod image_cache` |
| 修改 | `lib.rs` | 加 `pub mod cache` |
| 修改 | `routes/items.rs` | `services::item_list_cache` → `cache::item_list`，stream_list 用缓存 |
| 修改 | `routes/playback.rs` | `services::item_list_cache` → `cache::item_list` |
| 修改 | `routes/extras.rs` | `services::item_list_cache` → `cache::item_list` |
| 修改 | `routes/images.rs` | `services::image_cache` → `cache::image` |
| 修改 | `routes/mediainfo.rs` | stream_list 用缓存 |
| 修改 | `routes/users.rs` | user_info 用缓存 |
| 修改 | `mappers/item.rs` | `services::image_cache` → `cache::image` |
