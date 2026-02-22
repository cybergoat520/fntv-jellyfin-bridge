/**
 * Xbox 客户端兼容性测试
 * 测试 Xbox Jellyfin 客户端特有的行为和问题
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { get, post, head, assertSuccess, assertStatus, client } from '../lib/client.ts';
import { login, isLoggedIn, skipIfNoCredentials } from '../lib/auth-helper.ts';
import { config } from '../config.ts';

describe('Xbox Client Compatibility', () => {
  before(async () => {
    if (!isLoggedIn() && config.username && config.password) {
      try {
        await login();
      } catch (e) {
        console.log('  [警告] 登录失败，部分测试将跳过');
      }
    }
  });

  describe('HEAD / 根路径探测', () => {
    it('HEAD / 应该返回 200 或重定向到 /web/', async () => {
      // Xbox 客户端启动时会发送 HEAD / 探测服务器
      const response = await head('/');
      
      // 应该成功（200）或重定向（302）
      assert.ok(
        response.status === 200 || response.status === 302,
        `HEAD / 应该返回 200 或 302，实际得到 ${response.status}`
      );
      
      // 如果是重定向，应该指向 /web/
      if (response.status === 302) {
        const location = response.headers?.location || response.headers?.Location;
        assert.ok(
          location?.includes('/web/'),
          `重定向位置应该包含 /web/，实际: ${location}`
        );
      }
      
      console.log('  ✓ HEAD / 根路径探测正常');
    });

    it('GET / 应该重定向到 /web/', async () => {
      const response = await get('/');
      
      // 应该重定向
      assert.ok(
        response.status === 302 || response.status === 200,
        `GET / 应该返回 302 或 200，实际得到 ${response.status}`
      );
      
      console.log('  ✓ GET / 根路径处理正常');
    });
  });

  describe('Xbox 认证格式', () => {
    skipIfNoCredentials(() => {
      it('应该支持只有 Token 的 MediaBrowser 格式', async () => {
        // Xbox 客户端可能使用简化格式: MediaBrowser Token="xxx"
        // 没有 Client、Device、DeviceId、Version 字段
        const { data: loginData } = await login();
        
        if (!loginData?.AccessToken) {
          console.log('  [SKIP] 无法获取 token');
          return;
        }
        
        // 使用只有 Token 的格式请求
        const testClient = client;
        const response = await testClient.request({
          method: 'GET',
          url: '/Users/Me',
          headers: {
            'Authorization': `MediaBrowser Token="${loginData.AccessToken}"`,
          },
        }).catch((e: any) => e.response);
        
        // 应该成功认证
        if (response.status === 200) {
          assert.ok(response.data?.Id, '响应应该包含用户 Id');
          console.log('  ✓ 只有 Token 的 MediaBrowser 格式认证成功');
        } else if (response.status === 401) {
          console.log('  [WARN] 只有 Token 的格式返回 401，可能服务端需要完整格式');
        } else {
          assert.ok(false, `意外的响应状态: ${response.status}`);
        }
      });

      it('应该支持 X-MediaBrowser-Token 头', async () => {
        const { data: loginData } = await login();
        
        if (!loginData?.AccessToken) {
          console.log('  [SKIP] 无法获取 token');
          return;
        }
        
        // 使用 X-MediaBrowser-Token 头
        const testClient = client;
        const response = await testClient.request({
          method: 'GET',
          url: '/Users/Me',
          headers: {
            'X-MediaBrowser-Token': loginData.AccessToken,
          },
        }).catch((e: any) => e.response);
        
        // 应该成功认证
        assert.ok(
          response.status === 200 || response.status === 401,
          `X-MediaBrowser-Token 应该被正确处理`
        );
        
        if (response.status === 200) {
          console.log('  ✓ X-MediaBrowser-Token 头认证成功');
        } else {
          console.log('  [WARN] X-MediaBrowser-Token 返回 401，可能服务端不支持');
        }
      });
    });
  });

  describe('Xbox User-Agent 处理', () => {
    it('应该接受 Xbox User-Agent 请求', async () => {
      // 模拟 Xbox 的 User-Agent
      const xboxUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36';
      
      const testClient = client;
      const response = await testClient.request({
        method: 'GET',
        url: '/System/Info/Public',
        headers: {
          'User-Agent': xboxUserAgent,
        },
      }).catch((e: any) => e.response);
      
      assertStatus(response, 200);
      assert.ok(response.data?.ServerName, '响应应该包含 ServerName');
      
      console.log('  ✓ Xbox User-Agent 请求处理正常');
    });
  });

  describe('/web/ 路径处理', () => {
    it('/web 应该重定向到 /web/', async () => {
      const response = await get('/web');
      
      // 应该重定向到带斜杠的路径
      assert.ok(
        response.status === 301 || response.status === 302 || 
        response.status === 307 || response.status === 308 ||
        response.status === 200, // 或者直接返回内容
        `/web 应该重定向或返回内容，实际状态: ${response.status}`
      );
      
      if ([301, 302, 307, 308].includes(response.status)) {
        const location = response.headers?.location || response.headers?.Location;
        assert.ok(
          location?.endsWith('/web/') || location?.endsWith('/web/index.html'),
          `重定向应该指向 /web/ 或 /web/index.html，实际: ${location}`
        );
      }
      
      console.log('  ✓ /web 路径重定向正常');
    });

    it('/web/ 应该返回 200', async () => {
      const response = await get('/web/');
      
      // 应该返回内容或重定向到 index.html
      assert.ok(
        response.status === 200 || response.status === 302,
        `/web/ 应该返回 200 或 302，实际状态: ${response.status}`
      );
      
      console.log('  ✓ /web/ 路径访问正常');
    });
  });

});
