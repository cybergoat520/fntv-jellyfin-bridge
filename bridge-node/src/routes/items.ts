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

  // 如果有 parentId，转换为飞牛 GUID 并查询
  if (parentId) {
    const fnosGuid = toFnosGuid(parentId);
    if (!fnosGuid) {
      return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
    }

    try {
      const result = await fnosGetItemList(session.fnosServer, session.fnosToken, {
        parent_guid: fnosGuid,
        exclude_folder: 1,
        sort_column: 'sort_title',
        sort_type: 'ASC',
      });

      if (!result.success || !result.data) {
        return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
      }

      const allItems = result.data.list.map(item => mapPlayListItemToDto(item, serverId));
      const paged = allItems.slice(startIndex, startIndex + limit);

      return c.json({
        Items: paged,
        TotalRecordCount: result.data.total || allItems.length,
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
