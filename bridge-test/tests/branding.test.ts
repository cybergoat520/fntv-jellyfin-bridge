/**
 * Branding API 测试
 * 品牌配置和样式
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { get, assertSuccess, assertStatus } from '../lib/client.ts';

describe('Branding API', () => {
  describe('GET /Branding/Configuration', () => {
    it('应该返回品牌配置', async () => {
      const response = await get('/Branding/Configuration');
      
      assertSuccess(response, '获取品牌配置失败');
      assertStatus(response, 200);
      
      const data = response.data!;
      // 验证基本结构（字段可能为空）
      assert.strictEqual(typeof data, 'object', '响应应该是对象');
      
      console.log(`  ✓ 品牌配置已获取`);
    });
  });

  describe('GET /Branding/Css', () => {
    it('应该返回自定义 CSS', async () => {
      const response = await get('/Branding/Css.css');
      
      assertSuccess(response);
      assertStatus(response, 200);
      
      // 响应应该是 CSS 字符串
      const data = response.data!;
      assert.ok(typeof data === 'string' || typeof data === 'object', 
        '响应应该是字符串或对象');
    });

    it('应该支持小写路径', async () => {
      const response = await get('/branding/css.css');
      
      assertSuccess(response);
      assertStatus(response, 200);
    });
  });
});
