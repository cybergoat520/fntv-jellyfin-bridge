/// Media 映射器
/// 飞牛 StreamList → Jellyfin MediaSource / MediaStream

use dashmap::DashMap;
use serde_json::json;
use std::sync::LazyLock;

use super::item::seconds_to_ticks;

/// 字幕信息
#[derive(Debug, Clone)]
pub struct SubtitleInfo {
    pub guid: String,
    pub fnos_stream_index: i32,
    pub language: String,
    pub title: String,
    pub codec: String,
    pub is_external: bool,
}

/// 字幕信息映射缓存 (key: "{mediaSourceId}:{index}")
static SUBTITLE_INFO_MAP: LazyLock<DashMap<String, SubtitleInfo>> = LazyLock::new(DashMap::new);

pub fn register_subtitle_info(media_source_id: &str, index: i32, info: SubtitleInfo) {
    let key = format!("{}:{}", media_source_id, index);
    SUBTITLE_INFO_MAP.insert(key, info);
}

pub fn get_subtitle_info(media_source_id: &str, index: i32) -> Option<SubtitleInfo> {
    let key = format!("{}:{}", media_source_id, index);
    SUBTITLE_INFO_MAP.get(&key).map(|v| v.value().clone())
}

/// 浏览器兼容的音频编解码器
const BROWSER_COMPATIBLE_CODECS: &[&str] = &["aac", "mp3", "flac", "opus", "vorbis", "pcm_s16le", "pcm_f32le"];

/// 飞牛视频流 → Jellyfin MediaStream
fn map_video_stream(vs: &serde_json::Value, index: i32) -> serde_json::Value {
    let codec = vs["codec_name"].as_str().unwrap_or("h264");
    let height = vs["height"].as_i64().unwrap_or(0);
    let width = vs["width"].as_i64().unwrap_or(0);

    json!({
        "Id": format!("{}", index),
        "Codec": codec,
        "IsInterlaced": !vs["progressive"].as_bool().unwrap_or(true),
        "BitRate": vs["bps"].as_i64(),
        "BitDepth": vs["bit_depth"].as_i64(),
        "RefFrames": vs["refs"].as_i64(),
        "IsDefault": true,
        "IsForced": false,
        "IsExternal": false,
        "Height": height,
        "Width": width,
        "AverageFrameRate": parse_frame_rate(vs["avg_frame_rate"].as_str().unwrap_or("")),
        "RealFrameRate": parse_frame_rate(vs["r_frame_rate"].as_str().unwrap_or("")),
        "Profile": vs["profile"].as_str(),
        "Type": "Video",
        "AspectRatio": vs["display_aspect_ratio"].as_str(),
        "Index": index,
        "PixelFormat": vs["pix_fmt"].as_str(),
        "Level": vs["level"].as_i64(),
        "ColorSpace": vs["color_space"].as_str(),
        "ColorTransfer": vs["color_transfer"].as_str(),
        "ColorPrimaries": vs["color_primaries"].as_str(),
        "DisplayTitle": format_video_title(vs),
    })
}

/// 飞牛音频流 → Jellyfin MediaStream
fn map_audio_stream(audio: &serde_json::Value, index: i32) -> serde_json::Value {
    let codec = audio["codec_name"].as_str().unwrap_or("aac");
    let is_default = audio["is_default"].as_i64().unwrap_or(0) == 1
        || audio["is_default"].as_bool().unwrap_or(false);

    json!({
        "Id": format!("{}", index),
        "Codec": codec,
        "Language": audio["language"].as_str(),
        "IsInterlaced": false,
        "BitRate": audio["bps"].as_i64(),
        "IsDefault": is_default,
        "IsForced": false,
        "IsExternal": false,
        "Type": "Audio",
        "Index": index,
        "ChannelLayout": audio["channel_layout"].as_str(),
        "Channels": audio["channels"].as_i64(),
        "SampleRate": audio["sample_rate"].as_str().and_then(|s| s.parse::<i64>().ok()),
        "Profile": audio["profile"].as_str(),
        "Title": audio["title"].as_str(),
        "DisplayTitle": format_audio_title(audio),
        "DisplayLanguage": audio["language"].as_str(),
    })
}

