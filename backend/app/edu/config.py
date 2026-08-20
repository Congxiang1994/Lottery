# 平台相关常量（移植自 hantang/smartedu-dl-go 的 resources.go，MIT）

SITE_HOST = "basic.smartedu.cn"
SERVER_LIST = ["s-file-1", "s-file-2", "s-file-3"]
RESOURCES_PATH = "/edu_product/esp/assets/"

# 资源类型 -> 解析/详情 URL 模板
RESOURCE_URLS = {
    # 电子教材
    "textbook": {
        "basic": "https://%s.ykt.cbern.com.cn/zxx/ndrv2/resources/tch_material/details/%s.json",
        "backup": [
            "https://%s.ykt.cbern.com.cn/zxx/ndrs/special_edu/resources/details/%s.json",
            "https://%s.ykt.cbern.com.cn/zxx/ndrs/resources/tch_material/details/%s.json",
            "https://%s.ykt.cbern.com.cn/zxx/ndrs/special_edu/thematic_course/%s/resources/list.json",
        ],
        "detail": "https://basic.smartedu.cn/tchMaterial/detail?contentType=assets_document&contentId=%s",
        "type": "tchMaterial",
    },
    # 课程教学 学生自主学习（国家课）
    "course": {
        "basic": "https://%s.ykt.cbern.com.cn/zxx/ndrv2/national_lesson/resources/details/%s.json",
        "detail": "https://basic.smartedu.cn/syncClassroom/classActivity?activityId=%s",
        "type": "national_lesson",
    },
    # 精品课
    "elite_course": {
        "basic": "https://%s.ykt.cbern.com.cn/zxx/ndrv2/resources/%s.json",
        "detail": "https://basic.smartedu.cn/qualityCourse?courseId=%s",
        "type": "elite_lesson",
    },
}

# 目录元信息（catalog 拉取）
CATALOG = {
    "textbook": {
        "name": "教材列表",
        "version": "https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/resources/tch_material/version/data_version.json",
        "tag": "https://s-file-1.ykt.cbern.com.cn/zxx/ndrs/tags/tch_material_tag.json",
    },
    "course": {
        "name": "课件包",
        "version": "https://s-file-2.ykt.cbern.com.cn/zxx/ndrs/national_lesson/teachingmaterials/version/data_version.json",
        "tag": "https://s-file-2.ykt.cbern.com.cn/zxx/ndrs/tags/national_lesson_tag.json",
    },
}

# 课程目录（课时）拉取
COURSE_PARTS_URL = "https://%s.ykt.cbern.com.cn/zxx/ndrs/national_lesson/teachingmaterials/%s/resources/parts.json"
COURSE_TREE_URL = "https://%s.ykt.cbern.com.cn/zxx/ndrv2/national_lesson/trees/%s.json"

# 资源格式
FORMAT_VIDEO = ["m3u8"]

# x-nd-auth 头名
AUTH_HEADER = "x-nd-auth"
