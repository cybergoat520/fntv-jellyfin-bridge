/**
 * PlayedItems / PlayingItems 路由
 * 标记已观看/未观看，旧版播放状态端点
 */

import { Hono } from 'hono';
import { toFnosGuid } from '../mappers/id.ts';
import { requireAuth } from '../middleware/auth.ts';
import { fnosSetWatched } from '../services/fnos.ts';
import type { SessionData } from '../services/session.ts';

const playstate = new Hono();

/**
 * POST /UserPlayedItems/:itemId - 标记已观看
 */
playstate.post('/UserPlayedItems/:itemId', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const itemId = c.req.param('itemId');
  const fnosGuid = toFnosGuid(itemId);

  if (fnosGuid) {
    try {
      await fnosSetWatched(session.fnosServer, session.fnosToken, fnosGuid);
    } catch (e: any) {
      console.error('标记已观看失败:', e.message);
    }
  }

  // 返回 UserItemDataDto
  return c.json({
    PlaybackPositionTicks: 0,
    PlayCount: 1,
    IsFavorite: false,
    Played: true,
  });
});

/**
 * DELETE /UserPlayedItems/:itemId - 标记未观看
 * 飞牛没有对应 API，返回成功但不操作
 */
playstate.delete('/UserPlayedItems/:itemId', requireAuth(), (c) => {
  return c.json({
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: false,
    Played: false,
  });
});

/**
 * 旧版路径兼容
 * POST /Users/:userId/PlayedItems/:itemId
 */
playstate.post('/Users/:userId/PlayedItems/:itemId', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const itemId = c.req.param('itemId');
  const fnosGuid = toFnosGuid(itemId);

  if (fnosGuid) {
    try {
      await fnosSetWatched(session.fnosServer, session.fnosToken, fnosGuid);
    } catch (e: any) {
      console.error('标记已观看失败:', e.message);
    }
  }

  return c.json({
    PlaybackPositionTicks: 0,
    PlayCount: 1,
    IsFavorite: false,
    Played: true,
  });
});

/**
 * DELETE /Users/:userId/PlayedItems/:itemId
 */
playstate.delete('/Users/:userId/PlayedItems/:itemId', requireAuth(), (c) => {
  return c.json({
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: false,
    Played: false,
  });
});

/**
 * 旧版播放状态端点
 * POST /PlayingItems/:itemId
 * POST /PlayingItems/:itemId/Progress
 * DELETE /PlayingItems/:itemId
 */
playstate.post('/PlayingItems/:itemId', requireAuth(), (c) => c.body(null, 204));
playstate.post('/PlayingItems/:itemId/Progress', requireAuth(), (c) => c.body(null, 204));
playstate.delete('/PlayingItems/:itemId', requireAuth(), (c) => c.body(null, 204));

export default playstate;
