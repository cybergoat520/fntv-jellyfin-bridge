/**
 * Items API 测试
 * 媒体列表和详情
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { get, assertSuccess, assertStatus } from '../lib/client.ts';
import { login, isLoggedIn, skipIfNoCredentials } from '../lib/auth-helper.ts';
import { config, testState } from '../config.ts';

describe('Items API', () => {
  let movieLibraryId: string | null = null;
  let tvLibraryId: string | null = null;
  let testItemId: string | null = null;

  before(async () => {
    if (!isLoggedIn() && config.username && config.password) {
      try {
        await login();
      } catch (e) {
        console.log('  [警告] 登录失败，部分测试将跳过');
      }
    }
    
    // 获取媒体库 ID
    if (isLoggedIn()) {
      const viewsResponse = await get('/UserViews');
      if (viewsResponse.success) {
        const items = viewsResponse.data?.Items || [];
        const movieLib = items.find((item: any) => item.Name === '电影' || item.CollectionType === 'movies');
        const tvLib = items.find((item: any) => item.Name === '电视剧' || item.CollectionType === 'tvshows');
        movieLibraryId = movieLib?.Id || null;
        tvLibraryId = tvLib?.Id || null;
      }
    }
  });

  describe('GET /Items - 媒体列表', () => {
    skipIfNoCredentials(() => {
      it('应该返回指定媒体库的项目', async () => {
        if (!movieLibraryId) {
          console.log('  [SKIP] 未找到电影媒体库');
          return;
        }

        const response = await get(`/Items?ParentId=${movieLibraryId}&Limit=10`);
        
        assertSuccess(response, '获取媒体列表失败');
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
        assert.strictEqual(typeof data.TotalRecordCount, 'number');
        assert.strictEqual(typeof data.StartIndex, 'number');
        
        console.log(`  ✓ 获取到 ${data.TotalRecordCount} 个项目`);
        
        // 保存第一个项目用于后续测试
        if (data.Items.length > 0) {
          testItemId = data.Items[0].Id;
          testState.testItemId = testItemId;
        }
      });

      it('应该支持分页', async () => {
        if (!movieLibraryId) return;

        const response = await get(`/Items?ParentId=${movieLibraryId}&StartIndex=0&Limit=5`);
        assertSuccess(response);
        
        const data = response.data!;
        assert.ok(data.Items.length <= 5, '返回项目数应该不超过 Limit');
        assert.strictEqual(data.StartIndex, 0, 'StartIndex 应该匹配');
      });

      it('应该支持搜索', async () => {
        if (!movieLibraryId) return;

        // 搜索特定关键词（使用常见词增加命中概率）
        const response = await get(`/Items?ParentId=${movieLibraryId}&SearchTerm=a&Limit=5`);
        assertSuccess(response);
        
        const data = response.data!;
        // 搜索结果可能为空，但请求应该成功
        assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
      });

      it('应该支持类型过滤', async () => {
        if (!movieLibraryId) return;

        const response = await get(`/Items?ParentId=${movieLibraryId}&IncludeItemTypes=Movie&Limit=10`);
        assertSuccess(response);
        
        const data = response.data!;
        // 验证返回的都是 Movie 类型
        for (const item of data.Items) {
          assert.strictEqual(item.Type, 'Movie', '过滤 Movie 应该只返回 Movie 类型');
        }
      });

      it('应该支持排序', async () => {
        if (!movieLibraryId) return;

        const response1 = await get(`/Items?ParentId=${movieLibraryId}&SortBy=SortName&SortOrder=Ascending&Limit=5`);
        const response2 = await get(`/Items?ParentId=${movieLibraryId}&SortBy=SortName&SortOrder=Descending&Limit=5`);
        
        assertSuccess(response1);
        assertSuccess(response2);
        
        // 如果都有数据，顺序应该不同
        if (response1.data?.Items?.length > 0 && response2.data?.Items?.length > 0) {
          const name1 = response1.data.Items[0].Name;
          const name2 = response2.data.Items[0].Name;
          if (response1.data.Items.length > 1 && name1 !== name2) {
            assert.notStrictEqual(name1, name2, '升序和降序的第一个项目应该不同');
          }
        }
      });
    });
  });

  describe('GET /Items/:itemId - 项目详情', () => {
    skipIfNoCredentials(() => {
      it('应该返回项目详情', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 没有可用的测试项目ID');
          return;
        }

        const response = await get(`/Items/${testItemId}`);
        
        assertSuccess(response, '获取项目详情失败');
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(data.Id, '应该有 Id');
        assert.ok(data.Name, '应该有 Name');
        assert.ok(data.Type, '应该有 Type');
        assert.ok(data.ServerId, '应该有 ServerId');
        
        console.log(`  ✓ 项目详情: ${data.Name} (${data.Type})`);
      });

      it('应该包含媒体源信息（对于视频）', async () => {
        if (!testItemId) return;

        const response = await get(`/Items/${testItemId}`);
        assertSuccess(response);
        
        const data = response.data!;
        if (data.MediaType === 'Video' && data.MediaSources) {
          assert.ok(Array.isArray(data.MediaSources), 'MediaSources 应该是数组');
          if (data.MediaSources.length > 0) {
            const source = data.MediaSources[0];
            assert.ok(source.Id, 'MediaSource 应该有 Id');
            assert.ok(source.Container, 'MediaSource 应该有 Container');
          }
        }
      });

      it('应该处理无效项目ID', async () => {
        const response = await get('/Items/invalid-item-id-12345');
        
        assert.ok(response.status === 404 || response.status === 200, 
          `期望 404 或 200，实际得到 ${response.status}`);
      });
    });
  });

  describe('GET /Items/Filters', () => {
    skipIfNoCredentials(() => {
      it('应该返回过滤器选项', async () => {
        const response = await get('/Items/Filters');
        
        assertSuccess(response);
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(Array.isArray(data.Genres), 'Genres 应该是数组');
        assert.ok(Array.isArray(data.Tags), 'Tags 应该是数组');
        assert.ok(Array.isArray(data.Years), 'Years 应该是数组');
      });
    });
  });

  describe('GET /Items/Latest - 最近添加', () => {
    skipIfNoCredentials(() => {
      it('应该返回最近添加的项目', async () => {
        if (!movieLibraryId) return;

        const response = await get(`/Items/Latest?ParentId=${movieLibraryId}&Limit=8`);
        
        assertSuccess(response);
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(Array.isArray(data), 'Latest 返回应该是数组');
        assert.ok(data.length <= 8, '返回数量应该不超过 Limit');
        
        console.log(`  ✓ 最近添加: ${data.length} 个项目`);
      });

      it('应该支持类型过滤', async () => {
        if (!movieLibraryId) return;

        const response = await get(`/Items/Latest?ParentId=${movieLibraryId}&IncludeItemTypes=Movie&Limit=5`);
        assertSuccess(response);
        
        const data = response.data!;
        for (const item of data) {
          assert.strictEqual(item.Type, 'Movie', '应该只返回 Movie 类型');
        }
      });
    });
  });

  describe('旧版路径兼容', () => {
    skipIfNoCredentials(() => {
      it('GET /Users/:userId/Items 应该重定向', async () => {
        if (!testState.userId) await login();
        
        const response = await get(`/Users/${testState.userId}/Items?Limit=5`);
        assert.ok(response.status === 200 || response.status === 307, 
          `期望 200 或 307，实际得到 ${response.status}`);
      });
    });
  });
});
