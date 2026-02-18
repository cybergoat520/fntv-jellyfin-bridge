/**
 * 请求日志中间件
 */

import type { Context, Next } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

export function logger() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;
    const query = c.req.url.includes('?') ? c.req.url.split('?')[1] : '';

    // 获取客户端连接信息
    let clientAddr = '?';
    try {
      const info = getConnInfo(c);
      clientAddr = info.remote?.address || '?';
      if (info.remote?.port) clientAddr += `:${info.remote.port}`;
    } catch {
      clientAddr = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || '?';
    }

    await next();

    const ms = Date.now() - start;
    const status = c.res.status;
    // 只输出非 200 的请求
    if (status >= 300) {
      const color = status >= 400 ? '\x1b[31m' : '\x1b[33m';
      const queryStr = query ? `?${query.slice(0, 100)}` : '';
      console.log(`${color}${method}\x1b[0m ${path}${queryStr} → ${status} (${ms}ms) \x1b[36m[${clientAddr}]\x1b[0m`);
    }
  };
}
