/**
 * Favorites 路由
 * 收藏/取消收藏
 */

import { Hono } from 'hono';
import { toFnosGuid } from '../mappers/id.ts';
import { requireAuth } from '../middleware/auth.ts';
import { fnosSetFavorite } from '../services/fnos.ts';
import type { SessionData } from '../services/session.ts';

const favorites = new Hono();

/**
 * POST /UserFavoriteItems/:itemId - 收藏
 */
favorites.post('/UserFavoriteItems/:itemId', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const itemId = c.req.param('itemId');
  const fnosGuid = toFnosGuid(itemId);

  if (fnosGuid) {
    try {
      await fnosSetFavorite(session.fnosServer, session.fnosToken, fnosGuid, true);
    } catch (e: any) {
      console.error('收藏失败:', e.message);
    }
  }

  return c.json({
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: true,
    Played: false,
  });
});

/**
 * DELETE /UserFavoriteItems/:itemId - 取消收藏
 */
favorites.delete('/UserFavoriteItems/:itemId', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const itemId = c.req.param('itemId');
  const fnosGuid = toFnosGuid(itemId);

  if (fnosGuid) {
    try {
      await fnosSetFavorite(session.fnosServer, session.fnosToken, fnosGuid, false);
    } catch (e: any) {
      console.error('取消收藏失败:', e.message);
    }
  }

  return c.json({
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: false,
    Played: false,
  });
});

/**
 * 旧版路径
 * POST /Users/:userId/FavoriteItems/:itemId
 */
favorites.post('/Users/:userId/FavoriteItems/:itemId', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const itemId = c.req.param('itemId');
  const fnosGuid = toFnosGuid(itemId);

  if (fnosGuid) {
    try {
      await fnosSetFavorite(session.fnosServer, session.fnosToken, fnosGuid, true);
    } catch (e: any) {
      console.error('收藏失败:', e.message);
    }
  }

  return c.json({
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: true,
    Played: false,
  });
});

/**
 * DELETE /Users/:userId/FavoriteItems/:itemId
 */
favorites.delete('/Users/:userId/FavoriteItems/:itemId', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const itemId = c.req.param('itemId');
  const fnosGuid = toFnosGuid(itemId);

  if (fnosGuid) {
    try {
      await fnosSetFavorite(session.fnosServer, session.fnosToken, fnosGuid, false);
    } catch (e: any) {
      console.error('取消收藏失败:', e.message);
    }
  }

  return c.json({
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: false,
    Played: false,
  });
});

export default favorites;
