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
import { getOrCreateHlsSession, getCachedHlsSession, clearHlsSession } from '../services/hls-session.ts';

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
  force200: boolean = false,
  on410Retry?: () => void,
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

    // 飞牛返回 application/octet-stream，浏览器 <video> 标签需要正确的 MIME 类型
    if (label === 'VIDEO' && (!resHeaders['content-type'] || resHeaders['content-type'] === 'application/octet-stream')) {
      // 从请求 URL 的扩展名推断 MIME 类型
      const ext = (clientReq.url || '').match(/\.(\w+)(\?|$)/)?.[1]?.toLowerCase();
      const mimeMap: Record<string, string> = {
        mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm',
        avi: 'video/x-msvideo', mov: 'video/quicktime', ts: 'video/mp2t',
      };
      resHeaders['content-type'] = mimeMap[ext || ''] || 'video/mp4';
    }

    // 当我们自动添加了 Range 头（客户端没发 Range），上游返回 206
    // 浏览器 <video> 标签期望收到 200，否则无法播放
    let statusCode = proxyRes.statusCode || 200;
    if (force200 && statusCode === 206) {
      statusCode = 200;
      delete resHeaders['content-range'];
      // content-length 应该是完整文件大小，从 content-range 解析
      const cr = proxyRes.headers['content-range'];
      if (cr) {
        const totalMatch = cr.match(/\/(\d+)$/);
        if (totalMatch) {
          resHeaders['content-length'] = totalMatch[1];
        }
      }
      console.log(`[${label}] 206→200 转换 (客户端未发 Range)`);
    }

    console.log(`[${label}] 上游响应: ${statusCode}, content-type=${resHeaders['content-type']}, content-length=${resHeaders['content-length'] || 'none'}, content-range=${resHeaders['content-range'] || 'none'}, accept-ranges=${resHeaders['accept-ranges'] || 'none'}`);

    // 410 Gone → 转码会话过期，触发重试
    if (statusCode === 410 && on410Retry) {
      console.log(`[${label}] 410 Gone → 触发会话重建重试`);
      proxyRes.resume(); // 消费掉响应体
      on410Retry();
      return;
    }

    clientRes.writeHead(statusCode, resHeaders);
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
    const clientHadRange = !!headers['range'];
    // 飞牛 media/range API 要求必须有 Range 头，否则返回 416
    if (!clientHadRange) {
      headers['range'] = 'bytes=0-';
    }
    pipeProxy(targetUrl, headers, skipVerify, req, res, 'VIDEO', !clientHadRange);

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

  console.log(`[HLS] 代理: mediaGuid=${mediaGuid} → sessionGuid=${hlsSession.sessionGuid}, file=${actualFile}, url=${targetUrl}`);

  const extra: Record<string, string> = {
    'Authorization': fnosToken,
    'Cookie': 'mode=relay',
    'Authx': generateAuthxString(fnosPath),
  };

  const headers = buildUpstreamHeaders(req, extra);

  // 设置 no-cache 头，防止浏览器缓存 HLS 响应（避免缓存 410 等错误）
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  // subtitle.m3u8 — 生成字幕分片播放列表
  if (file === 'subtitle.m3u8') {
    return handleSubtitleM3u8(req, res, fnosServer, fnosToken, hlsSession.sessionGuid);
  }

  // preset.m3u8 — 注入字幕轨道
  if (actualFile === 'preset.m3u8') {
    return handlePresetM3u8(req, res, targetUrl, headers, mediaGuid, fnosServer, fnosToken, hlsSession.sessionGuid);
  }

  // 410 重试：清除旧会话 → 重建 → 用新 sessionGuid 重新代理
  const on410Retry = session ? async () => {
    console.log(`[HLS] 410 重试: 清除旧会话 mediaGuid=${mediaGuid}`);
    clearHlsSession(mediaGuid);

    try {
      const newSession = await getOrCreateHlsSession(fnosServer, fnosToken, mediaGuid);
      if (!newSession) {
        console.error(`[HLS] 410 重试失败: 无法重建会话`);
        if (!res.headersSent) {
          res.writeHead(502);
          res.end('Failed to rebuild HLS session');
        }
        return;
      }

      const newFile = file === 'main.m3u8' ? 'preset.m3u8' : file;
      const newPath = `/v/media/${newSession.sessionGuid}/${newFile}`;
      const newUrl = `${fnosServer}${newPath}`;

      console.log(`[HLS] 410 重试: 新会话 sessionGuid=${newSession.sessionGuid}`);

      const retryExtra: Record<string, string> = {
        'Authorization': fnosToken,
        'Cookie': 'mode=relay',
        'Authx': generateAuthxString(newPath),
      };
      const retryHeaders = buildUpstreamHeaders(req, retryExtra);

      // 重试不再带 on410Retry，避免无限循环
      if (file === 'preset.m3u8') {
        handlePresetM3u8(req, res, newUrl, retryHeaders, mediaGuid);
      } else {
        pipeProxy(newUrl, retryHeaders, config.ignoreCert, req, res, 'HLS-RETRY');
      }
    } catch (e: any) {
      console.error(`[HLS] 410 重试异常:`, e.message);
      if (!res.headersSent) {
        res.writeHead(502);
        res.end('HLS retry failed');
      }
    }
  } : undefined;

  pipeProxy(targetUrl, headers, config.ignoreCert, req, res, 'HLS', false, on410Retry);
}

