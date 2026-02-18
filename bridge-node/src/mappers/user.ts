/**
 * 用户信息映射器
 * 飞牛 UserInfo → Jellyfin UserDto
 */

import type { UserDto, UserConfiguration, UserPolicy } from '../types/jellyfin.ts';
import type { FnosUserInfo } from '../types/fnos.ts';

/** 默认用户配置 */
function defaultUserConfig(): UserConfiguration {
  return {
    PlayDefaultAudioTrack: true,
    SubtitleLanguagePreference: '',
    DisplayMissingEpisodes: false,
    SubtitleMode: 'Default',
    EnableLocalPassword: false,
    OrderedViews: [],
    LatestItemsExcludes: [],
    MyMediaExcludes: [],
    HidePlayedInLatest: true,
    RememberAudioSelections: true,
    RememberSubtitleSelections: true,
    EnableNextEpisodeAutoPlay: true,
  };
}

/** 默认用户策略 */
function defaultUserPolicy(): UserPolicy {
  return {
    IsAdministrator: true,
    IsHidden: false,
    IsDisabled: false,
    EnableUserPreferenceAccess: true,
    EnableRemoteControlOfOtherUsers: false,
    EnableSharedDeviceControl: true,
    EnableRemoteAccess: true,
    EnableLiveTvManagement: false,
    EnableLiveTvAccess: false,
    EnableMediaPlayback: true,
    EnableAudioPlaybackTranscoding: true,
    EnableVideoPlaybackTranscoding: true,
    EnablePlaybackRemuxing: true,
    EnableContentDeletion: false,
    EnableContentDownloading: true,
    EnableSyncTranscoding: false,
    EnableMediaConversion: false,
    EnableAllDevices: true,
    EnableAllChannels: true,
    EnableAllFolders: true,
    EnablePublicSharing: false,
    InvalidLoginAttemptCount: 0,
    LoginAttemptsBeforeLockout: -1,
    MaxActiveSessions: 0,
    RemoteClientBitrateLimit: 0,
    AuthenticationProviderId: 'Jellyfin.Server.Implementations.Users.DefaultAuthenticationProvider',
    PasswordResetProviderId: 'Jellyfin.Server.Implementations.Users.DefaultPasswordResetProvider',
    SyncPlayAccess: 'CreateAndJoinGroups',
  };
}

/**
 * 将飞牛用户信息映射为 Jellyfin UserDto
 */
export function mapUserToJellyfin(
  fnosUser: FnosUserInfo,
  userId: string,
  serverId: string,
): UserDto {
  return {
    Name: fnosUser.nickname || fnosUser.username || 'User',
    ServerId: serverId,
    Id: userId,
    HasPassword: true,
    HasConfiguredPassword: true,
    HasConfiguredEasyPassword: false,
    EnableAutoLogin: false,
    LastLoginDate: new Date().toISOString(),
    LastActivityDate: new Date().toISOString(),
    Configuration: defaultUserConfig(),
    Policy: defaultUserPolicy(),
  };
}
