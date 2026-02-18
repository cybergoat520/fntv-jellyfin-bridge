/**
 * Media 映射器
 * 飞牛 StreamList → Jellyfin MediaSource / MediaStream
 */

import { toJellyfinId } from './id.ts';
import { secondsToTicks } from './item.ts';

/** Jellyfin MediaSourceInfo */
export interface MediaSourceInfo {
  Protocol: string;
  Id: string;
  Path: string;
  Type: string;
  Container: string;
  Size?: number;
  Name: string;
  IsRemote: boolean;
  RunTimeTicks?: number;
  SupportsTranscoding: boolean;
  SupportsDirectStream: boolean;
  SupportsDirectPlay: boolean;
  IsInfiniteStream: boolean;
  RequiresOpening: boolean;
  RequiresClosing: boolean;
  RequiresLooping: boolean;
  SupportsProbing: boolean;
  MediaStreams: MediaStreamInfo[];
  ReadAtNativeFramerate: boolean;
  DefaultAudioStreamIndex?: number;
  DefaultSubtitleStreamIndex?: number;
  DirectStreamUrl?: string;
  Bitrate?: number;
}

/** Jellyfin MediaStream */
export interface MediaStreamInfo {
  Codec: string;
  Language?: string;
  DisplayTitle?: string;
  DisplayLanguage?: string;
  IsInterlaced: boolean;
  BitRate?: number;
  BitDepth?: number;
  RefFrames?: number;
  IsDefault: boolean;
  IsForced: boolean;
  IsExternal: boolean;
  Height?: number;
  Width?: number;
  AverageFrameRate?: number;
  RealFrameRate?: number;
  Profile?: string;
  Type: string; // 'Video' | 'Audio' | 'Subtitle'
  AspectRatio?: string;
  Index: number;
  IsTextSubtitleStream?: boolean;
  SupportsExternalStream?: boolean;
  PixelFormat?: string;
  Level?: number;
  ChannelLayout?: string;
  Channels?: number;
  SampleRate?: number;
  Title?: string;
  ColorSpace?: string;
  ColorTransfer?: string;
  ColorPrimaries?: string;
}

/** Jellyfin PlaybackInfoResponse */
export interface PlaybackInfoResponse {
  MediaSources: MediaSourceInfo[];
  PlaySessionId: string;
}

/** 飞牛视频流 → Jellyfin MediaStream */
export function mapVideoStream(vs: any, index: number): MediaStreamInfo {
  return {
    Codec: vs.codec_name || 'h264',
    IsInterlaced: !vs.progressive,
    BitRate: vs.bps || undefined,
    BitDepth: vs.bit_depth || undefined,
    RefFrames: vs.refs || undefined,
    IsDefault: true,
    IsForced: false,
    IsExternal: false,
    Height: vs.height,
    Width: vs.width,
    AverageFrameRate: vs.avg_frame_rate ? parseFrameRate(vs.avg_frame_rate) : undefined,
    RealFrameRate: vs.r_frame_rate ? parseFrameRate(vs.r_frame_rate) : undefined,
    Profile: vs.profile || undefined,
    Type: 'Video',
    AspectRatio: vs.display_aspect_ratio || undefined,
    Index: index,
    PixelFormat: vs.pix_fmt || undefined,
    Level: vs.level || undefined,
    ColorSpace: vs.color_space || undefined,
    ColorTransfer: vs.color_transfer || undefined,
    ColorPrimaries: vs.color_primaries || undefined,
    DisplayTitle: formatVideoTitle(vs),
  };
}

/** 飞牛音频流 → Jellyfin MediaStream */
export function mapAudioStream(as: any, index: number): MediaStreamInfo {
  return {
    Codec: as.codec_name || 'aac',
    Language: as.language || undefined,
    IsInterlaced: false,
    BitRate: as.bps || undefined,
    IsDefault: as.is_default === 1 || as.is_default === true,
    IsForced: false,
    IsExternal: false,
    Type: 'Audio',
    Index: index,
    ChannelLayout: as.channel_layout || undefined,
    Channels: as.channels || undefined,
    SampleRate: as.sample_rate ? parseInt(as.sample_rate) : undefined,
    Profile: as.profile || undefined,
    Title: as.title || undefined,
    DisplayTitle: formatAudioTitle(as),
    DisplayLanguage: as.language || undefined,
  };
}

