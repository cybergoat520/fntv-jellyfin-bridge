/**
 * Items 路由
 * 媒体列表查询和单项详情
 */

import { Hono } from 'hono';
import { config } from '../config.ts';
import { generateServerId, toFnosGuid, toJellyfinId } from '../mappers/id.ts';
import { mapPlayListItemToDto, mapPlayInfoToDto, makeCollectionFolder } from '../mappers/item.ts';
import { buildMediaSource } from '../mappers/media.ts';
import { requireAuth } from '../middleware/auth.ts';
import { fnosGetItemList, fnosGetPlayInfo, fnosGetStreamList } from '../services/fnos.ts';
import { setImageCache } from '../services/imageCache.ts';
import type { SessionData } from '../services/session.ts';

const items = new Hono();

const serverId = generateServerId(config.fnosServer);

/** 飞牛类型 → Jellyfin 类型（用于过滤） */
function mapFnosTypeToJellyfin(type: string): string {
  switch (type) {
    case 'Movie': return 'Movie';
    case 'Episode': return 'Episode';
    case 'TV': case 'Series': return 'Series';
    case 'Season': return 'Season';
    default: return 'Video';
  }
}

/**
 * GET /Items - 获取媒体列表
 * Jellyfin 客户端用各种查询参数来获取不同的列表
 */
items.get('/', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const parentId = c.req.query('ParentId') || c.req.query('parentId');
  const searchTerm = c.req.query('SearchTerm') || c.req.query('searchTerm');
  const startIndex = parseInt(c.req.query('StartIndex') || '0', 10);
  const limit = parseInt(c.req.query('Limit') || '50', 10);
  const sortBy = c.req.query('SortBy') || c.req.query('sortBy') || '';
  const sortOrder = c.req.query('SortOrder') || c.req.query('sortOrder') || 'Ascending';
  const filters = c.req.query('Filters') || c.req.query('filters') || '';
  const includeItemTypes = c.req.query('IncludeItemTypes') || c.req.query('includeItemTypes') || '';

  // 如果有 parentId，转换为飞牛 GUID 并查询
  if (parentId) {
    let fnosGuid = toFnosGuid(parentId);
    if (!fnosGuid) {
      return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
    }

    // 虚拟媒体库 ID 需要特殊处理：用空 parent_guid 获取根目录
    const isVirtualView = fnosGuid.startsWith('view_');
    if (isVirtualView) {
      fnosGuid = '';
    }

    // 映射排序参数
    let sortColumn = 'sort_title';
    if (sortBy.includes('DateCreated') || sortBy.includes('DatePlayed')) sortColumn = 'air_date';
    else if (sortBy.includes('CommunityRating')) sortColumn = 'vote_average';
    else if (sortBy.includes('SortName') || sortBy.includes('Name')) sortColumn = 'sort_title';
    const sortType = sortOrder === 'Descending' ? 'DESC' : 'ASC';

    try {
      console.log(`[ITEMS] 查询列表: parent_guid=${fnosGuid}, parentId=${parentId}, isVirtualView=${isVirtualView}`);
      const result = await fnosGetItemList(session.fnosServer, session.fnosToken, {
        parent_guid: fnosGuid,
        exclude_folder: isVirtualView ? 0 : 1,
        sort_column: sortColumn,
        sort_type: sortType,
      });

      if (!result.success || !result.data) {
        console.log(`[ITEMS] 查询失败: ${result.message}`);
        return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
      }

      let items = result.data.list || [];
      console.log(`[ITEMS] 查询结果: ${items.length} 条, mdb_name=${result.data.mdb_name}, mdb_category=${result.data.mdb_category}, top_dir=${result.data.top_dir}`);
      if (isVirtualView && items.length > 0) {
        console.log(`[ITEMS] 首条: guid=${items[0].guid}, type=${items[0].type}, title=${items[0].title}`);
      }
      if (isVirtualView && items.length === 0) {
        console.log(`[ITEMS] 虚拟视图返回空，原始数据:`, JSON.stringify(result.data).slice(0, 500));
      }

      // 搜索过滤
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        items = items.filter(i =>
          (i.title && i.title.toLowerCase().includes(term)) ||
          (i.tv_title && i.tv_title.toLowerCase().includes(term))
        );
      }

      // 类型过滤
      if (includeItemTypes) {
        const types = includeItemTypes.split(',').map(t => t.trim());
        items = items.filter(i => types.includes(mapFnosTypeToJellyfin(i.type)));
      }

      // IsResumable 过滤：有播放进度但未看完
      if (filters.includes('IsResumable')) {
        items = items.filter(i => i.ts > 0 && i.watched !== 1);
      }

      // IsFavorite 过滤
      if (filters.includes('IsFavorite')) {
        items = items.filter(i => i.is_favorite === 1);
      }

      // IsPlayed / IsUnplayed 过滤
      if (filters.includes('IsPlayed')) {
        items = items.filter(i => i.watched === 1);
      }
      if (filters.includes('IsUnplayed')) {
        items = items.filter(i => i.watched !== 1);
      }

      const allDtos = items.map(item => {
        const dto = mapPlayListItemToDto(item, serverId);
        // 缓存 poster URL，供图片代理路由使用
        if (item.poster) {
          setImageCache(dto.Id, {
            poster: item.poster,
            server: session.fnosServer,
            token: session.fnosToken,
          });
        }
        return dto;
      });
      const paged = allDtos.slice(startIndex, startIndex + limit);

      return c.json({
        Items: paged,
        TotalRecordCount: allDtos.length,
        StartIndex: startIndex,
      });
    } catch (e: any) {
      console.error('获取项目列表失败:', e.message);
      return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
    }
  }

  // 无 parentId 时返回空列表
  return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
});

