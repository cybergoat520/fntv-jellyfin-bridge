/**
 * Users 路由
 * 认证 + 用户信息
 */

import { Hono } from 'hono';
import { config } from '../config.ts';
import { generateServerId, toJellyfinId } from '../mappers/id.ts';
import { mapUserToJellyfin } from '../mappers/user.ts';
import { parseAuthHeader, requireAuth } from '../middleware/auth.ts';
import { fnosLogin, fnosGetUserInfo } from '../services/fnos.ts';
import { createSession, getSession } from '../services/session.ts';
import type { AuthenticationResult, SessionInfoDto, PlayStateInfo } from '../types/jellyfin.ts';

const users = new Hono();

const serverId = generateServerId(config.fnosServer);

/**
 * POST /Users/AuthenticateByName
 * Jellyfin 客户端用户名密码登录
 */
users.post('/AuthenticateByName', async (c) => {
  // 解析 Authorization 头获取客户端信息
  const authValue = c.req.header('Authorization') || c.req.header('X-Emby-Authorization');
  const authHeader = parseAuthHeader(authValue);

  // 解析请求体
  const body = await c.req.json<{ Username: string; Pw: string }>();
  const { Username: username, Pw: password } = body;

  if (!username || !password) {
    return c.json({ error: 'Username and password are required' }, 400);
  }

  // 调用飞牛登录
  const loginResult = await fnosLogin(config.fnosServer, username, password);
  if (!loginResult.success) {
    return c.json({ error: loginResult.error }, 401);
  }

  // 生成用户 ID
  const userId = toJellyfinId(`user_${username}`);

  // 创建会话
  const accessToken = createSession({
    fnosToken: loginResult.token,
    fnosServer: loginResult.server,
    userId,
    username,
    client: authHeader?.client || 'Unknown',
    deviceId: authHeader?.deviceId || 'unknown',
    deviceName: authHeader?.device || 'Unknown',
    appVersion: authHeader?.version || '0.0.0',
  });

  // 尝试获取用户详细信息
  let userInfo = { username, nickname: username, avatar: '', uid: 0 };
  try {
    const infoResult = await fnosGetUserInfo(loginResult.server, loginResult.token);
    if (infoResult.success && infoResult.data) {
      userInfo = { ...userInfo, ...infoResult.data };
    }
  } catch {
    // 获取用户信息失败不影响登录
  }

  const userDto = mapUserToJellyfin(userInfo, userId, serverId);

  const sessionInfo: SessionInfoDto = {
    PlayState: {
      CanSeek: false,
      IsPaused: false,
      IsMuted: false,
      RepeatMode: 'RepeatNone',
    } satisfies PlayStateInfo,
    Id: accessToken.slice(0, 8),
    UserId: userId,
    UserName: username,
    Client: authHeader?.client || 'Unknown',
    DeviceId: authHeader?.deviceId || 'unknown',
    DeviceName: authHeader?.device || 'Unknown',
    ApplicationVersion: authHeader?.version || '0.0.0',
    LastActivityDate: new Date().toISOString(),
    ServerId: serverId,
    IsActive: true,
    SupportsRemoteControl: false,
    HasCustomDeviceName: false,
  };

  const result: AuthenticationResult = {
    User: userDto,
    SessionInfo: sessionInfo,
    AccessToken: accessToken,
    ServerId: serverId,
  };

  return c.json(result);
});

/**
 * GET /Users/Me - 获取当前用户信息
 */
users.get('/Me', requireAuth(), async (c) => {
  const session = c.get('session') as ReturnType<typeof getSession>;
  if (!session) return c.json({ error: 'Unauthorized' }, 401);

  let userInfo = { username: session.username, nickname: session.username, avatar: '', uid: 0 };
  try {
    const infoResult = await fnosGetUserInfo(session.fnosServer, session.fnosToken);
    if (infoResult.success && infoResult.data) {
      userInfo = { ...userInfo, ...infoResult.data };
    }
  } catch {
    // 使用默认值
  }

  const userDto = mapUserToJellyfin(userInfo, session.userId, serverId);
  return c.json(userDto);
});

/**
 * GET /Users/:userId - 获取指定用户信息
 */
users.get('/:userId', requireAuth(), async (c) => {
  const session = c.get('session') as ReturnType<typeof getSession>;
  if (!session) return c.json({ error: 'Unauthorized' }, 401);

  let userInfo = { username: session.username, nickname: session.username, avatar: '', uid: 0 };
  try {
    const infoResult = await fnosGetUserInfo(session.fnosServer, session.fnosToken);
    if (infoResult.success && infoResult.data) {
      userInfo = { ...userInfo, ...infoResult.data };
    }
  } catch {
    // 使用默认值
  }

  const userDto = mapUserToJellyfin(userInfo, session.userId, serverId);
  return c.json(userDto);
});

/**
 * GET /Users - 获取用户列表（返回空列表，不支持公开用户列表）
 */
users.get('/', (c) => {
  return c.json([]);
});

export default users;
