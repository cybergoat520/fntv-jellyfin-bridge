/**
 * HLS 转码代理路由
 * 代理飞牛的 HLS 转码流（用于浏览器不支持的音频编解码器如 EAC3/DTS）
 * 飞牛 HLS URL: /v/media/{mediaGuid}/main.m3u8
 */

import { Hono } from 'hono';
import axios from 'axios';
import * as https from 'node:https';
import { config } from '../config.ts';
import { optionalAuth } from '../middleware/auth.ts';
import { generateAuthxString } from '../fnos-client/signature.ts';
import { getSession } from '../services/session.ts';
import type { SessionData } from '../services/session.ts';

const hls = new Hono();

/**
 * 从请求中获取 session（支持 query param 和 header）
 */
function getSessionFromRequest(c: any): SessionData | null {
  // 先尝试从中间件获取
  const session = c.get('session') as SessionData | undefined;
  if (session) return session;

  // 从 query param 获取 token
  const apiKey = c.req.query('api_key') || c.req.query('ApiKey');
  if (apiKey) {
    return getSession(apiKey);
  }

  return null;
}

/**
 * 代理 HLS 请求到飞牛服务器
 * GET /videos/:mediaGuid/hls/:file
 * 匹配: main.m3u8, preset.m3u8, subtitle.m3u8, *.ts 等
 */
hls.get('/:mediaGuid/hls/:file', optionalAuth(), async (c) => {
  const mediaGuid = c.req.param('mediaGuid');
  const file = c.req.param('file');
  const session = getSessionFromRequest(c);

  if (!session) {
    return c.body('Unauthorized', 401);
  }

  // 飞牛 HLS URL: /v/media/{mediaGuid}/{file}
  const fnosPath = `/v/media/${mediaGuid}/${file}`;
  const targetUrl = `${session.fnosServer}${fnosPath}`;

  console.log(`[HLS] 代理: ${fnosPath}`);

  try {
    const headers: Record<string, string> = {
      'Authorization': session.fnosToken,
      'Cookie': 'mode=relay',
      'Authx': generateAuthxString(fnosPath),
    };

    const response = await axios({
      method: 'get',
      url: targetUrl,
      headers,
      responseType: file.endsWith('.m3u8') ? 'text' : 'stream',
      timeout: 30000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: !config.ignoreCert,
      }),
    });

    // 转发响应头
    if (file.endsWith('.m3u8')) {
      c.header('Content-Type', 'application/vnd.apple.mpegurl');
      // m3u8 内容中的 ts 分片 URL 可能是相对路径，需要保持相对
      return c.body(response.data, response.status);
    } else {
      // ts 分片
      c.header('Content-Type', 'video/mp2t');
      const forwardHeaders = ['content-length', 'content-range', 'accept-ranges'];
      for (const h of forwardHeaders) {
        if (response.headers[h]) {
          c.header(h, response.headers[h] as string);
        }
      }
      return c.body(response.data, response.status);
    }
  } catch (e: any) {
    console.error(`[HLS] 代理失败: ${e.message}`);
    return c.body('HLS proxy error', 502);
  }
});

export default hls;
