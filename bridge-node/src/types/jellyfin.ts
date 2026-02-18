/**
 * Jellyfin API 类型定义
 * 仅包含第一阶段需要的类型
 */

/** Jellyfin 公开系统信息 */
export interface PublicSystemInfo {
  LocalAddress: string;
  ServerName: string;
  Version: string;
  ProductName: string;
  OperatingSystem: string;
  Id: string;
  StartupWizardCompleted: boolean;
}

/** Jellyfin 完整系统信息 */
export interface SystemInfo extends PublicSystemInfo {
  OperatingSystemDisplayName: string;
  HasPendingRestart: boolean;
  IsShuttingDown: boolean;
  SupportsLibraryMonitor: boolean;
  WebSocketPortNumber: number;
  CanSelfRestart: boolean;
  CanLaunchWebBrowser: boolean;
  HasUpdateAvailable: boolean;
  TranscodingTempPath: string;
  LogPath: string;
  InternalMetadataPath: string;
  CachePath: string;
}

/** Jellyfin 品牌配置 */
export interface BrandingOptions {
  LoginDisclaimer: string;
  CustomCss: string;
  SplashscreenEnabled: boolean;
}

/** Jellyfin 用户 DTO */
export interface UserDto {
  Name: string;
  ServerId: string;
  Id: string;
  HasPassword: boolean;
  HasConfiguredPassword: boolean;
  HasConfiguredEasyPassword: boolean;
  EnableAutoLogin: boolean;
  LastLoginDate: string | null;
  LastActivityDate: string | null;
  Configuration: UserConfiguration;
  Policy: UserPolicy;
}

/** 用户配置 */
export interface UserConfiguration {
  PlayDefaultAudioTrack: boolean;
  SubtitleLanguagePreference: string;
  DisplayMissingEpisodes: boolean;
  SubtitleMode: string;
  EnableLocalPassword: boolean;
  OrderedViews: string[];
  LatestItemsExcludes: string[];
  MyMediaExcludes: string[];
  HidePlayedInLatest: boolean;
  RememberAudioSelections: boolean;
  RememberSubtitleSelections: boolean;
  EnableNextEpisodeAutoPlay: boolean;
}

/** 用户策略 */
export interface UserPolicy {
  IsAdministrator: boolean;
  IsHidden: boolean;
  IsDisabled: boolean;
  EnableUserPreferenceAccess: boolean;
  EnableRemoteControlOfOtherUsers: boolean;
  EnableSharedDeviceControl: boolean;
  EnableRemoteAccess: boolean;
  EnableLiveTvManagement: boolean;
  EnableLiveTvAccess: boolean;
  EnableMediaPlayback: boolean;
  EnableAudioPlaybackTranscoding: boolean;
  EnableVideoPlaybackTranscoding: boolean;
  EnablePlaybackRemuxing: boolean;
  EnableContentDeletion: boolean;
  EnableContentDownloading: boolean;
  EnableSyncTranscoding: boolean;
  EnableMediaConversion: boolean;
  EnableAllDevices: boolean;
  EnableAllChannels: boolean;
  EnableAllFolders: boolean;
  EnablePublicSharing: boolean;
  InvalidLoginAttemptCount: number;
  LoginAttemptsBeforeLockout: number;
  MaxActiveSessions: number;
  RemoteClientBitrateLimit: number;
  AuthenticationProviderId: string;
  PasswordResetProviderId: string;
  SyncPlayAccess: string;
}

/** 认证结果 */
export interface AuthenticationResult {
  User: UserDto;
  SessionInfo: SessionInfoDto;
  AccessToken: string;
  ServerId: string;
}

/** 会话信息 DTO */
export interface SessionInfoDto {
  PlayState: PlayStateInfo;
  Id: string;
  UserId: string;
  UserName: string;
  Client: string;
  DeviceId: string;
  DeviceName: string;
  ApplicationVersion: string;
  LastActivityDate: string;
  ServerId: string;
  IsActive: boolean;
  SupportsRemoteControl: boolean;
  HasCustomDeviceName: boolean;
}

/** 播放状态信息 */
export interface PlayStateInfo {
  CanSeek: boolean;
  IsPaused: boolean;
  IsMuted: boolean;
  RepeatMode: string;
}

/** Jellyfin Authorization 头解析结果 */
export interface JellyfinAuthHeader {
  client: string;
  device: string;
  deviceId: string;
  version: string;
  token?: string;
}
