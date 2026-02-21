# 修复 stream.{ext} 路由匹配问题

日期：2025-01-27

## 问题描述

测试 `GET /Videos/${testItemId}/stream.mkv?static=true` 超时失败，返回 status 0。

## 根因分析

Axum 使用 `matchit` 库做路由匹配。根据 matchit 文档：

> Named parameters like `/{id}` match anything until the next `/` or the end of the path. **Note that named parameters must be followed by a `/` or the end of the route. Dynamic suffixes are not currently supported.**

当前代码中有两个路由使用了不支持的"动态后缀"模式：

1. `/Videos/{itemId}/stream.{ext}` - 视频流
2. `/Videos/{itemId}/{mediaSourceId}/Subtitles/{index}/Stream.{format}` - 字幕流

这些路由无法正确注册或匹配，导致请求卡住。

## 解决方案

在 `normalize_path` 中将 `xxx.ext` 格式转换为 `xxx/ext` 格式，然后使用标准的路径参数匹配。

### 转换规则

| 原始请求路径 | 转换后路径 |
|---|---|
| `/Videos/{id}/stream.mkv` | `/Videos/{id}/stream/mkv` |
| `/Videos/{id}/stream.mp4` | `/Videos/{id}/stream/mp4` |
| `/Videos/{id}/{ms}/Subtitles/{idx}/Stream.vtt` | `/Videos/{id}/{ms}/Subtitles/{idx}/Stream/vtt` |
| `/Videos/{id}/{ms}/Subtitles/{idx}/Stream.srt` | `/Videos/{id}/{ms}/Subtitles/{idx}/Stream/srt` |

## 修改清单

### 1. `src/main.rs` - `normalize_path` 函数

使用 `flat_map` 替代 `map`，支持 1:2 拆分。检测 `stream.xxx` / `Stream.xxx` 格式，转换为 `stream/xxx` / `Stream/xxx`：

```rust
let new_segments: Vec<String> = segments
    .iter()
    .flat_map(|seg| {
        let lower = seg.to_lowercase();
        
        // 检测 stream.ext 或 Stream.ext 格式（如 stream.mkv, Stream.vtt）
        // 转换为 stream/ext 或 Stream/ext 格式
        if lower.starts_with("stream.") && lower.len() > 7 {
            let ext = &seg[7..]; // 取 "stream." 之后的部分
            let prefix = if seg.starts_with('S') { "Stream" } else { "stream" };
            changed = true;
            return vec![prefix.to_string(), ext.to_string()];
        }
        
        // 正常的大小写规范化
        if let Some(canonical) = path_map.get(lower.as_str()) {
            if *seg != *canonical {
                changed = true;
                return vec![canonical.to_string()];
            }
        }
        vec![seg.to_string()]
    })
    .collect();
```

### 2. `src/proxy/stream.rs` - 路由定义

修改路由模式：

```rust
// 修改前
.route("/Videos/{itemId}/stream.{ext}", get(video_stream_with_ext)...)
.route("/Videos/{itemId}/{mediaSourceId}/Subtitles/{index}/Stream.{format}", get(subtitle_stream)...)

// 修改后
.route("/Videos/{itemId}/stream/{ext}", get(video_stream_with_ext)...)
.route("/Videos/{itemId}/{mediaSourceId}/Subtitles/{index}/Stream/{format}", get(subtitle_stream)...)
```

### 3. 测试更新

- 删除 HEAD 请求测试（飞牛 API 返回 501 Not Implemented）
- 改用 Range 请求测试流代理功能：
  - 头部 16KB：`Range: bytes=0-16383`
  - 中间 16KB：根据文件大小计算中间位置
  - 末尾 16KB：`Range: bytes=-16384`

## 测试验证

修改后所有测试通过：

```
✓ 应该支持带扩展名的流请求（Range: 头部 16KB）
✓ 应该支持 Range 请求（中间 16KB）
✓ 应该支持 Range 请求（末尾 16KB）
```

## 影响范围

- 仅影响 bridge-rust 内部路由处理
- 不影响 jellyfin-web 或其他客户端
- 不影响飞牛 API 调用

## 相关文件

- `bridge-rust/src/main.rs` - normalize_path 函数
- `bridge-rust/src/proxy/stream.rs` - 路由定义和 handler
- `bridge-test/tests/stream.test.ts` - 测试用例
