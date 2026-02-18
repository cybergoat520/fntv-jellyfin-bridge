/**
 * 飞牛影视 HTTP 客户端
 * 内置 Authx 签名、重定向处理、签名错误重试
 */

import axios from 'axios';
import type { AxiosInstance, AxiosResponse } from 'axios';
import * as https from 'node:https';
import { generateAuthxString, generateNonce } from './signature.ts';

export type HttpMethod = 'get' | 'post' | 'put' | 'delete';

export interface FnosApiResponse<T = any> {
  code: number;
  msg: string;
  data: T;
}

export interface RequestResult<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  moveUrl?: string;
  certificateError?: boolean;
}

export interface FnosClientOptions {
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  ignoreCert?: boolean;
}

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_DELAY = 100;

export class FnosClient {
  private server: string;
  private token: string;
  private options: Required<FnosClientOptions>;
  private http: AxiosInstance;

  constructor(server: string, token = '', options: FnosClientOptions = {}) {
    this.server = server;
    this.token = token;
    this.options = {
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryDelay: options.retryDelay ?? DEFAULT_RETRY_DELAY,
      ignoreCert: options.ignoreCert ?? false,
    };

    this.http = axios.create({
      timeout: this.options.timeout,
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      httpsAgent: new https.Agent({
        rejectUnauthorized: !this.options.ignoreCert,
        keepAlive: true,
      }),
    });
  }

  setToken(token: string): void {
    this.token = token;
  }

  getServer(): string {
    return this.server;
  }

  getToken(): string {
    return this.token;
  }

  async request<T = any>(
    method: HttpMethod,
    url: string,
    data?: any,
  ): Promise<RequestResult<T>> {
    return this.requestInternal<T>(this.server, method, url, data, this.options.maxRetries);
  }

  private async requestInternal<T>(
    baseUrl: string,
    method: HttpMethod,
    url: string,
    data: any,
    retriesLeft: number,
  ): Promise<RequestResult<T>> {
    if ((method === 'post' || method === 'put') && data) {
      data = { ...data, nonce: generateNonce() };
    }

    const authx = generateAuthxString(url, data);
    const fullUrl = baseUrl + url;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cookie': 'mode=relay',
      'Authx': authx,
    };
    if (this.token) {
      headers['Authorization'] = this.token;
    }

    console.log(`[FNOS] ${method.toUpperCase()} ${fullUrl} (retries=${retriesLeft})`);

    for (let attempt = 0; attempt <= retriesLeft; attempt++) {
      try {
        let response: AxiosResponse<FnosApiResponse<T>>;
        const config = { headers };

        switch (method) {
          case 'get':
            response = await this.http.get(fullUrl, config);
            break;
          case 'post':
            response = await this.http.post(fullUrl, data, config);
            break;
          case 'put':
            response = await this.http.put(fullUrl, data, config);
            break;
          case 'delete':
            response = await this.http.delete(fullUrl, config);
            break;
          default:
            return { success: false, message: `不支持的方法: ${method}` };
        }

        // 处理重定向
        if ([301, 302, 307, 308].includes(response.status)) {
          const location = response.headers.location;
          if (location) {
            let newBaseUrl = baseUrl;
            let newPath = location;
            if (location.startsWith('http')) {
              const parsed = new URL(location);
              newBaseUrl = `${parsed.protocol}//${parsed.host}`;
              newPath = parsed.pathname + parsed.search;
            }
            const result = await this.requestInternal<T>(
              newBaseUrl, method, newPath, data, retriesLeft - 1,
            );
            return { ...result, moveUrl: result.moveUrl || newBaseUrl };
          }
        }

        // 非 JSON 响应
        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('application/json')) {
          return { success: true, data: response.data as any };
        }

        const res = response.data;

        // 签名错误重试
        if (res.code === 5000 && res.msg === 'invalid sign') {
          if (attempt >= retriesLeft) {
            return { success: false, message: `签名错误，已重试 ${attempt + 1} 次` };
          }
          await this.delay(this.options.retryDelay);
          continue;
        }

        if (res.code !== 0) {
          return { success: false, message: res.msg || `业务错误 code=${res.code}` };
        }

        return { success: true, data: res.data };

      } catch (error: any) {
        console.log(`[FNOS] 请求失败 (attempt ${attempt + 1}/${retriesLeft + 1}): ${error.code || ''} ${error.message}`);
        if (this.isCertificateError(error)) {
          return { success: false, message: error.message, certificateError: true };
        }
        if (attempt >= retriesLeft) {
          return { success: false, message: error.message || '请求失败' };
        }
        await this.delay(this.options.retryDelay);
      }
    }

    return { success: false, message: '重试逻辑异常' };
  }

  private isCertificateError(error: any): boolean {
    const code = error.code || '';
    const msg = error.message || '';
    return (
      code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
      code === 'CERT_HAS_EXPIRED' ||
      code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
      code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
      code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
      msg.includes('certificate') ||
      msg.includes('self signed') ||
      msg.includes('self-signed')
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
