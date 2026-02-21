/**
 * Favorites API 测试
 * 收藏功能
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { get, post, del, assertSuccess, assertStatus } from '../lib/client.ts';
import { login, isLoggedIn, skipIfNoCredentials } from '../lib/auth-helper.ts';
import { config, testState } from '../config.ts';

describe('Favorites API', () => {
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

  describe('POST /UserFavoriteItems/:itemId - 添加收藏', () => {
    skipIfNoCredentials(() => {
      it('应该添加项目到收藏', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        const response = await post(`/UserFavoriteItems/${testItemId}`);
        
        assertSuccess(response, '添加收藏失败');
        assert.ok(response.status === 200 || response.status === 204, 
          `期望 200 或 204，实际得到 ${response.status}`);
        
        console.log(`  ✓ 已添加到收藏: ${testItemId}`);
      });

      it('应该处理无效项目ID', async () => {
        const response = await post('/UserFavoriteItems/invalid-item-id');
        
        // 可能返回 404 或 200（取决于实现）
        assert.ok([200, 204, 404].includes(response.status), 
          `期望 200/204/404，实际得到 ${response.status}`);
      });
    });
  });

  describe('DELETE /UserFavoriteItems/:itemId - 取消收藏', () => {
    skipIfNoCredentials(() => {
      it('应该从收藏中移除项目', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        const response = await del(`/UserFavoriteItems/${testItemId}`);
        
        assertSuccess(response);
        assert.ok(response.status === 200 || response.status === 204, 
          `期望 200 或 204，实际得到 ${response.status}`);
        
        console.log(`  ✓ 已从收藏移除: ${testItemId}`);
      });
    });
  });

  describe('GET /Items - 收藏过滤', () => {
    skipIfNoCredentials(() => {
      it('应该支持 IsFavorite 过滤', async () => {
        const viewsResponse = await get('/UserViews');
        if (!viewsResponse.success) return;
        
        const movieLib = viewsResponse.data?.Items?.find((item: any) => 
          item.Name === '电影' || item.CollectionType === 'movies'
        );
        
        if (!movieLib) return;

        const response = await get(`/Items?ParentId=${movieLib.Id}&Filters=IsFavorite&Limit=20`);
        
        assertSuccess(response);
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
        
        // 验证返回的都是收藏项目
        for (const item of data.Items) {
          assert.strictEqual(item.UserData?.IsFavorite, true, 
            '过滤 IsFavorite 应该只返回收藏项目');
        }
        
        console.log(`  ✓ 收藏项目: ${data.TotalRecordCount} 个`);
      });
    });
  });
});
