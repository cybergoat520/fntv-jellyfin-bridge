/**
 * Items 路由
 * 媒体列表查询和单项详情
 */

import { Hono } from 'hono';
import { config } from '../config.ts';
import { generateServerId, toFnosGuid } from '../mappers/id.ts';
import { mapPlayListItemToDto, mapPlayInfoToDto } from '../mappers/item.ts';
import { requireAuth } from '../middleware/auth.ts';
import { fnosGetItemList, fnosGetPlayInfo } from '../services/fnos.ts';
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
    const fnosGuid = toFnosGuid(parentId);
    if (!fnosGuid) {
      return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
    }

    // 映射排序参数
    let sortColumn = 'sort_title';
    if (sortBy.includes('DateCreated') || sortBy.includes('DatePlayed')) sortColumn = 'air_date';
    else if (sortBy.includes('CommunityRating')) sortColumn = 'vote_average';
    else if (sortBy.includes('SortName') || sortBy.includes('Name')) sortColumn = 'sort_title';
    const sortType = sortOrder === 'Descending' ? 'DESC' : 'ASC';

    try {
      const result = await fnosGetItemList(session.fnosServer, session.fnosToken, {
        parent_guid: fnosGuid,
        exclude_folder: 1,
        sort_column: sortColumn,
        sort_type: sortType,
      });

      if (!result.success || !result.data) {
        return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
      }

      let items = result.data.list;

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

      const allDtos = items.map(item => mapPlayListItemToDto(item, serverId));
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
 * GET /Items/:itemId - 获取单个项目详情
 */
items.get('/:itemId', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const itemId = c.req.param('itemId');
  const fnosGuid = toFnosGuid(itemId);

  if (!fnosGuid) {
    return c.json({ error: 'Item not found' }, 404);
  }

  try {
    const result = await fnosGetPlayInfo(session.fnosServer, session.fnosToken, fnosGuid);
    if (!result.success || !result.data) {
      return c.json({ error: 'Item not found' }, 404);
    }

    const dto = mapPlayInfoToDto(result.data, serverId);
    return c.json(dto);
  } catch (e: any) {
    console.error('获取项目详情失败:', e.message);
    return c.json({ error: 'Internal error' }, 500);
  }
});

/**
 * GET /Items/:itemId/Images/:imageType - 图片代理
 * 这里先做一个简单的重定向到飞牛的图片 URL
 */
items.get('/:itemId/Images/:imageType', async (c) => {
  // 图片代理在 images.ts 中实现，这里做兜底
  return c.json({}, 404);
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
