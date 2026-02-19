/**
 * Shows 路由
 * 剧集的季和集列表
 */

import { Hono } from 'hono';
import { config } from '../config.ts';
import { generateServerId, toFnosGuid, toJellyfinId, registerItemType } from '../mappers/id.ts';
import { mapPlayListItemToDto, type BaseItemDto } from '../mappers/item.ts';
import { requireAuth } from '../middleware/auth.ts';
import { fnosGetSeasonList, fnosGetEpisodeList } from '../services/fnos.ts';
import { setImageCache } from '../services/imageCache.ts';
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
    console.log(`[SHOWS] Seasons请求: seriesId=${seriesId}, fnosGuid=${fnosGuid}`);
    const result = await fnosGetSeasonList(session.fnosServer, session.fnosToken, fnosGuid);
    console.log(`[SHOWS] Seasons结果: success=${result.success}, seasons=${result.data?.length || 0}`);
    if (!result.success || !result.data) {
      return c.json({ Items: [], TotalRecordCount: 0, StartIndex: 0 });
    }

    const seasons: BaseItemDto[] = result.data.map(season => {
      const dto: BaseItemDto = {
        Name: season.title || `第 ${season.season_number} 季`,
        ServerId: serverId,
        Id: toJellyfinId(season.guid),
        CanDelete: false,
        CanDownload: false,
        IsFolder: true,
        Type: 'Season',
        IndexNumber: season.season_number,
        SeriesId: seriesId,
        SeriesName: season.tv_title || '',
        ImageTags: season.poster ? { Primary: Buffer.from(season.poster).toString('base64url').slice(0, 16) } : {},
        BackdropImageTags: [],
        LocationType: 'FileSystem',
        ChildCount: season.local_number_of_episodes || season.episode_number || 0,
      };
      // 注册季的类型，供详情路由判断
      registerItemType(season.guid, 'Season');
      // 缓存季的 poster 图片
      if (season.poster) {
        setImageCache(dto.Id, {
          poster: season.poster,
          server: session.fnosServer,
          token: session.fnosToken,
        });
      }
      return dto;
    });

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
  const startIndex = parseInt(c.req.query('StartIndex') || '0', 10);
  const limit = parseInt(c.req.query('Limit') || '100', 10);

  console.log(`[SHOWS] Episodes请求: seriesId=${seriesId}, seasonId=${seasonId}`);

  // episode/list 需要季 guid
  let fnosGuid: string | null = null;
  if (seasonId) {
    fnosGuid = toFnosGuid(seasonId);
  } else {
    // 如果没有 SeasonId，先获取系列的第一个季
    const seriesFnosGuid = toFnosGuid(seriesId);
    if (!seriesFnosGuid) {
      return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
    }
    const seasonsResult = await fnosGetSeasonList(session.fnosServer, session.fnosToken, seriesFnosGuid);
    if (seasonsResult.success && seasonsResult.data && seasonsResult.data.length > 0) {
      fnosGuid = seasonsResult.data[0].guid;
    }
  }

  if (!fnosGuid) {
    return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
  }

  try {
    const result = await fnosGetEpisodeList(session.fnosServer, session.fnosToken, fnosGuid);
    console.log(`[SHOWS] Episodes结果: fnosGuid=${fnosGuid}, episodes=${result.data?.length || 0}`);
    if (!result.success || !result.data) {
      return c.json({ Items: [], TotalRecordCount: 0, StartIndex: startIndex });
    }

    let episodes = result.data;

    const allItems = episodes.map(ep => {
      const dto = mapPlayListItemToDto(ep, serverId);
      // 缓存集的 poster
      if (ep.poster) {
        setImageCache(dto.Id, {
          poster: ep.poster,
          server: session.fnosServer,
          token: session.fnosToken,
        });
      }
      return dto;
    });
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
