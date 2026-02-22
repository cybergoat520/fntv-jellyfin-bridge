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

## 5. 路径规范化优化

**现状**：当前实现了大小写规范化（如 `/system/info/public` → `/System/Info/Public`），但未实现双斜杠规范化。bridge-node 版本有双斜杠处理（`//System/Info` → `/System/Info`），但 bridge-rust 没有。

**背景**：
- 标准客户端（jellyfin-web、Xbox、Android 等）都会发送正确的路径
- 大小写规范化是容错处理，防止第三方客户端或手动请求出错
- 双斜杠规范化在 bridge-node 中是为 Xbox 添加的，但实际上 Xbox 也不会产生双斜杠路径

**方案选项**：

**选项 A - 保持现状**：
- 维持现有大小写规范化
- 不添加双斜杠处理（因为没有实际需求）
- 移除相关的测试代码（已移到 `path-normalization.test.ts`，可删除）

**选项 B - 完整实现**：
- 在 `normalize_path` 中添加双斜杠处理：
  ```rust
  let path = path.replace("//", "/");
  ```
- 统一处理所有非标准路径变体

**选项 C - 移除大小写规范化**：
- 如果确认所有客户端都使用正确的大小写，可以移除该功能简化代码
- 需要充分测试各主流客户端（jellyfin-web、Xbox、Android、iOS）

**建议**：选项 A（保持现状），因为没有实际场景需要双斜杠支持，且大小写规范化对容错有帮助。`path-normalization.test.ts` 中的测试可以保留作为回归测试，但标记为可选/容错性质。
