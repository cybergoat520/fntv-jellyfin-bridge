/**
 * System 路由
 * /System/Info/Public, /System/Info, /System/Ping
 */

import { Hono } from 'hono';
import { config } from '../config.ts';
import { generateServerId } from '../mappers/id.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { PublicSystemInfo, SystemInfo } from '../types/jellyfin.ts';

const system = new Hono();

const serverId = generateServerId(config.fnosServer);

/** GET /System/Info/Public - 公开系统信息（无需认证） */
system.get('/Info/Public', (c) => {
  // 从请求头动态获取地址，避免返回 0.0.0.0
  const host = c.req.header('host') || `${config.host}:${config.port}`;
  const proto = c.req.header('x-forwarded-proto') || 'http';
  const info: PublicSystemInfo = {
    LocalAddress: `${proto}://${host}`,
    ServerName: config.serverName,
    Version: config.jellyfinVersion,
    ProductName: 'Jellyfin Server',
    OperatingSystem: '',
    Id: serverId,
    StartupWizardCompleted: true,
  };
  return c.json(info);
});

/** GET /System/Info - 完整系统信息（需要认证） */
system.get('/Info', requireAuth(), (c) => {
  const host = c.req.header('host') || `${config.host}:${config.port}`;
  const proto = c.req.header('x-forwarded-proto') || 'http';
  const info: SystemInfo = {
    LocalAddress: `${proto}://${host}`,
    ServerName: config.serverName,
    Version: config.jellyfinVersion,
    ProductName: 'Jellyfin Server',
    OperatingSystem: '',
    Id: serverId,
    StartupWizardCompleted: true,
    OperatingSystemDisplayName: 'fnos-bridge',
    HasPendingRestart: false,
    IsShuttingDown: false,
    SupportsLibraryMonitor: false,
    WebSocketPortNumber: config.port,
    CanSelfRestart: false,
    CanLaunchWebBrowser: false,
    HasUpdateAvailable: false,
    TranscodingTempPath: '',
    LogPath: '',
    InternalMetadataPath: '',
    CachePath: '',
  };
  return c.json(info);
});

/** GET/POST /System/Ping - 心跳 */
system.get('/Ping', (c) => c.json(config.serverName));
system.post('/Ping', (c) => c.json(config.serverName));

export default system;
