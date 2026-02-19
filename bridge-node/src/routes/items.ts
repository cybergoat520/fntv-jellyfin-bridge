/**
 * Items 路由
 * 媒体列表查询和单项详情
 */

import { Hono } from 'hono';
import { config } from '../config.ts';
import { generateServerId, toFnosGuid, toJellyfinId, registerMediaGuid, getItemType } from '../mappers/id.ts';
import { mapPlayListItemToDto, mapPlayInfoToDto, makeCollectionFolder } from '../mappers/item.ts';
import { buildMediaSources } from '../mappers/media.ts';
import { requireAuth } from '../middleware/auth.ts';
import { fnosGetItemList, fnosGetPlayInfo, fnosGetStreamList } from '../services/fnos.ts';
import { setImageCache } from '../services/imageCache.ts';
import type { SessionData } from '../services/session.ts';

const items = new Hono();

const serverId = generateServerId(config.fnosServer);

/** item/list 短期缓存，避免收藏夹等场景重复请求飞牛 */
const itemListCache = new Map<string, { data: any; ts: number; pending?: Promise<any> }>();
const ITEM_LIST_CACHE_TTL = 5_000; // 5 秒

async function cachedGetItemList(server: string, token: string, req: { parent_guid: string; exclude_folder: number; sort_column: string; sort_type: string }) {
  const key = `${server}:${req.parent_guid}:${req.exclude_folder}:${req.sort_column}:${req.sort_type}`;
  const cached = itemListCache.get(key);

  // 缓存命中
  if (cached && (Date.now() - cached.ts) < ITEM_LIST_CACHE_TTL) {
    return cached.pending || cached.data;
  }

  // 并发去重：用 Promise 确保同一 key 只发一次请求
  const pending = fnosGetItemList(server, token, req).then(result => {
    itemListCache.set(key, { data: result, ts: Date.now() });
    return result;
  });
  itemListCache.set(key, { data: null, ts: Date.now(), pending });

  // 清理过期缓存
  for (const [k, v] of itemListCache) {
    if (Date.now() - v.ts > ITEM_LIST_CACHE_TTL && !v.pending) itemListCache.delete(k);
  }

  return pending;
}

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
      const result = await cachedGetItemList(session.fnosServer, session.fnosToken, {
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

  // 无 parentId 但有 Recursive 查询（如收藏夹、全局搜索）
  // 遍历所有媒体库汇总结果
  const recursive = c.req.query('Recursive') || c.req.query('recursive');
  if (recursive === 'true' && (filters || searchTerm || includeItemTypes)) {
    let allItems: any[] = [];

    let sortColumn = 'sort_title';
    if (sortBy.includes('DateCreated') || sortBy.includes('DatePlayed')) sortColumn = 'air_date';
    else if (sortBy.includes('CommunityRating')) sortColumn = 'vote_average';
    else if (sortBy.includes('SortName') || sortBy.includes('Name')) sortColumn = 'sort_title';
    const sortType = sortOrder === 'Descending' ? 'DESC' : 'ASC';

    // 用空 parent_guid 获取所有媒体库根目录内容
    try {
      const result = await cachedGetItemList(session.fnosServer, session.fnosToken, {
        parent_guid: '',
        exclude_folder: 1,
        sort_column: sortColumn,
        sort_type: sortType,
      });
      if (result.success && result.data) {
        allItems = result.data.list || [];
      }
    } catch {
      // 忽略错误
    }

    // 搜索过滤
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      allItems = allItems.filter(i =>
        (i.title && i.title.toLowerCase().includes(term)) ||
        (i.tv_title && i.tv_title.toLowerCase().includes(term))
      );
    }

    // 类型过滤
    if (includeItemTypes) {
      const types = includeItemTypes.split(',').map(t => t.trim());
      allItems = allItems.filter(i => types.includes(mapFnosTypeToJellyfin(i.type)));
    }

    // IsFavorite 过滤
    if (filters.includes('IsFavorite')) {
      allItems = allItems.filter(i => i.is_favorite === 1);
    }

    // IsResumable 过滤
    if (filters.includes('IsResumable')) {
      allItems = allItems.filter(i => i.ts > 0 && i.watched !== 1);
    }

    // IsPlayed / IsUnplayed 过滤
    if (filters.includes('IsPlayed')) {
      allItems = allItems.filter(i => i.watched === 1);
    }
    if (filters.includes('IsUnplayed')) {
      allItems = allItems.filter(i => i.watched !== 1);
    }

    const allDtos = allItems.map(item => {
      const dto = mapPlayListItemToDto(item, serverId);
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
  }

  // 无 parentId 且无 Recursive 时返回空列表
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
 * GET /Items/Latest - 最近添加
 */
items.get('/Latest', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const parentId = c.req.query('ParentId') || c.req.query('parentId');
  const limit = parseInt(c.req.query('Limit') || '16', 10);
  const includeItemTypes = c.req.query('IncludeItemTypes') || c.req.query('includeItemTypes') || '';

  let fnosGuid = parentId ? toFnosGuid(parentId) : null;
  // 根据虚拟媒体库类型决定过滤条件
  let viewFilter: string | null = null;
  if (fnosGuid === 'view_movies') {
    viewFilter = 'Movie';
    fnosGuid = '';
  } else if (fnosGuid === 'view_tvshows') {
    viewFilter = 'Series';
    fnosGuid = '';
  }

  try {
    const result = await cachedGetItemList(session.fnosServer, session.fnosToken, {
      parent_guid: fnosGuid || '',
      exclude_folder: 1,
      sort_column: 'air_date',
      sort_type: 'DESC',
    });

    if (!result.success || !result.data) {
      return c.json([]);
    }

    let list = result.data.list || [];

    // 按虚拟媒体库类型过滤
    if (viewFilter) {
      list = list.filter(i => mapFnosTypeToJellyfin(i.type) === viewFilter);
    }

    // 按 IncludeItemTypes 过滤
    if (includeItemTypes) {
      const types = includeItemTypes.split(',').map(t => t.trim());
      list = list.filter(i => types.includes(mapFnosTypeToJellyfin(i.type)));
    }

    const dtos = list.slice(0, limit).map(item => {
      const dto = mapPlayListItemToDto(item, serverId);
      if (item.poster) {
        setImageCache(dto.Id, {
          poster: item.poster,
          server: session.fnosServer,
          token: session.fnosToken,
        });
      }
      return dto;
    });

    // Latest 端点返回数组而非 { Items, TotalRecordCount }
    return c.json(dtos);
  } catch (e: any) {
    console.error('获取最近添加失败:', e.message);
    return c.json([]);
  }
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
    // 检查原始类型：如果是 TV/Series，play/info 会返回最近观看的那一集
    // 需要构造 Series DTO 而不是 Episode DTO
    const originalType = getItemType(fnosGuid);

    const result = await fnosGetPlayInfo(session.fnosServer, session.fnosToken, fnosGuid);
    if (!result.success || !result.data) {
      return c.json({ error: 'Item not found' }, 404);
    }

    const playInfo = result.data;

    // 如果原始类型是 TV/Series，覆盖 play/info 返回的 Episode 类型
    if (originalType === 'TV' || originalType === 'Series') {
      playInfo.item.type = 'TV';
      // play/info 返回的是最近观看的集，用 tv_title 作为系列名
      if (playInfo.item.tv_title) {
        playInfo.item.title = playInfo.item.tv_title;
      }
      // 用原始系列 guid，而不是 play/info 返回的集 guid
      playInfo.item.guid = fnosGuid;
      // grand_guid 设为空（自身就是系列）
      playInfo.grand_guid = '';
      playInfo.parent_guid = '';
      // 用系列的季数信息
      playInfo.item.number_of_seasons = playInfo.item.number_of_seasons || 0;
      playInfo.item.local_number_of_seasons = playInfo.item.local_number_of_seasons || 0;
    }

    // 如果原始类型是 Season，也覆盖为 Season
    if (originalType === 'Season') {
      playInfo.item.type = 'Season';
      // 季的标题用 parent_title（第 X 季）
      if (playInfo.item.parent_title) {
        playInfo.item.title = playInfo.item.parent_title;
      }
      // 用原始季的 guid
      playInfo.item.guid = fnosGuid;
      // 季的季数
      playInfo.item.season_number = playInfo.item.season_number || 1;
    }

    const dto = mapPlayInfoToDto(playInfo, serverId);

    // 对可播放项目，获取流信息并附加 MediaSources
    if (dto.MediaType === 'Video' && playInfo.media_guid) {
      try {
        const streamResult = await fnosGetStreamList(session.fnosServer, session.fnosToken, fnosGuid);
        if (streamResult.success && streamResult.data) {
          const sd = streamResult.data;
          const mediaSources = buildMediaSources(
            itemId,
            sd.files || [],
            sd.video_streams || [],
            sd.audio_streams || [],
            sd.subtitle_streams || [],
            playInfo.item.duration || 0,
          );
          dto.MediaSources = mediaSources;
          // 注册 media_guid → item_guid 映射，供 jellyfin-web 用 mediaSourceId 调用 getItem 时查找
          for (const ms of mediaSources) {
            registerMediaGuid(ms.Id, fnosGuid);
          }
          // jellyfin-web 的 getItem 调用期望顶层有 MediaStreams
          if (mediaSources.length > 0) {
            (dto as any).MediaStreams = mediaSources[0].MediaStreams;
          }
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
