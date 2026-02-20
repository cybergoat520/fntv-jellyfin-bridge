/// 飞牛影视 Authx 签名计算
///
/// 签名算法：
///   sign = MD5(api_key + "_" + url + "_" + nonce + "_" + timestamp + "_" + MD5(body) + "_" + api_secret)
///
/// 输出格式：
///   nonce={nonce}&timestamp={timestamp}&sign={sign}

use md5::{Digest, Md5};
use rand::Rng;
use std::time::{SystemTime, UNIX_EPOCH};

const API_KEY: &str = "NDzZTVxnRKP8Z0jXg1VAMonaG8akvh";
const API_SECRET: &str = "16CCEB3D-AB42-077D-36A1-F355324E4237";

pub fn md5_hex(text: &str) -> String {
    let mut hasher = Md5::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn generate_nonce() -> String {
    let mut rng = rand::thread_rng();
    rng.gen_range(100000..1000000).to_string()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub struct AuthxParams {
    pub nonce: String,
    pub timestamp: u64,
    pub sign: String,
}

pub fn generate_authx(url: &str, data: Option<&str>) -> AuthxParams {
    let nonce = generate_nonce();
    let timestamp = now_millis();
    let data_json = data.unwrap_or("");
    let data_md5 = md5_hex(data_json);
    let sign_str = format!(
        "{}_{}_{}_{}_{}_{}", API_KEY, url, nonce, timestamp, data_md5, API_SECRET
    );
    AuthxParams {
        nonce,
        timestamp,
        sign: md5_hex(&sign_str),
    }
}

pub fn generate_authx_string(url: &str, data: Option<&str>) -> String {
    let p = generate_authx(url, data);
    format!("nonce={}&timestamp={}&sign={}", p.nonce, p.timestamp, p.sign)
}
