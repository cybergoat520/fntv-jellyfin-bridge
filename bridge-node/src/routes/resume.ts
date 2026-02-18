/**
 * Resume / 继续观看路由
 * GET /UserItems/Resume - 获取正在观看的项目
 */

import { Hono } from 'hono';
import { config } from '../config.ts';
import { generateServerId, toFnosGuid } from '../mappers/id.ts';
import { mapPlayListItemToDto } from '../mappers/item.ts';
import { requireAuth } from '../middleware/auth.ts';
import { fnosGetItemList } from '../services/fnos.ts';
import type { SessionData } from '../services/session.ts';

const resume = new Hono();

const serverId = generateServerId(config.fnosServer);

/**
 * GET /UserItems/Resume - 继续观看列表
 * 返回有播放进度但未看完的项目
 */
resume.get('/Resume', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const startIndex = parseInt(c.req.query('StartIndex') || '0', 10);
  const limit = parseInt(c.req.query('Limit') || '12', 10);
  const parentId = c.req.query('ParentId') || c.req.query('parentId');

  // 需要遍历媒体库获取有进度的项目
  const viewGuids = ['view_movies', 'view_tvshows'];
  const resumeItems: any[] = [];

  for (const viewGuid of viewGuids) {
    try {
      const result = await fnosGetItemList(session.fnosServer, session.fnosToken, {
        parent_guid: viewGuid,
        exclude_folder: 1,
        sort_column: 'air_date',
        sort_type: 'DESC',
      });

      if (result.success && result.data) {
        // 筛选有播放进度但未看完的
        const inProgress = result.data.list.filter(i => i.ts > 0 && i.watched !== 1);
        resumeItems.push(...inProgress);
      }
    } catch {
      // 忽略单个媒体库的错误
    }
  }

  // 按播放时间排序（最近播放的在前）
  resumeItems.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const allDtos = resumeItems.map(item => mapPlayListItemToDto(item, serverId));
  const paged = allDtos.slice(startIndex, startIndex + limit);

  return c.json({
    Items: paged,
    TotalRecordCount: allDtos.length,
    StartIndex: startIndex,
  });
});

export default resume;
