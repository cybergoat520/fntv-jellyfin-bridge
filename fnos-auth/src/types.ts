/**
 * 飞牛影视 API 类型定义
 */

// ============ 请求相关 ============

/** HTTP 方法 */
export enum HttpMethod {
  GET = 'get',
  POST = 'post',
  PUT = 'put',
  DELETE = 'delete',
}

/** 登录凭据 */
export interface LoginCredentials {
  /** 服务器地址，例如 http://192.168.1.100:5666 */
  server: string;
  /** 用户名 */
  username: string;
  /** 密码 */
  password: string;
}

/** 飞牛登录请求体 */
export interface FnosLoginRequest {
  app_name: string;
  username: string;
  password: string;
  nonce?: string;
}

// ============ 响应相关 ============

/** 飞牛 API 通用响应格式 */
export interface FnosApiResponse<T = any> {
  code: number;
  msg: string;
  data: T;
}

/** 飞牛登录响应 data */
export interface FnosLoginData {
  token: string;
  [key: string]: any;
}

/** 飞牛用户信息 */
export interface FnosUserInfo {
  username: string;
  uid?: number;
  [key: string]: any;
}

// ============ 客户端相关 ============

/** 内部请求结果（统一封装） */
export interface RequestResult<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  /** 是否为证书错误 */
  certificateError?: boolean;
  /** 重定向后的最终 URL */
  moveUrl?: string;
}

/** 登录结果 */
export interface LoginResult {
  success: boolean;
  /** 飞牛 token */
  token: string;
  /** 用户名 */
  username: string;
  /** 实际服务器地址（可能经过重定向） */
  server: string;
  /** Cookie 信息 */
  cookies: {
    'Trim-MC-token': string;
    mode: string;
  };
  /** 错误信息 */
  error?: string;
}

// ============ 签名相关 ============

/** Authx 签名参数 */
export interface AuthxParams {
  nonce: string;
  timestamp: number;
  sign: string;
}

// ============ 客户端配置 ============

/** FnosClient 配置 */
export interface FnosClientOptions {
  /** 请求超时（毫秒），默认 10000 */
  timeout?: number;
  /** 签名错误最大重试次数，默认 5 */
  maxRetries?: number;
  /** 重试间隔（毫秒），默认 100 */
  retryDelay?: number;
  /** 是否忽略 SSL 证书验证，默认 false */
  ignoreCert?: boolean;
}
