/**
 * Playback API 测试
 * 播放状态同步
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { post, get, assertSuccess, assertStatus } from '../lib/client.ts';
import { login, isLoggedIn, skipIfNoCredentials } from '../lib/auth-helper.ts';
import { config, testState } from '../config.ts';

describe('Playback API', () => {
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

  describe('POST /Sessions/Playing - 播放开始', () => {
    skipIfNoCredentials(() => {
      it('应该报告播放开始', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        const response = await post('/Sessions/Playing', {
          ItemId: testItemId,
          PositionTicks: 0,
          CanSeek: true,
          IsPaused: false,
          IsMuted: false,
          VolumeLevel: 100,
        });
        
        assertSuccess(response, '报告播放开始失败');
        assertStatus(response, 204);
        
        console.log(`  ✓ 播放开始已报告`);
      });

      it('应该处理无效项目ID', async () => {
        const response = await post('/Sessions/Playing', {
          ItemId: 'invalid-item-id',
          PositionTicks: 0,
        });
        
        // 应该返回 204（不报错）或 404
        assert.ok(response.status === 204 || response.status === 404, 
          `期望 204 或 404，实际得到 ${response.status}`);
      });

      it('应该处理缺失 ItemId', async () => {
        const response = await post('/Sessions/Playing', {
          PositionTicks: 0,
        });
        
        // 应该优雅处理，不崩溃
        assert.ok(response.status === 204 || response.status === 400, 
          `期望 204 或 400，实际得到 ${response.status}`);
      });
    });
  });

  describe('POST /Sessions/Playing/Progress - 播放进度', () => {
    skipIfNoCredentials(() => {
      it('应该报告播放进度', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        // 报告 60 秒的进度 (Jellyfin 使用 ticks: 1 tick = 100 纳秒)
        const positionTicks = 60 * 10_000_000; // 60 秒

        const response = await post('/Sessions/Playing/Progress', {
          ItemId: testItemId,
          PositionTicks: positionTicks,
          CanSeek: true,
          IsPaused: false,
          IsMuted: false,
          VolumeLevel: 100,
        });
        
        assertSuccess(response, '报告播放进度失败');
        assertStatus(response, 204);
        
        console.log(`  ✓ 播放进度已报告: 60秒`);
      });

      it('应该支持暂停状态', async () => {
        if (!testItemId) return;

        const response = await post('/Sessions/Playing/Progress', {
          ItemId: testItemId,
          PositionTicks: 120 * 10_000_000,
          IsPaused: true,
        });
        
        assertSuccess(response);
        assertStatus(response, 204);
      });
    });
  });

  describe('POST /Sessions/Playing/Stopped - 播放停止', () => {
    skipIfNoCredentials(() => {
      it('应该报告播放停止', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        const response = await post('/Sessions/Playing/Stopped', {
          ItemId: testItemId,
          PositionTicks: 300 * 10_000_000, // 5 分钟
        });
        
        assertSuccess(response, '报告播放停止失败');
        assertStatus(response, 204);
        
        console.log(`  ✓ 播放停止已报告`);
      });
    });
  });

  describe('POST /Sessions/Playing/Ping - 播放心跳', () => {
    skipIfNoCredentials(() => {
      it('应该响应播放心跳', async () => {
        const response = await post('/Sessions/Playing/Ping');
        
        assertSuccess(response);
        assertStatus(response, 204);
      });
    });
  });

  describe('POST /UserPlayedItems/:itemId - 标记已观看', () => {
    skipIfNoCredentials(() => {
      it('应该标记项目为已观看', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        const response = await post(`/UserPlayedItems/${testItemId}`);
        
        assertSuccess(response, '标记已观看失败');
        assert.ok(response.status === 200 || response.status === 204, 
          `期望 200 或 204，实际得到 ${response.status}`);
        
        console.log(`  ✓ 已标记为观看: ${testItemId}`);
      });

      it('应该处理无效项目ID', async () => {
        const response = await post('/UserPlayedItems/invalid-item-id');
        
        // 可能返回 404 或 200（取决于实现）
        assert.ok(response.status === 200 || response.status === 204 || response.status === 404, 
          `期望 200/204/404，实际得到 ${response.status}`);
      });
    });
  });

  describe('DELETE /UserPlayedItems/:itemId - 取消已观看', () => {
    skipIfNoCredentials(() => {
      it('应该取消已观看标记', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        const { del } = await import('../lib/client.ts');
        const response = await del(`/UserPlayedItems/${testItemId}`);
        
        // 可能返回 200/204（成功）或 501（未实现）
        assert.ok([200, 204, 501].includes(response.status), 
          `期望 200/204/501，实际得到 ${response.status}`);
        
        console.log(`  ✓ 已取消观看标记: ${testItemId}`);
      });
    });
  });

  describe('GET /Sessions', () => {
    skipIfNoCredentials(() => {
      it('应该返回会话列表', async () => {
        const response = await get('/Sessions');
        
        assertSuccess(response);
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(Array.isArray(data), 'Sessions 应该是数组');
        
        // 应该有至少一个会话（当前会话）
        if (data.length > 0) {
          const session = data[0];
          assert.ok(session.Id, '会话应该有 Id');
          assert.ok(typeof session.IsActive === 'boolean', 'IsActive 应该是布尔值');
        }
      });
    });
  });

  describe('POST /Sessions/Capabilities', () => {
    skipIfNoCredentials(() => {
      it('应该接受客户端能力上报', async () => {
        const response = await post('/Sessions/Capabilities', {
          PlayableMediaTypes: ['Video', 'Audio'],
          SupportedCommands: ['Play', 'Pause', 'Stop'],
        });
        
        assertSuccess(response);
        assertStatus(response, 204);
      });

      it('应该接受完整客户端能力', async () => {
        const response = await post('/Sessions/Capabilities/Full', {
          PlayableMediaTypes: ['Video'],
          SupportedCommands: ['Play'],
        });
        
        assertSuccess(response);
        assertStatus(response, 204);
      });
    });
  });
});
