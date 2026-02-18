/**
 * Shows 路由
 * 剧集的季和集列表
 */

import { Hono } from 'hono';
import { config } from '../config.ts';
import { generateServerId, toFnosGuid, toJellyfinId } from '../mappers/id.ts';
import { mapPlayListItemToDto, type BaseItemDto } from '../mappers/item.ts';
import { requireAuth } from '../middleware/auth.ts';
import { fnosGetEpisodeList } from '../services/fnos.ts';
import type { SessionData } from '../services/session.ts';

const shows = new Hono();

const serverId = generateServerId(config.fnosServer);

/**
 * GET /Shows/:seriesId/Seasons
 * 获取剧集的季列表
 */
shows.get('/:seriesId/Seasons', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const seriesId = c.req.param('seriesId');
  const fnosGuid = toFnosGuid(seriesId);

  if (!fnosGuid) {
    return c.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
  }

  try {
    const result = await fnosGetEpisodeList(session.fnosServer, session.fnosToken, fnosGuid);
    if (!result.success || !result.data) {
      return c.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
    }

    // 从剧集列表中提取唯一的季
    const seasonMap = new Map<string, { seasonNumber: number; parentGuid: string; title: string }>();
    for (const ep of result.data) {
      const key = ep.parent_guid || `season_${ep.season_number}`;
      if (!seasonMap.has(key)) {
        seasonMap.set(key, {
          seasonNumber: ep.season_number,
          parentGuid: ep.parent_guid,
          title: ep.parent_title || `第 ${ep.season_number} 季`,
        });
      }
    }

    const seasons: BaseItemDto[] = Array.from(seasonMap.entries()).map(([key, s]) => ({
      Name: s.title,
      ServerId: serverId,
      Id: toJellyfinId(s.parentGuid || key),
      CanDelete: false,
      CanDownload: false,
      IsFolder: true,
      Type: 'Season',
      IndexNumber: s.seasonNumber,
      SeriesId: seriesId,
      SeriesName: result.data![0]?.tv_title || '',
      ImageTags: {},
      BackdropImageTags: [],
      LocationType: 'FileSystem',
      ChildCount: result.data!.filter(ep => ep.season_number === s.seasonNumber).length,
    }));

    return c.json({
      Items: seasons,
      TotalRecordCount: seasons.length,
      StartIndex: 0,
    });
  } catch (e: any) {
    console.error('获取季列表失败:', e.message);
    return c.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
  }
});

/**
 * GET /Shows/:seriesId/Episodes
 * 获取某季的集列表
 */
shows.get('/:seriesId/Episodes', requireAuth(), async (c) => {
  const session = c.get('session') as SessionData;
  const seriesId = c.req.param('seriesId');
  const seasonId = c.req.query('SeasonId') || c.req.query('seasonId');
  const season = c.req.query('Season') || c.req.query('season');
  const startIndex = parseInt(c.req.query('StartIndex') || '0', 10);
  const limit = parseInt(c.req.query('Limit') || '100', 10);

  const fnosGuid = toFnosGuid(seriesId);
  if (!fnosGuid) {
    return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
  }

  try {
    const result = await fnosGetEpisodeList(session.fnosServer, session.fnosToken, fnosGuid);
    if (!result.success || !result.data) {
      return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
    }

    let episodes = result.data;

    // 按季过滤
    if (seasonId) {
      const seasonFnosGuid = toFnosGuid(seasonId);
      if (seasonFnosGuid) {
        episodes = episodes.filter(ep => ep.parent_guid === seasonFnosGuid);
      }
    } else if (season) {
      const seasonNum = parseInt(season, 10);
      episodes = episodes.filter(ep => ep.season_number === seasonNum);
    }

    const allItems = episodes.map(ep => mapPlayListItemToDto(ep, serverId));
    const paged = allItems.slice(startIndex, startIndex + limit);

    return c.json({
      Items: paged,
      TotalRecordCount: allItems.length,
      StartIndex: startIndex,
    });
  } catch (e: any) {
    console.error('获取集列表失败:', e.message);
    return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
  }
});

/**
 * GET /Shows/NextUp
 * 下一集推荐（暂返回空）
 */
shows.get('/NextUp', requireAuth(), (c) => {
  return c.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
});

export default shows;
