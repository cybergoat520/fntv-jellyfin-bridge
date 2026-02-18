/**
 * Hono 应用配置
 * 注册所有路由和中间件
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
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
import hlsRoutes from './routes/hls.ts';
import subtitlesRoutes from './routes/subtitles.ts';
import playbackRoutes from './routes/playback.ts';
import playstateRoutes from './routes/playstate.ts';
import resumeRoutes from './routes/resume.ts';
import favoritesRoutes from './routes/favorites.ts';

const app = new Hono();

// 全局中间件
app.use('*', cors());
app.use('*', logger());

// 路径大小写规范化中间件
// jellyfin-web 发送的 API 路径可能是小写（如 /Users/authenticatebyname）
// 但 Hono 路由匹配是大小写敏感的，需要将已知路径段规范化为 PascalCase
const pathSegmentMap: Record<string, string> = {
  'system': 'System',
  'info': 'Info',
  'public': 'Public',
  'ping': 'Ping',
  'branding': 'Branding',
  'configuration': 'Configuration',
  'css': 'Css',
  'css.css': 'Css.css',
  'users': 'Users',
  'authenticatebyname': 'AuthenticateByName',
  'me': 'Me',
  'userviews': 'UserViews',
  'items': 'Items',
  'resume': 'Resume',
  'shows': 'Shows',
  'seasons': 'Seasons',
  'episodes': 'Episodes',
  'images': 'Images',
  'playbackinfo': 'PlaybackInfo',
  'videos': 'Videos',
  'sessions': 'Sessions',
  'playing': 'Playing',
  'progress': 'Progress',
  'stopped': 'Stopped',
  'capabilities': 'Capabilities',
  'full': 'Full',
  'userplayeditems': 'UserPlayedItems',
  'useritems': 'UserItems',
  'userfavoriteitems': 'UserFavoriteItems',
  'favoriteitems': 'FavoriteItems',
  'playeditems': 'PlayedItems',
  'quickconnect': 'QuickConnect',
  'enabled': 'Enabled',
  'displaypreferences': 'DisplayPreferences',
  'localization': 'Localization',
  'countries': 'Countries',
  'cultures': 'Cultures',
  'parentalratings': 'ParentalRatings',
  'filters': 'Filters',
  'nextup': 'NextUp',
  'latest': 'Latest',
  'primary': 'Primary',
  'backdrop': 'Backdrop',
  'thumb': 'Thumb',
  'logo': 'Logo',
  'banner': 'Banner',
  'views': 'Views',
  'stream': 'stream',
  'subtitles': 'Subtitles',
  'intros': 'Intros',
  'similar': 'Similar',
  'thememedia': 'ThemeMedia',
  'specialfeatures': 'SpecialFeatures',
  'syncplay': 'SyncPlay',
  'list': 'List',
  'studios': 'Studios',
  'endpoint': 'Endpoint',
  'playback': 'Playback',
  'bitratetest': 'BitrateTest',
  'hls': 'hls',
  'main.m3u8': 'main.m3u8',
  'preset.m3u8': 'preset.m3u8',
  'subtitle.m3u8': 'subtitle.m3u8',
};

app.use('*', async (c, next) => {
  const originalPath = c.req.path;
  // 跳过静态文件
  if (originalPath.startsWith('/web/')) return next();

  const segments = originalPath.split('/');
  let changed = false;

  for (let i = 0; i < segments.length; i++) {
    const lower = segments[i].toLowerCase();
    // 处理 stream.xxx 扩展名：stream.mkv → stream（去掉扩展名，Hono 不支持 :param 带点号）
    if (lower.startsWith('stream.') && segments[i - 1] && segments[i - 2]?.toLowerCase() === 'videos') {
      segments[i] = 'stream';
      changed = true;
      continue;
    }
    if (pathSegmentMap[lower] && segments[i] !== pathSegmentMap[lower]) {
      segments[i] = pathSegmentMap[lower];
      changed = true;
    }
  }
  if (changed) {
    const newPath = segments.join('/');
    const url = new URL(c.req.url);
    url.pathname = newPath;
    // 内部重写：构造新请求，保留 method/headers/body，让 Hono 重新路由
    const newReq = new Request(url.toString(), {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: c.req.raw.body,
      // @ts-ignore - duplex needed for streaming body
      duplex: 'half',
    });
    return app.fetch(newReq);
  }
  return next();
});

// 路由挂载
app.route('/System', systemRoutes);
app.route('/Branding', brandingRoutes);
app.route('/Users', usersRoutes);
app.route('/UserViews', viewsRoutes);
// 图片路由需要在 items 路由之前挂载，避免 /:itemId 先匹配
app.route('/Items', imagesRoutes);
app.route('/Items', itemsRoutes);
app.route('/Shows', showsRoutes);

// PlaybackInfo 挂载在 /Items 下
app.route('/Items', mediainfoRoutes);

// 视频流、HLS 转码和字幕
app.route('/Videos', videosRoutes);
app.route('/Videos', hlsRoutes);  // HLS 转码代理
app.route('/Videos', subtitlesRoutes);

// 播放状态同步
app.route('/Sessions', playbackRoutes);
app.route('/', playstateRoutes);

// 继续观看和收藏
app.route('/UserItems', resumeRoutes);
app.route('/', favoritesRoutes);

// QuickConnect - 不支持
app.get('/QuickConnect/Enabled', (c) => c.json(false));

// Sessions/Capabilities - 客户端能力上报
app.post('/Sessions/Capabilities', (c) => c.body(null, 204));
app.post('/Sessions/Capabilities/Full', (c) => c.body(null, 204));

// Localization 端点
app.get('/Localization/Countries', (c) => c.json([]));
app.get('/Localization/Cultures', (c) => c.json([]));
app.get('/Localization/ParentalRatings', (c) => c.json([]));

// DisplayPreferences
app.get('/DisplayPreferences/:id', (c) => {
  return c.json({
    Id: c.req.param('id') || 'usersettings',
    SortBy: 'SortName',
    SortOrder: 'Ascending',
    RememberIndexing: false,
    RememberSorting: false,
    CustomPrefs: {},
  });
});
app.post('/DisplayPreferences/:id', (c) => c.body(null, 204));

// Intros - 播放前的片头（不支持，返回空）
app.get('/Items/:itemId/Intros', (c) => {
  return c.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
});
app.get('/Users/:userId/Items/:itemId/Intros', (c) => {
  return c.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
});

// Similar - 相似推荐（返回空）
app.get('/Items/:itemId/Similar', (c) => {
  return c.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
});

// ThemeMedia - 主题音乐/视频（返回空）
app.get('/Items/:itemId/ThemeMedia', (c) => {
  return c.json({ ThemeVideosResult: { Items: [], TotalRecordCount: 0 }, ThemeSongsResult: { Items: [], TotalRecordCount: 0 }, SoundtrackSongsResult: { Items: [], TotalRecordCount: 0 } });
});

// SpecialFeatures - 特别收录（返回空）
app.get('/Items/:itemId/SpecialFeatures', (c) => c.json([]));
app.get('/Users/:userId/Items/:itemId/SpecialFeatures', (c) => c.json([]));

// SyncPlay - 不支持
app.get('/SyncPlay/List', (c) => c.json([]));

// Studios - 工作室列表（返回空）
app.get('/Studios', (c) => {
  return c.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
});

// System/Endpoint - 客户端端点信息
app.get('/System/Endpoint', (c) => {
  return c.json({ IsLocal: true, IsInNetwork: true });
});

// Playback/BitrateTest - 带宽测试
app.get('/Playback/BitrateTest', (c) => {
  const size = parseInt(c.req.query('Size') || '500000', 10);
  // 返回指定大小的随机数据，模拟带宽测试
  const data = new Uint8Array(Math.min(size, 1000000));
  c.header('Content-Type', 'application/octet-stream');
  return c.body(data, 200);
});

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

// 根路径重定向到 web UI
app.get('/', (c) => c.redirect('/web/index.html', 302));
app.get('/web', (c) => c.redirect('/web/index.html', 302));
app.get('/web/', (c) => c.redirect('/web/index.html', 302));

// Jellyfin Web UI 静态文件托管
const webDir = path.resolve(import.meta.dirname || '.', '..', 'web');
const hasWebUI = fs.existsSync(path.join(webDir, 'index.html'));

if (hasWebUI) {
  console.log(`[WEB] Jellyfin Web UI: ${webDir}`);
  // /web/foo.js → 从 bridge-node/web/foo.js 提供
  app.get('/web/*', serveStatic({
    root: './',
    rewriteRequestPath: (p) => p.replace(/^\/web/, '/web'),
  }));
} else {
  console.log('[WEB] 未找到 Jellyfin Web UI，WebView 客户端（Xbox/安卓官方）将无法使用');
  console.log(`[WEB] 运行 scripts/build-web.sh 构建 Web UI 到 ${webDir}`);
  app.get('/web/*', (c) => {
    return c.html('<!DOCTYPE html><html><head><title>fnos-bridge</title></head><body><h1>fnos-bridge</h1><p>Jellyfin Web UI 未安装。请运行 <code>scripts/build-web.sh</code> 构建。</p><p>或使用原生客户端（Findroid / Swiftfin / Jellyfin Media Player）连接。</p></body></html>');
  });
}

app.get('/favicon.ico', (c) => c.body(null, 204));

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
