/**
 * 认证辅助函数
 */

import { post, get, assertSuccess, assertStatus } from './client.ts';
import { config, testState } from '../config.ts';

export interface LoginCredentials {
  Username: string;
  Pw: string;
}

export interface AuthenticationResult {
  User: {
    Id: string;
    Name: string;
    ServerId: string;
    [key: string]: any;
  };
  AccessToken: string;
  ServerId: string;
  SessionInfo?: any;
}

/** 执行登录 */
export async function login(credentials?: LoginCredentials): Promise<AuthenticationResult> {
  const creds = credentials || {
    Username: config.username,
    Pw: config.password,
  };

  if (!creds.Username || !creds.Pw) {
    throw new Error('缺少用户名或密码');
  }

  const response = await post<AuthenticationResult>('/Users/AuthenticateByName', creds, {
    headers: {
      'X-Emby-Authorization': 'MediaBrowser Client="TestClient", Device="TestDevice", DeviceId="test-001", Version="1.0.0"',
    },
  });

  if (!response.success) {
    throw new Error(`登录请求失败: ${response.error || `HTTP ${response.status}`}`);
  }
  
  if (response.status !== 200) {
    throw new Error(`登录返回非200状态码: ${response.status}`);
  }

  const result = response.data!;
  
  if (!result.AccessToken || !result.User?.Id) {
    throw new Error('登录响应缺少必要字段');
  }
  
  // 保存到全局状态
  testState.accessToken = result.AccessToken;
  testState.userId = result.User.Id;
  testState.serverId = result.ServerId;

  return result;
}

/** 获取当前用户信息 */
export async function getCurrentUser() {
  const response = await get('/Users/Me');
  assertSuccess(response);
  assertStatus(response, 200);
  return response.data;
}

/** 获取指定用户信息 */
export async function getUser(userId: string) {
  const response = await get(`/Users/${userId}`);
  assertSuccess(response);
  assertStatus(response, 200);
  return response.data;
}

/** 登出（清理状态） */
export function logout(): void {
  testState.accessToken = null;
  testState.userId = null;
  testState.serverId = null;
}

/** 检查是否已登录 */
export function isLoggedIn(): boolean {
  return !!testState.accessToken;
}

/** 跳过测试如果未配置凭据 */
export function skipIfNoCredentials(testFn: Function): void {
  if (!config.username || !config.password) {
    console.log('[SKIP] 未配置用户名/密码，跳过测试');
    return;
  }
  testFn();
}