/// 飞牛字幕流 → Jellyfin MediaStream
fn map_subtitle_stream(ss: &serde_json::Value, index: i32) -> serde_json::Value {
    let is_text = !ss["is_bitmap"].as_bool().unwrap_or(false);
    let codec = ss["codec_name"].as_str()
        .or_else(|| ss["format"].as_str())
        .unwrap_or("srt");
    let is_default = ss["is_default"].as_i64().unwrap_or(0) == 1
        || ss["is_default"].as_bool().unwrap_or(false);
    let title = ss["title"].as_str().unwrap_or("");
    let language = ss["language"].as_str().unwrap_or("");
    let display = if !title.is_empty() {
        title.to_string()
    } else if !language.is_empty() {
        language.to_string()
    } else {
        format!("字幕 {}", index)
    };

    json!({
        "Id": format!("{}", index),
        "Codec": codec,
        "Language": if language.is_empty() { serde_json::Value::Null } else { json!(language) },
        "IsInterlaced": false,
        "IsDefault": is_default,
        "IsForced": ss["forced"].as_i64().unwrap_or(0) == 1,
        "IsExternal": true,  // 只处理外挂字幕
        "Type": "Subtitle",
        "Index": index,
        "Title": if title.is_empty() { serde_json::Value::Null } else { json!(title) },
        "DisplayTitle": display,
        "IsTextSubtitleStream": is_text,
        "SupportsExternalStream": is_text,
    })
}

