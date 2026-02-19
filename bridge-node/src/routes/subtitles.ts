/**
 * 字幕路由
 * 代理飞牛影视的字幕文件
 */

import { Hono } from 'hono';
import axios from 'axios';
import { config } from '../config.ts';
import { requireAuth, extractToken } from '../middleware/auth.ts';
import { optionalAuth } from '../middleware/auth.ts';
import type { SessionData } from '../services/session.ts';
import { generateAuthxString } from '../fnos-client/signature.ts';
import { getSubtitleGuid } from '../mappers/media.ts';

const subtitles = new Hono();

/**
 * GET /Videos/:itemId/:mediaSourceId/Subtitles/:index/Stream.:format
 * GET /Videos/:itemId/:mediaSourceId/Subtitles/:index/:startPositionTicks/Stream.:format
 * 字幕文件代理
 */
subtitles.get('/:itemId/:mediaSourceId/Subtitles/:index/*', optionalAuth(), handleSubtitle);

async function handleSubtitle(c: any) {
  const session = c.get('session') as SessionData | undefined;
  const mediaSourceId = c.req.param('mediaSourceId');
  const index = parseInt(c.req.param('index'), 10);
  // 从路径末尾提取格式：Stream.subrip → subrip
  const pathParts = c.req.path.split('/');
  const lastPart = pathParts[pathParts.length - 1] || '';
  const format = lastPart.includes('.') ? lastPart.split('.').pop() || 'srt' : 'srt';

  // 通过 index → guid 映射找到飞牛字幕 guid
  const subtitleGuid = getSubtitleGuid(mediaSourceId, index);
  if (!subtitleGuid) {
    console.error(`[SUBTITLE] 未找到字幕映射: mediaSourceId=${mediaSourceId}, index=${index}`);
    return c.body('Subtitle not found', 404);
  }

  // 获取认证信息（优先 session，其次 api_key）
  let server = session?.fnosServer || config.fnosServer;
  let token = session?.fnosToken || '';
  if (!token) {
    const { token: apiKey } = extractToken(c);
    if (apiKey) {
      // 从 session store 获取
      const { getSession } = await import('../services/session.ts');
      const sess = getSession(apiKey);
      if (sess) {
        server = sess.fnosServer;
        token = sess.fnosToken;
      }
    }
  }

  const url = `/v/api/v1/subtitle/dl/${subtitleGuid}`;
  const fullUrl = `${server}${url}`;

  try {
    const authx = generateAuthxString(url);
    const response = await axios.get(fullUrl, {
      headers: {
        'Authorization': token,
        'Cookie': 'mode=relay',
        'Authx': authx,
      },
      responseType: 'arraybuffer',
      timeout: 15000,
    });

    const contentTypeMap: Record<string, string> = {
      srt: 'text/plain; charset=utf-8',
      subrip: 'text/plain; charset=utf-8',
      ass: 'text/plain; charset=utf-8',
      ssa: 'text/plain; charset=utf-8',
      vtt: 'text/vtt; charset=utf-8',
      sub: 'text/plain; charset=utf-8',
    };

    c.header('Content-Type', contentTypeMap[format] || 'application/octet-stream');
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(response.data);
  } catch (e: any) {
    console.error('字幕代理失败:', e.message);
    return c.body('Subtitle not found', 404);
  }
}

export default subtitles;
