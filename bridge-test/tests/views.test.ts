/**
 * UserViews API 测试
 * 媒体库列表
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { get, assertSuccess, assertStatus } from '../lib/client.ts';
import { login, isLoggedIn, skipIfNoCredentials } from '../lib/auth-helper.ts';
import { config, testState } from '../config.ts';

describe('UserViews API', () => {
  before(async () => {
    if (!isLoggedIn() && config.username && config.password) {
      try {
        await login();
      } catch (e: any) {
        console.log(`  [警告] 登录失败: ${e.message}`);
      }
    }
  });

  describe('GET /UserViews', () => {
    skipIfNoCredentials(() => {
      it('应该返回媒体库列表', async () => {
        const response = await get('/UserViews');
        
        assertSuccess(response, '获取媒体库失败');
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
        assert.strictEqual(typeof data.TotalRecordCount, 'number', 'TotalRecordCount 应该是数字');
        assert.strictEqual(typeof data.StartIndex, 'number', 'StartIndex 应该是数字');
        
        console.log(`  ✓ 媒体库数量: ${data.TotalRecordCount}`);
      });

      it('应该包含电影和电视剧媒体库', async () => {
        const response = await get('/UserViews');
        assertSuccess(response);
        
        const data = response.data!;
        const items = data.Items || [];
        
        // 查找电影媒体库
        const movieLibrary = items.find((item: any) => 
          item.Name === '电影' || item.CollectionType === 'movies'
        );
        
        // 查找电视剧媒体库
        const tvLibrary = items.find((item: any) => 
          item.Name === '电视剧' || item.CollectionType === 'tvshows'
        );
        
        assert.ok(movieLibrary, '应该包含电影媒体库');
        assert.ok(tvLibrary, '应该包含电视剧媒体库');
        
        // 验证媒体库结构
        if (movieLibrary) {
          assert.strictEqual(movieLibrary.Type, 'CollectionFolder', '类型应该是 CollectionFolder');
          assert.ok(movieLibrary.Id, '应该有 Id');
          console.log(`  ✓ 电影库: ${movieLibrary.Name} (${movieLibrary.Id})`);
        }
        
        if (tvLibrary) {
          assert.strictEqual(tvLibrary.Type, 'CollectionFolder', '类型应该是 CollectionFolder');
          assert.ok(tvLibrary.Id, '应该有 Id');
          console.log(`  ✓ 电视剧库: ${tvLibrary.Name} (${tvLibrary.Id})`);
        }
      });

      it('每个媒体库应该有必要的字段', async () => {
        const response = await get('/UserViews');
        assertSuccess(response);
        
        const data = response.data!;
        const items = data.Items || [];
        
        for (const item of items) {
          assert.ok(item.Id, '应该有 Id');
          assert.ok(item.Name, '应该有 Name');
          assert.ok(item.Type, '应该有 Type');
          assert.ok(item.ServerId, '应该有 ServerId');
          assert.strictEqual(item.IsFolder, true, 'IsFolder 应该为 true');
        }
      });
    });

    it('未认证时应该返回 401', async () => {
      // 临时清除认证
      const originalToken = testState.accessToken;
      testState.accessToken = null;
      
      const response = await get('/UserViews');
      
      // 恢复认证
      testState.accessToken = originalToken;
      
      assert.strictEqual(response.status, 401, '未认证应该返回 401');
    });
  });

  describe('旧版路径兼容', () => {
    skipIfNoCredentials(() => {
      it('GET /Users/:userId/Views 应该重定向到 /UserViews', async () => {
        if (!testState.userId) {
          await login();
        }
        
        const response = await get(`/Users/${testState.userId}/Views`);
        
        // 应该返回 307 重定向或最终响应
        assert.ok(response.status === 200 || response.status === 307, 
          `期望 200 或 307，实际得到 ${response.status}`);
      });
    });
  });
});
