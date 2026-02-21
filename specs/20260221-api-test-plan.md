# fnos-bridge API 测试计划

> 日期：2026-02-21  
> 目标：为 bridge-node (Node.js 版本) 建立完整的 API 测试覆盖

## 测试目标

建立一套完整的 API 测试套件，覆盖 fnos-bridge 的所有 Jellyfin 兼容端点，确保：

1. **功能正确性**：每个端点按预期工作
2. **认证流程**：登录、Token 验证、权限控制
3. **数据映射**：飞牛数据正确转换为 Jellyfin 格式
4. **错误处理**：无效输入得到恰当响应
5. **兼容性**：支持不同 Jellyfin 客户端的请求方式

## 测试架构

```
bridge-test/
├── package.json          # 项目配置
├── config.ts             # 环境变量配置
├── lib/
│   ├── client.ts         # HTTP 客户端封装
│   ├── auth-helper.ts    # 认证辅助函数
│   └── index.ts          # 库导出
├── tests/
│   ├── system.test.ts    # 系统信息 API
│   ├── auth.test.ts      # 认证和用户 API
│   ├── views.test.ts     # 媒体库 API
│   ├── items.test.ts     # 媒体项目 API
│   ├── shows.test.ts     # 剧集 API
│   ├── playback.test.ts  # 播放状态 API
│   ├── stream.test.ts    # 视频流 API
│   ├── images.test.ts    # 图片代理 API
│   ├── branding.test.ts  # 品牌 API
│   ├── favorites.test.ts # 收藏 API
│   ├── resume.test.ts    # 继续观看 API
│   └── misc.test.ts      # 其他端点
└── README.md
```

## 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 测试框架 | Node.js Test Runner | 原生支持，无需额外依赖 |
| HTTP 客户端 | axios | 功能完善，支持拦截器 |
| 语言 | TypeScript | 与项目一致，类型安全 |

## 环境变量

```bash
TEST_BASE_URL=http://localhost:8096      # Bridge 地址
TEST_FNOS_SERVER=http://localhost:5666   # 飞牛地址
TEST_USERNAME=admin                      # 测试用户
TEST_PASSWORD=password                   # 测试密码
TEST_TIMEOUT=30000                       # 超时(ms)
TEST_VERBOSE=true                        # 详细日志
```

## 测试用例详述

### 1. System API (system.test.ts)

| 测试 | 端点 | 描述 |
|------|------|------|
| 公开系统信息 | `GET /System/Info/Public` | 返回 ServerName, Version, Id |
| Ping | `GET/POST /System/Ping` | 返回服务器名称 |
| 端点信息 | `GET /System/Endpoint` | 返回 IsLocal, IsInNetwork |
| 带宽测试 | `GET /Playback/BitrateTest` | 返回指定大小的测试数据 |
| 大小写兼容 | 各种大小写组合 | 验证路径规范化 |

### 2. Auth & Users API (auth.test.ts)

| 测试 | 端点 | 描述 |
|------|------|------|
| 有效登录 | `POST /Users/AuthenticateByName` | 返回 AccessToken 和 User |
| 无效凭据 | `POST /Users/AuthenticateByName` | 返回 401 |
| 缺少参数 | `POST /Users/AuthenticateByName` | 返回 400 |
| 获取当前用户 | `GET /Users/Me` | 返回当前登录用户信息 |
| 获取指定用户 | `GET /Users/:id` | 返回指定用户信息 |
| Token 验证 | `GET /Users/Me` | 无效 Token 返回 401 |

### 3. UserViews API (views.test.ts)

| 测试 | 端点 | 描述 |
|------|------|------|
| 媒体库列表 | `GET /UserViews` | 返回电影、电视剧媒体库 |
| 字段验证 | `GET /UserViews` | 每个库有 Id, Name, Type 等字段 |
| 未认证访问 | `GET /UserViews` | 返回 401 |
| 旧版路径 | `GET /Users/:id/Views` | 重定向到 /UserViews |

### 4. Items API (items.test.ts)

| 测试 | 端点 | 描述 |
|------|------|------|
| 媒体列表 | `GET /Items?ParentId={id}` | 返回指定库的项目 |
| 分页 | `GET /Items?StartIndex&Limit` | 正确分页 |
| 搜索 | `GET /Items?SearchTerm={term}` | 按名称搜索 |
| 类型过滤 | `GET /Items?IncludeItemTypes=Movie` | 只返回电影 |
| 排序 | `GET /Items?SortBy&SortOrder` | 支持多种排序 |
| 项目详情 | `GET /Items/:id` | 返回单个项目详情 |
| 媒体源 | `GET /Items/:id` | 包含 MediaSources |
| 最近添加 | `GET /Items/Latest` | 返回最近添加的项目 |
| 过滤器 | `GET /Items/Filters` | 返回可用过滤器 |

### 5. Shows API (shows.test.ts)

| 测试 | 端点 | 描述 |
|------|------|------|
| 季列表 | `GET /Shows/:id/Seasons` | 返回剧集的所有季 |
| 集列表 | `GET /Shows/:id/Episodes` | 返回剧集的所有集 |
| 按季过滤 | `GET /Shows/:id/Episodes?SeasonId={id}` | 只返回指定季的集 |
| 下一集 | `GET /Shows/NextUp` | 返回空列表（暂未实现）|
| 字段验证 | 季/集 | IndexNumber, SeriesId 等字段 |

### 6. Playback API (playback.test.ts)

