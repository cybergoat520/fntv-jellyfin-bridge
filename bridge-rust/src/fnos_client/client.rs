/// 飞牛影视 HTTP 客户端
/// 内置 Authx 签名、重定向处理、签名错误重试

use reqwest::Client;
use serde::de::DeserializeOwned;
use serde::Deserialize;
use tracing::{debug, warn};

use super::signature::{generate_authx_string, generate_nonce};

#[derive(Debug, Deserialize)]
pub struct FnosApiResponse<T> {
    pub code: i32,
    pub msg: String,
    pub data: T,
}

#[derive(Debug, Clone)]
pub struct RequestResult<T> {
    pub success: bool,
    pub data: Option<T>,
    pub message: Option<String>,
    pub move_url: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FnosClientOptions {
    pub timeout_ms: u64,
    pub max_retries: u32,
    pub retry_delay_ms: u64,
    pub ignore_cert: bool,
}

impl Default for FnosClientOptions {
    fn default() -> Self {
        Self {
            timeout_ms: 10000,
            max_retries: 5,
            retry_delay_ms: 100,
            ignore_cert: false,
        }
    }
}

#[derive(Clone)]
pub struct FnosClient {
    server: String,
    token: String,
    options: FnosClientOptions,
    http: Client,
}

impl FnosClient {
    pub fn new(server: &str, token: &str, options: FnosClientOptions) -> Self {
        let http = Client::builder()
            .timeout(std::time::Duration::from_millis(options.timeout_ms))
            .redirect(reqwest::redirect::Policy::none())
            .danger_accept_invalid_certs(options.ignore_cert)
            .build()
            .expect("Failed to build HTTP client");

        Self {
            server: server.to_string(),
            token: token.to_string(),
            options,
            http,
        }
    }

    pub fn server(&self) -> &str {
        &self.server
    }

    pub fn token(&self) -> &str {
        &self.token
    }

    pub async fn request<T: DeserializeOwned + Send>(
        &self,
        method: &str,
        url: &str,
        data: Option<serde_json::Value>,
    ) -> RequestResult<T> {
        self.request_internal(&self.server, method, url, data, self.options.max_retries)
            .await
    }

