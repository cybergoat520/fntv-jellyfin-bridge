/**
 * Jellyfin 认证中间件
 * 解析 Authorization 头，提取会话信息
 */

import type { Context, Next } from 'hono';
import { getSession, type SessionData } from '../services/session.ts';
import type { JellyfinAuthHeader } from '../types/jellyfin.ts';

/** 扩展 Hono Context 的变量类型 */
export type AuthVariables = {
  session: SessionData;
  authHeader: JellyfinAuthHeader;
};

/**
 * 解析 Jellyfin MediaBrowser Authorization 头
 * 格式: MediaBrowser Client="xxx", Device="xxx", DeviceId="xxx", Version="xxx", Token="xxx"
 */
export function parseAuthHeader(header: string | undefined): JellyfinAuthHeader | null {
  if (!header) return null;

  const prefix = 'mediabrowser ';
  const raw = header.toLowerCase().startsWith(prefix)
    ? header.slice(prefix.length)
    : header;

  const params: Record<string, string> = {};
  // 匹配 Key="Value" 对
  const regex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    params[match[1].toLowerCase()] = match[2];
  }

  if (!params.client && !params.device) return null;

  return {
    client: params.client || 'Unknown',
    device: params.device || 'Unknown',
    deviceId: params.deviceid || 'unknown',
    version: params.version || '0.0.0',
    token: params.token,
  };
}

/**
 * 认证中间件 - 需要有效会话
 * 用于需要登录的端点
 */
export function requireAuth() {
  return async (c: Context, next: Next) => {
    const authValue = c.req.header('Authorization') || c.req.header('X-Emby-Authorization');
    const parsed = parseAuthHeader(authValue);

    if (!parsed?.token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const session = getSession(parsed.token);
    if (!session) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    c.set('session', session);
    c.set('authHeader', parsed);
    await next();
  };
}

/**
 * 可选认证中间件
 * 解析认证信息但不强制要求
 */
export function optionalAuth() {
  return async (c: Context, next: Next) => {
    const authValue = c.req.header('Authorization') || c.req.header('X-Emby-Authorization');
    const parsed = parseAuthHeader(authValue);

    if (parsed?.token) {
      const session = getSession(parsed.token);
      if (session) {
        c.set('session', session);
      }
    }
    if (parsed) {
      c.set('authHeader', parsed);
    }

    await next();
  };
}
