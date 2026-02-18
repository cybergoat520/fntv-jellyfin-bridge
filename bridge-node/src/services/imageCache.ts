/**
 * 图片 URL 缓存
 * 在列表查询时缓存 poster/backdrop URL，供图片代理路由使用
 * 这样图片请求不需要再调用飞牛 API
 */

export interface CachedImage {
  poster?: string;
  backdrop?: string;
  server: string;
  token: string;
}

/** itemId (Jellyfin UUID) → 图片信息 */
const cache = new Map<string, CachedImage>();

export function setImageCache(itemId: string, data: CachedImage): void {
  cache.set(itemId, data);
}

export function getImageCache(itemId: string): CachedImage | undefined {
  return cache.get(itemId);
}

/** 批量设置 */
export function setImageCacheBatch(entries: Array<{ itemId: string; data: CachedImage }>): void {
  for (const { itemId, data } of entries) {
    cache.set(itemId, data);
  }
}
