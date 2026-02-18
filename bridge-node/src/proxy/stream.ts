/**
 * 原生 Node.js 流式代理
 * 绕过 Hono 框架，直接用 http.pipe() 实现真正的流式传输
 *
 * 解决问题：
 * - axios timeout 会在 30s 后杀掉大文件传输
 * - Hono c.body() 对流式响应支持不完善
 *
 * 参考 fntv-electron Go 代理的 DynamicProxy 实现
 */

import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { config } from '../config.ts';
import { parseAuthHeader } from '../middleware/auth.ts';
import { getSession } from '../services/session.ts';
import type { SessionData } from '../services/session.ts';
import { toFnosGuid } from '../mappers/id.ts';
import { fnosGetPlayInfo, fnosGetStream } from '../services/fnos.ts';
import { generateAuthxString } from '../fnos-client/signature.ts';
import { getOrCreateHlsSession, getCachedHlsSession } from '../services/hls-session.ts';

/** 从客户端透传到上游的请求头（同 Go 代理 PassthroughHeaders） */
const PASSTHROUGH_HEADERS = [
  'user-agent', 'accept', 'accept-language', 'accept-encoding',
  'cache-control', 'pragma', 'range', 'if-range',
  'if-modified-since', 'if-none-match',
];

/** 从上游转发到客户端的响应头 */
const FORWARD_HEADERS = [
  'content-type', 'content-length', 'content-range',
  'accept-ranges', 'cache-control', 'etag', 'last-modified',
];

/**
 * 检查路径是否是视频流请求
 * /Videos/:id/stream 或 /Videos/:id/stream.xxx
 */
export function isVideoStreamPath(pathname: string): boolean {
  return /^\/videos\/[^/]+\/stream(\.[^/]+)?$/i.test(pathname);
}

/**
 * 检查路径是否是 HLS 请求
 * /Videos/:mediaGuid/hls/:file
 */
export function isHlsPath(pathname: string): boolean {
  return /^\/videos\/[^/]+\/hls\/[^/]+$/i.test(pathname);
}

/**
 * 从请求中提取 session
 */
function getSessionFromReq(req: http.IncomingMessage, url: URL): SessionData | null {
  // X-Emby-Authorization header
  const embyAuth = req.headers['x-emby-authorization'] as string | undefined;
  if (embyAuth) {
    const parsed = parseAuthHeader(embyAuth);
    if (parsed?.token) return getSession(parsed.token);
  }

  // Authorization header
  const authHeader = req.headers['authorization'] as string | undefined;
  if (authHeader) {
    const parsed = parseAuthHeader(authHeader);
    if (parsed?.token) return getSession(parsed.token);
  }

  // Query param
  const apiKey = url.searchParams.get('api_key') || url.searchParams.get('ApiKey');
  if (apiKey) return getSession(apiKey);

  return null;
}

/**
 * 发起原生 HTTP 代理请求并 pipe 响应
 */
function pipeProxy(
  targetUrl: string,
  extraHeaders: Record<string, string>,
  skipVerify: boolean,
  clientReq: http.IncomingMessage,
  clientRes: http.ServerResponse,
  label: string,
) {
  const upstream = new URL(targetUrl);
  const isHttps = upstream.protocol === 'https:';
  const mod = isHttps ? https : http;

  const options: https.RequestOptions = {
    hostname: upstream.hostname,
    port: upstream.port || (isHttps ? 443 : 80),
    path: upstream.pathname + upstream.search,
    method: clientReq.method || 'GET',
    headers: extraHeaders,
    rejectUnauthorized: !skipVerify,
    // 只限制响应头超时（同 Go 代理 ResponseHeaderTimeout: 120s）
    timeout: 120_000,
  };

  const proxyReq = mod.request(options, (proxyRes) => {
    // 转发响应头
    const resHeaders: Record<string, string | string[]> = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
    };
    for (const h of FORWARD_HEADERS) {
      if (proxyRes.headers[h]) {
        resHeaders[h] = proxyRes.headers[h] as string;
      }
    }

    clientRes.writeHead(proxyRes.statusCode || 200, resHeaders);
    // 直接 pipe — 无 body 超时，真正的流式传输
    proxyRes.pipe(clientRes);

    proxyRes.on('error', (err) => {
      console.error(`[${label}] 上游响应错误:`, err.message);
      clientRes.end();
    });
  });

  proxyReq.on('timeout', () => {
    console.error(`[${label}] 上游响应头超时`);
    proxyReq.destroy();
    if (!clientRes.headersSent) {
      clientRes.writeHead(504);
      clientRes.end('Gateway Timeout');
    }
  });

  proxyReq.on('error', (err) => {
    console.error(`[${label}] 代理请求失败:`, err.message);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502);
      clientRes.end('Proxy error');
    }
  });

  // 客户端断开时销毁上游请求
  clientReq.on('close', () => {
    proxyReq.destroy();
  });

  proxyReq.end();
}

/**
 * 构建上游请求头：透传客户端头 + 额外头
 */
function buildUpstreamHeaders(
  clientReq: http.IncomingMessage,
  extra: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {};

  // 透传客户端头
  for (const h of PASSTHROUGH_HEADERS) {
    const val = clientReq.headers[h];
    if (val) headers[h] = Array.isArray(val) ? val[0] : val;
  }

  // 合并额外头（覆盖同名）
  Object.assign(headers, extra);

  return headers;
}

/**
 * 处理视频流请求（原生 Node.js）
 */
