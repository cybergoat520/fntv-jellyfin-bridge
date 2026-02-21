/**
 * HTTP 客户端封装
 */

import axios from 'axios';
import type { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { config, testState } from '../config.ts';

/** 创建 axios 实例 */
export function createClient(): AxiosInstance {
  const client = axios.create({
    baseURL: config.baseURL,
    timeout: config.timeout,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });

  // 请求拦截器：自动添加认证头
  client.interceptors.request.use((request) => {
    if (testState.accessToken) {
      request.headers['Authorization'] = `MediaBrowser Token="${testState.accessToken}"`;
    }
    if (config.verbose) {
      console.log(`[REQUEST] ${request.method?.toUpperCase()} ${request.url}`);
    }
    return request;
  });

  // 响应拦截器：日志
  client.interceptors.response.use(
    (response) => {
      if (config.verbose) {
        console.log(`[RESPONSE] ${response.status} ${response.config.url}`);
      }
      return response;
    },
    (error) => {
      if (config.verbose && error.response) {
        console.error(`[ERROR] ${error.response.status} ${error.config?.url}: ${JSON.stringify(error.response.data)}`);
      }
      return Promise.reject(error);
    }
  );

  return client;
}

/** 全局客户端实例 */
export const client = createClient();

/** API 响应包装 */
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  status: number;
  error?: string;
}

/** 安全请求包装 */
export async function safeRequest<T = any>(
  method: 'get' | 'post' | 'delete' | 'head',
  url: string,
  data?: any,
  options?: AxiosRequestConfig
): Promise<ApiResponse<T>> {
  try {
    const response: AxiosResponse<T> = await client.request({
      method,
      url,
      data,
      ...options,
    });
    return {
      success: true,
      data: response.data,
      status: response.status,
    };
  } catch (error: any) {
    return {
      success: false,
      status: error.response?.status || 0,
      error: error.response?.data?.error || error.message,
    };
  }
}

/** GET 请求 */
export const get = <T = any>(url: string, options?: AxiosRequestConfig) => 
  safeRequest<T>('get', url, undefined, options);

/** POST 请求 */
export const post = <T = any>(url: string, data?: any, options?: AxiosRequestConfig) => 
  safeRequest<T>('post', url, data, options);

/** DELETE 请求 */
export const del = <T = any>(url: string, options?: AxiosRequestConfig) => 
  safeRequest<T>('delete', url, undefined, options);

/** HEAD 请求 */
export const head = <T = any>(url: string, options?: AxiosRequestConfig) => 
  safeRequest<T>('head', url, undefined, options);

/** 检查响应状态 */
export function assertStatus(response: ApiResponse, expected: number, message?: string): void {
  if (response.status !== expected) {
    throw new Error(
      message || `期望状态码 ${expected}，实际得到 ${response.status}: ${response.error || ''}`
    );
  }
}

/** 检查响应成功 */
export function assertSuccess(response: ApiResponse, message?: string): void {
  if (!response.success) {
    throw new Error(message || `请求失败: ${response.error || '未知错误'}`);
  }
}

/** 检查字段存在 */
export function assertField<T>(obj: T, field: keyof T, message?: string): void {
  if (obj[field] === undefined || obj[field] === null) {
    throw new Error(message || `字段 ${String(field)} 不存在`);
  }
}
