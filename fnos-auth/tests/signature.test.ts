import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { md5, generateNonce, generateAuthx, generateAuthxString } from '../src/signature.ts';

describe('md5', () => {
  it('空字符串', () => {
    assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  });

  it('普通字符串', () => {
    assert.equal(md5('hello'), '5d41402abc4b2a76b9719d911017c592');
  });

  it('JSON 字符串', () => {
    const json = JSON.stringify({ username: 'admin', password: '123456' });
    const hash = md5(json);
    assert.equal(typeof hash, 'string');
    assert.equal(hash.length, 32);
  });
});

describe('generateNonce', () => {
  it('生成 6 位数字字符串', () => {
    const nonce = generateNonce();
    assert.match(nonce, /^\d{6}$/);
  });

  it('多次生成不完全相同', () => {
    const results = new Set(Array.from({ length: 20 }, () => generateNonce()));
    // 20 次生成至少有 2 个不同值
    assert.ok(results.size > 1, '随机数应有差异');
  });
});

describe('generateAuthx', () => {
  it('返回正确结构', () => {
    const params = generateAuthx('/v/api/v1/login', { username: 'admin' });
    assert.equal(typeof params.nonce, 'string');
    assert.equal(typeof params.timestamp, 'number');
    assert.equal(typeof params.sign, 'string');
    assert.equal(params.sign.length, 32); // MD5 长度
  });

  it('无 data 时也能正常签名', () => {
    const params = generateAuthx('/v/api/v1/user/info');
    assert.equal(params.sign.length, 32);
  });

  it('不同 data 产生不同签名', () => {
    const a = generateAuthx('/v/api/v1/login', { username: 'a' });
    const b = generateAuthx('/v/api/v1/login', { username: 'b' });
    // nonce 和 timestamp 不同，sign 必然不同
    assert.notEqual(a.sign, b.sign);
  });
});

describe('generateAuthxString', () => {
  it('返回正确格式', () => {
    const str = generateAuthxString('/v/api/v1/login', { username: 'admin' });
    assert.match(str, /^nonce=\d+&timestamp=\d+&sign=[a-f0-9]{32}$/);
  });

  it('GET 请求（无 data）', () => {
    const str = generateAuthxString('/v/api/v1/user/info');
    assert.match(str, /^nonce=\d+&timestamp=\d+&sign=[a-f0-9]{32}$/);
  });
});
