/**
 * Resume API 测试
 * 继续观看
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { get, assertSuccess, assertStatus } from '../lib/client.ts';
import { login, isLoggedIn, skipIfNoCredentials } from '../lib/auth-helper.ts';
import { config, testState } from '../config.ts';

describe('Resume API', () => {
  before(async () => {
    if (!isLoggedIn() && config.username && config.password) {
      try {
        await login();
      } catch (e: any) {
        console.log(`  [警告] 登录失败: ${e.message}`);
      }
    }
  });

  describe('GET /UserItems/Resume - 继续观看列表', () => {
    skipIfNoCredentials(() => {
      it('应该返回继续观看列表', async () => {
        const response = await get('/UserItems/Resume?Limit=20');
        
        assertSuccess(response, '获取继续观看列表失败');
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
        assert.strictEqual(typeof data.TotalRecordCount, 'number');
        
        console.log(`  ✓ 继续观看: ${data.TotalRecordCount} 个项目`);
      });

      it('应该只返回有播放进度的项目', async () => {
        const response = await get('/UserItems/Resume?Limit=20');
        assertSuccess(response);
        
        const data = response.data!;
        for (const item of data.Items) {
          assert.ok(item.UserData?.PlaybackPositionTicks > 0 || item.UserData?.PlayedPercentage > 0,
            '继续观看项目应该有播放进度');
        }
      });

      it('应该支持类型过滤', async () => {
        const response = await get('/UserItems/Resume?MediaTypes=Video&Limit=10');
        assertSuccess(response);
        
        const data = response.data!;
        for (const item of data.Items) {
          assert.ok(['Movie', 'Episode', 'Video'].includes(item.Type),
            '过滤 Video 应该只返回视频类型');
        }
      });

      it('应该支持分页', async () => {
        const response = await get('/UserItems/Resume?StartIndex=0&Limit=5');
        assertSuccess(response);
        
        const data = response.data!;
        assert.ok(data.Items.length <= 5, '返回数量应该不超过 Limit');
      });
    });
  });

  describe('GET /Users/:userId/Items/Resume - 旧版路径', () => {
    skipIfNoCredentials(() => {
      it('应该重定向到新路径', async () => {
        if (!testState.userId) await login();
        
        const response = await get(`/Users/${testState.userId}/Items/Resume?Limit=5`);
        
        // 应该返回 307 重定向或最终响应
        assert.ok([200, 307].includes(response.status), 
          `期望 200 或 307，实际得到 ${response.status}`);
      });
    });
  });

  describe('GET /Items - IsResumable 过滤', () => {
    skipIfNoCredentials(() => {
      it('应该支持 IsResumable 过滤', async () => {
        const viewsResponse = await get('/UserViews');
        if (!viewsResponse.success) return;
        
        const movieLib = viewsResponse.data?.Items?.find((item: any) => 
          item.Name === '电影' || item.CollectionType === 'movies'
        );
        
        if (!movieLib) return;

        const response = await get(`/Items?ParentId=${movieLib.Id}&Filters=IsResumable&Limit=20`);
        
        assertSuccess(response);
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
        
        console.log(`  ✓ 可恢复项目: ${data.TotalRecordCount} 个`);
      });
    });
  });
});