| 测试 | 端点 | 描述 |
|------|------|------|
| 播放开始 | `POST /Sessions/Playing` | 报告播放开始 |
| 播放进度 | `POST /Sessions/Playing/Progress` | 报告播放进度 |
| 播放停止 | `POST /Sessions/Playing/Stopped` | 报告播放停止 |
| 心跳 | `POST /Sessions/Playing/Ping` | 播放心跳 |
| 标记已看 | `POST /UserPlayedItems/:id` | 标记为已观看 |
| 取消已看 | `DELETE /UserPlayedItems/:id` | 取消已观看标记 |
| 会话列表 | `GET /Sessions` | 返回活跃会话 |
| 能力上报 | `POST /Sessions/Capabilities` | 接受客户端能力 |

### 7. Stream API (stream.test.ts)

| 测试 | 端点 | 描述 |
|------|------|------|
| 播放信息 | `POST /Items/:id/PlaybackInfo` | 返回 MediaSources |
| 媒体流 | `PlaybackInfo` | 包含视频/音频/字幕流信息 |
| DirectStream | `GET /Videos/:id/stream` | 返回视频流或 302 |
| Range 请求 | `GET /Videos/:id/stream` | 支持断点续传 |
| HLS 播放列表 | `GET /:id/hls/main.m3u8` | 返回 m3u8 文件 |
| 字幕 | `GET /Videos/:id/:source/Subtitles/:idx/Stream.{format}` | 返回字幕数据 |

### 8. Images API (images.test.ts)

| 测试 | 端点 | 描述 |
|------|------|------|
| 主封面 | `GET /Items/:id/Images/Primary` | 返回封面图 |
| 背景图 | `GET /Items/:id/Images/Backdrop` | 返回背景图 |
| 缩略图 | `GET /Items/:id/Images/Thumb` | 返回缩略图 |
| Logo | `GET /Items/:id/Images/Logo` | 返回 Logo |
| Banner | `GET /Items/:id/Images/Banner` | 返回 Banner |
| 尺寸参数 | `?fillWidth&fillHeight` | 支持尺寸调整 |
| 缓存 | 多次请求 | 第二次请求更快 |

### 9. Branding API (branding.test.ts)

| 测试 | 端点 | 描述 |
|------|------|------|
| 品牌配置 | `GET /Branding/Configuration` | 返回品牌配置 |
| 自定义 CSS | `GET /Branding/Css.css` | 返回 CSS |

### 10. Favorites API (favorites.test.ts)

| 测试 | 端点 | 描述 |
|------|------|------|
| 添加收藏 | `POST /UserFavoriteItems/:id` | 添加到收藏 |
| 取消收藏 | `DELETE /UserFavoriteItems/:id` | 从收藏移除 |
| 收藏列表 | `GET /Items?Filters=IsFavorite` | 过滤收藏项目 |

### 11. Resume API (resume.test.ts)

| 测试 | 端点 | 描述 |
|------|------|------|
| 继续观看 | `GET /UserItems/Resume` | 返回有播放进度的项目 |
| 类型过滤 | `?MediaTypes=Video` | 按类型过滤 |
| IsResumable | `GET /Items?Filters=IsResumable` | 过滤可恢复项目 |

### 12. Misc API (misc.test.ts)

| 测试 | 端点 | 描述 |
|------|------|------|
| Localization | `/Localization/*` | 返回空数组 |
| DisplayPreferences | `/DisplayPreferences/:id` | 读写显示偏好 |
| Intros | `/Items/:id/Intros` | 返回空列表 |
| Similar | `/Items/:id/Similar` | 返回空列表 |
| ThemeMedia | `/Items/:id/ThemeMedia` | 返回空结果 |
| SpecialFeatures | `/Items/:id/SpecialFeatures` | 返回空数组 |
| SyncPlay | `/SyncPlay/List` | 返回空数组 |
| Studios | `/Studios` | 返回空列表 |
| QuickConnect | `/QuickConnect/Enabled` | 返回 false |
| 根路径 | `/`, `/web` | 正确重定向 |
| 兜底处理 | 未知端点 | 返回空响应而非 404 |

## 测试执行计划

### 阶段 1：基础 API（无需认证）
- [x] System API
- [x] Branding API
- [x] Misc 公开端点

### 阶段 2：认证流程
- [x] 登录/登出
- [x] Token 验证
- [x] 用户信息

### 阶段 3：媒体浏览
- [x] UserViews
- [x] Items 列表和详情
- [x] Shows 季/集

### 阶段 4：播放功能
- [x] PlaybackInfo
- [x] 视频流
- [x] HLS
- [x] 字幕

### 阶段 5：用户交互
- [x] 播放状态同步
- [x] 收藏
- [x] 继续观看
- [x] 图片代理

## 运行指南

```bash
# 1. 进入测试目录
cd bridge-test

# 2. 安装依赖
npm install

# 3. 设置环境变量
export TEST_USERNAME=your_username
export TEST_PASSWORD=your_password

# 4. 运行所有测试
npm test

# 5. 运行特定模块
npm run test:auth
npm run test:items
npm run test:playback
```

## 预期结果

- 所有无需认证的端点：100% 通过
- 需要认证的端点：有凭据时通过，无凭据时跳过
- 需要媒体内容的测试：有内容时通过，无内容时跳过
- 总测试数：约 80+ 个测试用例

## 后续优化

1. **性能测试**：添加响应时间基准
2. **并发测试**：多客户端同时访问
3. **压力测试**：大量媒体库场景
4. **集成测试**：与真实 Jellyfin 客户端配合
5. **自动化**：CI/CD 集成
