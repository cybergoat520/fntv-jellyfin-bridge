/**
 * 图片代理路由
 * 代理飞牛影视的海报和剧照图片
 */

import { Hono } from 'hono';
import { toFnosGuid } from '../mappers/id.ts';
import { optionalAuth } from '../middleware/auth.ts';
import { fnosGetPlayInfo } from '../services/fnos.ts';
import { FnosClient } from '../fnos-client/client.ts';
import { config } from '../config.ts';
import type { SessionData } from '../services/session.ts';

const images = new Hono();

/**
 * 图片缓存：itemId → { poster, backdrop }
 * 避免每次请求图片都调用飞牛 API
 */
const imageCache = new Map<string, { poster?: string; backdrop?: string; server?: string; token?: string }>();

/**
 * GET /Items/:itemId/Images/:imageType
 * GET /Items/:itemId/Images/:imageType/:imageIndex
 */
images.get('/:itemId/Images/:imageType/:imageIndex?', optionalAuth(), async (c) => {
  const session = c.get('session') as SessionData | undefined;
  const itemId = c.req.param('itemId');
  const imageType = c.req.param('imageType');

  if (!session) {
    return c.body(null, 401);
  }

  const fnosGuid = toFnosGuid(itemId);
  if (!fnosGuid) {
    return c.body(null, 404);
  }

  // 查缓存
  let cached = imageCache.get(itemId);
  if (!cached) {
    try {
      const result = await fnosGetPlayInfo(session.fnosServer, session.fnosToken, fnosGuid);
      if (result.success && result.data) {
        cached = {
          poster: result.data.item.posters,
          backdrop: result.data.item.still_path,
          server: session.fnosServer,
          token: session.fnosToken,
        };
        imageCache.set(itemId, cached);
      }
    } catch {
      return c.body(null, 404);
    }
  }

  if (!cached) {
    return c.body(null, 404);
  }

  // 选择图片路径
  let imagePath: string | undefined;
  switch (imageType.toLowerCase()) {
    case 'primary':
    case 'poster':
      imagePath = cached.poster;
      break;
    case 'backdrop':
    case 'thumb':
    case 'banner':
      imagePath = cached.backdrop || cached.poster;
      break;
    default:
      imagePath = cached.poster;
  }

  if (!imagePath) {
    return c.body(null, 404);
  }

  // 代理飞牛图片
  const server = cached.server || session.fnosServer;
  const token = cached.token || session.fnosToken;
  const imageUrl = imagePath.startsWith('http') ? imagePath : `${server}${imagePath}`;

  try {
    const client = new FnosClient(server, token, { ignoreCert: config.ignoreCert });
    // 直接用 axios 获取图片
    const axios = (await import('axios')).default;
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      headers: {
        'Authorization': token,
        'Cookie': 'mode=relay',
      },
      timeout: 15000,
    });

    const contentType = response.headers['content-type'] || 'image/jpeg';
    c.header('Content-Type', contentType);
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(response.data);
  } catch (e: any) {
    console.error('图片代理失败:', e.message);
    return c.body(null, 502);
  }
});

export default images;
