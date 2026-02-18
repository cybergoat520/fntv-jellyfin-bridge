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
 * 从请求中提取 token
 * 支持多种来源：Authorization header、X-Emby-Authorization header、api_key query param
 */
function extractToken(c: Context): { token: string | undefined; parsed: JellyfinAuthHeader | null } {
  const authValue = c.req.header('Authorization') || c.req.header('X-Emby-Authorization');
  const parsed = parseAuthHeader(authValue);

  // 优先从 header 中获取 token
  if (parsed?.token) {
    return { token: parsed.token, parsed };
  }

  // 其次从 query parameter 获取（jellyfin-web 使用 api_key）
  const apiKey = c.req.query('api_key') || c.req.query('ApiKey');
  if (apiKey) {
    return { token: apiKey, parsed };
  }

  // 也支持 X-MediaBrowser-Token header
  const xToken = c.req.header('X-MediaBrowser-Token') || c.req.header('X-Emby-Token');
  if (xToken) {
    return { token: xToken, parsed };
  }

  // 如果 Authorization header 不是 MediaBrowser 格式，可能直接是 token
  if (authValue && !parsed) {
    // 可能是 "Bearer xxx" 或直接是 token
    const bearerMatch = authValue.match(/^Bearer\s+(.+)$/i);
    const rawToken = bearerMatch ? bearerMatch[1] : authValue;
    return { token: rawToken, parsed: null };
  }

  return { token: undefined, parsed };
}

/**
 * 认证中间件 - 需要有效会话
 * 用于需要登录的端点
 */
export function requireAuth() {
  return async (c: Context, next: Next) => {
    const { token, parsed } = extractToken(c);

    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const session = getSession(token);
    if (!session) {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }

    c.set('session', session);
    if (parsed) c.set('authHeader', parsed);
    await next();
  };
}

/**
 * 可选认证中间件
 * 解析认证信息但不强制要求
 */
export function optionalAuth() {
  return async (c: Context, next: Next) => {
    const { token, parsed } = extractToken(c);

    if (token) {
      const session = getSession(token);
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
