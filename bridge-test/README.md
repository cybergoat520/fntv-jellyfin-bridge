# fnos-bridge API 测试套件

用于测试 fnos-bridge Node.js 服务器的 API 端点。

## 快速开始

```bash
cd bridge-test
npm install

# 配置环境变量并运行测试
export TEST_USERNAME=your_username
export TEST_PASSWORD=your_password
npm test
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `TEST_BASE_URL` | `http://localhost:8096` | Bridge 服务器地址 |
| `TEST_FNOS_SERVER` | `http://localhost:5666` | 飞牛 NAS 地址 |
| `TEST_USERNAME` | - | 测试用户名（必填） |
| `TEST_PASSWORD` | - | 测试密码（必填） |
| `TEST_TIMEOUT` | `30000` | 请求超时（毫秒） |
| `TEST_VERBOSE` | `false` | 详细日志输出 |

## 运行测试

```bash
# 运行所有测试
npm test

# 只运行特定模块
npm run test:system      # 系统信息 API
npm run test:auth        # 认证和用户 API
npm run test:items       # 媒体项目 API
npm run test:playback    # 播放状态 API
npm run test:stream      # 视频流 API
```

## 测试覆盖

| 模块 | 端点 | 说明 |
|------|------|------|
| System | `/System/Info/Public`, `/System/Info`, `/System/Ping`, `/System/Endpoint` | 系统信息 |
| Auth | `/Users/AuthenticateByName`, `/Users/Me`, `/Users/:id` | 认证和用户 |
| Views | `/UserViews` | 媒体库列表 |
| Items | `/Items`, `/Items/:id`, `/Items/Latest`, `/Items/Filters` | 媒体列表和详情 |
| Shows | `/Shows/:id/Seasons`, `/Shows/:id/Episodes`, `/Shows/NextUp` | 剧集信息 |
| Playback | `/Sessions/Playing/*`, `/UserPlayedItems/*` | 播放状态同步 |
| Stream | `/Items/:id/PlaybackInfo`, `/Videos/*/stream` | 播放信息和视频流 |
| Images | `/Items/:id/Images/*` | 图片代理 |
| Branding | `/Branding/*` | 品牌配置 |
| Favorites | `/UserFavoriteItems/*` | 收藏功能 |
| Resume | `/UserItems/Resume` | 继续观看 |
| Misc | `/Localization/*`, `/DisplayPreferences/*` | 其他端点 |

## 测试结构

```
bridge-test/
├── package.json          # 项目配置
├── config.ts             # 测试配置
├── lib/
│   ├── client.ts         # HTTP 客户端封装
│   ├── auth-helper.ts    # 认证辅助函数
│   └── index.ts          # 库导出
├── tests/
│   ├── index.ts          # 测试入口
│   ├── system.test.ts    # System API 测试
│   ├── auth.test.ts      # Auth API 测试
│   ├── views.test.ts     # Views API 测试
│   ├── items.test.ts     # Items API 测试
│   ├── shows.test.ts     # Shows API 测试
│   ├── playback.test.ts  # Playback API 测试
│   ├── stream.test.ts    # Stream API 测试
│   ├── images.test.ts    # Images API 测试
│   ├── branding.test.ts  # Branding API 测试
│   ├── favorites.test.ts # Favorites API 测试
│   ├── resume.test.ts    # Resume API 测试
│   └── misc.test.ts      # 其他端点测试
└── README.md             # 本文档
```

## 注意事项

1. 部分测试需要有效的用户名和密码，否则会跳过
2. 视频流测试需要媒体库中有实际内容
3. 建议先在测试环境中运行，避免影响生产数据
4. 测试会临时修改收藏和播放状态，运行后会恢复
