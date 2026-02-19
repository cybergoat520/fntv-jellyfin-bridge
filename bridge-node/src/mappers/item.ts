/**
 * Item 映射器
 * 飞牛 PlayListItem / ItemDetail → Jellyfin BaseItemDto
 */

import { toJellyfinId, registerItemType } from './id.ts';
import type { FnosPlayListItem, FnosItemDetail, FnosPlayInfo } from '../types/fnos.ts';

/** Jellyfin BaseItemDto (简化版，按需扩展) */
export interface BaseItemDto {
  Name: string;
  ServerId: string;
  Id: string;
  Etag?: string;
  DateCreated?: string;
  CanDelete: boolean;
  CanDownload: boolean;
  Container?: string;
  SortName?: string;
  PremiereDate?: string;
  ExternalUrls?: any[];
  Path?: string;
  Overview?: string;
  Taglines?: string[];
  Genres?: string[];
  CommunityRating?: number;
  RunTimeTicks?: number;
  ProductionYear?: number;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  IsFolder: boolean;
  Type: string;
  ParentId?: string;
  SeriesId?: string;
  SeriesName?: string;
  SeasonId?: string;
  SeasonName?: string;
  UserData?: UserItemDataDto;
  ChildCount?: number;
  CollectionType?: string;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  LocationType?: string;
  MediaType?: string;
  MediaSources?: any[];
}

export interface UserItemDataDto {
  PlaybackPositionTicks: number;
  PlayCount: number;
  IsFavorite: boolean;
  Played: boolean;
  PlayedPercentage?: number;
  UnplayedItemCount?: number;
}

/**
 * 飞牛内容类型 → Jellyfin 类型
 */
function mapType(fnosType: string): string {
  switch (fnosType) {
    case 'Movie': return 'Movie';
    case 'Episode': return 'Episode';
    case 'TV':
    case 'Series': return 'Series';
    case 'Season': return 'Season';
    case 'Directory': return 'Folder';
    default: return 'Video';
  }
}

/**
 * 飞牛类型 → Jellyfin MediaType
 */
function mapMediaType(type: string): string | undefined {
  switch (type) {
    case 'Movie':
    case 'Episode':
    case 'Video':
      return 'Video';
    default:
      return undefined;
  }
}

/**
 * 秒 → Jellyfin ticks (1 tick = 100ns = 0.0000001s)
 */
export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * 10_000_000);
}

/**
 * ticks → 秒
 */
export function ticksToSeconds(ticks: number): number {
  return ticks / 10_000_000;
}

/**
 * 构造图片标签
 * 飞牛的 poster 路径作为 tag 的哈希
 */
function makeImageTags(poster: string | undefined): Record<string, string> {
  if (!poster) return {};
  // 用 poster 路径的简单哈希作为 tag
  return { Primary: Buffer.from(poster).toString('base64url').slice(0, 16) };
}

/**
 * 将飞牛 PlayListItem 映射为 Jellyfin BaseItemDto
 */
export function mapPlayListItemToDto(
  item: FnosPlayListItem,
  serverId: string,
): BaseItemDto {
  const jellyfinType = mapType(item.type);
  const isFolder = ['Series', 'Season', 'Folder'].includes(jellyfinType);
  const duration = item.duration || (item.runtime ? item.runtime * 60 : 0);

  // 记住原始类型，供详情路由判断
  registerItemType(item.guid, item.type);

  const dto: BaseItemDto = {
    Name: item.title || item.tv_title,
    ServerId: serverId,
    Id: toJellyfinId(item.guid),
    CanDelete: false,
    CanDownload: false,
    Overview: item.overview || undefined,
    CommunityRating: item.vote_average ? parseFloat(item.vote_average) : undefined,
    RunTimeTicks: duration > 0 ? secondsToTicks(duration) : undefined,
    IsFolder: isFolder,
    Type: jellyfinType,
    MediaType: mapMediaType(jellyfinType),
    ImageTags: makeImageTags(item.poster),
    BackdropImageTags: [],
    LocationType: 'FileSystem',
    UserData: {
      PlaybackPositionTicks: item.ts > 0 ? secondsToTicks(item.ts) : 0,
      PlayCount: item.watched ? 1 : 0,
      IsFavorite: item.is_favorite === 1,
      Played: item.watched === 1,
      PlayedPercentage: duration > 0 && item.ts > 0
        ? Math.min(100, (item.ts / duration) * 100)
        : undefined,
    },
  };

  // 剧集特有字段
  if (jellyfinType === 'Episode') {
    dto.IndexNumber = item.episode_number;
    dto.ParentIndexNumber = item.season_number;
    dto.SeriesName = item.tv_title;
    dto.SeasonName = item.parent_title || (item.season_number != null ? `第 ${item.season_number} 季` : undefined);
    if (item.ancestor_guid) {
      dto.SeriesId = toJellyfinId(item.ancestor_guid);
    }
    if (item.parent_guid) {
      dto.SeasonId = toJellyfinId(item.parent_guid);
      dto.ParentId = toJellyfinId(item.parent_guid);
    }
  }

  // 系列特有字段
  if (jellyfinType === 'Series') {
    dto.ChildCount = item.local_number_of_seasons || item.number_of_seasons;
  }

  // 日期
  if (item.air_date) {
    dto.PremiereDate = item.air_date + 'T00:00:00.0000000Z';
    const year = parseInt(item.air_date.split('-')[0]);
    if (year > 0) dto.ProductionYear = year;
  }

  return dto;
}

