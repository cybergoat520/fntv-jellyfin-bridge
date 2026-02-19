/**
 * 字幕路由
 * 代理飞牛影视的字幕文件
 */

import { Hono } from 'hono';
import axios from 'axios';
import { config } from '../config.ts';
import { extractToken } from '../middleware/auth.ts';
import { optionalAuth } from '../middleware/auth.ts';
import type { SessionData } from '../services/session.ts';
import { generateAuthxString } from '../fnos-client/signature.ts';
import { getSubtitleGuid } from '../mappers/media.ts';

const subtitles = new Hono();

/**
 * GET /Videos/:itemId/:mediaSourceId/Subtitles/:index/*
 * 字幕文件代理，支持原始格式和 .js (JSON TrackEvents) 格式
 */
subtitles.get('/:itemId/:mediaSourceId/Subtitles/:index/*', optionalAuth(), handleSubtitle);

async function handleSubtitle(c: any) {
  console.log(`[SUBTITLE] 收到请求: ${c.req.path}`);
  const session = c.get('session') as SessionData | undefined;
  const mediaSourceId = c.req.param('mediaSourceId');
  const index = parseInt(c.req.param('index'), 10);
  console.log(`[SUBTITLE] 解析参数: mediaSourceId=${mediaSourceId}, index=${index}`);
  // 从路径末尾提取格式：Stream.srt → srt, Stream.js → js
  const pathParts = c.req.path.split('/');
  const lastPart = pathParts[pathParts.length - 1] || '';
  const format = lastPart.includes('.') ? lastPart.split('.').pop() || 'srt' : 'srt';

  // 通过 index → guid 映射找到飞牛字幕 guid
  const subtitleGuid = getSubtitleGuid(mediaSourceId, index);
  if (!subtitleGuid) {
    console.error(`[SUBTITLE] 未找到字幕映射: mediaSourceId=${mediaSourceId}, index=${index}`);
    return c.body('Subtitle not found', 404);
  }

  // 获取认证信息
  let server = session?.fnosServer || config.fnosServer;
  let token = session?.fnosToken || '';
  if (!token) {
    const { token: apiKey } = extractToken(c);
    if (apiKey) {
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

    const rawData = Buffer.from(response.data);
    const text = rawData.toString('utf-8');

    // .js 格式：jellyfin-web 期望 JSON { TrackEvents: [...] }
    if (format === 'js') {
      const trackEvents = parseSrtToTrackEvents(text);
      c.header('Content-Type', 'application/json; charset=utf-8');
      c.header('Cache-Control', 'public, max-age=86400');
      return c.json({ TrackEvents: trackEvents });
    }

    // .vtt 格式：转换 SRT → WebVTT
    if (format === 'vtt') {
      const vtt = convertSrtToVtt(text);
      c.header('Content-Type', 'text/vtt; charset=utf-8');
      c.header('Cache-Control', 'public, max-age=86400');
      return c.body(vtt);
    }

    // 原始格式
    const contentTypeMap: Record<string, string> = {
      srt: 'text/plain; charset=utf-8',
      subrip: 'text/plain; charset=utf-8',
      ass: 'text/plain; charset=utf-8',
      ssa: 'text/plain; charset=utf-8',
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

/**
 * 解析 SRT 时间戳为 ticks (100ns 单位)
 * 格式: 00:01:23,456 → ticks
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
  // 按空行分割字幕块
  const blocks = srt.replace(/\r\n/g, '\n').split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    // 找到时间行（包含 -->）
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
