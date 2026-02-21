/**
 * 测试配置
 * 支持环境变量覆盖
 */

export interface TestConfig {
  /** Bridge 服务器地址 */
  baseURL: string;
  /** 飞牛 NAS 地址 */
  fnosServer: string;
  /** 测试用户名 */
  username: string;
  /** 测试密码 */
  password: string;
  /** 请求超时(ms) */
  timeout: number;
  /** 是否详细日志 */
  verbose: boolean;
}

export const config: TestConfig = {
  baseURL: process.env.TEST_BASE_URL || 'http://localhost:8096',
  fnosServer: process.env.TEST_FNOS_SERVER || 'http://localhost:5666',
  username: process.env.TEST_USERNAME || 'test',
  password: process.env.TEST_PASSWORD || '123456',
  timeout: parseInt(process.env.TEST_TIMEOUT || '30000', 10),
  verbose: process.env.TEST_VERBOSE === 'true',
};

/** 验证必要配置 */
export function validateConfig(): void {
  const missing: string[] = [];
  
  if (!config.username) missing.push('TEST_USERNAME');
  if (!config.password) missing.push('TEST_PASSWORD');
  
  if (missing.length > 0) {
    console.warn(`[警告] 缺少测试配置: ${missing.join(', ')}`);
    console.warn('部分测试将被跳过');
  }
}

/** 全局测试状态 */
export interface TestState {
  /** 访问令牌 */
  accessToken: string | null;
  /** 用户ID */
  userId: string | null;
  /** 服务器ID */
  serverId: string | null;
  /** 测试项目ID */
  testItemId: string | null;
  /** 测试剧集ID */
  testSeriesId: string | null;
}

export const testState: TestState = {
  accessToken: null,
  userId: null,
  serverId: null,
  testItemId: null,
  testSeriesId: null,
};
