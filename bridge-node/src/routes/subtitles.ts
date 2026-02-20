/**
 * 字幕路由
 * 代理飞牛影视的字幕文件
 */

import { Hono } from 'hono';
import axios from 'axios';
import { config } from '../config.ts';
import { extractToken } from '../middleware/auth.ts';
import { optionalAuth } from '../middleware/auth.ts';
import { generateAuthxString } from '../fnos-client/signature.ts';
import { getSubtitleInfo } from '../mappers/media.ts';

const subtitles = new Hono();

/**
 * GET /Videos/:itemId/:mediaSourceId/Subtitles/:index/*
 * 字幕文件代理
 * 支持格式: .js (JSON TrackEvents), .vtt, .srt
 */
subtitles.get('/:itemId/:mediaSourceId/Subtitles/:index/*', optionalAuth(), handleSubtitle);

async function handleSubtitle(c: any) {
  const mediaSourceId = c.req.param('mediaSourceId');
  const index = parseInt(c.req.param('index'), 10);

  // 从路径末尾提取格式
  const pathParts = c.req.path.split('/');
  const lastPart = pathParts[pathParts.length - 1] || '';
  const format = lastPart.includes('.') ? lastPart.split('.').pop() || 'srt' : 'srt';

  // 获取字幕信息
  const subtitleInfo = getSubtitleInfo(mediaSourceId, index);
  if (!subtitleInfo) {
    console.error(`[SUBTITLE] 未找到字幕: mediaSourceId=${mediaSourceId}, index=${index}`);
    return c.body('Subtitle not found', 404);
  }

  // 获取认证信息
  const apiKey = c.req.query('api_key');
  let token = '';
  let server = config.fnosServer;

  if (apiKey) {
    const { getSession } = await import('../services/session.ts');
    const sess = getSession(apiKey);
    if (sess) {
      token = sess.fnosToken;
      server = sess.fnosServer;
    }
  }

  if (!token) {
    return c.body('Unauthorized', 401);
  }

  // 外挂字幕：使用 subtitle/dl/{guid} API
  if (subtitleInfo.isExternal) {
    const subtitleUrl = `/v/api/v1/subtitle/dl/${subtitleInfo.guid}`;
    const fullUrl = `${server}${subtitleUrl}`;
    const authx = generateAuthxString(subtitleUrl);

    try {
      const response = await axios.get(fullUrl, {
        headers: {
          'Authorization': token,
          'Cookie': 'mode=relay',
          'Authx': authx,
        },
        responseType: 'arraybuffer',
        timeout: 30000,
        validateStatus: () => true,
      });

      if (response.status !== 200) {
        return c.body('Subtitle fetch failed', response.status);
      }

      const text = Buffer.from(response.data).toString('utf-8');

      // .js 格式：返回 JSON TrackEvents
      if (format === 'js') {
        const trackEvents = parseSrtToTrackEvents(text);
        return c.json({ TrackEvents: trackEvents });
      }

      // .vtt 格式：转换为 WebVTT
      if (format === 'vtt') {
        const vtt = convertSrtToVtt(text);
        c.header('Content-Type', 'text/vtt; charset=utf-8');
        return c.body(vtt);
      }

      // 其他格式：返回原始内容
      c.header('Content-Type', 'text/plain; charset=utf-8');
      return c.body(text);
    } catch (e: any) {
      console.error(`[SUBTITLE] 外挂字幕获取失败:`, e.message);
      return c.body('Subtitle error', 502);
    }
  }

  // 内嵌字幕：暂不支持
  return c.body('Internal subtitles not supported yet', 501);
}

/**
 * 解析 SRT 时间戳为 ticks (100ns 单位)
 */
function parseSrtTimestamp(ts: string): number {
  const match = ts.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const ms = parseInt(match[4].padEnd(3, '0').slice(0, 3), 10);
  return ((hours * 3600 + minutes * 60 + seconds) * 1000 + ms) * 10000;
}

/**
 * 解析 SRT 字幕为 Jellyfin TrackEvents JSON
 */
function parseSrtToTrackEvents(srt: string): any[] {
  const events: any[] = [];
  const blocks = srt.replace(/\r\n/g, '\n').split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    let timeLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timeLineIdx = i;
        break;
      }
    }
    if (timeLineIdx < 0) continue;

    const timeParts = lines[timeLineIdx].split('-->');
    if (timeParts.length !== 2) continue;

    const startTicks = parseSrtTimestamp(timeParts[0]);
    const endTicks = parseSrtTimestamp(timeParts[1]);
    const text = lines.slice(timeLineIdx + 1).join('\n').trim();

    if (text) {
      events.push({
        StartPositionTicks: startTicks,
        EndPositionTicks: endTicks,
        Text: text,
      });
    }
  }

  return events;
}

/**
 * 将 SRT 转换为 WebVTT 格式
 */
function convertSrtToVtt(srt: string): string {
  let vtt = 'WEBVTT\n\n';
  vtt += srt
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return vtt;
}

export default subtitles;
