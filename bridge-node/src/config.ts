/**
 * 配置模块
 * 支持环境变量和默认值
 */

export interface BridgeConfig {
  /** Bridge 服务监听端口 */
  port: number;
  /** Bridge 服务监听地址 */
  host: string;
  /** 飞牛影视服务器地址（默认值，可被登录时覆盖） */
  fnosServer: string;
  /** 是否跳过飞牛 HTTPS 证书验证 */
  ignoreCert: boolean;
  /** 伪装的 Jellyfin 服务器版本 */
  jellyfinVersion: string;
  /** 伪装的服务器名称 */
  serverName: string;
}

export const config: BridgeConfig = {
  port: parseInt(process.env.BRIDGE_PORT || '8096', 10),
  host: process.env.BRIDGE_HOST || '0.0.0.0',
  fnosServer: process.env.FNOS_SERVER || 'http://localhost:5666',
  ignoreCert: process.env.FNOS_IGNORE_CERT === 'true',
  jellyfinVersion: '10.10.6',
  serverName: process.env.SERVER_NAME || 'fnos-bridge',
};
