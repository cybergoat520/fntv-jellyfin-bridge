/// Jellyfin API 类型定义

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicSystemInfo {
    #[serde(rename = "LocalAddress")]
    pub local_address: String,
    #[serde(rename = "ServerName")]
    pub server_name: String,
    #[serde(rename = "Version")]
    pub version: String,
    #[serde(rename = "ProductName")]
    pub product_name: String,
    #[serde(rename = "OperatingSystem")]
    pub operating_system: String,
    #[serde(rename = "Id")]
    pub id: String,
    #[serde(rename = "StartupWizardCompleted")]
    pub startup_wizard_completed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemInfo {
    #[serde(flatten)]
    pub public: PublicSystemInfo,
    #[serde(rename = "OperatingSystemDisplayName")]
    pub os_display_name: String,
    #[serde(rename = "HasPendingRestart")]
    pub has_pending_restart: bool,
    #[serde(rename = "IsShuttingDown")]
    pub is_shutting_down: bool,
    #[serde(rename = "SupportsLibraryMonitor")]
    pub supports_library_monitor: bool,
    #[serde(rename = "WebSocketPortNumber")]
    pub websocket_port: u16,
    #[serde(rename = "CanSelfRestart")]
    pub can_self_restart: bool,
    #[serde(rename = "CanLaunchWebBrowser")]
    pub can_launch_web_browser: bool,
    #[serde(rename = "HasUpdateAvailable")]
    pub has_update_available: bool,
    #[serde(rename = "TranscodingTempPath")]
    pub transcoding_temp_path: String,
    #[serde(rename = "LogPath")]
    pub log_path: String,
    #[serde(rename = "InternalMetadataPath")]
    pub internal_metadata_path: String,
    #[serde(rename = "CachePath")]
    pub cache_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrandingOptions {
    #[serde(rename = "LoginDisclaimer")]
    pub login_disclaimer: String,
    #[serde(rename = "CustomCss")]
    pub custom_css: String,
    #[serde(rename = "SplashscreenEnabled")]
    pub splashscreen_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserDto {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "ServerId")]
    pub server_id: String,
    #[serde(rename = "Id")]
    pub id: String,
    #[serde(rename = "HasPassword")]
    pub has_password: bool,
    #[serde(rename = "HasConfiguredPassword")]
    pub has_configured_password: bool,
    #[serde(rename = "HasConfiguredEasyPassword")]
    pub has_configured_easy_password: bool,
    #[serde(rename = "EnableAutoLogin")]
    pub enable_auto_login: bool,
    #[serde(rename = "LastLoginDate")]
    pub last_login_date: Option<String>,
    #[serde(rename = "LastActivityDate")]
    pub last_activity_date: Option<String>,
    #[serde(rename = "Configuration")]
    pub configuration: UserConfiguration,
    #[serde(rename = "Policy")]
    pub policy: UserPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserConfiguration {
    #[serde(rename = "PlayDefaultAudioTrack")]
    pub play_default_audio_track: bool,
    #[serde(rename = "SubtitleLanguagePreference")]
    pub subtitle_language_preference: String,
    #[serde(rename = "DisplayMissingEpisodes")]
    pub display_missing_episodes: bool,
    #[serde(rename = "SubtitleMode")]
    pub subtitle_mode: String,
    #[serde(rename = "EnableLocalPassword")]
    pub enable_local_password: bool,
    #[serde(rename = "OrderedViews")]
    pub ordered_views: Vec<String>,
    #[serde(rename = "LatestItemsExcludes")]
    pub latest_items_excludes: Vec<String>,
    #[serde(rename = "MyMediaExcludes")]
    pub my_media_excludes: Vec<String>,
    #[serde(rename = "HidePlayedInLatest")]
    pub hide_played_in_latest: bool,
    #[serde(rename = "RememberAudioSelections")]
    pub remember_audio_selections: bool,
    #[serde(rename = "RememberSubtitleSelections")]
    pub remember_subtitle_selections: bool,
    #[serde(rename = "EnableNextEpisodeAutoPlay")]
    pub enable_next_episode_auto_play: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserPolicy {
    #[serde(rename = "IsAdministrator")]
    pub is_administrator: bool,
    #[serde(rename = "IsHidden")]
    pub is_hidden: bool,
    #[serde(rename = "IsDisabled")]
    pub is_disabled: bool,
    #[serde(rename = "EnableUserPreferenceAccess")]
    pub enable_user_preference_access: bool,
    #[serde(rename = "EnableRemoteControlOfOtherUsers")]
    pub enable_remote_control: bool,
    #[serde(rename = "EnableSharedDeviceControl")]
    pub enable_shared_device_control: bool,
    #[serde(rename = "EnableRemoteAccess")]
    pub enable_remote_access: bool,
    #[serde(rename = "EnableLiveTvManagement")]
    pub enable_live_tv_management: bool,
    #[serde(rename = "EnableLiveTvAccess")]
    pub enable_live_tv_access: bool,
    #[serde(rename = "EnableMediaPlayback")]
    pub enable_media_playback: bool,
    #[serde(rename = "EnableAudioPlaybackTranscoding")]
    pub enable_audio_playback_transcoding: bool,
    #[serde(rename = "EnableVideoPlaybackTranscoding")]
    pub enable_video_playback_transcoding: bool,
    #[serde(rename = "EnablePlaybackRemuxing")]
    pub enable_playback_remuxing: bool,
    #[serde(rename = "EnableContentDeletion")]
    pub enable_content_deletion: bool,
    #[serde(rename = "EnableContentDownloading")]
    pub enable_content_downloading: bool,
    #[serde(rename = "EnableSyncTranscoding")]
    pub enable_sync_transcoding: bool,
    #[serde(rename = "EnableMediaConversion")]
    pub enable_media_conversion: bool,
    #[serde(rename = "EnableAllDevices")]
    pub enable_all_devices: bool,
    #[serde(rename = "EnableAllChannels")]
    pub enable_all_channels: bool,
    #[serde(rename = "EnableAllFolders")]
    pub enable_all_folders: bool,
    #[serde(rename = "EnablePublicSharing")]
    pub enable_public_sharing: bool,
    #[serde(rename = "InvalidLoginAttemptCount")]
    pub invalid_login_attempt_count: i32,
    #[serde(rename = "LoginAttemptsBeforeLockout")]
    pub login_attempts_before_lockout: i32,
    #[serde(rename = "MaxActiveSessions")]
    pub max_active_sessions: i32,
    #[serde(rename = "RemoteClientBitrateLimit")]
    pub remote_client_bitrate_limit: i64,
    #[serde(rename = "AuthenticationProviderId")]
    pub authentication_provider_id: String,
    #[serde(rename = "PasswordResetProviderId")]
    pub password_reset_provider_id: String,
    #[serde(rename = "SyncPlayAccess")]
    pub sync_play_access: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthenticationResult {
    #[serde(rename = "User")]
    pub user: UserDto,
    #[serde(rename = "SessionInfo")]
    pub session_info: SessionInfoDto,
    #[serde(rename = "AccessToken")]
    pub access_token: String,
    #[serde(rename = "ServerId")]
    pub server_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfoDto {
    #[serde(rename = "PlayState")]
    pub play_state: PlayStateInfo,
    #[serde(rename = "Id")]
    pub id: String,
    #[serde(rename = "UserId")]
    pub user_id: String,
    #[serde(rename = "UserName")]
    pub user_name: String,
    #[serde(rename = "Client")]
    pub client: String,
    #[serde(rename = "DeviceId")]
    pub device_id: String,
    #[serde(rename = "DeviceName")]
    pub device_name: String,
    #[serde(rename = "ApplicationVersion")]
    pub application_version: String,
    #[serde(rename = "LastActivityDate")]
    pub last_activity_date: String,
    #[serde(rename = "ServerId")]
    pub server_id: String,
    #[serde(rename = "IsActive")]
    pub is_active: bool,
    #[serde(rename = "SupportsRemoteControl")]
    pub supports_remote_control: bool,
    #[serde(rename = "HasCustomDeviceName")]
    pub has_custom_device_name: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayStateInfo {
    #[serde(rename = "CanSeek")]
    pub can_seek: bool,
    #[serde(rename = "IsPaused")]
    pub is_paused: bool,
    #[serde(rename = "IsMuted")]
    pub is_muted: bool,
    #[serde(rename = "RepeatMode")]
    pub repeat_mode: String,
}

/// Jellyfin Authorization 头解析结果
#[derive(Debug, Clone, Default)]
pub struct JellyfinAuthHeader {
    pub client: String,
    pub device: String,
    pub device_id: String,
    pub version: String,
    pub token: Option<String>,
}

/// BaseItemDto
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BaseItemDto {
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "ServerId")]
    pub server_id: String,
    #[serde(rename = "Id")]
    pub id: String,
    #[serde(rename = "CanDelete")]
    pub can_delete: bool,
    #[serde(rename = "CanDownload")]
    pub can_download: bool,
    #[serde(rename = "Overview", skip_serializing_if = "Option::is_none")]
    pub overview: Option<String>,
    #[serde(rename = "CommunityRating", skip_serializing_if = "Option::is_none")]
    pub community_rating: Option<f64>,
    #[serde(rename = "RunTimeTicks", skip_serializing_if = "Option::is_none")]
    pub run_time_ticks: Option<i64>,
    #[serde(rename = "IsFolder")]
    pub is_folder: bool,
    #[serde(rename = "Type")]
    pub item_type: String,
    #[serde(rename = "MediaType", skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(rename = "ImageTags", skip_serializing_if = "Option::is_none")]
    pub image_tags: Option<serde_json::Value>,
    #[serde(rename = "BackdropImageTags", skip_serializing_if = "Option::is_none")]
    pub backdrop_image_tags: Option<Vec<String>>,
    #[serde(rename = "LocationType", skip_serializing_if = "Option::is_none")]
    pub location_type: Option<String>,
    #[serde(rename = "UserData", skip_serializing_if = "Option::is_none")]
    pub user_data: Option<UserItemDataDto>,
    #[serde(rename = "IndexNumber", skip_serializing_if = "Option::is_none")]
    pub index_number: Option<i32>,
    #[serde(rename = "ParentIndexNumber", skip_serializing_if = "Option::is_none")]
    pub parent_index_number: Option<i32>,
    #[serde(rename = "SeriesId", skip_serializing_if = "Option::is_none")]
    pub series_id: Option<String>,
    #[serde(rename = "SeriesName", skip_serializing_if = "Option::is_none")]
    pub series_name: Option<String>,
    #[serde(rename = "SeasonId", skip_serializing_if = "Option::is_none")]
    pub season_id: Option<String>,
    #[serde(rename = "SeasonName", skip_serializing_if = "Option::is_none")]
    pub season_name: Option<String>,
    #[serde(rename = "ParentId", skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(rename = "ChildCount", skip_serializing_if = "Option::is_none")]
    pub child_count: Option<i32>,
    #[serde(rename = "CollectionType", skip_serializing_if = "Option::is_none")]
    pub collection_type: Option<String>,
    #[serde(rename = "PremiereDate", skip_serializing_if = "Option::is_none")]
    pub premiere_date: Option<String>,
    #[serde(rename = "ProductionYear", skip_serializing_if = "Option::is_none")]
    pub production_year: Option<i32>,
    #[serde(rename = "MediaSources", skip_serializing_if = "Option::is_none")]
    pub media_sources: Option<Vec<serde_json::Value>>,
    #[serde(rename = "MediaStreams", skip_serializing_if = "Option::is_none")]
    pub media_streams: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserItemDataDto {
    #[serde(rename = "PlaybackPositionTicks")]
    pub playback_position_ticks: i64,
    #[serde(rename = "PlayCount")]
    pub play_count: i32,
    #[serde(rename = "IsFavorite")]
    pub is_favorite: bool,
    #[serde(rename = "Played")]
    pub played: bool,
    #[serde(rename = "PlayedPercentage", skip_serializing_if = "Option::is_none")]
    pub played_percentage: Option<f64>,
    #[serde(rename = "UnplayedItemCount", skip_serializing_if = "Option::is_none")]
    pub unplayed_item_count: Option<i32>,
}

/// Items 查询结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemsResult {
    #[serde(rename = "Items")]
    pub items: Vec<BaseItemDto>,
    #[serde(rename = "TotalRecordCount")]
    pub total_record_count: i64,
    #[serde(rename = "StartIndex")]
    pub start_index: i64,
}
