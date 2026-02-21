# 日志级别重构

> 日期：2026-02-21  
> 目标：统一 bridge-rust 的日志级别，正常运行时使用 info 级别  
> 状态：✅ 已完成

## 分级原则

| 级别 | 用途 | 示例 |
|------|------|------|
| **debug** | 调试时有用，正常运行不需要 | 路径规范化、请求 URI、数据条数、流程中间步骤 |
| **info** | 关键操作，正常运行需要看到 | 服务启动、登录成功、HLS 会话创建、会话恢复 |
| **warn** | 异常情况，需要关注但不影响运行 | 登录失败、未实现的端点、请求失败 |
| **error** | 错误，需要处理 | 代理失败、解析错误 |

## 修改记录

### main.rs ✅

| 原级别 | 新级别 | 内容 |
|--------|--------|------|
| info | info | 服务启动消息 |
| info | debug | `[ROOT] GET /`、`[ROOT] GET /web`、重定向日志 |
| info | debug | `[PATH] 原始路径`、`[PATH] 规范化后` |
| warn | warn | `[STUB] 未实现的端点` (保持) |

### proxy/stream.rs ✅

| 原级别 | 新级别 | 内容 |
|--------|--------|------|
| info | debug | `[STREAM_EXT]` 带扩展名请求 |
| info | debug | `[STREAM]` 流程步骤（开始、session、guid、构建请求等） |
| info | debug | `[HLS]` 代理日志、410 清除会话 |
| info | debug | `[SUBTITLE]` 字幕请求 |
| error | error | 代理失败 (保持) |

### routes/users.rs ✅ (新增)

| 原级别 | 新级别 | 内容 |
|--------|--------|------|
| (无) | info | `[AUTH] 登录成功: user=xxx, client=xxx, device=xxx` |
| (无) | warn | `[AUTH] 登录失败: user=xxx, error=xxx` |

### routes/items.rs (无需修改)

| 原级别 | 新级别 | 内容 |
|--------|--------|------|
| debug | debug | 请求 URI、分支判断、数据条数 (保持) |
| warn | warn | 请求失败 (保持) |

### routes/playback.rs ✅

| 原级别 | 新级别 | 内容 |
|--------|--------|------|
| info | debug | 播放进度上报详情 |

### services/hls_session.rs (无需修改)

| 原级别 | 新级别 | 内容 |
|--------|--------|------|
| info | info | 启动转码会话、会话创建成功 (保持) |
| error | error | 失败情况 (保持) |

### services/session.rs (无需修改)

| 原级别 | 新级别 | 内容 |
|--------|--------|------|
| info | info | 会话恢复 (保持) |
| warn | warn | 保存失败 (保持) |

### fnos_client/client.rs ✅

| 原级别 | 新级别 | 内容 |
|--------|--------|------|
| info | debug | 每次 HTTP 请求日志 |
| warn | warn | 重试警告 (保持) |

## 运行方式

```bash
# 正常运行（info 级别）
RUST_LOG=info cargo run

# 调试运行（debug 级别）
RUST_LOG=debug cargo run

# 只看特定模块的 debug
RUST_LOG=fnos_bridge::proxy=debug cargo run
```
