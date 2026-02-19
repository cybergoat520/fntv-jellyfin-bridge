/**
 * Playback 路由
 * 播放状态同步：开始、进度、停止、标记已观看
 */

import { Hono } from 'hono';
import { toFnosGuid } from '../mappers/id.ts';
import { ticksToSeconds } from '../mappers/item.ts';
import { requireAuth } from '../middleware/auth.ts';
import { fnosRecordPlayStatus, fnosSetWatched, fnosGetPlayInfo } from '../services/fnos.ts';
import { getHlsPlayLink, getStreamMeta } from '../services/hls-session.ts';
import type { SessionData } from '../services/session.ts';

const playback = new Hono();

/** 缓存 item_guid → play/info 结果，避免每次进度报告都请求 */
const playInfoCache = new Map<string, {
  media_guid: string;
  video_guid: string;
  audio_guid: string;
  subtitle_guid: string;
  duration: number;
  cachedAt: number;
}>();

/** 缓存有效期：5 分钟 */
const CACHE_TTL = 5 * 60 * 1000;

/**
 * 从 Jellyfin 播放报告中提取飞牛需要的数据
 * 优先从缓存/streamMeta 获取，避免频繁请求 play/info
 */
async function extractPlayData(session: SessionData, body: any) {
  const itemId = body.ItemId;
  if (!itemId) return null;

  const fnosGuid = toFnosGuid(itemId);
  if (!fnosGuid) return null;

  const positionTicks = body.PositionTicks || 0;
  const ts = ticksToSeconds(positionTicks);

  // 优先从缓存获取
  const cached = playInfoCache.get(fnosGuid);
  if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL) {
    const meta = getStreamMeta(cached.media_guid);
    return {
      item_guid: fnosGuid,
      media_guid: cached.media_guid,
      video_guid: cached.video_guid,
      audio_guid: cached.audio_guid,
      subtitle_guid: cached.subtitle_guid,
      play_link: getHlsPlayLink(cached.media_guid),
      ts: Math.round(ts),
      duration: cached.duration,
      resolution: meta?.resolution,
      bitrate: meta?.bitrate,
    };
  }

  // 缓存未命中，请求 play/info
  const playInfo = await fnosGetPlayInfo(session.fnosServer, session.fnosToken, fnosGuid);
  if (!playInfo.success || !playInfo.data) return null;

  const info = playInfo.data;

  // 写入缓存
  playInfoCache.set(fnosGuid, {
    media_guid: info.media_guid,
    video_guid: info.video_guid,
    audio_guid: info.audio_guid,
    subtitle_guid: info.subtitle_guid,
    duration: info.item.duration || 0,
    cachedAt: Date.now(),
  });

  const meta = getStreamMeta(info.media_guid);

  return {
    item_guid: fnosGuid,
    media_guid: info.media_guid,
    video_guid: info.video_guid,
    audio_guid: info.audio_guid,
    subtitle_guid: info.subtitle_guid,
    play_link: getHlsPlayLink(info.media_guid),
    ts: Math.round(ts),
    duration: info.item.duration || 0,
    resolution: meta?.resolution,
    bitrate: meta?.bitrate,
  };
}

/**
 * POST /Sessions/Playing - 报告播放开始
 */
playback.post('/Playing', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  try {
    const body = await c.req.json();
    const data = await extractPlayData(session, body);
    if (data) {
      await fnosRecordPlayStatus(session.fnosServer, session.fnosToken, data);
    }
  } catch (e: any) {
    console.error('报告播放开始失败:', e.message);
  }
  return c.body(null, 204);
});

/**
 * POST /Sessions/Playing/Progress - 报告播放进度
 */
playback.post('/Playing/Progress', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  try {
    const body = await c.req.json();
    const data = await extractPlayData(session, body);
    if (data) {
      await fnosRecordPlayStatus(session.fnosServer, session.fnosToken, data);
    }
  } catch (e: any) {
    console.error('报告播放进度失败:', e.message);
  }
  return c.body(null, 204);
});

/**
 * POST /Sessions/Playing/Stopped - 报告播放停止
 */
playback.post('/Playing/Stopped', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  try {
    const body = await c.req.json();
    const data = await extractPlayData(session, body);
    if (data) {
      await fnosRecordPlayStatus(session.fnosServer, session.fnosToken, data);
    }
  } catch (e: any) {
    console.error('报告播放停止失败:', e.message);
  }
  return c.body(null, 204);
});

/**
 * POST /Sessions/Playing/Ping - 播放心跳
 */
playback.post('/Playing/Ping', requireAuth(), (c) => {
  return c.body(null, 204);
});

export default playback;
