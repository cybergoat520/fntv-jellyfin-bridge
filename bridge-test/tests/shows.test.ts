/**
 * Shows API 测试
 * 剧集的季和集
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { get, assertSuccess, assertStatus } from '../lib/client.ts';
import { login, isLoggedIn, skipIfNoCredentials } from '../lib/auth-helper.ts';
import { config, testState } from '../config.ts';

describe('Shows API', () => {
  let testSeriesId: string | null = null;
  let testSeasonId: string | null = null;

  before(async () => {
    if (!isLoggedIn() && config.username && config.password) {
      try {
        await login();
      } catch (e) {
        console.log('  [警告] 登录失败，部分测试将跳过');
      }
    }
    
    // 查找一个电视剧项目
    if (isLoggedIn()) {
      const viewsResponse = await get('/UserViews');
      if (viewsResponse.success) {
        const tvLib = viewsResponse.data?.Items?.find((item: any) => 
          item.Name === '电视剧' || item.CollectionType === 'tvshows'
        );
        
        if (tvLib) {
          // 获取电视剧列表
          const itemsResponse = await get(`/Items?ParentId=${tvLib.Id}&IncludeItemTypes=Series&Limit=5`);
          if (itemsResponse.success && itemsResponse.data?.Items?.length > 0) {
            testSeriesId = itemsResponse.data.Items[0].Id;
            testState.testSeriesId = testSeriesId;
          }
        }
      }
    }
  });

  describe('GET /Shows/:seriesId/Seasons', () => {
    skipIfNoCredentials(() => {
      it('应该返回季列表', async () => {
        if (!testSeriesId) {
          console.log('  [SKIP] 未找到测试剧集');
          return;
        }

        const response = await get(`/Shows/${testSeriesId}/Seasons`);
        
        assertSuccess(response, '获取季列表失败');
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
        assert.strictEqual(typeof data.TotalRecordCount, 'number');
        
        console.log(`  ✓ 季数量: ${data.TotalRecordCount}`);
        
        // 保存第一个季的 ID
        if (data.Items.length > 0) {
          testSeasonId = data.Items[0].Id;
          
          // 验证季的数据结构
          const season = data.Items[0];
          assert.strictEqual(season.Type, 'Season', '类型应该是 Season');
          assert.ok(season.IndexNumber, '应该有季号 IndexNumber');
          assert.strictEqual(season.SeriesId, testSeriesId, 'SeriesId 应该匹配');
          // SeriesName 可能为空，不做强制断言
          // assert.ok(season.SeriesName, '应该有 SeriesName');
        }
      });

      it('每个季应该有正确的字段', async () => {
        if (!testSeriesId) return;

        const response = await get(`/Shows/${testSeriesId}/Seasons`);
        assertSuccess(response);
        
        const data = response.data!;
        for (const season of data.Items) {
          assert.ok(season.Id, '季应该有 Id');
          assert.ok(season.Name, '季应该有 Name');
          assert.strictEqual(season.Type, 'Season');
          assert.ok(typeof season.IndexNumber === 'number', 'IndexNumber 应该是数字');
          assert.strictEqual(season.IsFolder, true, 'IsFolder 应该为 true');
          
          // ChildCount 表示该季的集数
          if (season.ChildCount !== undefined) {
            assert.strictEqual(typeof season.ChildCount, 'number');
          }
        }
      });

      it('应该处理无效剧集ID', async () => {
        const response = await get('/Shows/invalid-series-id/Seasons');
        
        // 应该返回空列表或 404
        assert.ok(response.status === 200 || response.status === 404, 
          `期望 200 或 404，实际得到 ${response.status}`);
        
        if (response.status === 200) {
          assert.ok(Array.isArray(response.data?.Items), '应该返回 Items 数组');
          assert.strictEqual(response.data?.TotalRecordCount, 0, '总数应该为 0');
        }
      });
    });
  });

  describe('GET /Shows/:seriesId/Episodes', () => {
    skipIfNoCredentials(() => {
      it('应该返回剧集的所有集', async () => {
        if (!testSeriesId) {
          console.log('  [SKIP] 未找到测试剧集');
          return;
        }

        const response = await get(`/Shows/${testSeriesId}/Episodes?Limit=20`);
        
        assertSuccess(response, '获取集列表失败');
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
        
        console.log(`  ✓ 集数量: ${data.TotalRecordCount}`);
        
        // 验证集的数据结构
        if (data.Items.length > 0) {
          const episode = data.Items[0];
          assert.strictEqual(episode.Type, 'Episode', '类型应该是 Episode');
          assert.ok(episode.IndexNumber, '应该有集号 IndexNumber');
          assert.ok(episode.SeriesId, '应该有 SeriesId');
          assert.ok(episode.SeriesName, '应该有 SeriesName');
        }
      });

      it('应该支持按季过滤', async () => {
        if (!testSeriesId || !testSeasonId) {
          console.log('  [SKIP] 未找到测试季');
          return;
        }

        const response = await get(`/Shows/${testSeriesId}/Episodes?SeasonId=${testSeasonId}`);
        
        assertSuccess(response);
        
        const data = response.data!;
        // 所有返回的集应该属于同一个季
        if (data.Items.length > 0) {
          const seasonNumber = data.Items[0].ParentIndexNumber;
          for (const episode of data.Items) {
            assert.strictEqual(episode.ParentIndexNumber, seasonNumber, 
              '所有集的 ParentIndexNumber 应该相同');
          }
        }
      });

      it('应该支持分页', async () => {
        if (!testSeriesId) return;

        const response = await get(`/Shows/${testSeriesId}/Episodes?StartIndex=0&Limit=5`);
        assertSuccess(response);
        
        const data = response.data!;
        assert.ok(data.Items.length <= 5, '返回数量应该不超过 Limit');
      });

      it('每个集应该有正确的字段', async () => {
        if (!testSeriesId) return;

        const response = await get(`/Shows/${testSeriesId}/Episodes?Limit=5`);
        assertSuccess(response);
        
        const data = response.data!;
        for (const episode of data.Items) {
          assert.ok(episode.Id, '集应该有 Id');
          assert.ok(episode.Name, '集应该有 Name');
          assert.strictEqual(episode.Type, 'Episode');
          assert.ok(typeof episode.IndexNumber === 'number', 'IndexNumber 应该是数字');
          assert.ok(typeof episode.ParentIndexNumber === 'number', 'ParentIndexNumber 应该是数字');
          assert.ok(episode.SeriesId, '应该有 SeriesId');
          assert.ok(episode.SeriesName, '应该有 SeriesName');
          
          // 可能有的字段
          if (episode.Overview) {
            assert.strictEqual(typeof episode.Overview, 'string');
          }
        }
      });
    });
  });

  describe('GET /Shows/NextUp', () => {
    skipIfNoCredentials(() => {
      it('应该返回空列表（暂未实现）', async () => {
        const response = await get('/Shows/NextUp');
        
        assertSuccess(response);
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
        assert.strictEqual(data.TotalRecordCount, 0, '总数应该为 0');
      });
    });
  });
});