/** 飞牛字幕流 → Jellyfin MediaStream */
export function mapSubtitleStream(ss: any, index: number): MediaStreamInfo {
  const isText = !ss.is_bitmap;
  return {
    Codec: ss.codec_name || ss.format || 'srt',
    Language: ss.language || undefined,
    IsInterlaced: false,
    IsDefault: ss.is_default === 1 || ss.is_default === true,
    IsForced: ss.forced === 1,
    IsExternal: ss.is_external === 1,
    Type: 'Subtitle',
    Index: index,
    Title: ss.title || undefined,
    DisplayTitle: ss.title || ss.language || `字幕 ${index}`,
    IsTextSubtitleStream: isText,
    SupportsExternalStream: ss.is_external === 1,
  };
}

/**
 * 构造 MediaSourceInfo
 */
export function buildMediaSource(
  mediaGuid: string,
  fileName: string,
  videoStreams: any[],
  audioStreams: any[],
  subtitleStreams: any[],
  fileInfo: any,
  duration: number,
  videoStreamUrl: string,
): MediaSourceInfo {
  let streamIndex = 0;
  const mediaStreams: MediaStreamInfo[] = [];

  // 视频流
  for (const vs of videoStreams) {
    mediaStreams.push(mapVideoStream(vs, streamIndex++));
  }

  // 音频流
  const defaultAudioIndex = streamIndex;
  for (const as of audioStreams) {
    mediaStreams.push(mapAudioStream(as, streamIndex++));
  }

  // 字幕流
  for (const ss of subtitleStreams) {
    mediaStreams.push(mapSubtitleStream(ss, streamIndex++));
  }

  // 从文件名推断容器格式
  const container = fileName ? fileName.split('.').pop() || 'mkv' : 'mkv';

  return {
    Protocol: 'Http',
    Id: mediaGuid,
    Path: videoStreamUrl,
    Type: 'Default',
    Container: container,
    Size: fileInfo?.size || undefined,
    Name: fileName || 'Video',
    IsRemote: false,
    RunTimeTicks: duration > 0 ? secondsToTicks(duration) : undefined,
    SupportsTranscoding: false,
    SupportsDirectStream: true,
    SupportsDirectPlay: true,
    IsInfiniteStream: false,
    RequiresOpening: false,
    RequiresClosing: false,
    RequiresLooping: false,
    SupportsProbing: false,
    MediaStreams: mediaStreams,
    ReadAtNativeFramerate: false,
    DefaultAudioStreamIndex: mediaStreams.length > 1 ? defaultAudioIndex : undefined,
    DirectStreamUrl: videoStreamUrl,
    Bitrate: videoStreams[0]?.bps || undefined,
  };
}

/** 解析帧率字符串 "24000/1001" → 23.976 */
function parseFrameRate(rate: string): number | undefined {
  if (!rate) return undefined;
  const parts = rate.split('/');
  if (parts.length === 2) {
    const num = parseInt(parts[0]);
    const den = parseInt(parts[1]);
    if (den > 0) return Math.round((num / den) * 1000) / 1000;
  }
  const n = parseFloat(rate);
  return isNaN(n) ? undefined : n;
}

/** 格式化视频标题 */
function formatVideoTitle(vs: any): string {
  const parts: string[] = [];
  if (vs.resolution_type) parts.push(vs.resolution_type);
  else if (vs.height) parts.push(`${vs.height}p`);
  if (vs.codec_name) parts.push(vs.codec_name.toUpperCase());
  if (vs.color_range_type && vs.color_range_type !== 'SDR') parts.push(vs.color_range_type);
  return parts.join(' ') || 'Video';
}

/** 格式化音频标题 */
function formatAudioTitle(as: any): string {
  const parts: string[] = [];
  if (as.title) parts.push(as.title);
  else {
    if (as.language) parts.push(as.language);
    if (as.codec_name) parts.push(as.codec_name.toUpperCase());
    if (as.channel_layout) parts.push(as.channel_layout);
  }
  return parts.join(' ') || 'Audio';
}
