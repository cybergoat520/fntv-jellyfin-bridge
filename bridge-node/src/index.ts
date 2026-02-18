/**
 * fnos-bridge 入口
 * 启动 HTTP 服务器
 */

import { serve } from '@hono/node-server';
import app from './server.ts';
import { config } from './config.ts';

console.log(`
╔══════════════════════════════════════╗
║         fnos-bridge v0.1.0          ║
║   飞牛影视 → Jellyfin 转换层        ║
╚══════════════════════════════════════╝
`);
console.log(`飞牛服务器: ${config.fnosServer}`);
console.log(`监听地址:   http://${config.host}:${config.port}`);
console.log(`服务器名称: ${config.serverName}`);
console.log(`伪装版本:   Jellyfin ${config.jellyfinVersion}`);
console.log('');

serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
}, (info) => {
  console.log(`✅ 服务已启动: http://${info.address}:${info.port}`);
  console.log('等待 Jellyfin 客户端连接...\n');
});
