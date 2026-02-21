# fnos-bridge Rust 版 — 待优化项（低优先级）

可以做但不紧急的优化，按需推进。

## 1. stream/list 和 play/info 请求缓存

**现状**：`item_list_cache` 只缓存了列表请求（`/v/api/v1/item/list`），但 `stream/list` 和 `play/info` 没有缓存。打开一个详情页会触发两次相同的 `stream/list` 请求（items_detail + mediainfo/PlaybackInfo）。

**方案**：给 `fnos_get_stream_list` 和 `fnos_get_play_info` 加类似 `item_list_cache` 的 TTL 缓存 + 并发去重。

**影响**：减少飞牛 API 请求量，加快详情页加载。

## 2. user/info 请求合并

**现状**：每个需要认证的请求都会调一次 `/v/api/v1/user/info`，首页加载时会并发 4-5 次相同请求。

**方案**：在 session 层缓存 user info，TTL 内不重复请求。

## 3. fnos_client 日志级别调整

**现状**：所有 `[FNOS] POST/GET ...` 日志都是 `info` 级别，生产环境日志量大。

**方案**：改为 `debug`，只在需要时通过 `RUST_LOG=info,fnos_bridge::fnos_client=debug` 开启。

## 4. ~~Windows 本地编译支持~~

已解决 — Visual Studio Build Tools 安装后可正常编译。
