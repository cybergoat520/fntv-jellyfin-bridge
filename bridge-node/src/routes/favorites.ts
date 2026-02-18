/**
 * Favorites 路由
 * 收藏/取消收藏（飞牛无对应 API，stub 返回）
 */

import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.ts';

const favorites = new Hono();

/**
 * POST /UserFavoriteItems/:itemId - 收藏
 */
favorites.post('/UserFavoriteItems/:itemId', requireAuth(), (c) => {
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
favorites.delete('/UserFavoriteItems/:itemId', requireAuth(), (c) => {
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
favorites.post('/Users/:userId/FavoriteItems/:itemId', requireAuth(), (c) => {
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
favorites.delete('/Users/:userId/FavoriteItems/:itemId', requireAuth(), (c) => {
  return c.json({
    PlaybackPositionTicks: 0,
    PlayCount: 0,
    IsFavorite: false,
    Played: false,
  });
});

export default favorites;
