/**
 * 飞牛影视登录示例
 *
 * 使用方法：
 *   npx tsx examples/login.ts <server> <username> <password>
 *
 * 示例：
 *   npx tsx examples/login.ts http://192.168.1.100:5666 admin password
 */

import { login } from '../src/index.ts';

async function main() {
  const [server, username, password] = process.argv.slice(2);

  if (!server || !username || !password) {
    console.log('用法: npx tsx examples/login.ts <server> <username> <password>');
    console.log('示例: npx tsx examples/login.ts http://192.168.1.100:5666 admin password');
    process.exit(1);
  }

  console.log(`正在登录 ${server} ...`);

  const result = await login(
    { server, username, password },
    { ignoreCert: true }, // 开发环境忽略证书
  );

  if (result.success) {
    console.log('\n✅ 登录成功！');
    console.log(JSON.stringify({
      token: result.token,
      username: result.username,
      server: result.server,
      cookies: result.cookies,
    }, null, 2));
  } else {
    console.error('\n❌ 登录失败:', result.error);
    process.exit(1);
  }
}

main();