/**
 * 处理 preset.m3u8 — 注入字幕轨道
 */
async function handlePresetM3u8(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  targetUrl: string,
  headers: Record<string, string>,
  mediaGuid: string,
  fnosServer: string,
  fnosToken: string,
  sessionGuid: string,
) {
  try {
    const upstreamRes = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const client = targetUrl.startsWith('https:') ? https : http;
      const upstreamReq = client.get(targetUrl, { headers }, resolve);
      upstreamReq.on('error', reject);
    });

    if (upstreamRes.statusCode !== 200) {
      res.writeHead(upstreamRes.statusCode || 502);
      upstreamRes.pipe(res);
      return;
    }

    let m3u8Content = '';
    upstreamRes.setEncoding('utf8');
    upstreamRes.on('data', (chunk: string) => { m3u8Content += chunk; });
    upstreamRes.on('end', () => {
      // 注入字幕轨道引用
      const subtitleLine = `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Subtitle",DEFAULT=YES,AUTOSELECT=YES,FORCED=NO,LANGUAGE="und",URI="subtitle.m3u8"`;
      m3u8Content = m3u8Content.replace('#EXTM3U', `#EXTM3U\n${subtitleLine}`);

      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(m3u8Content);
    });
  } catch (e: any) {
    console.error(`[HLS] preset.m3u8 处理失败:`, e.message);
    res.writeHead(502);
    res.end('Failed to process m3u8');
  }
}

/**
 * 处理 subtitle.m3u8 — 生成字幕分片播放列表
 */
async function handleSubtitleM3u8(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  fnosServer: string,
  fnosToken: string,
  sessionGuid: string,
) {
  const presetPath = `/v/media/${sessionGuid}/preset.m3u8`;
  const targetUrl = `${fnosServer}${presetPath}`;
  const authx = generateAuthxString(presetPath);

  const headers: Record<string, string> = {
    'Authorization': fnosToken,
    'Cookie': 'mode=relay',
    'Authx': authx,
  };

  try {
    const upstreamRes = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const client = targetUrl.startsWith('https:') ? https : http;
      const upstreamReq = client.get(targetUrl, { headers }, resolve);
      upstreamReq.on('error', reject);
    });

    if (upstreamRes.statusCode !== 200) {
      res.writeHead(upstreamRes.statusCode || 502);
      upstreamRes.pipe(res);
      return;
    }

    let m3u8Content = '';
    upstreamRes.setEncoding('utf8');
    upstreamRes.on('data', (chunk: string) => { m3u8Content += chunk; });
    upstreamRes.on('end', () => {
      // 把 .ts 替换成 .vtt
      const subtitleM3u8 = m3u8Content.replace(/^(\d+\.ts)$/gm, (match) => match.replace('.ts', '.vtt'));

      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      });
      res.end(subtitleM3u8);
    });
  } catch (e: any) {
    console.error(`[HLS] subtitle.m3u8 生成失败:`, e.message);
    res.writeHead(502);
    res.end('Failed to generate subtitle m3u8');
  }
}
