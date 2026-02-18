/**
 * 会话管理服务
 * 管理 Jellyfin AccessToken → 飞牛凭据的映射
 * 支持文件持久化，重启不丢失会话
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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

/** 持久化文件路径 */
const SESSION_FILE = path.resolve(import.meta.dirname || '.', '..', '.sessions.json');

/** 从文件加载会话 */
function loadSessions(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      for (const [key, value] of Object.entries(data)) {
        sessions.set(key, value as SessionData);
      }
      console.log(`[SESSION] 已恢复 ${sessions.size} 个会话`);
    }
  } catch {
    // 文件损坏或不存在，忽略
  }
}

/** 保存会话到文件 */
function saveSessions(): void {
  try {
    const data: Record<string, SessionData> = {};
    for (const [key, value] of sessions) {
      data[key] = value;
    }
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
  } catch {
    // 写入失败，忽略
  }
}

// 启动时加载
loadSessions();

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
  saveSessions();
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
  const result = sessions.delete(accessToken);
  if (result) saveSessions();
  return result;
}

/**
 * 获取所有活跃会话数
 */
export function getSessionCount(): number {
  return sessions.size;
}