export async function handleVideoStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/videos\/([^/]+)\/stream/i);

  if (!match) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const itemId = match[1];
  const session = getSessionFromReq(req, url);

  if (!session) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end('{"error":"Unauthorized"}');
    return;
  }

  const fnosGuid = toFnosGuid(itemId);
  if (!fnosGuid) {
    res.writeHead(404);
    res.end('Item not found');
    return;
  }

  console.log(`[VIDEO] 流请求: itemId=${itemId}, fnosGuid=${fnosGuid}, range=${req.headers.range || 'none'}`);

  try {
    // 优先使用 mediaSourceId（用户选择的清晰度）
    let mediaGuid = url.searchParams.get('mediaSourceId');

    if (!mediaGuid) {
      const playInfoResult = await fnosGetPlayInfo(session.fnosServer, session.fnosToken, fnosGuid);
      if (!playInfoResult.success || !playInfoResult.data) {
        res.writeHead(404);
        res.end('Play info not found');
        return;
      }
      mediaGuid = playInfoResult.data.media_guid;
    }

    console.log(`[VIDEO] 使用 mediaGuid=${mediaGuid}`);

    // 获取流信息
    const streamResult = await fnosGetStream(
      session.fnosServer, session.fnosToken, mediaGuid,
      (req.headers['x-forwarded-for'] as string) || '127.0.0.1',
    );

    let targetUrl: string;
    const extra: Record<string, string> = {};
    let skipVerify = config.ignoreCert;

    if (streamResult.success && streamResult.data) {
      const sd = streamResult.data;
      const hasCloud = sd.cloud_storage_info && sd.direct_link_qualities?.length > 0;

      if (hasCloud) {
        targetUrl = sd.direct_link_qualities[0].url;
        skipVerify = false;
        if (sd.header?.Cookie?.length > 0) {
          extra['Cookie'] = sd.header.Cookie.join('; ');
        }
        const ct = sd.cloud_storage_info.cloud_storage_type;
        if (ct === 3) extra['User-Agent'] = 'trim_player';
        else if (ct === 1) extra['User-Agent'] = 'pan.baidu.com';
      } else {
        const mediaPath = `/v/api/v1/media/range/${mediaGuid}`;
        targetUrl = `${session.fnosServer}${mediaPath}`;
        extra['Authorization'] = session.fnosToken;
        extra['Cookie'] = 'mode=relay';
        extra['Authx'] = generateAuthxString(mediaPath);
      }
    } else {
      const mediaPath = `/v/api/v1/media/range/${mediaGuid}`;
      targetUrl = `${session.fnosServer}${mediaPath}`;
      extra['Authorization'] = session.fnosToken;
      extra['Cookie'] = 'mode=relay';
      extra['Authx'] = generateAuthxString(mediaPath);
    }

    const headers = buildUpstreamHeaders(req, extra);
    pipeProxy(targetUrl, headers, skipVerify, req, res, 'VIDEO');

  } catch (e: any) {
    console.error('[VIDEO] 视频代理失败:', e.message);
    if (!res.headersSent) {
      res.writeHead(502);
      res.end('Proxy error');
    }
  }
}

/**
 * 处理 HLS 请求（原生 Node.js）
 *
 * 流程：
 * 1. 首次 main.m3u8 请求 → 调用 play/play 启动转码会话
 * 2. play/play 返回 play_link 含 sessionGuid
 * 3. 用 sessionGuid 代理到飞牛 /v/media/{sessionGuid}/{file}
 */
export async function handleHlsStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/videos\/([^/]+)\/hls\/([^/]+)$/i);

  if (!match) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const mediaGuid = match[1];
  const file = match[2];

  // 认证：先尝试从请求中获取 session
  let session = getSessionFromReq(req, url);
  let fnosServer: string;
  let fnosToken: string;

  if (session) {
    fnosServer = session.fnosServer;
    fnosToken = session.fnosToken;
  } else {
    // 无认证信息（hls.js 的 .ts 段请求不带 api_key）
    // 从 HLS 会话缓存中获取凭据
    const cached = getCachedHlsSession(mediaGuid);
    if (!cached) {
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }
    fnosServer = cached.fnosServer;
    fnosToken = cached.fnosToken;
  }

  // 获取或创建 HLS 转码会话
  // 对于 .ts 段请求，会话应该已经在 m3u8 请求时创建了
  const hlsSession = session
    ? await getOrCreateHlsSession(fnosServer, fnosToken, mediaGuid)
    : getCachedHlsSession(mediaGuid);

  if (!hlsSession) {
    console.error(`[HLS] 无法获取转码会话: mediaGuid=${mediaGuid}`);
    res.writeHead(500);
    res.end('Failed to get transcoding session');
    return;
  }

  // 使用 sessionGuid 构建飞牛 HLS URL
  // main.m3u8 → preset.m3u8（飞牛用 preset.m3u8 作为主播放列表）
  const actualFile = file === 'main.m3u8' ? 'preset.m3u8' : file;
  const fnosPath = `/v/media/${hlsSession.sessionGuid}/${actualFile}`;
  const targetUrl = `${fnosServer}${fnosPath}`;

  console.log(`[HLS] 代理: mediaGuid=${mediaGuid} → sessionGuid=${hlsSession.sessionGuid}, file=${actualFile}`);

  const extra: Record<string, string> = {
    'Authorization': fnosToken,
    'Cookie': 'mode=relay',
    'Authx': generateAuthxString(fnosPath),
  };

  const headers = buildUpstreamHeaders(req, extra);

  // 设置 no-cache 头，防止浏览器缓存 HLS 响应（避免缓存 410 等错误）
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  pipeProxy(targetUrl, headers, config.ignoreCert, req, res, 'HLS');
}
