/**
 * 字幕路由
 * 代理飞牛影视的字幕文件
 */

import { Hono } from 'hono';
import axios from 'axios';
import { config } from '../config.ts';
import { requireAuth } from '../middleware/auth.ts';
import type { SessionData } from '../services/session.ts';
import { generateAuthxString } from '../fnos-client/signature.ts';

const subtitles = new Hono();

/**
 * GET /Videos/:itemId/:mediaSourceId/Subtitles/:index/Stream.:format
 * GET /Videos/:itemId/:mediaSourceId/Subtitles/:index/:startPositionTicks/Stream.:format
 * 字幕文件代理
 */
subtitles.get('/:itemId/:mediaSourceId/Subtitles/:index/Stream.:format', requireAuth(), handleSubtitle);
subtitles.get('/:itemId/:mediaSourceId/Subtitles/:index/:startPos/Stream.:format', requireAuth(), handleSubtitle);

async function handleSubtitle(c: any) {
  const session = c.get('session') as SessionData;
  const index = c.req.param('index');

  // index 在这里实际上是字幕流的 guid（我们在 MediaStream 中把 guid 编码到了 index）
  // 但 Jellyfin 客户端传的是数字 index，我们需要通过 PlaybackInfo 中的映射来找到对应的字幕 guid
  // 简化处理：直接用 index 作为字幕 guid 尝试下载
  const subtitleGuid = index;

  const url = `/v/api/v1/subtitle/dl/${subtitleGuid}`;
  const fullUrl = `${session.fnosServer}${url}`;

  try {
    const authx = generateAuthxString(url);
    const response = await axios.get(fullUrl, {
      headers: {
        'Authorization': session.fnosToken,
        'Cookie': 'mode=relay',
        'Authx': authx,
      },
      responseType: 'arraybuffer',
      timeout: 15000,
    });

    const format = c.req.param('format') || 'srt';
    const contentTypeMap: Record<string, string> = {
      srt: 'text/plain; charset=utf-8',
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
