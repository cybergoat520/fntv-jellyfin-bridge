/**
 * Videos 路由
 * 视频流反向代理
 * 参考 fntv-electron proxy 模块的逻辑
 */

import { Hono } from 'hono';
import axios from 'axios';
import * as https from 'node:https';
import { config } from '../config.ts';
import { toFnosGuid } from '../mappers/id.ts';
import { requireAuth } from '../middleware/auth.ts';
import { fnosGetPlayInfo, fnosGetStreamList, fnosGetStream } from '../services/fnos.ts';
import { generateAuthxString } from '../fnos-client/signature.ts';
import type { SessionData } from '../services/session.ts';

const videos = new Hono();

/**
 * GET /Videos/:itemId/stream
 * GET /Videos/:itemId/stream.:container
 * 视频流代理
 */
async function handleVideoStream(c: any) {
  const session = c.get('session') as SessionData;
  const itemId = c.req.param('itemId');
  const fnosGuid = toFnosGuid(itemId);

  console.log(`[VIDEO] 流请求: itemId=${itemId}, fnosGuid=${fnosGuid}, range=${c.req.header('Range') || 'none'}`);

  if (!fnosGuid) {
    return c.body('Item not found', 404);
  }

  try {
    // 获取播放信息以得到 mediaGuid
    const playInfoResult = await fnosGetPlayInfo(session.fnosServer, session.fnosToken, fnosGuid);
    if (!playInfoResult.success || !playInfoResult.data) {
      return c.body('Play info not found', 404);
    }

    const mediaGuid = playInfoResult.data.media_guid;

    // 获取流信息（含直链等）
    const streamResult = await fnosGetStream(
      session.fnosServer,
      session.fnosToken,
      mediaGuid,
      c.req.header('x-forwarded-for') || '127.0.0.1',
    );

    let targetUrl: string;
    const extraHeaders: Record<string, string> = {};
    let skipVerify = config.ignoreCert;

    if (streamResult.success && streamResult.data) {
      const streamData = streamResult.data;

      // 检查是否有云盘直链
      const hasCloudDirect = streamData.cloud_storage_info &&
        streamData.direct_link_qualities?.length > 0;

      if (hasCloudDirect) {
        // 云盘直链模式
        targetUrl = streamData.direct_link_qualities[0].url;
        skipVerify = false; // 云厂商证书合法

        // 注入 Cookie
        if (streamData.header?.Cookie?.length > 0) {
          extraHeaders['Cookie'] = streamData.header.Cookie.join('; ');
        }

        // 根据云盘类型设置 UA
        const cloudType = streamData.cloud_storage_info.cloud_storage_type;
        if (cloudType === 3) {
          // 115 网盘
          extraHeaders['User-Agent'] = 'trim_player';
        } else if (cloudType === 1) {
          // 百度网盘
          extraHeaders['User-Agent'] = 'pan.baidu.com';
        }
      } else {
        // 本地 NAS 模式
        const mediaPath = `/v/api/v1/media/range/${mediaGuid}`;
        targetUrl = `${session.fnosServer}${mediaPath}`;
        extraHeaders['Authorization'] = session.fnosToken;
        extraHeaders['Cookie'] = 'mode=relay';
        extraHeaders['Authx'] = generateAuthxString(mediaPath);
      }
    } else {
      // 降级：直接用 NAS 地址
      const mediaPath = `/v/api/v1/media/range/${mediaGuid}`;
      targetUrl = `${session.fnosServer}${mediaPath}`;
      extraHeaders['Authorization'] = session.fnosToken;
      extraHeaders['Cookie'] = 'mode=relay';
      extraHeaders['Authx'] = generateAuthxString(mediaPath);
    }

    // 透明代理：转发 Range 头
    const rangeHeader = c.req.header('Range');
    if (rangeHeader) {
      extraHeaders['Range'] = rangeHeader;
    }

    // 发起代理请求
    const proxyResponse = await axios({
      method: 'get',
      url: targetUrl,
      headers: extraHeaders,
      responseType: 'stream',
      timeout: 30000,
      maxRedirects: 5,
      httpsAgent: new https.Agent({
        rejectUnauthorized: !skipVerify,
      }),
    });

    // 转发响应头
    const responseHeaders: Record<string, string> = {};
    const forwardHeaders = [
      'content-type', 'content-length', 'content-range',
      'accept-ranges', 'cache-control',
    ];
    for (const h of forwardHeaders) {
      if (proxyResponse.headers[h]) {
        responseHeaders[h] = proxyResponse.headers[h] as string;
      }
    }

    // 设置响应头
    for (const [key, value] of Object.entries(responseHeaders)) {
      c.header(key, value);
    }

    const status = proxyResponse.status;
    return c.body(proxyResponse.data, status);

  } catch (e: any) {
    console.error('视频代理失败:', e.message);
    return c.body('Proxy error', 502);
  }
}

videos.get('/:itemId/stream', requireAuth(), handleVideoStream);

// HEAD 请求也需要支持（某些客户端先 HEAD 探测）
videos.on('HEAD', '/:itemId/stream', requireAuth(), handleVideoStream);

export default videos;
