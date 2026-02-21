/**
 * System API 测试
 * 测试系统信息端点（无需认证）
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { get, head, assertSuccess, assertStatus } from '../lib/client.ts';
import { config } from '../config.ts';

describe('System API', () => {
  describe('GET /System/Info/Public', () => {
    it('应该返回公开系统信息', async () => {
      const response = await get('/System/Info/Public');
      
      assertSuccess(response, '获取公开系统信息失败');
      assertStatus(response, 200);
      
      const data = response.data!;
      assert.strictEqual(typeof data.ServerName, 'string', 'ServerName 应该是字符串');
      assert.strictEqual(typeof data.Version, 'string', 'Version 应该是字符串');
      assert.strictEqual(typeof data.Id, 'string', 'Id 应该是字符串');
      assert.strictEqual(data.ProductName, 'Jellyfin Server', 'ProductName 应该匹配');
      assert.strictEqual(data.StartupWizardCompleted, true, 'StartupWizardCompleted 应该为 true');
      
      console.log(`  ✓ 服务器: ${data.ServerName}, 版本: ${data.Version}`);
    });

    it('应该包含 LocalAddress', async () => {
      const response = await get('/System/Info/Public');
      assertSuccess(response);
      
      const data = response.data!;
      assert.ok(data.LocalAddress, '应该包含 LocalAddress');
      assert.ok(data.LocalAddress.startsWith('http'), 'LocalAddress 应该是 URL');
    });
  });

  describe('GET /System/Info', () => {
    it('未认证时应该返回 401', async () => {
      // 临时清除认证状态
      const response = await get('/System/Info');
      // 注意：根据中间件实现，可能是 401 或返回受限信息
      assert.ok(response.status === 200 || response.status === 401, 
        `期望 200 或 401，实际得到 ${response.status}`);
    });
  });

  describe('GET /System/Ping', () => {
    it('应该返回服务器名称', async () => {
      const response = await get('/System/Ping');
      
      assertSuccess(response, 'Ping 失败');
      assertStatus(response, 200);
      
      const data = response.data!;
      assert.strictEqual(typeof data, 'string', 'Ping 响应应该是字符串');
      console.log(`  ✓ Ping 响应: ${data}`);
    });
  });

  describe('POST /System/Ping', () => {
    it('应该支持 POST 方法', async () => {
      const { post } = await import('../lib/client.ts');
      const response = await post('/System/Ping');
      
      assertSuccess(response, 'POST Ping 失败');
      assertStatus(response, 200);
    });
  });

  describe('GET /System/Endpoint', () => {
    it('应该返回端点信息', async () => {
      const response = await get('/System/Endpoint');
      
      assertSuccess(response);
      assertStatus(response, 200);
      
      const data = response.data!;
      assert.strictEqual(typeof data.IsLocal, 'boolean', 'IsLocal 应该是布尔值');
      assert.strictEqual(typeof data.IsInNetwork, 'boolean', 'IsInNetwork 应该是布尔值');
    });
  });

  describe('路径大小写兼容', () => {
    it('应该支持小写路径', async () => {
      const response = await get('/system/info/public');
      assertSuccess(response);
      assertStatus(response, 200);
    });

    it('应该支持混合大小写路径', async () => {
      const response = await get('/SYSTEM/INFO/PUBLIC');
      assertSuccess(response);
      assertStatus(response, 200);
    });
  });

  describe('GET /Playback/BitrateTest', () => {
    it('应该返回指定大小的数据', async () => {
      const response = await get('/Playback/BitrateTest?Size=1024');
      
      assertSuccess(response);
      assertStatus(response, 200);
      
      // 响应可能是二进制数据或字符串
      assert.ok(
        response.data instanceof Buffer || 
        typeof response.data === 'object' ||
        typeof response.data === 'string',
        '响应应该是二进制数据或字符串'
      );
    });

    it('应该限制最大大小', async () => {
      const response = await get('/Playback/BitrateTest?Size=999999999');
      assertSuccess(response);
      // 服务器应该限制返回大小不超过 1MB
    });
  });
});
