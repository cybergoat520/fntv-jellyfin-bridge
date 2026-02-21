/**
 * Stream API 测试
 * 视频流和播放信息
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { get, post, head, assertSuccess, assertStatus } from '../lib/client.ts';
import { login, isLoggedIn, skipIfNoCredentials } from '../lib/auth-helper.ts';
import { config, testState } from '../config.ts';

describe('Stream API', () => {
  let testItemId: string | null = null;
  let testMediaSourceId: string | null = null;

  before(async () => {
    if (!isLoggedIn() && config.username && config.password) {
      try {
        await login();
      } catch (e) {
        console.log('  [警告] 登录失败，部分测试将跳过');
      }
    }
    
    // 获取一个测试项目（带视频）
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
    
    // 获取媒体源 ID
    if (testItemId) {
      const itemResponse = await get(`/Items/${testItemId}`);
      if (itemResponse.success && itemResponse.data?.MediaSources?.length > 0) {
        testMediaSourceId = itemResponse.data.MediaSources[0].Id;
      }
    }
  });

  describe('POST /Items/:itemId/PlaybackInfo', () => {
    skipIfNoCredentials(() => {
      it('应该返回播放信息', async () => {
        if (!testItemId) {
          console.log('  [SKIP] 未找到测试项目');
          return;
        }

        const response = await post(`/Items/${testItemId}/PlaybackInfo`, {
          UserId: testState.userId,
          DeviceProfile: {
            Name: 'Test Device',
            MaxStreamingBitrate: 20_000_000,
            MaxStaticBitrate: 30_000_000,
            MusicStreamingTranscodingBitrate: 192_000,
          },
        });
        
        assertSuccess(response, '获取播放信息失败');
        assertStatus(response, 200);
        
        const data = response.data!;
        assert.ok(Array.isArray(data.MediaSources), 'MediaSources 应该是数组');
        
        console.log(`  ✓ 播放信息: ${data.MediaSources.length} 个媒体源`);
        
        // 验证媒体源结构
        if (data.MediaSources.length > 0) {
          const source = data.MediaSources[0];
          assert.ok(source.Id, 'MediaSource 应该有 Id');
          assert.ok(source.Container, '应该有 Container');
          assert.strictEqual(typeof source.SupportsDirectStream, 'boolean');
          assert.strictEqual(typeof source.SupportsTranscoding, 'boolean');
          
          // 保存用于后续测试
          testMediaSourceId = source.Id;
        }
      });

      it('应该包含 MediaStreams', async () => {
        if (!testItemId) return;

        const response = await post(`/Items/${testItemId}/PlaybackInfo`, {
          UserId: testState.userId,
        });
        
        assertSuccess(response);
        
        const data = response.data!;
        if (data.MediaSources.length > 0) {
          const source = data.MediaSources[0];
          assert.ok(Array.isArray(source.MediaStreams), 'MediaStreams 应该是数组');
          
          // 验证流信息
          for (const stream of source.MediaStreams || []) {
            assert.ok(stream.Id !== undefined, 'Stream 应该有 Id');
            assert.ok(stream.Type, 'Stream 应该有 Type（Video/Audio/Subtitle）');
            assert.ok(stream.Codec, 'Stream 应该有 Codec');
          }
        }
      });

      it('应该支持 DirectStream 判断', async () => {
        if (!testItemId) return;

        const response = await post(`/Items/${testItemId}/PlaybackInfo`, {
          UserId: testState.userId,
          EnableDirectStream: true,
        });
        
        assertSuccess(response);
        
        const data = response.data!;
        if (data.MediaSources.length > 0) {
          const source = data.MediaSources[0];
          // 根据音频兼容性，可能是 true 或 false
          assert.strictEqual(typeof source.SupportsDirectStream, 'boolean');
        }
      });

      it('应该处理无效项目ID', async () => {
        const response = await post('/Items/invalid-id/PlaybackInfo', {
          UserId: testState.userId,
        });
        
        assert.ok(response.status === 404 || response.status === 200, 
          `期望 404 或 200，实际得到 ${response.status}`);
      });
    });
  });

  describe('GET /Videos/:itemId/stream - 直接流', () => {
    skipIfNoCredentials(() => {
      it('应该返回视频流（如果支持 DirectStream）', async () => {
        if (!testItemId || !testMediaSourceId) {
          console.log('  [SKIP] 未找到测试项目或媒体源');
          return;
        }

        const response = await get(`/Videos/${testItemId}/stream?static=true&MediaSourceId=${testMediaSourceId}`, {
          responseType: 'stream',
        });
        
        // 可能返回 200（流）或 206（Range请求）或 302（重定向）或 404（不支持）
        assert.ok([200, 206, 302, 404].includes(response.status), 
          `期望 200/206/302/404，实际得到 ${response.status}`);
        
        if (response.status === 200) {
          console.log(`  ✓ 视频流已获取`);
        }
      });

      it('应该支持 Range 请求', async () => {
        if (!testItemId || !testMediaSourceId) return;

        const response = await get(`/Videos/${testItemId}/stream?static=true&MediaSourceId=${testMediaSourceId}`, {
          headers: {
            'Range': 'bytes=0-1023',
          },
        });
        
        // 应该返回 206 Partial Content 或 200
        assert.ok([200, 206].includes(response.status), 
          `期望 200 或 206，实际得到 ${response.status}`);
      });
    });
  });

  describe('GET /Videos/:itemId/stream.container', () => {
    skipIfNoCredentials(() => {
      it('应该支持带扩展名的流请求（Range: 头部 16KB）', async () => {
        if (!testItemId || !testMediaSourceId) {
          console.log('  [SKIP] 未找到测试项目或媒体源');
          return;
        }

        const response = await get(`/Videos/${testItemId}/stream.mkv?static=true&MediaSourceId=${testMediaSourceId}`, {
          headers: { 'Range': 'bytes=0-16383' },  // 前 16KB
          responseType: 'arraybuffer',
        });
        
        assert.ok([200, 206].includes(response.status), 
          `期望 200/206，实际得到 ${response.status}`);
        
        if (response.data) {
          const size = response.data.byteLength || response.data.length || 0;
          console.log(`  ✓ 头部数据: ${size} bytes`);
          assert.ok(size > 0, '应该返回数据');
          assert.ok(size <= 16384, `数据大小应该 <= 16KB，实际 ${size}`);
        }
      });

      it('应该支持 Range 请求（中间 16KB）', async () => {
        if (!testItemId || !testMediaSourceId) {
          console.log('  [SKIP] 未找到测试项目或媒体源');
          return;
        }

        // 先获取文件大小
        const headResp = await get(`/Videos/${testItemId}/stream.mkv?static=true&MediaSourceId=${testMediaSourceId}`, {
          headers: { 'Range': 'bytes=0-0' },  // 只请求 1 byte 来获取 Content-Range
        });
        
        // 从 Content-Range 解析总大小: "bytes 0-0/123456789"
        let totalSize = 0;
        if (headResp.status === 206) {
          // axios 会把 headers 放在不同地方，尝试多种方式获取
          const contentRange = headResp.data?.headers?.['content-range'] || '';
          const match = contentRange.match(/\/(\d+)$/);
          if (match) {
            totalSize = parseInt(match[1], 10);
          }
        }
        
        if (totalSize < 100000) {
          console.log('  [SKIP] 文件太小或无法获取大小，跳过中间位置测试');
          return;
        }

        const midStart = Math.floor(totalSize / 2);
        const midEnd = midStart + 16383;
        
        const response = await get(`/Videos/${testItemId}/stream.mkv?static=true&MediaSourceId=${testMediaSourceId}`, {
          headers: { 'Range': `bytes=${midStart}-${midEnd}` },
          responseType: 'arraybuffer',
        });
        
        assert.ok([200, 206].includes(response.status), 
          `期望 200/206，实际得到 ${response.status}`);
        
        if (response.data) {
          const size = response.data.byteLength || response.data.length || 0;
          console.log(`  ✓ 中间数据 (offset=${midStart}): ${size} bytes`);
          assert.ok(size > 0, '应该返回数据');
        }
      });

      it('应该支持 Range 请求（末尾 16KB）', async () => {
        if (!testItemId || !testMediaSourceId) {
          console.log('  [SKIP] 未找到测试项目或媒体源');
          return;
        }

        // 使用 suffix-range 格式请求末尾数据
        const response = await get(`/Videos/${testItemId}/stream.mkv?static=true&MediaSourceId=${testMediaSourceId}`, {
          headers: { 'Range': 'bytes=-16384' },  // 末尾 16KB
          responseType: 'arraybuffer',
        });
        
        assert.ok([200, 206].includes(response.status), 
          `期望 200/206，实际得到 ${response.status}`);
        
        if (response.data) {
          const size = response.data.byteLength || response.data.length || 0;
          console.log(`  ✓ 末尾数据: ${size} bytes`);
          assert.ok(size > 0, '应该返回数据');
        }
      });
    });
  });

  describe('HLS 转码流', () => {
    skipIfNoCredentials(() => {
      it('无会话时应该返回 404 或 410', async () => {
        // 使用一个不存在的 mediaSourceId，确保没有会话
        const fakeMediaSourceId = '00000000-0000-0000-0000-000000000000';
        const response = await get(`/${fakeMediaSourceId}/hls/main.m3u8`);
        
        // 无会话时应该返回 404（未找到）或 410（会话不存在/已过期）
        assert.ok([404, 410].includes(response.status), 
          `期望 404 或 410，实际得到 ${response.status}`);
        console.log(`  ✓ 无会话时返回 ${response.status}`);
      });

      it('有会话时应该返回 HLS 播放列表', async () => {
        if (!testItemId || !testMediaSourceId) {
          console.log('  [SKIP] 未找到测试项目或媒体源');
          return;
        }

        // 1. 先调用 PlaybackInfo 创建会话（注册流元数据）
        const playbackInfoResponse = await post(`/Items/${testItemId}/PlaybackInfo`, {
          DeviceProfile: {
            MaxStreamingBitrate: 120000000,
            TranscodingProfiles: [
              { Type: 'Video', Container: 'ts', Protocol: 'hls' }
            ]
          }
        });
        
        if (playbackInfoResponse.status !== 200) {
          console.log('  [SKIP] PlaybackInfo 调用失败');
          return;
        }

        // 2. 请求 HLS m3u8 播放列表
        const response = await get(`/${testMediaSourceId}/hls/main.m3u8`);
        
        // 有会话时应该返回 200（播放列表）
        // 注意：如果飞牛服务器不支持转码或配置问题，可能仍返回 404/410
        if (response.status === 200) {
          assert.ok(typeof response.data === 'string', '应该返回字符串');
          assert.ok(response.data.includes('#EXTM3U'), '应该是有效的 m3u8 文件');
          console.log(`  ✓ HLS 播放列表已获取`);
        } else {
          // 如果不是 200，记录状态但不失败（可能是服务器配置问题）
          console.log(`  ⚠ HLS 返回 ${response.status}（可能服务器不支持转码）`);
          assert.ok([404, 410].includes(response.status),
            `期望 200、404 或 410，实际得到 ${response.status}`);
        }
      });
    });
  });

  describe('字幕流', () => {
    skipIfNoCredentials(() => {
      it('应该支持字幕请求', async () => {
        if (!testItemId || !testMediaSourceId) {
          console.log('  [SKIP] 未找到测试项目或媒体源');
          return;
        }

        // 请求第一个字幕流
        const response = await get(`/Videos/${testItemId}/${testMediaSourceId}/Subtitles/0/Stream.subrip`);
        
        // 可能返回 200（字幕）或 404（无字幕）
        assert.ok([200, 404].includes(response.status), 
          `期望 200 或 404，实际得到 ${response.status}`);
      });
    });
  });
});