/// 构造单个 MediaSourceInfo
fn build_single_media_source(
    media_guid: &str,
    file_name: &str,
    video_streams: &[&serde_json::Value],
    audio_streams: &[&serde_json::Value],
    subtitle_streams: &[&serde_json::Value],
    file_info: Option<&serde_json::Value>,
    duration: f64,
    video_stream_url: &str,
) -> serde_json::Value {
    let mut stream_index: i32 = 0;
    let mut media_streams = Vec::new();

    // 视频流
    for vs in video_streams {
        media_streams.push(map_video_stream(vs, stream_index));
        stream_index += 1;
    }

    // 音频流
    let audio_start_index = stream_index;
    for audio in audio_streams {
        media_streams.push(map_audio_stream(audio, stream_index));
        stream_index += 1;
    }

    // 默认音频：优先浏览器兼容
    let mut default_audio_index = audio_start_index;
    for (i, audio) in audio_streams.iter().enumerate() {
        let codec = audio["codec_name"].as_str().unwrap_or("").to_lowercase();
        if BROWSER_COMPATIBLE_CODECS.contains(&codec.as_str()) {
            default_audio_index = audio_start_index + i as i32;
            break;
        }
    }

    // 字幕流 - 仅保留外挂字幕（内嵌字幕需 Range 抓取文件解析，开发成本高，暂不实现）
    for ss in subtitle_streams {
        let is_external = ss["is_external"].as_i64().unwrap_or(0) == 1;
        
        // 跳过内嵌字幕，只处理外挂字幕
        if !is_external {
            continue;
        }
        
        let sub_index = stream_index;
        stream_index += 1;
        let mut sub_stream = map_subtitle_stream(ss, sub_index);

        // 外挂字幕支持外部流传输
        sub_stream["DeliveryMethod"] = json!("External");
        sub_stream["DeliveryUrl"] = json!(format!(
            "/Videos/{}/{}/Subtitles/{}/Stream.vtt",
            media_guid, media_guid, sub_index
        ));

        media_streams.push(sub_stream);

        // 注册字幕信息
        if let Some(guid) = ss["guid"].as_str() {
            if !guid.is_empty() {
                register_subtitle_info(media_guid, sub_index, SubtitleInfo {
                    guid: guid.to_string(),
                    fnos_stream_index: ss["index"].as_i64().unwrap_or(sub_index as i64) as i32,
                    language: ss["language"].as_str().unwrap_or("").to_string(),
                    title: ss["title"].as_str().unwrap_or("").to_string(),
                    codec: ss["codec_name"].as_str()
                        .or_else(|| ss["format"].as_str())
                        .unwrap_or("srt")
                        .to_string(),
                    is_external: true,
                });
            }
        }
    }

    // 容器格式
    let container = if !file_name.is_empty() {
        file_name.rsplit('.').next().unwrap_or("mkv")
    } else {
        "mkv"
    };

    // 显示名称
    let vs0 = video_streams.first();
    tracing::debug!("[MEDIA] file_name={}, video_streams={}, audio_streams={}, file_info={:?}",
        file_name, video_streams.len(), audio_streams.len(),
        file_info.map(|f| f.to_string()).unwrap_or_default()
    );
    if let Some(vs) = video_streams.first() {
        tracing::debug!("[MEDIA] video_stream[0]: {}", vs);
    }
    let display_name = if let Some(vs) = vs0 {
        let codec = vs["codec_name"].as_str().unwrap_or("");
        let height = vs["height"].as_i64().unwrap_or(0);
        if codec.is_empty() && height == 0 {
            // 远程文件：视频流信息为空
            format_remote_file_name(file_info)
        } else {
            let mut name = format_video_title(vs);
            if let Some(fi) = file_info {
                if let Some(size) = fi["size"].as_i64() {
                    let size_mb = size / 1024 / 1024;
                    if size_mb > 1024 {
                        name = format!("{} ({:.1}GB)", name, size_mb as f64 / 1024.0);
                    } else {
                        name = format!("{} ({}MB)", name, size_mb);
                    }
                }
            }
            name
        }
    } else {
        format_remote_file_name(file_info)
    };

    // 检测是否需要转码
    let has_compatible_audio = audio_streams.iter().any(|a| {
        let codec = a["codec_name"].as_str().unwrap_or("").to_lowercase();
        BROWSER_COMPATIBLE_CODECS.contains(&codec.as_str())
    });
    let needs_transcoding = !audio_streams.is_empty() && !has_compatible_audio;
    let transcoding_url = format!("/Videos/{}/hls/main.m3u8", media_guid);

    let mut source = json!({
        "Protocol": "Http",
        "Id": media_guid,
        "Path": video_stream_url,
        "Type": "Default",
        "Container": container,
        "Name": display_name,
        "IsRemote": false,
        "SupportsTranscoding": true,
        "SupportsDirectStream": !needs_transcoding,
        "SupportsDirectPlay": false,
        "IsInfiniteStream": false,
        "RequiresOpening": false,
        "RequiresClosing": false,
        "RequiresLooping": false,
        "SupportsProbing": false,
        "MediaStreams": media_streams,
        "ReadAtNativeFramerate": false,
        "DirectStreamUrl": video_stream_url,
        "RequiredHttpHeaders": [],
        "TranscodingUrl": transcoding_url,
        "TranscodingContainer": "ts",
    });

    if let Some(fi) = file_info {
        if let Some(size) = fi["size"].as_i64() {
            source["Size"] = json!(size);
        }
    }
    if duration > 0.0 {
        source["RunTimeTicks"] = json!(seconds_to_ticks(duration));
    }
    if !audio_streams.is_empty() {
        source["DefaultAudioStreamIndex"] = json!(default_audio_index);
    }
    if let Some(vs) = vs0 {
        if let Some(bps) = vs["bps"].as_i64() {
            source["Bitrate"] = json!(bps);
        }
    }
    if needs_transcoding {
        source["TranscodingSubProtocol"] = json!("hls");
    }

    source
}

