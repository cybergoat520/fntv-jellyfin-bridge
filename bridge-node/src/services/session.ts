/**
 * 会话管理服务
 * 管理 Jellyfin AccessToken → 飞牛凭据的映射
 */

import { randomUUID } from 'node:crypto';

export interface SessionData {
  /** 飞牛 token */
  fnosToken: string;
  /** 飞牛服务器地址 */
  fnosServer: string;
  /** 用户 ID (Jellyfin UUID) */
  userId: string;
  /** 用户名 */
  username: string;
  /** 客户端信息 */
  client: string;
  deviceId: string;
  deviceName: string;
  appVersion: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后活动时间 */
  lastActivity: number;
}

/** AccessToken → SessionData */
const sessions = new Map<string, SessionData>();

/**
 * 创建新会话，返回 Jellyfin AccessToken
 */
export function createSession(data: Omit<SessionData, 'createdAt' | 'lastActivity'>): string {
  const accessToken = randomUUID().replace(/-/g, '');
  const now = Date.now();
  sessions.set(accessToken, {
    ...data,
    createdAt: now,
    lastActivity: now,
  });
  return accessToken;
}

/**
 * 根据 AccessToken 获取会话
 */
export function getSession(accessToken: string): SessionData | null {
  const session = sessions.get(accessToken);
  if (session) {
    session.lastActivity = Date.now();
  }
  return session ?? null;
}

/**
 * 删除会话
 */
export function removeSession(accessToken: string): boolean {
  return sessions.delete(accessToken);
}

/**
 * 获取所有活跃会话数
 */
export function getSessionCount(): number {
  return sessions.size;
}
