/// 用户信息映射器
/// 飞牛 UserInfo → Jellyfin UserDto

use crate::types::fnos::FnosUserInfo;
use crate::types::jellyfin::{UserConfiguration, UserDto, UserPolicy};

fn default_user_config() -> UserConfiguration {
    UserConfiguration {
        play_default_audio_track: true,
        subtitle_language_preference: String::new(),
        display_missing_episodes: false,
        subtitle_mode: "Default".into(),
        enable_local_password: false,
        ordered_views: vec![],
        latest_items_excludes: vec![],
        my_media_excludes: vec![],
        hide_played_in_latest: true,
        remember_audio_selections: true,
        remember_subtitle_selections: true,
        enable_next_episode_auto_play: true,
    }
}

fn default_user_policy() -> UserPolicy {
    UserPolicy {
        is_administrator: true,
        is_hidden: false,
        is_disabled: false,
        enable_user_preference_access: true,
        enable_remote_control: false,
        enable_shared_device_control: true,
        enable_remote_access: true,
        enable_live_tv_management: false,
        enable_live_tv_access: false,
        enable_media_playback: true,
        enable_audio_playback_transcoding: true,
        enable_video_playback_transcoding: true,
        enable_playback_remuxing: true,
        enable_content_deletion: false,
        enable_content_downloading: true,
        enable_sync_transcoding: false,
        enable_media_conversion: false,
        enable_all_devices: true,
        enable_all_channels: true,
        enable_all_folders: true,
        enable_public_sharing: false,
        invalid_login_attempt_count: 0,
        login_attempts_before_lockout: -1,
        max_active_sessions: 0,
        remote_client_bitrate_limit: 0,
        authentication_provider_id:
            "Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider".into(),
        password_reset_provider_id:
            "Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider".into(),
        sync_play_access: "CreateAndJoinGroups".into(),
    }
}

pub fn map_user_to_jellyfin(
    fnos_user: &FnosUserInfo,
    user_id: &str,
    server_id: &str,
) -> UserDto {
    let name = if !fnos_user.nickname.is_empty() {
        &fnos_user.nickname
    } else if !fnos_user.username.is_empty() {
        &fnos_user.username
    } else {
        "User"
    };

    let now = chrono::Utc::now().to_rfc3339();

    UserDto {
        name: name.to_string(),
        server_id: server_id.to_string(),
        id: user_id.to_string(),
        has_password: true,
        has_configured_password: true,
        has_configured_easy_password: false,
        enable_auto_login: false,
        last_login_date: Some(now.clone()),
        last_activity_date: Some(now),
        configuration: default_user_config(),
        policy: default_user_policy(),
    }
}
