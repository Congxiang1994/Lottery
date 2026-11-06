import { createApi } from "../common/http";

const BASE = "/api/babysong";

/** 儿歌域请求（全站 http 客户端，错误体/网络失败统一处理）。 */
const api = createApi(BASE);

export interface Song {
  id: string;
  title: string;
  channel: string;
  youtube_url: string;
  cover: string;
  /** 哔哩哔哩视频 BV 号（抓取所得，可能为空） */
  bilibili_bvid?: string;
  /** 服务器已有本地视频文件（/data/song/{id}.mp4） */
  local?: boolean;
  /** 本地播放地址（nginx /song/ 静态服务） */
  local_url?: string;
}

export interface SongList {
  total: number;
  local_total: number;
  songs: Song[];
}

export const babysongApi = {
  list: () => api.get<SongList>("/list"),
};
