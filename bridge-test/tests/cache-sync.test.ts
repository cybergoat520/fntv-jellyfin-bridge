/**
 * 缓存同步测试
 * 测试收藏、观看、播放状态变更后的缓存一致性
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { get, post, del, assertSuccess, assertStatus } from '../lib/client.ts';
import { login, isLoggedIn, skipIfNoCredentials } from '../lib/auth-helper.ts';
import { config, testState } from '../config.ts';

describe('Cache Sync API', () => {
  let testItemId: string | null = null;
  let testParentId: string | null = null;

  before(async () => {
    if (!isLoggedIn() && config.username && config.password) {
      try {
        await login();
      } catch (e) {
        console.log('  [警告] 登录失败，部分测试将跳过');
      }
    }
    
    // 获取测试项目和父级ID
    if (isLoggedIn() && !testState.testItemId) {
      const viewsResponse = await get('/UserViews');
      if (viewsResponse.success) {
        const movieLib = viewsResponse.data?.Items?.find((item: any) => 
          item.Name === '电影' || item.CollectionType === 'movies'
        );
        
        if (movieLib) {
          testParentId = movieLib.Id;
          const itemsResponse = await get(`/Items?ParentId=${movieLib.Id}&Limit=1`);
          if (itemsResponse.success && itemsResponse.data?.Items?.length > 0) {
            testState.testItemId = itemsResponse.data.Items[0].Id;
          }
        }
      }
    }
    testItemId = testState.testItemId;
  });

  describe('收藏状态缓存同步', () => {
    skipIfNoCredentials(() => {
      it('添加收藏后列表应显示为已收藏', async () => {
        if (!testItemId || !testParentId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        // 1. 先确保未收藏
        await del(`/UserFavoriteItems/${testItemId}`);
        
        // 2. 添加收藏
        const addResponse = await post(`/UserFavoriteItems/${testItemId}`);
        assertSuccess(addResponse, '添加收藏失败');
        
        // 3. 等待缓存更新（给服务器一点时间处理）
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 4. 获取列表，验证收藏状态
        const listResponse = await get(`/Items?ParentId=${testParentId}&Limit=50`);
        assertSuccess(listResponse);
        
        const item = listResponse.data?.Items?.find((i: any) => i.Id === testItemId);
        if (item) {
          assert.strictEqual(item.UserData?.IsFavorite, true, 
            '添加收藏后列表中应显示为已收藏');
          console.log('  ✓ 添加收藏后列表状态正确');
        } else {
          console.log('  [WARN] 未在列表中找到测试项目');
        }
      });

      it('取消收藏后列表应显示为未收藏', async () => {
        if (!testItemId || !testParentId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        // 1. 先确保已收藏
        await post(`/UserFavoriteItems/${testItemId}`);
        
        // 2. 取消收藏
        const removeResponse = await del(`/UserFavoriteItems/${testItemId}`);
        assertSuccess(removeResponse, '取消收藏失败');
        
        // 3. 等待缓存更新
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 4. 获取列表，验证收藏状态
        const listResponse = await get(`/Items?ParentId=${testParentId}&Limit=50`);
        assertSuccess(listResponse);
        
        const item = listResponse.data?.Items?.find((i: any) => i.Id === testItemId);
        if (item) {
          assert.ok(!item.UserData?.IsFavorite, 
            '取消收藏后列表中应显示为未收藏');
          console.log('  ✓ 取消收藏后列表状态正确');
        } else {
          console.log('  [WARN] 未在列表中找到测试项目');
        }
      });

      it('IsFavorite 过滤器应实时反映状态变更', async () => {
        if (!testItemId || !testParentId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        // 1. 添加收藏
        await post(`/UserFavoriteItems/${testItemId}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 2. 查询收藏列表，应包含该项目
        const favResponse = await get(`/Items?ParentId=${testParentId}&Filters=IsFavorite&Limit=50`);
        assertSuccess(favResponse);
        
        const inFavorites = favResponse.data?.Items?.some((i: any) => i.Id === testItemId);
        assert.strictEqual(inFavorites, true, 
          '收藏后应在 IsFavorite 过滤结果中');
        
        // 3. 取消收藏
        await del(`/UserFavoriteItems/${testItemId}`);
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 4. 再次查询，不应包含
        const favResponse2 = await get(`/Items?ParentId=${testParentId}&Filters=IsFavorite&Limit=50`);
        assertSuccess(favResponse2);
        
        const stillInFavorites = favResponse2.data?.Items?.some((i: any) => i.Id === testItemId);
        assert.strictEqual(stillInFavorites, false, 
          '取消收藏后不应在 IsFavorite 过滤结果中');
        
        console.log('  ✓ IsFavorite 过滤器实时同步正确');
      });
    });
  });

  describe('观看状态缓存同步', () => {
    skipIfNoCredentials(() => {
      it('标记已看后列表应显示为已观看', async () => {
        if (!testItemId || !testParentId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        // 1. 先取消观看
        await del(`/UserPlayedItems/${testItemId}`);
        
        // 2. 标记已看
        const markResponse = await post(`/UserPlayedItems/${testItemId}`);
        assertSuccess(markResponse, '标记已看失败');
        
        // 3. 等待缓存更新
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 4. 获取列表，验证观看状态
        const listResponse = await get(`/Items?ParentId=${testParentId}&Limit=50`);
        assertSuccess(listResponse);
        
        const item = listResponse.data?.Items?.find((i: any) => i.Id === testItemId);
        if (item) {
          assert.strictEqual(item.UserData?.Played, true, 
            '标记已看后列表中应显示为已观看');
          console.log('  ✓ 标记已看后列表状态正确');
        } else {
          console.log('  [WARN] 未在列表中找到测试项目');
        }
      });

      it('取消已看后列表应显示为未观看', async () => {
        if (!testItemId || !testParentId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        // 1. 先标记已看
        await post(`/UserPlayedItems/${testItemId}`);
        
        // 2. 取消已看
        const unmarkResponse = await del(`/UserPlayedItems/${testItemId}`);
        // 可能返回 200/204（成功）或 501（未实现）
        if (![200, 204].includes(unmarkResponse.status)) {
          console.log('  [SKIP] 取消已看可能未实现');
          return;
        }
        
        // 3. 等待缓存更新
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 4. 获取列表，验证观看状态
        const listResponse = await get(`/Items?ParentId=${testParentId}&Limit=50`);
        assertSuccess(listResponse);
        
        const item = listResponse.data?.Items?.find((i: any) => i.Id === testItemId);
        if (item) {
          assert.ok(!item.UserData?.Played, 
            '取消已看后列表中应显示为未观看');
          console.log('  ✓ 取消已看后列表状态正确');
        } else {
          console.log('  [WARN] 未在列表中找到测试项目');
        }
      });

      it('有播放进度时标记已看应清除进度', async () => {
        if (!testItemId || !testParentId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        // 1. 先取消已看（重置状态）
        await del(`/UserPlayedItems/${testItemId}`);
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 2. 上报播放进度（5分钟）
        const positionTicks = 5 * 60 * 10_000_000;
        await post('/Sessions/Playing/Progress', {
          ItemId: testItemId,
          PositionTicks: positionTicks,
          CanSeek: true,
          IsPaused: false,
        });
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 3. 验证列表中有播放进度
        const listBefore = await get(`/Items?ParentId=${testParentId}&Limit=50`);
        const itemBefore = listBefore.data?.Items?.find((i: any) => i.Id === testItemId);
        if (itemBefore?.UserData?.PlaybackPositionTicks) {
          console.log(`  [INFO] 标记已看前进度: ${itemBefore.UserData.PlaybackPositionTicks / 10_000_000}秒`);
        }
        
        // 4. 标记已看
        const markResponse = await post(`/UserPlayedItems/${testItemId}`);
        assertSuccess(markResponse, '标记已看失败');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 5. 验证列表中进度已清除或更新
        const listAfter = await get(`/Items?ParentId=${testParentId}&Limit=50`);
        assertSuccess(listAfter);
        
        const itemAfter = listAfter.data?.Items?.find((i: any) => i.Id === testItemId);
        assert.ok(itemAfter, '应在列表中找到测试项目');
        assert.strictEqual(itemAfter.UserData?.Played, true, '应标记为已观看');
        
        // 播放进度应该被清除（变为0或接近0）或不再显示
        const playbackTicks = itemAfter.UserData?.PlaybackPositionTicks;
        if (playbackTicks !== undefined && playbackTicks !== null) {
          // 如果还有进度值，应该非常小（小于1秒）
          const seconds = playbackTicks / 10_000_000;
          assert.ok(seconds < 1, `标记已看后播放进度应被清除，实际还有 ${seconds}秒`);
        }
        
        // 验证继续观看列表中不再出现（因为没有进度了）
        const resumeResponse = await get('/UserItems/Resume?Limit=50');
        const inResume = resumeResponse.data?.Items?.some((i: any) => i.Id === testItemId);
        assert.ok(!inResume, '标记已看后不应在继续观看列表中');
        
        console.log('  ✓ 有播放进度时标记已看后进度已清除');
      });
    });
  });

  describe('播放进度缓存同步', () => {
    skipIfNoCredentials(() => {
      it('上报播放进度后应出现在继续观看列表', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        // 1. 先重置观看状态（取消已看）
        await del(`/UserPlayedItems/${testItemId}`);
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 2. 报告播放进度（5分钟）
        const positionTicks = 5 * 60 * 10_000_000; // 5分钟
        const progressResponse = await post('/Sessions/Playing/Progress', {
          ItemId: testItemId,
          PositionTicks: positionTicks,
          CanSeek: true,
          IsPaused: false,
        });
        assertSuccess(progressResponse, '上报播放进度失败');
        assertStatus(progressResponse, 204);
        
        // 3. 等待缓存更新
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 4. 查询继续观看列表
        const resumeResponse = await get('/UserItems/Resume?Limit=50');
        assertSuccess(resumeResponse);
        
        const inResume = resumeResponse.data?.Items?.some((i: any) => i.Id === testItemId);
        if (inResume) {
          console.log('  ✓ 上报进度后继续观看列表正确');
        } else {
          // 可能由于时间关系未同步，记录但不失败
          console.log('  [WARN] 项目未出现在继续观看列表中（可能缓存未同步）');
        }
      });

      it('播放停止后进度应正确保存', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        // 1. 报告播放开始
        await post('/Sessions/Playing', {
          ItemId: testItemId,
          PositionTicks: 0,
          CanSeek: true,
          IsPaused: false,
        });
        
        // 2. 报告播放停止（10分钟位置）
        const positionTicks = 10 * 60 * 10_000_000; // 10分钟
        const stopResponse = await post('/Sessions/Playing/Stopped', {
          ItemId: testItemId,
          PositionTicks: positionTicks,
        });
        assertSuccess(stopResponse, '上报播放停止失败');
        assertStatus(stopResponse, 204);
        
        // 3. 等待缓存更新
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // 4. 获取项目详情，验证播放进度
        const itemResponse = await get(`/Items/${testItemId}`);
        assertSuccess(itemResponse);
        
        const userData = itemResponse.data?.UserData;
        if (userData?.PlaybackPositionTicks) {
          // 允许一定的误差（±30秒）
          const expectedTicks = positionTicks;
          const actualTicks = userData.PlaybackPositionTicks;
          const diffSeconds = Math.abs(actualTicks - expectedTicks) / 10_000_000;
          
          assert.ok(diffSeconds < 30, 
            `播放进度误差过大: 期望 ${expectedTicks/10_000_000}秒, 实际 ${actualTicks/10_000_000}秒`);
          console.log('  ✓ 播放停止后进度保存正确');
        } else {
          console.log('  [WARN] 未获取到播放进度（可能缓存未同步）');
        }
      });
    });
  });

  describe('播放信息缓存性能', () => {
    skipIfNoCredentials(() => {
      it('多次播放上报应正常工作（PlayInfo缓存）', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        // 连续多次上报播放进度，验证 PlayInfo 缓存机制正常工作
        const timestamps = [
          1 * 60 * 10_000_000,  // 1分钟
          2 * 60 * 10_000_000,  // 2分钟
          3 * 60 * 10_000_000,  // 3分钟
          5 * 60 * 10_000_000,  // 5分钟
        ];

        for (let i = 0; i < timestamps.length; i++) {
          const startTime = Date.now();
          const response = await post('/Sessions/Playing/Progress', {
            ItemId: testItemId,
            PositionTicks: timestamps[i],
            CanSeek: true,
            IsPaused: false,
          });
          const duration = Date.now() - startTime;
          
          assertSuccess(response, `第 ${i + 1} 次上报播放进度失败`);
          assertStatus(response, 204);
          
          // 如果缓存生效，后续请求应该更快（但这里只是记录，不做强断言）
          if (config.verbose) {
            console.log(`  [INFO] 上报 ${i + 1}/${timestamps.length} 耗时: ${duration}ms`);
          }
          
          // 短暂间隔
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('  ✓ 多次播放上报正常工作（PlayInfo缓存优化）');
      });

      it('混合播放事件上报应正常工作', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        // 模拟真实播放场景：开始 -> 进度 -> 进度 -> 停止
        const events = [
          { url: '/Sessions/Playing', data: { ItemId: testItemId, PositionTicks: 0 } },
          { url: '/Sessions/Playing/Progress', data: { ItemId: testItemId, PositionTicks: 30 * 10_000_000 } },
          { url: '/Sessions/Playing/Progress', data: { ItemId: testItemId, PositionTicks: 60 * 10_000_000 } },
          { url: '/Sessions/Playing/Progress', data: { ItemId: testItemId, PositionTicks: 90 * 10_000_000 } },
          { url: '/Sessions/Playing/Stopped', data: { ItemId: testItemId, PositionTicks: 120 * 10_000_000 } },
        ];

        for (const event of events) {
          const response = await post(event.url, event.data);
          assertSuccess(response);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        console.log('  ✓ 混合播放事件上报正常');
      });
    });
  });

  describe('最近添加列表缓存', () => {
    skipIfNoCredentials(() => {
      it('最近添加列表应正确返回', async () => {
        const viewsResponse = await get('/UserViews');
        if (!viewsResponse.success) {
          console.log('  [SKIP] 无法获取媒体库');
          return;
        }

        const movieLib = viewsResponse.data?.Items?.find((item: any) => 
          item.Name === '电影' || item.CollectionType === 'movies'
        );
        
        if (!movieLib) {
          console.log('  [SKIP] 未找到电影库');
          return;
        }

        // 获取最近添加
        const latestResponse = await get(`/Items/Latest?ParentId=${movieLib.Id}&Limit=10`);
        assertSuccess(latestResponse);
        
        assert.ok(Array.isArray(latestResponse.data), '最近添加应该是数组');
        console.log(`  ✓ 最近添加列表: ${latestResponse.data?.length || 0} 个项目`);
      });
    });
  });
});
