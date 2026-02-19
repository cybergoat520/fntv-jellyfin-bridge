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
import { registerStreamMeta, clearHlsSession } from '../services/hls-session.ts';
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
  let maxStreamingBitrate: number | undefined;
  try {
    if (c.req.method === 'POST') {
      const body = await c.req.json();
      enableDirectPlay = body.EnableDirectPlay;
      enableDirectStream = body.EnableDirectStream;
      mediaSourceId = body.MediaSourceId;
      if (body.MaxStreamingBitrate != null) maxStreamingBitrate = Number(body.MaxStreamingBitrate);
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
  if (maxStreamingBitrate === undefined) {
    const qMB = c.req.query('MaxStreamingBitrate');
    if (qMB) maxStreamingBitrate = Number(qMB);
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
        // 回退到转码时，必须设置 TranscodingSubProtocol 让 jellyfin-web 用 hls.js
        ms.TranscodingSubProtocol = 'hls';
      }
      // 质量菜单选择低码率时，禁用 DirectStream 强制走 HLS 转码
      // 否则播放器会忽略码率限制继续播放原始文件
      if (maxStreamingBitrate && ms.Bitrate && maxStreamingBitrate < ms.Bitrate && ms.SupportsDirectStream) {
        ms.SupportsDirectStream = false;
        ms.TranscodingSubProtocol = 'hls';
        console.log(`  [QUALITY] 码率限制 ${(maxStreamingBitrate / 1e6).toFixed(1)}Mbps < 源码率 ${(ms.Bitrate / 1e6).toFixed(1)}Mbps → 强制 HLS 转码`);
      }
      // 在 TranscodingUrl 中注入 api_key，让 hls.js 能通过认证
      if (ms.TranscodingUrl && userToken) {
        const sep = ms.TranscodingUrl.includes('?') ? '&' : '?';
        ms.TranscodingUrl = `${ms.TranscodingUrl}${sep}api_key=${userToken}`;
        // 附加 MaxStreamingBitrate 作为 cache buster，让质量切换产生不同 URL
        if (maxStreamingBitrate) {
          ms.TranscodingUrl = `${ms.TranscodingUrl}&MaxStreamingBitrate=${maxStreamingBitrate}`;
        }
      }
      // 质量切换时清除 HLS 会话缓存，让下次请求重新启动转码
      if (enableDirectStream === false || enableDirectPlay === false) {
        clearHlsSession(ms.Id);
      }
      // 注册 media_guid → item_guid 映射
      registerMediaGuid(ms.Id, fnosGuid);
    }

    const playSessionId = randomUUID();

    const response: PlaybackInfoResponse = {
      MediaSources: filteredSources,
      PlaySessionId: playSessionId,
    };

    console.log(`[PLAYBACK] PlaybackInfo: item=${itemId}, sources=${filteredSources.length}/${mediaSources.length}, mediaSourceId=${mediaSourceId || 'none'}, enableDS=${enableDirectStream}, enableDP=${enableDirectPlay}, maxBitrate=${maxStreamingBitrate || 'none'}`);
    for (const ms of filteredSources) {
      const videoStream = ms.MediaStreams?.find((s: any) => s.Type === 'Video');
      const audioStream = ms.MediaStreams?.find((s: any) => s.Type === 'Audio' && s.Index === ms.DefaultAudioStreamIndex);
      console.log(`  [SOURCE] id=${ms.Id}, name=${ms.Name}, container=${ms.Container}, DS=${ms.SupportsDirectStream}, TC=${ms.SupportsTranscoding}, video=${videoStream?.Codec || '?'}, audio=${audioStream?.Codec || '?'}`);
    }

    return c.json(response);
  } catch (e: any) {
    console.error('获取播放信息失败:', e.message);
    return c.json({ MediaSources: [], PlaySessionId: randomUUID() });
  }
}

mediainfo.get('/:itemId/PlaybackInfo', requireAuth(), handlePlaybackInfo);
mediainfo.post('/:itemId/PlaybackInfo', requireAuth(), handlePlaybackInfo);

export default mediainfo;
