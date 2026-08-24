# 小鹅通视频课程下载器

批量下载小鹅通（xet）店铺视频课程，保存为按序号命名的 mp4 文件。

用于《汉字是画出来的》（小象汉字店铺）108 节动画视频课全量下载：
`001-日.mp4` ~ `108-立.mp4`，实测 108/108 成功、0 失败（约 195MB，耗时约 93 秒）。

## 目录结构

```
tools/xiaoe-downloader/
├── download.py            # 主下载脚本: detail_info → play_sign → getPlayUrl → m3u8 → ffmpeg
├── enumerate_courses.py   # 目录枚举工具: 分页拉取课程目录, 重新生成 courses.py
├── courses.py             # 课程映射 (序号, 名称, resource_id), 由枚举工具生成/维护
├── config.example.json    # 配置样例 (复制为 config.json 后填写)
├── .gitignore             # 忽略 config.json / 下载产物
└── README.md
```

## 环境要求

- Python 3.8+（仅标准库，无第三方依赖）
- ffmpeg（HLS 下载与解密合并）：`apt install ffmpeg` / `brew install ffmpeg`

## 快速开始

```bash
cp config.example.json config.json
# 编辑 config.json, 填入 cookie (登录态, 见下文)
python3 download.py          # 全量下载, 断点续传, 失败自动重试
python3 enumerate_courses.py # (可选) 重新枚举目录并生成 courses.py
```

产物输出到 `config.json` 的 `outdir`（默认 `/data/hanzi`），命名 `{序号:03d}-{名称}.mp4`。

## Cookie 获取（关键）

1. 浏览器登录小鹅通店铺网页（课程需已购买/兑换）
2. 打开开发者工具 → Network → 任选一个同域（`*.xet.pomoho.com`）请求
3. 复制请求头 `Cookie` 完整字符串到 `config.json` 的 `cookie` 字段

登录态需要 **`anony_token` + `ko_token` 同时携带**才生效（只带 `ko_token` 会被网关识别为匿名）。
Cookie 过期后只需更新 `config.json` 的 cookie 再重跑即可（已下载的自动跳过）。

## 工作原理

```
column.items.get   → 课程目录 (枚举全部视频 resource_id)
video.detail_info  → play_sign (一次性签名, 短时效)
material-center.play/getPlayUrl → m3u8 地址 (720p_hls)
ffmpeg -c copy     → 合并 ts 分片为 mp4 (标准 AES-128 加密, ffmpeg 自动解密)
```

关键接口：

| 接口 | 方法 | 关键参数 |
|---|---|---|
| `xe.course.business_go.column.items.get/2.0.0` | POST form | `bizData[column_id]` `bizData[page_index]` `bizData[page_size]` `bizData[sort]=asc` |
| `xe.course.business_go.video.detail_info.get/2.0.0` | POST form | `bizData[resource_id]` `bizData[product_id]` `bizData[opr_sys]=MacIntel` |
| `xe.material-center.play/getPlayUrl` | POST json | `org_app_id` `app_id` `play_sign[]` `play_line=A` `opr_sys` |

必须使用新版 `xe.course.business_go.*` 路径（经典 `xe.api/...` 会被网关拦截）。

## 踩坑记录

- **play_sign 一次性**：`detail_info` 拿到后必须立即调 `getPlayUrl`，稍晚会报「未注册的签名」；m3u8 拿到后立即交给 ffmpeg（URL 有时效性）
- **网关滑块拦截**：快速高频请求会触发滑块验证；保持 4 并发以内可稳定跑
- **`sub.course.list` 返回空**：该接口参数是 `bizData[course_id]=v_xxx`（单视频），不适用于目录
- **`loop_resource.get` 顺序不可靠**：本店返回 `is_sequence:0`，001 的 next 是 108；目录顺序一律以 `column.items.get` 为准
- **`composite_info` 需 GET**：`?app_id=&resource_id=&product_type=3`，且不含目录数据，弃用
- **字段名**：`column.items.get` 返回的资源 id 在 `id` 字段（不是 `resource_id`）
- **非视频条目**：`type=1` 为图文（如兑换说明/彩蛋/附赠课），枚举时自动跳过

## 校验

- 全部 mp4 `ffprobe` 可播放，抽查时长与课程记录一致
- 文件名序号 1-108 连续无缺失
- 重跑脚本自动跳过已存在文件（`SKIP(exists)`），失败列表写入 `{outdir}/failed.txt`

## 实测参数（2026-08-24）

- 店铺：小象汉字，app_id `appmi6TUexg1562`
- 课程：《汉字是画出来的》product_id `p_64004ceee4b030cacb1e03ec`
- 环境：Ubuntu 24.04 + ffmpeg 6.1.1，4 并发，约 93 秒全量完成
- 服务器留存脚本：`/data/hanzi/download_hanzi.py`（与本目录 download.py 等价，Cookie 内嵌版）
