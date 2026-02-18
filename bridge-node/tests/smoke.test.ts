/**
 * 快速冒烟测试
 * 验证第一阶段的端点是否正常工作
 */

import { serve } from '@hono/node-server';
import app from '../src/server.ts';

const PORT = 18096;

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, async () => {
  const base = `http://127.0.0.1:${PORT}`;
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (e: any) {
      console.log(`  ❌ ${name}: ${e.message}`);
      failed++;
    }
  }

  function assert(condition: boolean, msg: string) {
    if (!condition) throw new Error(msg);
  }

  console.log('\n🧪 fnos-bridge 冒烟测试\n');

  await test('GET /System/Info/Public', async () => {
    const res = await fetch(`${base}/System/Info/Public`);
    assert(res.status === 200, `status=${res.status}`);
    const data = await res.json() as any;
    assert(data.ServerName === 'fnos-bridge', `ServerName=${data.ServerName}`);
    assert(data.Version === '10.10.6', `Version=${data.Version}`);
    assert(data.StartupWizardCompleted === true, 'StartupWizardCompleted');
    assert(typeof data.Id === 'string' && data.Id.length > 0, 'Id missing');
  });

  await test('GET /System/Ping', async () => {
    const res = await fetch(`${base}/System/Ping`);
    assert(res.status === 200, `status=${res.status}`);
  });

  await test('POST /System/Ping', async () => {
    const res = await fetch(`${base}/System/Ping`, { method: 'POST' });
    assert(res.status === 200, `status=${res.status}`);
  });

  await test('GET /Branding/Configuration', async () => {
    const res = await fetch(`${base}/Branding/Configuration`);
    assert(res.status === 200, `status=${res.status}`);
    const data = await res.json() as any;
    assert('LoginDisclaimer' in data, 'missing LoginDisclaimer');
    assert('CustomCss' in data, 'missing CustomCss');
  });

  await test('GET /Branding/Css', async () => {
    const res = await fetch(`${base}/Branding/Css`);
    assert(res.status === 200, `status=${res.status}`);
    const ct = res.headers.get('content-type') || '';
    assert(ct.includes('text/css'), `content-type=${ct}`);
  });

  await test('GET /Users (空列表)', async () => {
    const res = await fetch(`${base}/Users`);
    assert(res.status === 200, `status=${res.status}`);
    const data = await res.json() as any;
    assert(Array.isArray(data), 'not array');
  });

  await test('GET /System/Info (无认证应401)', async () => {
    const res = await fetch(`${base}/System/Info`);
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test('POST /Users/AuthenticateByName (无飞牛服务器应返回错误)', async () => {
    const res = await fetch(`${base}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'MediaBrowser Client="Test", Device="Test", DeviceId="test123", Version="1.0"',
      },
      body: JSON.stringify({ Username: 'test', Pw: 'test' }),
    });
    // 飞牛服务器不可达时应返回 401
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test('未实现端点返回兜底响应', async () => {
    const res = await fetch(`${base}/SomeUnknownEndpoint`);
    assert(res.status === 200, `status=${res.status}`);
  });

  await test('GET /Items 需要认证', async () => {
    const res = await fetch(`${base}/Items`);
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  // ---- 第四阶段：播放状态同步 ----

  await test('POST /Sessions/Playing 需要认证', async () => {
    const res = await fetch(`${base}/Sessions/Playing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ItemId: 'test' }),
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test('POST /Sessions/Playing/Progress 需要认证', async () => {
    const res = await fetch(`${base}/Sessions/Playing/Progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ItemId: 'test' }),
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test('POST /Sessions/Playing/Stopped 需要认证', async () => {
    const res = await fetch(`${base}/Sessions/Playing/Stopped`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ItemId: 'test' }),
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test('POST /UserPlayedItems/:itemId 需要认证', async () => {
    const res = await fetch(`${base}/UserPlayedItems/fake-item-id`, {
      method: 'POST',
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test('DELETE /UserPlayedItems/:itemId 需要认证', async () => {
    const res = await fetch(`${base}/UserPlayedItems/fake-item-id`, {
      method: 'DELETE',
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  // ---- 第五阶段：增强功能 ----

  await test('GET /UserItems/Resume 需要认证', async () => {
    const res = await fetch(`${base}/UserItems/Resume`);
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test('POST /UserFavoriteItems/:itemId 需要认证', async () => {
    const res = await fetch(`${base}/UserFavoriteItems/fake-item-id`, {
      method: 'POST',
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test('DELETE /UserFavoriteItems/:itemId 需要认证', async () => {
    const res = await fetch(`${base}/UserFavoriteItems/fake-item-id`, {
      method: 'DELETE',
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
  });

  await test('GET /Users/:userId/Items/Resume 重定向', async () => {
    const res = await fetch(`${base}/Users/fake-user/Items/Resume`, { redirect: 'manual' });
    assert(res.status === 307, `expected 307, got ${res.status}`);
    const loc = res.headers.get('location') || '';
    assert(loc.includes('/UserItems/Resume'), `location=${loc}`);
  });

  console.log(`\n📊 结果: ${passed} 通过, ${failed} 失败\n`);

  server.close();
  process.exit(failed > 0 ? 1 : 0);
});
