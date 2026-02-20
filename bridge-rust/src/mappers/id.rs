/// ID 映射器
/// 飞牛 GUID (字符串) ↔ Jellyfin UUID (标准格式)
/// 使用 UUID v5 (基于 SHA-1 的确定性 UUID)

use dashmap::DashMap;
use sha1::{Digest, Sha1};
use std::sync::LazyLock;

/// 固定命名空间，用于 UUID v5 生成
const NAMESPACE: &str = "f6b5c8a0-3d2e-4f1a-9b8c-7d6e5f4a3b2c";

/// 反向查找缓存：Jellyfin UUID → 飞牛 GUID
static REVERSE_MAP: LazyLock<DashMap<String, String>> = LazyLock::new(DashMap::new);

/// media_guid → item_guid 映射
static MEDIA_TO_ITEM_MAP: LazyLock<DashMap<String, String>> = LazyLock::new(DashMap::new);

/// fnosGuid → 原始类型缓存
static TYPE_CACHE: LazyLock<DashMap<String, String>> = LazyLock::new(DashMap::new);

/// 注册飞牛项目的原始类型
pub fn register_item_type(fnos_guid: &str, item_type: &str) {
    TYPE_CACHE.insert(fnos_guid.to_string(), item_type.to_string());
}

/// 获取飞牛项目的原始类型
pub fn get_item_type(fnos_guid: &str) -> Option<String> {
    TYPE_CACHE.get(fnos_guid).map(|v| v.value().clone())
}

/// 将飞牛 GUID 转换为 Jellyfin UUID (v5)
/// 确定性：相同输入始终产生相同输出
pub fn to_jellyfin_id(fnos_guid: &str) -> String {
    let uuid = uuidv5(fnos_guid, NAMESPACE);
    REVERSE_MAP.insert(uuid.clone(), fnos_guid.to_string());
    uuid
}

/// 将 Jellyfin UUID 转换回飞牛 GUID
/// 依赖缓存，如果未找到返回 None
pub fn to_fnos_guid(jellyfin_id: &str) -> Option<String> {
    let lower = jellyfin_id.to_lowercase();
    // 先查 Jellyfin UUID → 飞牛 GUID 映射
    if let Some(v) = REVERSE_MAP.get(&lower) {
        return Some(v.value().clone());
    }
    // 再查 media_guid → item_guid 映射
    if let Some(v) = MEDIA_TO_ITEM_MAP.get(&lower) {
        return Some(v.value().clone());
    }
    None
}

/// 注册 media_guid → item_guid 映射
pub fn register_media_guid(media_guid: &str, item_guid: &str) {
    MEDIA_TO_ITEM_MAP.insert(media_guid.to_lowercase(), item_guid.to_string());
}

/// 注册 Jellyfin UUID → 飞牛 GUID 反向映射
pub fn register_reverse_mapping(jellyfin_id: &str, fnos_guid: &str) {
    REVERSE_MAP.insert(jellyfin_id.to_lowercase(), fnos_guid.to_string());
}

/// 生成确定性的服务器 ID
pub fn generate_server_id(server_url: &str) -> String {
    uuidv5(server_url, NAMESPACE)
}

/// UUID v5 实现 (基于 SHA-1)
/// 参考 RFC 4122
fn uuidv5(name: &str, namespace: &str) -> String {
    let ns_bytes = parse_uuid(namespace);
    let name_bytes = name.as_bytes();

    let mut hasher = Sha1::new();
    hasher.update(&ns_bytes);
    hasher.update(name_bytes);
    let hash = hasher.finalize();

    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hash[..16]);

    // 设置版本 (v5 = 0101) 和变体 (10xx)
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    format!(
        "{}-{}-{}-{}-{}",
        hex::encode(&bytes[0..4]),
        hex::encode(&bytes[4..6]),
        hex::encode(&bytes[6..8]),
        hex::encode(&bytes[8..10]),
        hex::encode(&bytes[10..16]),
    )
}

/// 解析 UUID 字符串为 16 字节
fn parse_uuid(uuid: &str) -> Vec<u8> {
    let hex_str: String = uuid.chars().filter(|c| *c != '-').collect();
    hex::decode(&hex_str).unwrap_or_else(|_| vec![0u8; 16])
}

/// hex encode/decode helpers (inline, no extra dep)
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
    }

    pub fn decode(s: &str) -> Result<Vec<u8>, ()> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|_| ()))
            .collect()
    }
}
