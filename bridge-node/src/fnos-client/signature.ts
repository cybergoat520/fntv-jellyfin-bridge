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

const API_KEY = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh';
const API_SECRET = '16CCEB3D-AB42-077D-36A1-F355324E4237';

export function md5(text: string): string {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

export function generateNonce(min = 100000, max = 1000000): string {
  return Math.floor(Math.random() * (max - min) + min).toString();
}

export interface AuthxParams {
  nonce: string;
  timestamp: number;
  sign: string;
}

export function generateAuthx(url: string, data?: object): AuthxParams {
  const nonce = generateNonce();
  const timestamp = Date.now();
  const dataJson = data ? JSON.stringify(data) : '';
  const dataMd5 = md5(dataJson);
  const signStr = [API_KEY, url, nonce, timestamp.toString(), dataMd5, API_SECRET].join('_');
  return { nonce, timestamp, sign: md5(signStr) };
}

export function generateAuthxString(url: string, data?: object): string {
  const { nonce, timestamp, sign } = generateAuthx(url, data);
  return `nonce=${nonce}&timestamp=${timestamp}&sign=${sign}`;
}
