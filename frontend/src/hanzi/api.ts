import { createApi } from "../common/http";

const BASE = "/api/hanzi";

/** 汉字课域请求（全站 http 客户端，错误体/网络失败统一处理）。 */
const api = createApi(BASE);

export interface VideoItem {
  id: number | null;
  num: number | null;
  title: string;
  pinyin: string;
  pinyin_first: string;
  filename: string;
  url: string;
}

export interface VideoList {
  total: number;
  videos: VideoItem[];
}

export const hanziApi = {
  list: () => api.get<VideoList>("/list"),
};
