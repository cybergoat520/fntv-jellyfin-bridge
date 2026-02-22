/**
 * 路径规范化测试
 * 
 * 这些测试验证服务器对非标准路径的容错处理能力。
 * 
 * 注意：标准的 Jellyfin 客户端（jellyfin-web、Xbox、Android 等）
 * 都会使用正确的路径大小写（如 /System/Info/Public）。
 * 这些测试是为了防止第三方客户端或手动请求使用小写路径时出现问题。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { get, assertSuccess, assertStatus } from '../lib/client.ts';

describe('Path Normalization', () => {
  describe('大小写规范化', () => {
    it('应该处理全小写路径 /system/info/public', async () => {
      const response = await get('/system/info/public');
      
      assertSuccess(response);
      assertStatus(response, 200);
      assert.ok(response.data?.ServerName, '响应应该包含 ServerName');
      assert.ok(response.data?.Version, '响应应该包含 Version');
      
      console.log('  ✓ 全小写路径 /system/info/public 处理正常');
    });

    it('应该处理全大写路径 /SYSTEM/INFO/PUBLIC', async () => {
      const response = await get('/SYSTEM/INFO/PUBLIC');
      
      assertSuccess(response);
      assertStatus(response, 200);
      assert.ok(response.data?.ServerName, '响应应该包含 ServerName');
      
      console.log('  ✓ 全大写路径 /SYSTEM/INFO/PUBLIC 处理正常');
    });

    it('应该处理混合大小写路径 /System/Info/Public', async () => {
      const response = await get('/System/Info/Public');
      
      assertSuccess(response);
      assertStatus(response, 200);
      assert.ok(response.data?.ServerName, '响应应该包含 ServerName');
      
      console.log('  ✓ 混合大小写路径 /System/Info/Public 处理正常');
    });

    it('应该处理混合大小写路径 /SYSTEM/Info/Public', async () => {
      const response = await get('/SYSTEM/Info/Public');
      
      assertSuccess(response);
      assertStatus(response, 200);
      assert.ok(response.data?.ServerName, '响应应该包含 ServerName');
      
      console.log('  ✓ 混合大小写路径 /SYSTEM/Info/Public 处理正常');
    });
  });

  describe('其他路径变体', () => {
    it('应该处理小写的 /userviews', async () => {
      const response = await get('/userviews');
      
      // 应该正常处理，不 404
      assert.ok(
        response.status === 200 || response.status === 401 || response.status === 302,
        `小写路径应该正确处理，实际状态: ${response.status}`
      );
      
      console.log('  ✓ 小写路径 /userviews 处理正常');
    });

    it('应该处理小写的 /branding/configuration', async () => {
      const response = await get('/branding/configuration');
      
      assertSuccess(response);
      assertStatus(response, 200);
      
      console.log('  ✓ 小写路径 /branding/configuration 处理正常');
    });
  });
});
