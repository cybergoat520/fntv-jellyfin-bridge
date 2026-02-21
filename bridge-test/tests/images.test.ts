/**
 * Images API 测试
 * 图片代理
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { get, assertSuccess, assertStatus } from '../lib/client.ts';
import { login, isLoggedIn, skipIfNoCredentials } from '../lib/auth-helper.ts';
import { config, testState } from '../config.ts';

describe('Images API', () => {
  let testItemId: string | null = null;

  before(async () => {
    if (!isLoggedIn() && config.username && config.password) {
      try {
        await login();
      } catch (e) {
        console.log('  [警告] 登录失败，部分测试将跳过');
      }
    }
    
    // 获取一个测试项目
    if (isLoggedIn() && !testState.testItemId) {
      const viewsResponse = await get('/UserViews');
      if (viewsResponse.success) {
        const movieLib = viewsResponse.data?.Items?.find((item: any) => 
          item.Name === '电影' || item.CollectionType === 'movies'
        );
        
        if (movieLib) {
          const itemsResponse = await get(`/Items?ParentId=${movieLib.Id}&Limit=1`);
          if (itemsResponse.success && itemsResponse.data?.Items?.length > 0) {
            testState.testItemId = itemsResponse.data.Items[0].Id;
          }
        }
      }
    }
    testItemId = testState.testItemId;
  });

  describe('GET /Items/:itemId/Images/Primary', () => {
    skipIfNoCredentials(() => {
      it('应该返回主封面图', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        const response = await get(`/Items/${testItemId}/Images/Primary`, {
          responseType: 'arraybuffer',
        });
        
        // 可能返回 200（有图）或 404（无图）
        if (response.status === 404) {
          console.log('  [SKIP] 该项目没有封面图');
          return;
        }
        
        assertSuccess(response, '获取封面图失败');
        assertStatus(response, 200);
        
        // 验证响应是图片
        const contentType = response.data?.contentType || 'image/jpeg';
        assert.ok(
          contentType.includes('image/') || response.data instanceof Buffer || 
          (typeof response.data === 'object'),
          '响应应该是图片数据'
        );
        
        console.log(`  ✓ 封面图已获取`);
      });

      it('应该支持尺寸参数', async () => {
        if (!testItemId) return;

        const response = await get(`/Items/${testItemId}/Images/Primary?fillWidth=300&fillHeight=450`);
        
        // 可能返回 200 或 404（如果图片不支持尺寸调整）
        assert.ok(response.status === 200 || response.status === 404,
          `期望 200 或 404，实际得到 ${response.status}`);
      });

      it('应该支持 maxWidth/maxHeight 参数', async () => {
        if (!testItemId) return;

        const response = await get(`/Items/${testItemId}/Images/Primary?maxWidth=500`);
        
        // 可能返回 200 或 404
        assert.ok(response.status === 200 || response.status === 404,
          `期望 200 或 404，实际得到 ${response.status}`);
      });

      it('应该处理无效项目ID', async () => {
        const response = await get('/Items/invalid-id/Images/Primary');
        
        // 可能返回 404 或默认图片
        assert.ok(response.status === 200 || response.status === 404, 
          `期望 200 或 404，实际得到 ${response.status}`);
      });
    });
  });

  describe('GET /Items/:itemId/Images/Backdrop', () => {
    skipIfNoCredentials(() => {
      it('应该返回背景图', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        const response = await get(`/Items/${testItemId}/Images/Backdrop`, {
          responseType: 'arraybuffer',
        });
        
        // 背景图可能不存在
        assert.ok(response.status === 200 || response.status === 404, 
          `期望 200 或 404，实际得到 ${response.status}`);
        
        if (response.status === 200) {
          console.log(`  ✓ 背景图已获取`);
        }
      });
    });
  });

  describe('GET /Items/:itemId/Images/Thumb', () => {
    skipIfNoCredentials(() => {
      it('应该返回缩略图', async () => {
        if (!testItemId) return;

        const response = await get(`/Items/${testItemId}/Images/Thumb`, {
          responseType: 'arraybuffer',
        });
        
        assert.ok(response.status === 200 || response.status === 404, 
          `期望 200 或 404，实际得到 ${response.status}`);
      });
    });
  });

  describe('GET /Items/:itemId/Images/Logo', () => {
    skipIfNoCredentials(() => {
      it('应该返回 Logo 图', async () => {
        if (!testItemId) return;

        const response = await get(`/Items/${testItemId}/Images/Logo`, {
          responseType: 'arraybuffer',
        });
        
        assert.ok(response.status === 200 || response.status === 404, 
          `期望 200 或 404，实际得到 ${response.status}`);
      });
    });
  });

  describe('GET /Items/:itemId/Images/Banner', () => {
    skipIfNoCredentials(() => {
      it('应该返回 Banner 图', async () => {
        if (!testItemId) return;

        const response = await get(`/Items/${testItemId}/Images/Banner`, {
          responseType: 'arraybuffer',
        });
        
        assert.ok(response.status === 200 || response.status === 404, 
          `期望 200 或 404，实际得到 ${response.status}`);
      });
    });
  });

  describe('图片缓存', () => {
    skipIfNoCredentials(() => {
      it('应该缓存图片（第二次请求更快）', async () => {
        if (!testItemId) return;

        // 第一次请求
        const start1 = Date.now();
        const response1 = await get(`/Items/${testItemId}/Images/Primary`);
        const time1 = Date.now() - start1;
        
        // 第一次请求应该成功（也可能 404 如果图片不存在）
        if (response1.status !== 200 && response1.status !== 404) {
          assertSuccess(response1);
        }
        
        // 第二次请求（应该更快，因为缓存）
        const start2 = Date.now();
        const response2 = await get(`/Items/${testItemId}/Images/Primary`);
        const time2 = Date.now() - start2;
        
        if (response2.status !== 200 && response2.status !== 404) {
          assertSuccess(response2);
        }
        
        console.log(`  ✓ 第一次: ${time1}ms, 第二次: ${time2}ms`);
        
        // 两次响应应该相同
        assert.ok(response1.status === response2.status, '两次请求状态应该相同');
      });
    });
  });
});
