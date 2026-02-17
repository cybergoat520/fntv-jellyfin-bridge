/**
 * 飞牛影视 Authx 签名计算
 *
 * 签名算法：
 *   sign = MD5(api_key + "_" + url + "_" + nonce + "_" + timestamp + "_" + MD5(body) + "_" + api_secret)
 *
 * 输出格式：
 *   nonce={nonce}&timestamp={timestamp}&sign={sign}
 */

import * as crypto from 'node:crypto';
import type { AuthxParams } from './types.ts';

// 飞牛影视 API 密钥（所有飞牛实例通用）
const API_KEY = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh';
const API_SECRET = '16CCEB3D-AB42-077D-36A1-F355324E4237';

/** 计算 MD5 哈希 */
export function md5(text: string): string {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

/** 生成 6 位随机数字字符串 */
export function generateNonce(min = 100000, max = 1000000): string {
  return Math.floor(Math.random() * (max - min) + min).toString();
}

/**
 * 生成 Authx 签名参数
 * @param url - API 路径，例如 /v/api/v1/login
 * @param data - 请求体（POST/PUT 时传入）
 */
export function generateAuthx(url: string, data?: object): AuthxParams {
  const nonce = generateNonce();
  const timestamp = Date.now();
  const dataJson = data ? JSON.stringify(data) : '';
  const dataMd5 = md5(dataJson);

  const signStr = [API_KEY, url, nonce, timestamp.toString(), dataMd5, API_SECRET].join('_');

  return {
    nonce,
    timestamp,
    sign: md5(signStr),
  };
}

/**
 * 生成 Authx 签名字符串（直接用于 Header）
 * @param url - API 路径
 * @param data - 请求体
 * @returns 格式：nonce={nonce}&timestamp={timestamp}&sign={sign}
 */
export function generateAuthxString(url: string, data?: object): string {
  const { nonce, timestamp, sign } = generateAuthx(url, data);
  return `nonce=${nonce}&timestamp=${timestamp}&sign=${sign}`;
}
