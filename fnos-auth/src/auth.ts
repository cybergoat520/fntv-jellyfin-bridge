/**
 * 飞牛影视登录功能
 *
 * 流程：
 * 1. 构建服务器地址（http/https）
 * 2. 发送 POST /v/api/v1/login（自动附加 Authx 签名）
 * 3. 处理重定向（更新实际服务器地址）
 * 4. 返回 token + cookies
 */

import { FnosClient } from './client.ts';
import { HttpMethod } from './types.ts';
import type {
  LoginCredentials,
  LoginResult,
  FnosLoginData,
  FnosClientOptions,
} from './types.ts';

/**
 * 登录飞牛影视
 *
 * @example
 * ```ts
 * const result = await login({
 *   server: 'http://192.168.1.100:5666',
 *   username: 'admin',
 *   password: 'password',
 * });
 *
 * if (result.success) {
 *   console.log('Token:', result.token);
 *   console.log('Cookies:', result.cookies);
 * }
 * ```
 */
export async function login(
  credentials: LoginCredentials,
  options?: FnosClientOptions,
): Promise<LoginResult> {
  const { server, username, password } = credentials;

  if (!server || !username || !password) {
    return {
      success: false,
      token: '',
      username: '',
      server: '',
      cookies: { 'Trim-MC-token': '', mode: '' },
      error: '缺少必要的登录信息（server, username, password）',
    };
  }

  const client = new FnosClient(server, '', options);

  const response = await client.request<FnosLoginData>(
    HttpMethod.POST,
    '/v/api/v1/login',
    {
      app_name: 'trimemedia-web',
      username,
      password,
    },
  );

  // 登录失败
  if (!response.success) {
    return {
      success: false,
      token: '',
      username,
      server,
      cookies: { 'Trim-MC-token': '', mode: '' },
      error: response.certificateError
        ? `证书验证失败: ${response.message}`
        : response.message || '登录失败',
    };
  }

  // 提取 token
  const token = response.data?.token;
  if (!token) {
    return {
      success: false,
      token: '',
      username,
      server,
      cookies: { 'Trim-MC-token': '', mode: '' },
      error: '登录响应中没有 token',
    };
  }

  // 实际服务器地址（可能经过重定向）
  const actualServer = response.moveUrl || server;

  return {
    success: true,
    token,
    username,
    server: actualServer,
    cookies: {
      'Trim-MC-token': token,
      mode: 'relay',
    },
  };
}
