/**
 * 认证和用户 API 测试
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { get, post, assertSuccess, assertStatus } from '../lib/client.ts';
import { login, logout, getCurrentUser, getUser, isLoggedIn, skipIfNoCredentials } from '../lib/auth-helper.ts';
import { config, testState } from '../config.ts';

describe('Auth & Users API', () => {
  // 测试前确保登录状态用于后续测试
  after(async () => {
    // 如果登录成功，保持会话状态供其他测试使用
    if (!isLoggedIn() && config.username && config.password) {
      try {
        await login();
        console.log('  ✓ 已保存会话状态供后续测试使用');
      } catch {
        // 登录失败不影响当前测试结果
      }
    }
  });

  describe('GET /Users/Public', () => {
    it('应该返回公开用户列表（空数组）', async () => {
      const response = await get('/Users/Public');
      
      assertSuccess(response);
      assertStatus(response, 200);
      assert.ok(Array.isArray(response.data), '响应应该是数组');
    });
  });

  describe('GET /Users（未认证）', () => {
    it('应该返回空数组或需要认证', async () => {
      const response = await get('/Users');
      assert.ok(response.status === 200 || response.status === 401, 
        `期望 200 或 401，实际得到 ${response.status}`);
    });
  });

  describe('POST /Users/AuthenticateByName', () => {
    it('应该拒绝无效凭据', async () => {
      const response = await post('/Users/AuthenticateByName', {
        Username: 'invalid_user',
        Pw: 'wrong_password',
      });
      
      assert.strictEqual(response.status, 401, '无效凭据应该返回 401');
    });

    it('应该拒绝缺少用户名', async () => {
      const response = await post('/Users/AuthenticateByName', {
        Pw: 'some_password',
      });
      
      assert.strictEqual(response.status, 400, '缺少用户名应该返回 400');
    });

    it('应该拒绝缺少密码', async () => {
      const response = await post('/Users/AuthenticateByName', {
        Username: 'some_user',
      });
      
      assert.strictEqual(response.status, 400, '缺少密码应该返回 400');
    });

    skipIfNoCredentials(() => {
      it('应该成功登录并返回有效令牌', async () => {
        const result = await login();
        
        assert.ok(result.AccessToken, '应该返回 AccessToken');
        assert.ok(result.User, '应该返回 User 对象');
        assert.ok(result.ServerId, '应该返回 ServerId');
        assert.strictEqual(result.User.Name, config.username, '用户名应该匹配');
        assert.strictEqual(typeof result.User.Id, 'string', 'User.Id 应该是字符串');
        
        // 验证令牌格式
        assert.ok(result.AccessToken.length > 0, 'AccessToken 不应该为空');
        
        console.log(`  ✓ 登录成功: ${result.User.Name}, Token: ${result.AccessToken.slice(0, 20)}...`);
      });
    });
  });

  describe('GET /Users/Me（已认证）', () => {
    skipIfNoCredentials(() => {
      it('应该返回当前用户信息', async () => {
        // 先登录
        if (!isLoggedIn()) {
          await login();
        }
        
        const user = await getCurrentUser();
        
        assert.ok(user, '应该返回用户信息');
        assert.strictEqual(user.Id, testState.userId, '用户ID应该匹配');
        assert.strictEqual(user.Name, config.username, '用户名应该匹配');
        assert.strictEqual(user.ServerId, testState.serverId, 'ServerId 应该匹配');
        
        console.log(`  ✓ 当前用户: ${user.Name} (${user.Id})`);
      });
    });
  });

  describe('GET /Users/:userId（已认证）', () => {
    skipIfNoCredentials(() => {
      it('应该返回指定用户信息', async () => {
        if (!isLoggedIn()) {
          await login();
        }
        
        const user = await getUser(testState.userId!);
        
        assert.ok(user, '应该返回用户信息');
        assert.strictEqual(user.Id, testState.userId, '用户ID应该匹配');
        
        console.log(`  ✓ 获取用户: ${user.Name}`);
      });

      it('应该处理无效用户ID', async () => {
        if (!isLoggedIn()) {
          await login();
        }
        
        const response = await get('/Users/invalid-user-id');
        // 可能返回 404 或空数据
        assert.ok(response.status === 200 || response.status === 404, 
          `期望 200 或 404，实际得到 ${response.status}`);
      });
    });
  });

  describe('Authorization 头验证', () => {
    skipIfNoCredentials(() => {
      it('应该拒绝无效令牌', async () => {
        // 保存原令牌
        const originalToken = testState.accessToken;
        
        // 设置无效令牌
        testState.accessToken = 'invalid_token_12345';
        
        const response = await get('/Users/Me');
        
        // 恢复令牌
        testState.accessToken = originalToken;
        
        assert.strictEqual(response.status, 401, '无效令牌应该返回 401');
      });

      it('应该拒绝缺失令牌', async () => {
        // 临时登出
        const originalToken = testState.accessToken;
        testState.accessToken = null;
        
        const response = await get('/Users/Me');
        
        // 恢复令牌
        testState.accessToken = originalToken;
        
        assert.strictEqual(response.status, 401, '缺失令牌应该返回 401');
      });
    });
  });

  describe('会话持久化', () => {
    skipIfNoCredentials(() => {
      it('令牌应该在多次请求中保持有效', async () => {
        if (!isLoggedIn()) {
          await login();
        }
        
        // 第一次请求
        const user1 = await getCurrentUser();
        assert.ok(user1, '第一次请求应该成功');
        
        // 第二次请求（使用相同令牌）
        const user2 = await getCurrentUser();
        assert.ok(user2, '第二次请求应该成功');
        
        assert.strictEqual(user1.Id, user2.Id, '用户ID应该一致');
      });
    });
  });
});
