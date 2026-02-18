/**
 * 图片代理路由
 * 代理飞牛影视的海报和剧照图片
 * 
 * 图片 URL 在列表查询时已缓存到 imageCache，
 * 这里直接用缓存的 poster 路径代理，不需要认证。
 */

import { Hono } from 'hono';
import { getImageCache, setImageCache } from '../services/imageCache.ts';
import { toFnosGuid } from '../mappers/id.ts';
import { optionalAuth } from '../middleware/auth.ts';
import { fnosGetPlayInfo } from '../services/fnos.ts';
import { generateAuthxString } from '../fnos-client/signature.ts';
import { config } from '../config.ts';
import type { SessionData } from '../services/session.ts';

const images = new Hono();

/**
 * GET /Items/:itemId/Images/:imageType
 * GET /Items/:itemId/Images/:imageType/:imageIndex
 * 
 * 不要求认证 — 浏览器 <img> 标签不会带 auth header
 * 优先从 imageCache 获取 poster URL，fallback 到 fnosGetPlayInfo
 */
images.get('/:itemId/Images/:imageType/:imageIndex?', optionalAuth(), async (c) => {
  const itemId = c.req.param('itemId');
  const imageType = c.req.param('imageType');

  // 1. 先查缓存
  let cached = getImageCache(itemId);

  // 2. 缓存未命中，尝试用 session 调 API
  if (!cached) {
    const session = c.get('session') as SessionData | undefined;
    if (session) {
      const fnosGuid = toFnosGuid(itemId);
      if (fnosGuid) {
        try {
          const result = await fnosGetPlayInfo(session.fnosServer, session.fnosToken, fnosGuid);
          if (result.success && result.data) {
            cached = {
              poster: result.data.item.posters,
              backdrop: result.data.item.still_path,
              server: session.fnosServer,
              token: session.fnosToken,
            };
            setImageCache(itemId, cached);
          }
        } catch {
          // ignore
        }
      }
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

  // 构造完整图片 URL
  // 飞牛的 poster 路径格式: /xx/yy/hash.webp
  // 完整 API 路径: /v/api/v1/sys/img/xx/yy/hash.webp
  const server = cached.server;
  let imageUrl: string;
  if (imagePath.startsWith('http')) {
    imageUrl = imagePath;
  } else if (imagePath.startsWith('/v/api/')) {
    imageUrl = `${server}${imagePath}`;
  } else {
    // poster 路径是相对的，需要加上 /v/api/v1/sys/img 前缀
    const cleanPath = imagePath.startsWith('/') ? imagePath : `/${imagePath}`;
    imageUrl = `${server}/v/api/v1/sys/img${cleanPath}`;
  }

  // 添加尺寸参数
  const fillWidth = c.req.query('fillWidth') || c.req.query('maxWidth');
  let finalUrl = imageUrl;
  if (fillWidth && !imageUrl.includes('w=')) {
    const sep = imageUrl.includes('?') ? '&' : '?';
    finalUrl = `${imageUrl}${sep}w=${fillWidth}`;
  }

  try {
    // 从 URL 中提取 API 路径用于签名
    const urlObj = new URL(finalUrl);
    const apiPath = urlObj.pathname;
    const authx = generateAuthxString(apiPath);
    const token = cached.token || '';

    const resp = await fetch(finalUrl, {
      headers: {
        'Cookie': 'mode=relay',
        'Authx': authx,
        'Authorization': token,
      },
    });

    if (!resp.ok) {
      return c.body(null, resp.status as any);
    }

    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const body = await resp.arrayBuffer();

    c.header('Content-Type', contentType);
    c.header('Cache-Control', 'public, max-age=86400');
    return c.body(new Uint8Array(body));
  } catch (e: any) {
    console.error('图片代理失败:', e.message);
    return c.body(null, 502);
  }
});

export default images;
