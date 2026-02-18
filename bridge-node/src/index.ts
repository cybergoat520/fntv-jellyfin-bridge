/**
 * fnos-bridge 入口
 * 启动 HTTP + WebSocket 服务器
 */

import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';
import app from './server.ts';
import { config } from './config.ts';

console.log(`
╔══════════════════════════════════════╗
║         fnos-bridge v0.1.0           ║
║   飞牛影视 → Jellyfin 转换层          ║
╚══════════════════════════════════════╝
`);
console.log(`飞牛服务器: ${config.fnosServer}`);
console.log(`监听地址:   http://${config.host}:${config.port}`);
console.log(`服务器名称: ${config.serverName}`);
console.log(`伪装版本:   Jellyfin ${config.jellyfinVersion}`);
console.log('');

const server = serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
}, (info) => {
  console.log(`✅ 服务已启动: http://${info.address}:${info.port}`);
  console.log('等待 Jellyfin 客户端连接...\n');
});

// WebSocket 服务器 — jellyfin-web 需要 /socket 端点
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws: WebSocket) => {
  // 发送初始消息，告知客户端连接成功
  ws.send(JSON.stringify({
    MessageType: 'ForceKeepAlive',
    Data: 60,
  }));

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());
      // 处理客户端消息
      if (msg.MessageType === 'KeepAlive') {
        // 心跳，不需要响应
      } else if (msg.MessageType === 'SessionsStart' || msg.MessageType === 'ScheduledTasksInfoStart') {
        // 会话/任务订阅，发送空数据
        ws.send(JSON.stringify({
          MessageType: msg.MessageType.replace('Start', ''),
          Data: [],
        }));
      }
    } catch {
      // 忽略解析错误
    }
  });

  ws.on('error', () => {});
});

// 拦截 HTTP upgrade 请求，将 /socket 路径升级为 WebSocket
(server as any).on('upgrade', (request: any, socket: any, head: any) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  if (url.pathname === '/socket') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});
