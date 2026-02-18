/**
 * Hono 应用配置
 * 注册所有路由和中间件
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from './middleware/logger.ts';
import systemRoutes from './routes/system.ts';
import brandingRoutes from './routes/branding.ts';
import usersRoutes from './routes/users.ts';
import viewsRoutes from './routes/views.ts';
import itemsRoutes from './routes/items.ts';
import showsRoutes from './routes/shows.ts';
import imagesRoutes from './routes/images.ts';
import mediainfoRoutes from './routes/mediainfo.ts';
import videosRoutes from './routes/videos.ts';
import subtitlesRoutes from './routes/subtitles.ts';
import playbackRoutes from './routes/playback.ts';
import playstateRoutes from './routes/playstate.ts';
import resumeRoutes from './routes/resume.ts';
import favoritesRoutes from './routes/favorites.ts';

const app = new Hono();

// 全局中间件
app.use('*', cors());
app.use('*', logger());

// 路由挂载
app.route('/System', systemRoutes);
app.route('/Branding', brandingRoutes);
app.route('/Users', usersRoutes);
app.route('/UserViews', viewsRoutes);
app.route('/Items', itemsRoutes);
app.route('/Shows', showsRoutes);

// 图片路由需要挂载在 /Items 下
app.route('/Items', imagesRoutes);

// PlaybackInfo 挂载在 /Items 下
app.route('/Items', mediainfoRoutes);

// 视频流和字幕
app.route('/Videos', videosRoutes);
app.route('/Videos', subtitlesRoutes);

// 播放状态同步
app.route('/Sessions', playbackRoutes);
app.route('/', playstateRoutes);

// 继续观看和收藏
app.route('/UserItems', resumeRoutes);
app.route('/', favoritesRoutes);

// 旧版路径兼容: /Users/{userId}/Views → /UserViews
app.get('/Users/:userId/Views', (c) => {
  const url = new URL(c.req.url);
  return c.redirect(`/UserViews${url.search}`, 307);
});

// 旧版路径兼容: /Users/{userId}/Items → /Items
app.get('/Users/:userId/Items', (c) => {
  const url = new URL(c.req.url);
  return c.redirect(`/Items${url.search}`, 307);
});

// 旧版路径兼容: /Users/{userId}/Items/Resume → /UserItems/Resume
app.get('/Users/:userId/Items/Resume', (c) => {
  const url = new URL(c.req.url);
  return c.redirect(`/UserItems/Resume${url.search}`, 307);
});

// 旧版路径兼容: /Users/{userId}/Items/{itemId} → /Items/{itemId}
app.get('/Users/:userId/Items/:itemId', (c) => {
  const itemId = c.req.param('itemId');
  const url = new URL(c.req.url);
  return c.redirect(`/Items/${itemId}${url.search}`, 307);
});

// 兜底：未实现的端点返回空响应而非 404
app.all('*', (c) => {
  const path = c.req.path;
  console.log(`\x1b[33m[STUB]\x1b[0m 未实现的端点: ${c.req.method} ${path}`);

  if (path.includes('/Items') || path.includes('/Views') || path.includes('/NextUp') || path.includes('/Upcoming')) {
    return c.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
  }
  if (path.includes('/DisplayPreferences')) {
    return c.json({
      Id: 'usersettings',
      SortBy: 'SortName',
      SortOrder: 'Ascending',
      CustomPrefs: {},
    });
  }

  return c.json({});
});

export default app;
