/**
 * 飞牛 API 服务封装
 * 基于内置的 FnosClient
 */

import { FnosClient } from '../fnos-client/client.ts';
import type { HttpMethod } from '../fnos-client/client.ts';
import type { FnosUserInfo, FnosPlayInfo, FnosItemListRequest, FnosItemListResponse, FnosPlayListItem } from '../types/fnos.ts';
import { config } from '../config.ts';

/**
 * 创建飞牛客户端实例
 */
export function createFnosClient(server: string, token: string = ''): FnosClient {
  return new FnosClient(server, token, {
    ignoreCert: config.ignoreCert,
  });
}

/**
 * 登录飞牛影视
 */
export async function fnosLogin(server: string, username: string, password: string) {
  const client = createFnosClient(server);
  const result = await client.request('post' as HttpMethod, '/v/api/v1/login', {
    app_name: 'trimemedia-web',
    username,
    password,
  });

  if (!result.success) {
    console.log(`[AUTH] 飞牛登录失败: server=${server}, user=${username}, error=${result.message}`);
    return { success: false as const, error: result.message || '登录失败' };
  }

  const token = result.data?.token;
  if (!token) {
    return { success: false as const, error: '未获取到 token' };
  }

  const actualServer = result.moveUrl || server;

  return {
    success: true as const,
    token,
    server: actualServer,
    username,
  };
}

/**
 * 获取用户信息
 */
export async function fnosGetUserInfo(server: string, token: string) {
  const client = createFnosClient(server, token);
  return client.request<FnosUserInfo>('get' as HttpMethod, '/v/api/v1/user/info');
}

/**
 * 获取播放信息
 */
export async function fnosGetPlayInfo(server: string, token: string, itemGuid: string) {
  const client = createFnosClient(server, token);
  return client.request<FnosPlayInfo>('post' as HttpMethod, '/v/api/v1/play/info', {
    item_guid: itemGuid,
  });
}

/**
 * 获取项目列表
 */
export async function fnosGetItemList(server: string, token: string, req: FnosItemListRequest) {
  const client = createFnosClient(server, token);
  return client.request<FnosItemListResponse>('post' as HttpMethod, '/v/api/v1/item/list', req);
}

/**
 * 获取剧集列表
 */
export async function fnosGetEpisodeList(server: string, token: string, id: string) {
  const client = createFnosClient(server, token);
  return client.request<FnosPlayListItem[]>('get' as HttpMethod, `/v/api/v1/episode/list/${id}`);
}

/**
 * 获取流列表（视频、音频、字幕流）
 */
export async function fnosGetStreamList(server: string, token: string, itemGuid: string) {
  const client = createFnosClient(server, token);
  return client.request<any>('get' as HttpMethod, `/v/api/v1/stream/list/${itemGuid}`);
}

/**
 * 获取流信息（含直链、质量等）
 */
export async function fnosGetStream(server: string, token: string, mediaGuid: string, ip: string) {
  const client = createFnosClient(server, token);
  return client.request<any>('post' as HttpMethod, '/v/api/v1/stream', {
    header: { "User-Agent": ["trim_player"] },
    level: 1,
    media_guid: mediaGuid,
    ip: ip,
  });
}

/**
 * 获取播放质量列表
 */
export async function fnosGetPlayQuality(server: string, token: string, mediaGuid: string) {
  const client = createFnosClient(server, token);
  return client.request<any>('post' as HttpMethod, '/v/api/v1/play/quality', {
    media_guid: mediaGuid,
  });
}

/**
 * 启动播放/转码会话
 * 必须在请求 HLS m3u8 之前调用，否则飞牛返回 410 Gone
 * 返回 play_link 包含转码会话 GUID
 */
export async function fnosStartPlay(server: string, token: string, data: {
  media_guid: string;
  video_guid: string;
  video_encoder: string;
  resolution: string;
  bitrate: number;
  startTimestamp: number;
  audio_encoder: string;
  audio_guid: string;
  subtitle_guid?: string;
  channels: number;
  forced_sdr?: number;
}) {
  const client = createFnosClient(server, token);
  return client.request<{
    play_link: string;
    media_guid: string;
    video_guid: string;
    audio_guid: string;
    hls_time: number;
  }>('post' as HttpMethod, '/v/api/v1/play/play', data);
}

/**
 * 标记已观看
 */
export async function fnosSetWatched(server: string, token: string, itemGuid: string) {
  const client = createFnosClient(server, token);
  return client.request('post' as HttpMethod, '/v/api/v1/item/watched', {
    item_guid: itemGuid,
  });
}

/**
 * 记录播放状态
 */
export async function fnosRecordPlayStatus(server: string, token: string, data: {
  item_guid: string;
  media_guid: string;
  video_guid: string;
  audio_guid: string;
  subtitle_guid: string;
  play_link: string;
  ts: number;
  duration: number;
  resolution?: string;
  bitrate?: number;
}) {
  const client = createFnosClient(server, token);
  return client.request('post' as HttpMethod, '/v/api/v1/play/record', data);
}
