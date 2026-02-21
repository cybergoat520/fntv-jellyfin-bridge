# 20260221 fnos-bridge Rust 版调试修复记录

## 概述

bridge-rust 初始实现后的首轮调试修复，解决了编译、运行时路由、图片代理、列表过滤等一系列问题。

## 修复内容

### 1. 编译环境

- Dockerfile 从 `rust:1.83` 升级到 `rust:1.85`（`getrandom 0.4.1` 需要 edition2024）
- 构建阶段安装 `pkg-config` + `libssl-dev`（openssl-sys 依赖）
- `images.rs` Handler trait 不满足：用 `Extension<SessionData>` 替代 `Request` 提取
- `client.rs` future not Send：`request` 和 `request_internal` 泛型 `T` 加 `Send` bound

### 2. Docker 部署

- Dockerfile 去掉 jellyfin-web 下载 stage（portable.tar.gz 已不提供），改用本地卷挂载
- `docker-compose.yml` 改用 `image: fnos-bridge:latest` + `./web:/app/web` 卷映射
- 添加 `build.sh` 编译脚本

### 3. 路由修复

- **重复路由 panic**：`/Users/{userId}/Items/Resume` 在 `main.rs` 和 `routes/items.rs` 重复注册，去掉 main.rs 的
- **路径规范化失效**：Axum 的 `.layer()` 中间件在路由匹配之后执行，`path_normalize` 无法影响路由匹配。改为外层 Router + `normalize_path` 函数在路由匹配前转换路径
- **Router oneshot 消费 bug**：外层 Router fallback 中 `inner.oneshot()` 消费了 Router，只有第一个请求正常。改为每次 `inner.clone()` 后再 `oneshot`
- **缺失路由**：添加 `/UserItems/Resume`、`/Users/{userId}/Items/Latest` 兼容路由

### 4. 参数大小写兼容

- `ItemsQuery` 的 serde 注解从 `#[serde(rename = "ParentId")]` 改为 `#[serde(alias = "ParentId", alias = "parentId")]`
- jellyfin-web 用 camelCase（`parentId`, `recursive`），原生客户端用 PascalCase（`ParentId`, `Recursive`），现在两种都支持

### 5. 图片代理

- 新增 `services/image_cache.rs`：全局 DashMap 缓存图片路径（poster/backdrop + server/token）
- `mappers/item.rs`：`map_playlist_item_to_dto` 和 `map_play_info_to_dto` 加 `server`/`token` 参数，映射时自动缓存图片
- `routes/images.rs`：改用 `optional_auth` + image cache，优先认证，fallback 到缓存，对齐 Node.js 版本行为
- 图片 URL 构造对齐 Node.js：支持 `/v/api/v1/sys/img` 前缀、`fillWidth`/`maxWidth` 尺寸参数
- 添加 `tower-http::services::ServeDir` serve `/web/` 静态文件

### 6. 列表过滤

- **过滤 bug**：`view_tvshows` 的 category 从 `"TV"` 改为 `"Series"`，过滤时用 `map_type()` 映射后比较
- `map_type` 改为 `pub` 供路由层使用
- **items_list 重写**：对齐 Node.js 三分支逻辑：
  1. 有 ParentId → 虚拟媒体库过滤 + IncludeItemTypes + Filters
  2. 无 ParentId + Recursive=true → 全局搜索/收藏夹
  3. 都没有 → 返回空
- 支持完整过滤：IsFavorite、IsResumable、IsPlayed、IsUnplayed

### 7. 请求缓存

- 新增 `services/item_list_cache.rs`：带 30s TTL + 并发去重（tokio Mutex）的请求缓存
- 所有 `fnos_get_item_list` 调用改为 `cached_get_item_list`，避免重复请求飞牛

### 8. 继续观看 / 最近添加

- `items_resume`：添加 `MediaTypes` 过滤（Audio/Book 直接返回空），排序改为 `air_date DESC` 对齐 Node.js
- `items_latest`：添加 ParentId 虚拟媒体库过滤 + IncludeItemTypes 过滤
- `middleware/auth.rs`：新增 `optional_auth` 中间件

## 新增文件

| 文件 | 说明 |
|------|------|
| `bridge-rust/src/services/image_cache.rs` | 图片路径全局缓存 |
| `bridge-rust/src/services/item_list_cache.rs` | 列表请求缓存（TTL 30s + 并发去重） |

## 当前状态

- 首页正常：继续观看、最近添加电影、最近添加电视剧
- 电影/电视剧列表正确过滤
- 图片代理正常（无认证也可通过缓存访问）
- Docker 编译部署正常
- 本地 Windows 编译需要 Visual Studio Build Tools