/// 按 media_guid 分组构造多个 MediaSource
pub fn build_media_sources(
    item_id: &str,
    files: &[serde_json::Value],
    video_streams: &[serde_json::Value],
    audio_streams: &[serde_json::Value],
    subtitle_streams: &[serde_json::Value],
    duration: f64,
) -> Vec<serde_json::Value> {
    // 收集所有 media_guid
    let mut media_guids: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for vs in video_streams {
        if let Some(mg) = vs["media_guid"].as_str() {
            if !mg.is_empty() && seen.insert(mg.to_string()) {
                media_guids.push(mg.to_string());
            }
        }
    }

    if media_guids.is_empty() {
        let file_info = files.first();
        let media_guid = file_info
            .and_then(|f| f["guid"].as_str())
            .unwrap_or("unknown");
        let file_name = file_info
            .and_then(|f| f["path"].as_str())
            .and_then(|p| p.rsplit('/').next())
            .unwrap_or("video");
        let url = format!("/Videos/{}/stream?static=true&mediaSourceId={}", item_id, media_guid);
        let vs_refs: Vec<&serde_json::Value> = video_streams.iter().collect();
        let as_refs: Vec<&serde_json::Value> = audio_streams.iter().collect();
        let ss_refs: Vec<&serde_json::Value> = subtitle_streams.iter().collect();
        return vec![build_single_media_source(
            media_guid, file_name, &vs_refs, &as_refs, &ss_refs, file_info, duration, &url,
        )];
    }

    // 按分辨率降序排列
    media_guids.sort_by(|a, b| {
        let ha = video_streams.iter()
            .find(|v| v["media_guid"].as_str() == Some(a.as_str()))
            .and_then(|v| v["height"].as_i64())
            .unwrap_or(0);
        let hb = video_streams.iter()
            .find(|v| v["media_guid"].as_str() == Some(b.as_str()))
            .and_then(|v| v["height"].as_i64())
            .unwrap_or(0);
        hb.cmp(&ha)
    });

    let mut sources = Vec::new();
    for mg in &media_guids {
        let my_vs: Vec<&serde_json::Value> = video_streams.iter()
            .filter(|v| v["media_guid"].as_str() == Some(mg.as_str()))
            .collect();
        let my_as: Vec<&serde_json::Value> = audio_streams.iter()
            .filter(|a| a["media_guid"].as_str() == Some(mg.as_str()))
            .collect();
        let my_ss: Vec<&serde_json::Value> = subtitle_streams.iter()
            .filter(|s| s["media_guid"].as_str() == Some(mg.as_str()))
            .collect();
        let my_file = files.iter().find(|f| f["guid"].as_str() == Some(mg.as_str()));
        let file_name = my_file
            .and_then(|f| f["path"].as_str())
            .and_then(|p| p.rsplit('/').next())
            .unwrap_or("video");
        let url = format!("/Videos/{}/stream?static=true&mediaSourceId={}", item_id, mg);

        sources.push(build_single_media_source(
            mg, file_name, &my_vs, &my_as, &my_ss, my_file, duration, &url,
        ));
    }

    sources
}

/// 解析帧率字符串 "24000/1001" → 23.976
fn parse_frame_rate(rate: &str) -> Option<f64> {
    if rate.is_empty() {
        return None;
    }
    if let Some((num_s, den_s)) = rate.split_once('/') {
        let num: f64 = num_s.parse().ok()?;
        let den: f64 = den_s.parse().ok()?;
        if den > 0.0 {
            return Some((num / den * 1000.0).round() / 1000.0);
        }
    }
    rate.parse().ok()
}

fn format_remote_file_name(file_info: Option<&serde_json::Value>) -> String {
    if let Some(fi) = file_info {
        if let Some(size) = fi["size"].as_i64() {
            let size_mb = size / 1024 / 1024;
            if size_mb > 1024 {
                return format!("远程文件 ({:.1}GB)", size_mb as f64 / 1024.0);
            } else {
                return format!("远程文件 ({}MB)", size_mb);
            }
        }
    }
    "远程文件".to_string()
}

fn format_video_title(vs: &serde_json::Value) -> String {
    let mut parts = Vec::new();
    if let Some(rt) = vs["resolution_type"].as_str() {
        if !rt.is_empty() {
            parts.push(rt.to_string());
        }
    } else if let Some(h) = vs["height"].as_i64() {
        if h > 0 {
            parts.push(format!("{}p", h));
        }
    }
    if let Some(codec) = vs["codec_name"].as_str() {
        parts.push(codec.to_uppercase());
    }
    if let Some(cr) = vs["color_range_type"].as_str() {
        if cr != "SDR" && !cr.is_empty() {
            parts.push(cr.to_string());
        }
    }
    if parts.is_empty() { "Video".into() } else { parts.join(" ") }
}

fn format_audio_title(audio: &serde_json::Value) -> String {
    if let Some(title) = audio["title"].as_str() {
        if !title.is_empty() {
            return title.to_string();
        }
    }
    let mut parts = Vec::new();
    if let Some(lang) = audio["language"].as_str() {
        if !lang.is_empty() { parts.push(lang.to_string()); }
    }
    if let Some(codec) = audio["codec_name"].as_str() {
        parts.push(codec.to_uppercase());
    }
    if let Some(layout) = audio["channel_layout"].as_str() {
        if !layout.is_empty() { parts.push(layout.to_string()); }
    }
    if parts.is_empty() { "Audio".into() } else { parts.join(" ") }
}
