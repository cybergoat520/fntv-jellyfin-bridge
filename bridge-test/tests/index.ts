/**
 * fnos-bridge API 测试套件入口
 * 
 * 运行方式:
 *   npm test                 - 运行所有测试
 *   npm run test:system      - 只运行 System API 测试
 *   npm run test:auth        - 只运行 Auth API 测试
 *   npm run test:items       - 只运行 Items API 测试
 *   npm run test:playback    - 只运行 Playback API 测试
 *   npm run test:stream      - 只运行 Stream API 测试
 * 
 * 环境变量:
 *   TEST_BASE_URL            - Bridge 服务器地址 (默认: http://localhost:8096)
 *   TEST_FNOS_SERVER         - 飞牛 NAS 地址 (默认: http://localhost:5666)
 *   TEST_USERNAME            - 测试用户名
 *   TEST_PASSWORD            - 测试密码
 *   TEST_TIMEOUT             - 请求超时 (默认: 30000ms)
 *   TEST_VERBOSE             - 详细日志 (true/false)
 * 
 * 示例:
 *   TEST_USERNAME=admin TEST_PASSWORD=123456 npm test
 */

import { validateConfig } from '../config.ts';

// 验证配置
validateConfig();

console.log(`
╔══════════════════════════════════════════════════════════╗
║           fnos-bridge API 测试套件                       ║
╠══════════════════════════════════════════════════════════╣
║  测试目标: ${process.env.TEST_BASE_URL || 'http://localhost:8096'}
╚══════════════════════════════════════════════════════════╝
`);

// 导入所有测试模块
import './system.test.ts';
import './auth.test.ts';
import './views.test.ts';
import './items.test.ts';
import './shows.test.ts';
import './playback.test.ts';
import './stream.test.ts';
import './images.test.ts';
import './branding.test.ts';
import './favorites.test.ts';
import './resume.test.ts';
import './misc.test.ts';
