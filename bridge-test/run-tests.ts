/**
 * 顺序执行测试的脚本
 * 使用单进程模式确保会话状态共享
 */

import { config, validateConfig } from './config.ts';
import { login, isLoggedIn } from './lib/auth-helper.ts';

// 验证配置
validateConfig();

console.log(`
╔══════════════════════════════════════════════════════════╗
║           fnos-bridge API 测试套件                       ║
╠══════════════════════════════════════════════════════════╣
║  服务器: ${config.baseURL}
║  飞牛:   ${config.fnosServer}
╚══════════════════════════════════════════════════════════╝
`);

// 如果提供了凭据，先登录
async function setup() {
  if (config.username && config.password) {
    try {
      await login();
      console.log(`✓ 已登录: ${config.username}\n`);
    } catch (e: any) {
      console.error(`✗ 登录失败: ${e.message}\n`);
      process.exit(1);
    }
  } else {
    console.log('! 未提供用户名密码，部分测试将跳过\n');
  }
}

// 运行测试
await setup();

// 导入所有测试（按依赖顺序）
console.log('=== 开始测试 ===\n');

// 1. 系统信息（无需认证）
await import('./tests/system.test.ts');

// 2. 品牌（无需认证）
await import('./tests/branding.test.ts');

// 3. 认证（已登录）
await import('./tests/auth.test.ts');

// 4. 媒体库
await import('./tests/views.test.ts');

// 5. 媒体项目
await import('./tests/items.test.ts');

// 6. 剧集
await import('./tests/shows.test.ts');

// 7. 播放状态
await import('./tests/playback.test.ts');

// 8. 视频流
await import('./tests/stream.test.ts');

// 9. 图片
await import('./tests/images.test.ts');

// 10. 收藏
await import('./tests/favorites.test.ts');

// 11. 继续观看
await import('./tests/resume.test.ts');

// 12. 其他
await import('./tests/misc.test.ts');

console.log('\n=== 测试完成 ===');