/**
 * 将飞牛 PlayInfo 映射为 Jellyfin BaseItemDto
 */
export function mapPlayInfoToDto(
  info: FnosPlayInfo,
  serverId: string,
): BaseItemDto {
  const item = info.item;
  const jellyfinType = mapType(item.type);
  const isFolder = ['Series', 'Season'].includes(jellyfinType);
  const duration = item.duration || (item.runtime ? item.runtime * 60 : 0);

  const dto: BaseItemDto = {
    Name: item.title || item.tv_title,
    ServerId: serverId,
    Id: toJellyfinId(item.guid),
    CanDelete: false,
    CanDownload: false,
    Overview: item.overview || undefined,
    CommunityRating: item.vote_average ? parseFloat(item.vote_average) : undefined,
    RunTimeTicks: duration > 0 ? secondsToTicks(duration) : undefined,
    IsFolder: isFolder,
    Type: jellyfinType,
    MediaType: mapMediaType(jellyfinType),
    ImageTags: makeImageTags(item.posters),
    BackdropImageTags: item.still_path ? [makeImageTags(item.still_path).Primary || ''] : [],
    LocationType: 'FileSystem',
    UserData: {
      PlaybackPositionTicks: item.watched_ts > 0 ? secondsToTicks(item.watched_ts) : 0,
      PlayCount: item.is_watched ? 1 : 0,
      IsFavorite: item.is_favorite === 1,
      Played: item.is_watched === 1,
      PlayedPercentage: duration > 0 && item.watched_ts > 0
        ? Math.min(100, (item.watched_ts / duration) * 100)
        : undefined,
    },
  };

  if (jellyfinType === 'Episode') {
    dto.IndexNumber = item.episode_number;
    dto.ParentIndexNumber = item.season_number;
    dto.SeriesName = item.tv_title;
    dto.SeasonName = item.parent_title || (item.season_number != null ? `第 ${item.season_number} 季` : undefined);
    if (info.grand_guid) {
      dto.SeriesId = toJellyfinId(info.grand_guid);
    }
    if (info.parent_guid) {
      dto.SeasonId = toJellyfinId(info.parent_guid);
      dto.ParentId = toJellyfinId(info.parent_guid);
    }
  }

  if (jellyfinType === 'Series') {
    dto.ChildCount = item.local_number_of_seasons || item.number_of_seasons;
  }

  if (item.air_date) {
    dto.PremiereDate = item.air_date + 'T00:00:00.0000000Z';
    const year = parseInt(item.air_date.split('-')[0]);
    if (year > 0) dto.ProductionYear = year;
  }

  return dto;
}

/**
 * 构造一个虚拟的媒体库 CollectionFolder
 */
export function makeCollectionFolder(
  name: string,
  id: string,
  serverId: string,
  collectionType: string,
): BaseItemDto {
  return {
    Name: name,
    ServerId: serverId,
    Id: id,
    CanDelete: false,
    CanDownload: false,
    IsFolder: true,
    Type: 'CollectionFolder',
    CollectionType: collectionType,
    ImageTags: {},
    BackdropImageTags: [],
    LocationType: 'FileSystem',
  };
}
