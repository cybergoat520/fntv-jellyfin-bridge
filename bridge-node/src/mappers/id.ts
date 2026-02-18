/**
 * ID 映射器
 * 飞牛 GUID (字符串) ↔ Jellyfin UUID (标准格式)
 * 使用 UUID v5 (基于 SHA-1 的确定性 UUID)
 */

import { createHash } from 'node:crypto';

/** 固定命名空间，用于 UUID v5 生成 */
const NAMESPACE = 'f6b5c8a0-3d2e-4f1a-9b8c-7d6e5f4a3b2c';

/** 反向查找缓存：Jellyfin UUID → 飞牛 GUID */
const reverseMap = new Map<string, string>();

/** media_guid → item_guid 映射（用于 getItem 查找） */
const mediaToItemMap = new Map<string, string>();

/**
 * 将飞牛 GUID 转换为 Jellyfin UUID (v5)
 * 确定性：相同输入始终产生相同输出
 */
export function toJellyfinId(fnosGuid: string): string {
  const uuid = uuidv5(fnosGuid, NAMESPACE);
  reverseMap.set(uuid, fnosGuid);
  return uuid;
}

/**
 * 将 Jellyfin UUID 转换回飞牛 GUID
 * 依赖缓存，如果未找到返回 null
 */
export function toFnosGuid(jellyfinId: string): string | null {
  // 先查 Jellyfin UUID → 飞牛 GUID 映射
  const direct = reverseMap.get(jellyfinId.toLowerCase());
  if (direct) return direct;

  // 再查 media_guid → item_guid 映射（jellyfin-web 用 mediaSourceId 调用 getItem）
  const fromMedia = mediaToItemMap.get(jellyfinId.toLowerCase());
  if (fromMedia) return fromMedia;

  return null;
}

/**
 * 注册 media_guid → item_guid 映射
 * 用于 jellyfin-web 用 mediaSourceId 调用 getItem 时的查找
 */
export function registerMediaGuid(mediaGuid: string, itemGuid: string): void {
  mediaToItemMap.set(mediaGuid.toLowerCase(), itemGuid);
}

/**
 * 生成确定性的服务器 ID
 * 基于飞牛服务器地址
 */
export function generateServerId(serverUrl: string): string {
  return uuidv5(serverUrl, NAMESPACE);
}

/**
 * UUID v5 实现 (基于 SHA-1)
 * 参考 RFC 4122
 */
function uuidv5(name: string, namespace: string): string {
  // 解析命名空间 UUID 为字节
  const nsBytes = parseUuid(namespace);
  const nameBytes = Buffer.from(name, 'utf-8');

  // SHA-1(namespace + name)
  const hash = createHash('sha1')
    .update(nsBytes)
    .update(nameBytes)
    .digest();

  // 设置版本 (v5 = 0101) 和变体 (10xx)
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  // 格式化为 UUID 字符串
  const hex = hash.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** 解析 UUID 字符串为 16 字节 Buffer */
function parseUuid(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}
