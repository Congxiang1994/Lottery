import { createApi } from "../common/http";

const BASE = "/api/pinzi";

/** 汉字拼读课域请求（全站 http 客户端，错误体/网络失败统一处理）。 */
const api = createApi(BASE);

export interface PinziVideo {
  /** 序号（001 先导篇 → 018 总结篇） */
  seq: number;
  /** 完整标题（来自 meta.json，可能很长） */
  title: string;
  filename: string;
  /** 时长（秒），meta.json 缺失时为 0 */
  duration: number;
  /** 封面地址，无封面时为空串 */
  cover: string;
  /** 视频地址（已 URL 编码） */
  url: string;
}

export interface PinziList {
  total: number;
  videos: PinziVideo[];
}

export const pinziApi = {
  list: () => api.get<PinziList>("/list"),
};
