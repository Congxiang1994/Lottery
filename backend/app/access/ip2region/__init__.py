# Copyright 2022 The Ip2Region Authors. All rights reserved.
# Use of this source code is governed by a Apache2.0-style
# license that can be found in the LICENSE file.
#
# ────────────────────────────────────────────────────────────────────────────
# 本目录是 lionsoul2014/ip2region 官方 Python binding 的 **vendored 副本**
# （上游路径 binding/python/ip2region，Apache-2.0）。
#
# 为什么 vendor 而不是 pip install：
#   1. 官方 binding 本身就是纯标准库实现（零 C 扩展），pip 包只是它的打包发布；
#   2. 服务器装包需要走代理 / 镜像，多一个可能失败的环节；
#   3. 版本漂移风险为 0 —— 数据文件（.xdb）与 searcher 版本必须匹配，
#      两者一起进仓才能保证「换台机器也能跑」。
#
# 与上游的唯一差异：searcher.py 的 `import ip2region.util as util`
# 改为相对导入 `from . import util` —— 避免占用顶层 `ip2region` 包名。
# 数据文件（ip2region_v4.xdb 等）不入库，见 tools/geo_update.py。
# ────────────────────────────────────────────────────────────────────────────

# xdb package
