/**
 * MediaInfo 路由
 * /Items/{itemId}/PlaybackInfo - 播放信息
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { generateServerId, toFnosGuid } from '../mappers/id.ts';
import { buildMediaSource, type PlaybackInfoResponse } from '../mappers/media.ts';
import { requireAuth } from '../middleware/auth.ts';
import { fnosGetPlayInfo, fnosGetStreamList } from '../services/fnos.ts';
import type { SessionData } from '../services/session.ts';

const mediainfo = new Hono();

const serverId = generateServerId(config.fnosServer);

/**
 * GET /Items/:itemId/PlaybackInfo
 * POST /Items/:itemId/PlaybackInfo
 * 获取播放信息，返回 MediaSources
 */
async function handlePlaybackInfo(c: any) {
  const session = c.get('session') as SessionData;
  const itemId = c.req.param('itemId');
  const fnosGuid = toFnosGuid(itemId);

  if (!fnosGuid) {
    return c.json({ MediaSources: [], PlaySessionId: randomUUID() });
  }

  try {
    // 获取播放信息
    const playInfoResult = await fnosGetPlayInfo(session.fnosServer, session.fnosToken, fnosGuid);
    if (!playInfoResult.success || !playInfoResult.data) {
      return c.json({ MediaSources: [], PlaySessionId: randomUUID() });
    }

    const playInfo = playInfoResult.data;

    // 获取流列表
    const streamResult = await fnosGetStreamList(session.fnosServer, session.fnosToken, fnosGuid);
    if (!streamResult.success || !streamResult.data) {
      return c.json({ MediaSources: [], PlaySessionId: randomUUID() });
    }

    const streamData = streamResult.data;
    const videoStreams = streamData.video_streams || [];
    const audioStreams = streamData.audio_streams || [];
    const subtitleStreams = streamData.subtitle_streams || [];
    const files = streamData.files || [];

    // 构造视频流 URL（通过 bridge 代理）
    const mediaGuid = playInfo.media_guid;
    const videoStreamUrl = `/Videos/${itemId}/stream?static=true&mediaSourceId=${mediaGuid}`;

    const mediaSource = buildMediaSource(
      mediaGuid,
      files[0]?.path?.split('/').pop() || 'video',
      videoStreams,
      audioStreams,
      subtitleStreams,
      files[0] || null,
      playInfo.item.duration || 0,
      videoStreamUrl,
    );

    const playSessionId = randomUUID();

    const response: PlaybackInfoResponse = {
      MediaSources: [mediaSource],
      PlaySessionId: playSessionId,
    };

    return c.json(response);
  } catch (e: any) {
    console.error('获取播放信息失败:', e.message);
    return c.json({ MediaSources: [], PlaySessionId: randomUUID() });
  }
}

mediainfo.get('/:itemId/PlaybackInfo', requireAuth(), handlePlaybackInfo);
mediainfo.post('/:itemId/PlaybackInfo', requireAuth(), handlePlaybackInfo);

export default mediainfo;
