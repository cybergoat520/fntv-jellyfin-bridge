/**
 * fnos-bridge 入口
 * 启动 HTTP + WebSocket 服务器
 * 
 * 视频流和 HLS 请求在 http.Server 层拦截，绕过 Hono 框架
 * 使用原生 Node.js pipe() 实现真正的流式传输
 */

import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';
import app from './server.ts';
import { config } from './config.ts';
import { isHlsPath, handleHlsStream } from './proxy/stream.ts';

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
  overrideGlobalObjects: false,
}, (info) => {
  console.log(`✅ 服务已启动: http://${info.address}:${info.port}`);
  console.log('等待 Jellyfin 客户端连接...\n');
});

// 设置服务器超时：不限制请求超时（大文件流式传输）
const nativeServer = server as any;
nativeServer.requestTimeout = 0;
nativeServer.headersTimeout = 120_000;
nativeServer.timeout = 0; // 不限制 socket 超时

// 在 Hono 之前拦截视频流和 HLS 请求
// @hono/node-server 的 serve() 返回 http.Server，其 'request' 事件已被绑定

// 保存原始 request listener
const listeners = nativeServer.listeners('request');
nativeServer.removeAllListeners('request');

// 添加拦截器：HLS 走原生代理，视频流和其他请求走 Hono
nativeServer.on('request', (req: any, res: any) => {
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // HLS 请求 → 原生流式代理
  if (isHlsPath(pathname)) {
    handleHlsStream(req, res).catch((e: any) => {
      console.error('[HLS] 未捕获异常:', e.message);
      if (!res.headersSent) { res.writeHead(500); res.end('Internal error'); }
    });
    return;
  }

  // 其他请求 → Hono 处理
  for (const listener of listeners) {
    listener.call(nativeServer, req, res);
  }
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
nativeServer.on('upgrade', (request: any, socket: any, head: any) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  if (url.pathname === '/socket') {
    wss.handleUpgrade(request, socket, head, (ws: any) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});
