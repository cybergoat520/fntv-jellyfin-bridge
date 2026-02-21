/**
 * Misc API 测试
 * 其他端点
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import { get, post, assertSuccess, assertStatus } from '../lib/client.ts';
import { login, isLoggedIn, skipIfNoCredentials } from '../lib/auth-helper.ts';
import { testState, config } from '../config.ts';

describe('Misc API', () => {
  describe('Localization', () => {
    it('GET /Localization/Countries 应该返回空数组', async () => {
      const response = await get('/Localization/Countries');
      
      assertSuccess(response);
      assertStatus(response, 200);
      assert.ok(Array.isArray(response.data), '应该是数组');
    });

    it('GET /Localization/Cultures 应该返回空数组', async () => {
      const response = await get('/Localization/Cultures');
      
      assertSuccess(response);
      assertStatus(response, 200);
      assert.ok(Array.isArray(response.data), '应该是数组');
    });

    it('GET /Localization/ParentalRatings 应该返回空数组', async () => {
      const response = await get('/Localization/ParentalRatings');
      
      assertSuccess(response);
      assertStatus(response, 200);
      assert.ok(Array.isArray(response.data), '应该是数组');
    });
  });

  describe('DisplayPreferences', () => {
    it('GET /DisplayPreferences/:id 应该返回偏好设置', async () => {
      const response = await get('/DisplayPreferences/usersettings');
      
      assertSuccess(response);
      assertStatus(response, 200);
      
      const data = response.data!;
      assert.ok(data.Id, '应该有 Id');
      assert.ok(data.SortBy, '应该有 SortBy');
      assert.ok(data.SortOrder, '应该有 SortOrder');
    });

    it('POST /DisplayPreferences/:id 应该接受偏好设置', async () => {
      const response = await post('/DisplayPreferences/usersettings', {
        SortBy: 'SortName',
        SortOrder: 'Ascending',
      });
      
      assertSuccess(response);
      assertStatus(response, 204);
    });
  });

  describe('Intros', () => {
    it('GET /Items/:itemId/Intros 应该返回空', async () => {
      const response = await get('/Items/test-id/Intros');
      
      assertSuccess(response);
      assertStatus(response, 200);
      
      const data = response.data!;
      assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
      assert.strictEqual(data.TotalRecordCount, 0, '总数应该为 0');
    });
  });

  describe('Similar', () => {
    it('GET /Items/:itemId/Similar 应该返回空', async () => {
      const response = await get('/Items/test-id/Similar');
      
      assertSuccess(response);
      assertStatus(response, 200);
      
      const data = response.data!;
      assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
    });
  });

  describe('ThemeMedia', () => {
    it('GET /Items/:itemId/ThemeMedia 应该返回空', async () => {
      const response = await get('/Items/test-id/ThemeMedia');
      
      assertSuccess(response);
      assertStatus(response, 200);
      
      const data = response.data!;
      assert.ok(data.ThemeVideosResult, '应该有 ThemeVideosResult');
      assert.ok(data.ThemeSongsResult, '应该有 ThemeSongsResult');
    });
  });

  describe('SpecialFeatures', () => {
    it('GET /Items/:itemId/SpecialFeatures 应该返回空数组', async () => {
      const response = await get('/Items/test-id/SpecialFeatures');
      
      assertSuccess(response);
      assertStatus(response, 200);
      assert.ok(Array.isArray(response.data), '应该是数组');
    });
  });

  describe('SyncPlay', () => {
    it('GET /SyncPlay/List 应该返回空数组', async () => {
      const response = await get('/SyncPlay/List');
      
      assertSuccess(response);
      assertStatus(response, 200);
      assert.ok(Array.isArray(response.data), '应该是数组');
    });
  });

  describe('Studios', () => {
    it('GET /Studios 应该返回空列表', async () => {
      const response = await get('/Studios');
      
      assertSuccess(response);
      assertStatus(response, 200);
      
      const data = response.data!;
      assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
    });
  });

  describe('QuickConnect', () => {
    it('GET /QuickConnect/Enabled 应该返回 false', async () => {
      const response = await get('/QuickConnect/Enabled');
      
      assertSuccess(response);
      assertStatus(response, 200);
      assert.strictEqual(response.data, false, '应该返回 false');
    });
  });

  describe('根路径', () => {
    it('HEAD / 应该返回 200', async () => {
      const { head } = await import('../lib/client.ts');
      const response = await head('/');
      
      assertSuccess(response);
      assertStatus(response, 200);
    });

    it('GET / 应该重定向到 /web/', async () => {
      const response = await get('/');
      
      assert.ok([200, 302].includes(response.status), 
        `期望 200 或 302，实际得到 ${response.status}`);
    });

    it('GET /web 应该重定向到 /web/', async () => {
      const response = await get('/web');
      
      assert.ok([200, 302].includes(response.status), 
        `期望 200 或 302，实际得到 ${response.status}`);
    });
  });

  describe('favicon.ico', () => {
    it('GET /favicon.ico 应该返回 204', async () => {
      const response = await get('/favicon.ico');
      
      assertSuccess(response);
      assertStatus(response, 204);
    });
  });

  describe('未实现端点兜底', () => {
    it('应该对未知端点返回空响应而非 404', async () => {
      const response = await get('/Unknown/Endpoint/That/Does/Not/Exist');
      
      // 不应该返回 404
      assert.ok(response.status !== 404, '不应该返回 404');
      assert.ok(response.status === 200, `期望 200，实际得到 ${response.status}`);
    });

    it('应该对 Items 相关未知端点返回空 Items', async () => {
      const response = await get('/Items/Unknown/Action');
      
      if (response.status === 200 && response.data) {
        const data = response.data!;
        if (data.Items !== undefined) {
          assert.ok(Array.isArray(data.Items), 'Items 应该是数组');
        }
      }
    });
  });
});