/**
 * GET /Items/Filters - 获取过滤器选项
 */
items.get('/Filters', requireAuth(), (c) => {
  return c.json({
    Genres: [],
    Tags: [],
    OfficialRatings: [],
    Years: [],
  });
});

/**
 * GET /Items/:itemId - 获取单个项目详情
 */
items.get('/:itemId', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const itemId = c.req.param('itemId');
  const fnosGuid = toFnosGuid(itemId);

  // 处理虚拟媒体库 ID（CollectionFolder）
  if (fnosGuid && fnosGuid.startsWith('view_')) {
    const viewMap: Record<string, { name: string; type: string }> = {
      'view_movies': { name: '电影', type: 'movies' },
      'view_tvshows': { name: '电视剧', type: 'tvshows' },
    };
    const view = viewMap[fnosGuid];
    if (view) {
      return c.json(makeCollectionFolder(view.name, itemId, serverId, view.type));
    }
  }

  if (!fnosGuid) {
    return c.json({ error: 'Item not found' }, 404);
  }

  try {
    const result = await fnosGetPlayInfo(session.fnosServer, session.fnosToken, fnosGuid);
    if (!result.success || !result.data) {
      return c.json({ error: 'Item not found' }, 404);
    }

    const playInfo = result.data;
    console.log(`[ITEM] 详情: guid=${fnosGuid}, type=${playInfo.item.type}, media_guid=${playInfo.media_guid}, can_play=${playInfo.item.can_play}`);
    const dto = mapPlayInfoToDto(playInfo, serverId);
    console.log(`[ITEM] DTO: Type=${dto.Type}, MediaType=${dto.MediaType}, Name=${dto.Name}`);

    // 对可播放项目，获取流信息并附加 MediaSources
    if (dto.MediaType === 'Video' && playInfo.media_guid) {
      try {
        const streamResult = await fnosGetStreamList(session.fnosServer, session.fnosToken, fnosGuid);
        if (streamResult.success && streamResult.data) {
          const sd = streamResult.data;
          const videoStreamUrl = `/Videos/${itemId}/stream?static=true&mediaSourceId=${playInfo.media_guid}`;
          const mediaSource = buildMediaSource(
            playInfo.media_guid,
            sd.files?.[0]?.path?.split('/').pop() || 'video',
            sd.video_streams || [],
            sd.audio_streams || [],
            sd.subtitle_streams || [],
            sd.files?.[0] || null,
            playInfo.item.duration || 0,
            videoStreamUrl,
          );
          dto.MediaSources = [mediaSource];
          // jellyfin-web 的 getItem 调用期望顶层有 MediaStreams
          (dto as any).MediaStreams = mediaSource.MediaStreams;
        }
      } catch {
        // 流信息获取失败不影响详情返回
      }
    }

    return c.json(dto);
  } catch (e: any) {
    console.error('获取项目详情失败:', e.message);
    return c.json({ error: 'Internal error' }, 500);
  }
});

/**
 * GET /Users/:userId/Items - 旧版路径兼容
 */
items.get('/Users/:userId/Items', requireAuth(), async (c) => {
  // 复用主 Items 逻辑
  const url = new URL(c.req.url);
  const newUrl = `/Items${url.search}`;
  return c.redirect(newUrl, 307);
});

export default items;
