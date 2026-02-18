/**
 * 请求日志中间件
 */

import type { Context, Next } from 'hono';

export function logger() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const ms = Date.now() - start;
    const status = c.res.status;
    const color = status >= 400 ? '\x1b[31m' : status >= 300 ? '\x1b[33m' : '\x1b[32m';
    console.log(`${color}${method}\x1b[0m ${path} → ${status} (${ms}ms)`);
  };
}
