# 20260217 - fnos-auth 飞牛影视登录模块

## 项目概述

创建 `fnos-auth` 模块，实现飞牛影视 API 登录能力，作为后续 Jellyfin 转换层的基础。

## 项目背景

目标是制作飞牛影视到 Jellyfin 的转换层，让 Jellyfin 客户端可以访问飞牛影视服务器。本次实现第一步：登录飞牛影视。

## 技术选型

| 项目 | 选择 | 理由 |
|------|------|------|
| 运行时 | Node.js 24 | 原生支持 TypeScript，无需编译 |
| 语言 | TypeScript | 类型安全 |
| HTTP 客户端 | Axios | 支持拦截器、Cookie 管理 |
| 签名算法 | crypto (内置) | MD5 计算 |
| 测试 | node:test (内置) | 无需额外依赖 |

## 项目结构

```
fnos-auth/
├── src/
│   ├── types.ts          # 类型定义
│   ├── signature.ts      # Authx 签名计算（MD5）
│   ├── client.ts         # HTTP 客户端（自动签名 + 重定向 + 重试）
│   ├── auth.ts           # 登录功能
│   └── index.ts          # 统一导出
├── tests/
│   └── signature.test.ts # 签名单元测试
├── examples/
│   └── login.ts          # 使用示例
├── specs/                # 文档
├── package.json
└── tsconfig.json
```

## 新增文件清单

| 文件 | 说明 |
|------|------|
| `package.json` | 项目配置，依赖 axios + @types/node |
| `tsconfig.json` | TypeScript 配置（noEmit，仅类型检查） |
| `src/types.ts` | 所有类型定义（请求/响应/配置） |
| `src/signature.ts` | Authx 签名算法实现 |
| `src/client.ts` | FnosClient HTTP 客户端 |
| `src/auth.ts` | login() 登录函数 |
| `src/index.ts` | 统一导出 |
| `tests/signature.test.ts` | 签名模块单元测试（10 个用例） |
| `examples/login.ts` | CLI 登录示例 |

## 核心实现

### 1. Authx 签名算法 (`src/signature.ts`)

飞牛影视每个 API 请求都需要 Authx 签名：

```
签名公式：
  sign = MD5(api_key + "_" + url + "_" + nonce + "_" + timestamp + "_" + MD5(body) + "_" + api_secret)

输出格式：
  nonce={nonce}&timestamp={timestamp}&sign={sign}

固定密钥：
  api_key    = NDzZTVxnRKP8Z0jXg1VAMonaG8akvh
  api_secret = 16CCEB3D-AB42-077D-36A1-F355324E4237
```

### 2. HTTP 客户端 (`src/client.ts`)

FnosClient 封装了飞牛 API 请求的通用逻辑：

- 自动计算并附加 Authx 签名到 Header
- 自动附加 Cookie `mode=relay`
- POST/PUT 请求自动添加 nonce 防重放
- 手动处理 3xx 重定向（递归跟随）
- 签名错误（code=5000）自动重试（默认 5 次，间隔 100ms）
- 证书错误识别并标记

请求头格式：
```
Content-Type: application/json
Authorization: {token}
Cookie: mode=relay
Authx: nonce={nonce}&timestamp={timestamp}&sign={sign}
```

### 3. 登录功能 (`src/auth.ts`)

调用 `POST /v/api/v1/login`，请求体：
```json
{
  "app_name": "trimemedia-web",
  "username": "xxx",
  "password": "xxx",
  "nonce": "随机6位数字"
}
```

返回结构：
```typescript
{
  success: boolean;
  token: string;              // Trim-MC-token
  username: string;
  server: string;             // 实际服务器地址（可能经过重定向）
  cookies: {
    'Trim-MC-token': string;  // 登录 token
    mode: string;             // 固定值 'relay'
  };
  error?: string;
}
```

### 4. Cookie 说明

登录成功后需要两个 Cookie：
- `Trim-MC-token` = 登录返回的 token
- `mode` = `relay`（外网访问必需）

本次实现仅返回 Cookie 值，不做持久化存储。

## 使用方式

```typescript
import { login } from './src/index.ts';

const result = await login({
  server: 'http://192.168.1.100:5666',
  username: 'admin',
  password: 'password',
});
```

CLI：
```bash
node examples/login.ts http://192.168.1.100:5666 admin password
```

## 测试结果

```
10 tests, 4 suites, 10 pass, 0 fail
```

覆盖：MD5 计算、nonce 生成、签名结构、签名格式。

## 依赖

```json
{
  "dependencies": { "axios": "^1.7.0" },
  "devDependencies": { "@types/node": "^20.0.0" }
}
```

无 tsx、无 typescript 编译器，直接用 Node.js 24 原生运行 .ts 文件。

## 后续计划

- 集成测试：连接真实飞牛服务器验证登录
- FN ID OAuth 登录支持
- 用户信息获取（`GET /v/api/v1/user/info`）
- 媒体列表获取（`POST /v/api/v1/item/list`）
- Jellyfin API 转换层