    fn request_internal<'a, T: DeserializeOwned + Send>(
        &'a self,
        base_url: &'a str,
        method: &'a str,
        url: &'a str,
        data: Option<serde_json::Value>,
        retries_left: u32,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = RequestResult<T>> + Send + 'a>>
    where
        T: 'a,
    {
        // Need to box the future for recursive async
        let data_clone = data.clone();
        Box::pin(async move {
            // Inject nonce for POST/PUT/DELETE
            let body_data = match method {
                "post" | "put" | "delete" => {
                    let mut d = data_clone.unwrap_or(serde_json::Value::Object(Default::default()));
                    if let Some(obj) = d.as_object_mut() {
                        obj.insert("nonce".into(), serde_json::Value::String(generate_nonce()));
                    }
                    Some(d)
                }
                _ => data_clone,
            };

            let body_str = body_data
                .as_ref()
                .map(|d| serde_json::to_string(d).unwrap_or_default());
            let authx = generate_authx_string(url, body_str.as_deref());
            let full_url = format!("{}{}", base_url, url);

            debug!("[FNOS] {} {} (retries={})", method.to_uppercase(), full_url, retries_left);

            for attempt in 0..=retries_left {
                let mut req_builder = match method {
                    "get" => self.http.get(&full_url),
                    "post" => self.http.post(&full_url),
                    "put" => self.http.put(&full_url),
                    "delete" => self.http.delete(&full_url),
                    _ => {
                        return RequestResult {
                            success: false,
                            data: None,
                            message: Some(format!("Unsupported method: {}", method)),
                            move_url: None,
                        };
                    }
                };

                req_builder = req_builder
                    .header("Content-Type", "application/json")
                    .header("Cookie", "mode=relay")
                    .header("Authx", &authx);

                if !self.token.is_empty() {
                    req_builder = req_builder.header("Authorization", &self.token);
                }

                if let Some(ref body) = body_data {
                    if method != "get" {
                        req_builder = req_builder.json(body);
                    }
                }

                match req_builder.send().await {
                    Ok(response) => {
                        let status = response.status().as_u16();

                        // Handle redirects
                        if matches!(status, 301 | 302 | 307 | 308) {
                            if let Some(location) = response.headers().get("location") {
                                if let Ok(loc_str) = location.to_str() {
                                    let (new_base, new_path) = if loc_str.starts_with("http") {
                                        if let Ok(parsed) = reqwest::Url::parse(loc_str) {
                                            let base = format!(
                                                "{}://{}",
                                                parsed.scheme(),
                                                parsed.host_str().unwrap_or("localhost")
                                            );
                                            let port_suffix = parsed
                                                .port()
                                                .map(|p| format!(":{}", p))
                                                .unwrap_or_default();
                                            let full_base = format!("{}{}", base, port_suffix);
                                            let path = format!(
                                                "{}{}",
                                                parsed.path(),
                                                parsed
                                                    .query()
                                                    .map(|q| format!("?{}", q))
                                                    .unwrap_or_default()
                                            );
                                            (full_base, path)
                                        } else {
                                            (base_url.to_string(), loc_str.to_string())
                                        }
                                    } else {
                                        (base_url.to_string(), loc_str.to_string())
                                    };

                                    let mut result: RequestResult<T> = self
                                        .request_internal(
                                            &new_base,
                                            method,
                                            &new_path,
                                            body_data.clone(),
                                            retries_left.saturating_sub(1),
                                        )
                                        .await;
                                    if result.move_url.is_none() {
                                        result.move_url = Some(new_base);
                                    }
                                    return result;
                                }
                            }
                        }

                        // Check content type
                        let content_type = response
                            .headers()
                            .get("content-type")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("")
                            .to_string();

                        let body_text = match response.text().await {
                            Ok(t) => t,
                            Err(e) => {
                                return RequestResult {
                                    success: false,
                                    data: None,
                                    message: Some(format!("Failed to read response: {}", e)),
                                    move_url: None,
                                };
                            }
                        };

                        if !content_type.contains("application/json") {
                            // Try to parse as T anyway
                            match serde_json::from_str::<T>(&body_text) {
                                Ok(d) => {
                                    return RequestResult {
                                        success: true,
                                        data: Some(d),
                                        message: None,
                                        move_url: None,
                                    };
                                }
                                Err(_) => {
                                    return RequestResult {
                                        success: true,
                                        data: None,
                                        message: Some("Non-JSON response".into()),
                                        move_url: None,
                                    };
                                }
                            }
                        }

                        // Parse JSON response
                        match serde_json::from_str::<FnosApiResponse<T>>(&body_text) {
                            Ok(res) => {
                                // Signature error retry
                                if res.code == 5000 && res.msg == "invalid sign" {
                                    if attempt >= retries_left {
                                        return RequestResult {
                                            success: false,
                                            data: None,
                                            message: Some(format!(
                                                "签名错误，已重试 {} 次",
                                                attempt + 1
                                            )),
                                            move_url: None,
                                        };
                                    }
                                    tokio::time::sleep(std::time::Duration::from_millis(
                                        self.options.retry_delay_ms,
                                    ))
                                    .await;
                                    continue;
                                }

                                if res.code != 0 {
                                    return RequestResult {
                                        success: false,
                                        data: None,
                                        message: Some(
                                            if res.msg.is_empty() {
                                                format!("业务错误 code={}", res.code)
                                            } else {
                                                res.msg
                                            },
                                        ),
                                        move_url: None,
                                    };
                                }

                                return RequestResult {
                                    success: true,
                                    data: Some(res.data),
                                    message: None,
                                    move_url: None,
                                };
                            }
                            Err(e) => {
                                return RequestResult {
                                    success: false,
                                    data: None,
                                    message: Some(format!("JSON parse error: {} body={}", e, &body_text[..body_text.len().min(200)])),
                                    move_url: None,
                                };
                            }
                        }
                    }
                    Err(e) => {
                        warn!(
                            "[FNOS] Request failed (attempt {}/{}): {}",
                            attempt + 1,
                            retries_left + 1,
                            e
                        );
                        if attempt >= retries_left {
                            return RequestResult {
                                success: false,
                                data: None,
                                message: Some(e.to_string()),
                                move_url: None,
                            };
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(
                            self.options.retry_delay_ms,
                        ))
                        .await;
                    }
                }
            }

            RequestResult {
                success: false,
                data: None,
                message: Some("重试逻辑异常".into()),
                move_url: None,
            }
        })
    }
}
