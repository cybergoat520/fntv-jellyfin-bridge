/**
 * UserViews 路由
 * 返回媒体库列表（虚拟构造）
 */

import { Hono } from 'hono';
import { config } from '../config.ts';
import { generateServerId, toJellyfinId } from '../mappers/id.ts';
import { makeCollectionFolder } from '../mappers/item.ts';
import { requireAuth } from '../middleware/auth.ts';

const views = new Hono();

const serverId = generateServerId(config.fnosServer);

/**
 * 构造虚拟媒体库列表
 * 飞牛影视没有独立的"媒体库列表"API，我们构造固定的虚拟媒体库
 */
function getDefaultViews() {
  return [
    makeCollectionFolder('电影', toJellyfinId('view_movies'), serverId, 'movies'),
    makeCollectionFolder('电视剧', toJellyfinId('view_tvshows'), serverId, 'tvshows'),
  ];
}

/** GET /UserViews */
views.get('/', requireAuth(), (c) => {
  const items = getDefaultViews();
  return c.json({
    Items: items,
    TotalRecordCount: items.length,
    StartIndex: 0,
  });
});

export default views;
