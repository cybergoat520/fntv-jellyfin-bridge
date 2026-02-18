/**
 * MediaInfo 路由
 * /Items/{itemId}/PlaybackInfo - 播放信息
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { generateServerId, toFnosGuid, registerMediaGuid } from '../mappers/id.ts';
import { buildMediaSources, type PlaybackInfoResponse } from '../mappers/media.ts';
import { requireAuth, extractToken } from '../middleware/auth.ts';
import { fnosGetPlayInfo, fnosGetStreamList } from '../services/fnos.ts';
import { registerStreamMeta } from '../services/hls-session.ts';
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

  // 解析客户端请求参数（POST body 或 query params）
  let enableDirectPlay: boolean | undefined;
  let enableDirectStream: boolean | undefined;
  let mediaSourceId: string | undefined;
  try {
    if (c.req.method === 'POST') {
      const body = await c.req.json();
      enableDirectPlay = body.EnableDirectPlay;
      enableDirectStream = body.EnableDirectStream;
      mediaSourceId = body.MediaSourceId;
    }
  } catch { /* ignore parse errors */ }
  // query params 也可能带这些参数
  if (enableDirectPlay === undefined) {
    const qDP = c.req.query('EnableDirectPlay');
    if (qDP !== undefined) enableDirectPlay = qDP === 'true';
  }
  if (enableDirectStream === undefined) {
    const qDS = c.req.query('EnableDirectStream');
    if (qDS !== undefined) enableDirectStream = qDS === 'true';
  }
  if (!mediaSourceId) {
    const qMS = c.req.query('MediaSourceId');
    if (qMS) mediaSourceId = qMS;
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

    // 按 media_guid 分组构造多个 MediaSource（支持多清晰度切换）
    const mediaSources = buildMediaSources(
      itemId, files, videoStreams, audioStreams, subtitleStreams,
      playInfo.item.duration || 0,
    );

    // 获取当前用户 token，注入到 TranscodingUrl 中（hls.js 不发 Authorization header）
    const { token: userToken } = extractToken(c);

    // 为所有 MediaSource 注册流元数据（HLS 转码后备需要）
    for (const ms of mediaSources) {
      const vs = videoStreams.find((v: any) => v.media_guid === ms.Id) || videoStreams[0];
      const as = audioStreams.find((a: any) => a.media_guid === ms.Id) || audioStreams[0];
      if (vs && as) {
        registerStreamMeta(ms.Id, {
          media_guid: ms.Id,
          video_guid: vs.guid || '',
          video_encoder: vs.codec_name || 'h264',
          resolution: vs.resolution_type || (vs.height >= 2160 ? '4k' : vs.height >= 1080 ? '1080p' : '720p'),
          bitrate: vs.bps || 15000000,
          audio_encoder: 'aac', // 目标编码器始终用 aac（浏览器兼容）
          audio_guid: as.guid || '',
          subtitle_guid: '',
          channels: as.channels || 2,
        });
      }
    }

    // 如果客户端指定了 MediaSourceId，只返回对应的 MediaSource
    // 这在用户选择特定版本（如 4K vs 1080p）时很重要
    let filteredSources = mediaSources;
    if (mediaSourceId) {
      const matched = mediaSources.filter(ms => ms.Id === mediaSourceId);
      if (matched.length > 0) filteredSources = matched;
    }

    // 客户端请求禁用 DirectPlay/DirectStream 时，覆盖对应标志
    // 这在播放出错重试时很重要，避免无限循环
    for (const ms of mediaSources) {
      if (enableDirectPlay === false) {
        ms.SupportsDirectPlay = false;
      }
      if (enableDirectStream === false) {
        ms.SupportsDirectStream = false;
      }
      // 在 TranscodingUrl 中注入 api_key，让 hls.js 能通过认证
      if (ms.TranscodingUrl && userToken) {
        const sep = ms.TranscodingUrl.includes('?') ? '&' : '?';
        ms.TranscodingUrl = `${ms.TranscodingUrl}${sep}api_key=${userToken}`;
      }
      // 注册 media_guid → item_guid 映射
      registerMediaGuid(ms.Id, fnosGuid);
    }

    const playSessionId = randomUUID();

    const response: PlaybackInfoResponse = {
      MediaSources: filteredSources,
      PlaySessionId: playSessionId,
    };

    console.log(`[PLAYBACK] PlaybackInfo: item=${itemId}, sources=${filteredSources.length}/${mediaSources.length}, mediaSourceId=${mediaSourceId || 'none'}, enableDS=${enableDirectStream}, enableDP=${enableDirectPlay}`);

    return c.json(response);
  } catch (e: any) {
    console.error('获取播放信息失败:', e.message);
    return c.json({ MediaSources: [], PlaySessionId: randomUUID() });
  }
}

mediainfo.get('/:itemId/PlaybackInfo', requireAuth(), handlePlaybackInfo);
mediainfo.post('/:itemId/PlaybackInfo', requireAuth(), handlePlaybackInfo);

export default mediainfo;
