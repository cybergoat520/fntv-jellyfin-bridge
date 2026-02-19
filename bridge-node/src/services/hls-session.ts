/**
 * HLS 转码会话管理
 *
 * 飞牛 HLS 转码流程：
 * 1. play/play 启动转码会话 → 返回 play_link 含 sessionGuid
 * 2. /v/media/{sessionGuid}/preset.m3u8 获取播放列表
 * 3. /v/media/{sessionGuid}/xxx.ts 获取视频段
 *
 * 本模块管理 mediaGuid → sessionGuid 的映射
 * jellyfin-web 的 Playing/Progress 心跳（每 10s）会通过 playback.ts 转发到飞牛，
 * 同时携带正确的 play_link，起到会话保活 + 进度同步的双重作用
 */

import { fnosStartPlay } from './fnos.ts';

/** 流元数据，用于调用 play/play */
export interface StreamMeta {
  media_guid: string;
  item_guid: string;
  video_guid: string;
  video_encoder: string;
  resolution: string;
  bitrate: number;
  audio_encoder: string;
  audio_guid: string;
  subtitle_guid: string;
  channels: number;
  duration: number;
}

/** HLS 会话信息 */
interface HlsSession {
  /** 飞牛返回的 play_link 路径 */
  playLink: string;
  /** 从 play_link 提取的 session GUID */
  sessionGuid: string;
  /** 飞牛服务器地址 */
  fnosServer: string;
  /** 飞牛 token */
  fnosToken: string;
  /** 创建时间 */
  createdAt: number;
}

/** mediaGuid → 流元数据（在 PlaybackInfo 时注册） */
const streamMetaMap = new Map<string, StreamMeta>();

/** mediaGuid → HLS 会话（在首次 m3u8 请求时创建） */
const hlsSessionMap = new Map<string, HlsSession>();

/**
 * 注册流元数据（在 PlaybackInfo 构建 MediaSource 时调用）
 */
export function registerStreamMeta(mediaGuid: string, meta: StreamMeta): void {
  streamMetaMap.set(mediaGuid, meta);
}

/**
 * 获取流元数据（用于 playback 进度报告获取 play_link）
 */
export function getStreamMeta(mediaGuid: string): StreamMeta | undefined {
  return streamMetaMap.get(mediaGuid);
}

/**
 * 获取 HLS 会话的 play_link（用于 playback 进度报告）
 */
export function getHlsPlayLink(mediaGuid: string): string {
  const cached = hlsSessionMap.get(mediaGuid);
  return cached?.playLink || '';
}

/**
 * 获取或创建 HLS 转码会话
 * 首次调用会请求 play/play 启动转码，后续直接返回缓存
 */
export async function getOrCreateHlsSession(
  server: string,
  token: string,
  mediaGuid: string,
  startTimestamp: number = 0,
): Promise<{ sessionGuid: string; playLink: string } | null> {
  // 检查缓存
  const cached = hlsSessionMap.get(mediaGuid);
  if (cached) {
    return { sessionGuid: cached.sessionGuid, playLink: cached.playLink };
  }

  // 获取流元数据
  const meta = streamMetaMap.get(mediaGuid);
  if (!meta) {
    console.error(`[HLS] 未找到 mediaGuid=${mediaGuid} 的流元数据`);
    return null;
  }

  try {
    console.log(`[HLS] 启动转码会话: mediaGuid=${mediaGuid}`);
    const result = await fnosStartPlay(server, token, {
      media_guid: meta.media_guid,
      video_guid: meta.video_guid,
      video_encoder: meta.video_encoder,
      resolution: meta.resolution,
      bitrate: meta.bitrate,
      startTimestamp,
      audio_encoder: meta.audio_encoder,
      audio_guid: meta.audio_guid,
      subtitle_guid: meta.subtitle_guid,
      channels: meta.channels,
      forced_sdr: 0,
    });

    if (!result.success || !result.data?.play_link) {
      console.error(`[HLS] play/play 失败:`, result.message);
      return null;
    }

    const playLink = result.data.play_link;
    // 从 play_link 提取 session GUID: /v/media/{sessionGuid}/preset.m3u8
    const match = playLink.match(/\/v\/media\/([^/]+)\//);
    if (!match) {
      console.error(`[HLS] 无法从 play_link 提取 sessionGuid: ${playLink}`);
      return null;
    }

    const sessionGuid = match[1];
    const session: HlsSession = {
      playLink,
      sessionGuid,
      fnosServer: server,
      fnosToken: token,
      createdAt: Date.now(),
    };

    hlsSessionMap.set(mediaGuid, session);
    console.log(`[HLS] 转码会话已创建: mediaGuid=${mediaGuid} → sessionGuid=${sessionGuid}`);

    return { sessionGuid, playLink };
  } catch (e: any) {
    console.error(`[HLS] 启动转码会话失败:`, e.message);
    return null;
  }
}

/**
 * 获取已缓存的 HLS 会话（不创建新的）
 * 用于 .ts 段请求 — 这些请求可能没有认证信息
 */
export function getCachedHlsSession(mediaGuid: string): {
  sessionGuid: string;
  fnosServer: string;
  fnosToken: string;
} | null {
  const cached = hlsSessionMap.get(mediaGuid);
  if (!cached) return null;
  return {
    sessionGuid: cached.sessionGuid,
    fnosServer: cached.fnosServer,
    fnosToken: cached.fnosToken,
  };
}

/**
 * 清除 HLS 会话缓存（用于重新开始转码）
 */
export function clearHlsSession(mediaGuid: string): void {
  hlsSessionMap.delete(mediaGuid);
}
