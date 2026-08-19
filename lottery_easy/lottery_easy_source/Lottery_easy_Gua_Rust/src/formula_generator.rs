//! formula_generator.rs - 公式生成器模块
//!
//! 本模块实现公式候选的生成，包括精简版和激进版两种生成器。
//! 
//! 重要说明：
//! ==========
//! 以下被注释的特征值在Python版本中因为性能问题被注释掉，
//! 但在Rust版本中保留这些注释，因为后续Rust性能好了之后还可能开启。

#![allow(dead_code)]
#![allow(unused_variables)]

use std::collections::HashMap;
use crate::config::GuaConfig;
use crate::formula::{FormulaSpec, FormulaCandidate};

/// 特征提取器定义
/// 
/// 注意：以下被注释的特征值在Python版本中因为性能问题被注释掉，
/// 但在Rust版本中保留这些注释，因为后续Rust性能好了之后还可能开启。
pub fn get_feature_extractor_definitions() -> Vec<(&'static str, &'static str)> {
    vec![
        // ==================== 基础卦象特征 ====================
        ("ben_gua_num", "本卦数字"),
        ("ben_gua_xiantian", "本卦先天数"),
        ("ben_gua_houtian", "本卦后天数"),
        ("ben_gua_wuxing_num", "本卦五行数"),
        ("ben_gua_upper_num", "本卦上卦数"),
        ("ben_gua_lower_num", "本卦下卦数"),
        ("ben_gua_sum", "本卦和"),
        ("ben_gua_product", "本卦积"),
        ("ben_gua_diff", "本卦差"),
        ("ben_gua_64", "本卦64卦数"),
        ("ben_gua_shang", "本卦上"),
        ("ben_gua_xia", "本卦下"),
        // ("ben_gua_hetu1", "本卦河图数1"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_hetu2", "本卦河图数2"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_najia_t1", "本卦纳甲天干1"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_najia_t6", "本卦纳甲天干6"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_najia_d1", "本卦纳甲地支1"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_najia_d6", "本卦纳甲地支6"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_wangshuai", "本卦五行旺衰"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_yao1", "本卦初爻"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_yao2", "本卦二爻"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_yao3", "本卦三爻"),  // 注释：性能优化时暂时关闭
        
        // ==================== 变卦特征 ====================
        ("bian_gua_num", "变卦数字"),
        ("bian_gua_xiantian", "变卦先天数"),
        ("bian_gua_houtian", "变卦后天数"),
        ("bian_gua_wuxing_num", "变卦五行数"),
        ("bian_gua_upper_num", "变卦上卦数"),
        ("bian_gua_lower_num", "变卦下卦数"),
        ("bian_gua_sum", "变卦和"),
        ("bian_gua_product", "变卦积"),
        ("bian_gua_diff", "变卦差"),
        ("bian_gua_64", "变卦64卦数"),
        ("bian_gua_shang", "变卦上"),
        ("bian_gua_xia", "变卦下"),
        // ("bian_gua_hetu1", "变卦河图数1"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_hetu2", "变卦河图数2"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_wangshuai", "变卦五行旺衰"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_yao1", "变卦初爻"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_yao2", "变卦二爻"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_yao3", "变卦三爻"),  // 注释：性能优化时暂时关闭
        
        // ==================== 互卦特征 ====================
        ("hu_gua_num", "互卦数字"),
        ("hu_gua_xiantian", "互卦先天数"),
        ("hu_gua_houtian", "互卦后天数"),
        ("hu_gua_wuxing_num", "互卦五行数"),
        ("hu_gua_upper_num", "互卦上卦数"),
        ("hu_gua_lower_num", "互卦下卦数"),
        ("hu_gua_sum", "互卦和"),
        ("hu_gua_product", "互卦积"),
        ("hu_gua_diff", "互卦差"),
        ("hu_gua_64", "互卦64卦数"),
        ("hu_gua_shang", "互卦上"),
        ("hu_gua_xia", "互卦下"),
        // ("hu_gua_hetu1", "互卦河图数1"),  // 注释：性能优化时暂时关闭
        // ("hu_gua_hetu2", "互卦河图数2"),  // 注释：性能优化时暂时关闭
        // ("hu_gua_wangshuai", "互卦五行旺衰"),  // 注释：性能优化时暂时关闭
        
        // ==================== 变爻特征 ====================
        ("bian_yao_pos", "变爻位置"),
        ("bian_yao_num", "变爻数字"),
        ("bian_yao", "变爻"),
        ("yang_count", "阳爻数"),
        ("yin_count", "阴爻数"),
        ("liu_yao", "六爻"),
        
        // ==================== 时间特征 ====================
        ("lunar_year", "农历年"),
        ("lunar_month", "农历月"),
        ("lunar_day", "农历日"),
        ("lunar_hour", "农历时辰"),
        
        // ==================== 天干特征 ====================
        ("year_tiangan", "年天干"),
        ("month_tiangan", "月天干"),
        ("day_tiangan", "日天干"),
        ("hour_tiangan", "时天干"),
        ("day_stem", "日干"),
        ("day_stem_wuxing", "日干五行"),
        
        // ==================== 地支特征 ====================
        ("year_dizhi", "年地支"),
        ("month_dizhi", "月地支"),
        ("day_dizhi", "日地支"),
        ("hour_dizhi", "时地支"),
        ("day_branch", "日支"),
        ("day_branch_wuxing", "日支五行"),
        // ("year_branch_wuxing", "年支五行"),  // 注释：一个月内不变
        
        // ==================== 五行特征 ====================
        ("year_wuxing_num", "年五行数"),
        ("month_wuxing_num", "月五行数"),
        ("day_wuxing_num", "日五行数"),
        ("hour_wuxing_num", "时五行数"),
        ("wuxing_ben_shang", "五行本上"),
        ("wuxing_ben_xia", "五行本下"),
        ("wuxing_bian_shang", "五行变上"),
        ("wuxing_bian_xia", "五行变下"),
        ("wuxing_hu_shang", "五行互上"),
        ("wuxing_hu_xia", "五行互下"),
        ("wuxing_flow", "五行流转"),
        
        // ==================== 组合特征 ====================
        ("year_month_sum", "年月天干和"),
        ("day_hour_sum", "日时天干和"),
        ("year_day_sum", "年日地支和"),
        ("month_hour_sum", "月时地支和"),
        ("bazi_sum", "八字和"),
        ("tiangan_he", "天干和"),
        ("dizhi_liu_he", "地支六合"),
        ("dizhi_san_he", "地支三合"),
        ("dizhi_liu_chong", "地支六冲"),
        
        // ==================== 卦象组合特征 ====================
        ("ben_bian_sum", "本变卦和"),
        ("ben_hu_sum", "本互卦和"),
        ("bian_hu_sum", "变互卦和"),
        ("three_gua_sum", "三卦和"),
        ("total_gua_sum", "总卦和"),
        
        // ==================== 卦象乘积特征 ====================
        ("ben_bian_product", "本变卦积"),
        ("ben_hu_product", "本互卦积"),
        ("bian_hu_product", "变互卦积"),
        
        // ==================== 月相特征 ====================
        ("moon_energy", "月相能量"),
        
        // ==================== 能量特征 ====================
        ("total_energy", "总能量"),
        ("ti_energy", "体能量"),
        ("yong_energy", "用能量"),
        ("bian_shang_energy", "变上能量"),
        ("bian_xia_energy", "变下能量"),
        ("hu_shang_energy", "互上能量"),
        ("hu_xia_energy", "互下能量"),
        ("adjusted_energy", "调整后能量"),
        ("metaphysics_score", "玄学评分"),
        
        // ==================== 体用关系 ====================
        ("ti_yong_he", "体用和"),
        ("ti_yong_cha", "体用差"),
        ("ti_yong_score", "体用评分"),
        ("ti_yong_total_score", "体用总评分"),
        
        // ==================== 先天后天特征 ====================
        ("xiantian_ben_shang", "先天本上"),
        ("xiantian_ben_xia", "先天本下"),
        ("xiantian_bian_shang", "先天变上"),
        ("xiantian_bian_xia", "先天变下"),
        ("xiantian_hu_shang", "先天互上"),
        ("xiantian_hu_xia", "先天互下"),
        ("xiantian_sum", "先天和"),
        ("houtian_ben_shang", "后天本上"),
        ("houtian_ben_xia", "后天本下"),
        ("houtian_bian_shang", "后天变上"),
        ("houtian_bian_xia", "后天变下"),
        ("houtian_hu_shang", "后天互上"),
        ("houtian_hu_xia", "后天互下"),
        
        // ==================== 纳甲特征 ====================
        ("najia_ben_shang", "纳甲本上"),
        ("najia_ben_xia", "纳甲本下"),
        ("najia_bian_shang", "纳甲变上"),
        ("najia_bian_xia", "纳甲变下"),
        
        // ==================== 六神特征 ====================
        ("liushen", "六神"),
        
        // ==================== 河图洛书特征 ====================
        ("hetu_shang_sum", "河图上和"),
        ("hetu_xia_sum", "河图下和"),
        ("hetu_sheng", "河图生"),
        ("hetu_cheng", "河图成"),
        ("luoshu_ben", "洛书本"),
        ("luoshu_fei_xing", "洛书飞星"),
        ("heluo_he", "河洛和"),
        ("heluo_precise", "河洛精确"),
        
        // ==================== 纳音特征 ====================
        // ("nayin_num", "纳音数"),  // 注释：一个月内不变
        // ("nayin_precise", "纳音精确"),  // 注释：一个月内不变
        // ("nayin_wuxing_detail", "纳音五行详情"),  // 注释：一个月内不变
        ("nayin_gua", "纳音卦"),
        
        // ==================== 三元九运特征 ====================
        // ("sanyuan_yuan", "三元元"),  // 注释：一个月内不变
        // ("sanyuan_yun", "三元运"),  // 注释：一个月内不变
        ("sanyuan_gua", "三元卦"),
        ("sanyuan_num", "三元数"),
        
        // ==================== 飞星特征 ====================
        // ("year_flying_star", "年飞星"),  // 注释：一个月内不变
        // ("month_flying_star", "月飞星"),  // 注释：一个月内不变
        ("day_flying_star", "日飞星"),
        ("flying_star_gua", "飞星卦"),
        // ("jiuxing_sum", "九星和"),  // 注释：一个月内不变
        
        // ==================== 太乙神数特征 ====================
        // ("taiyi_gong_v4", "太乙宫v4"),  // 注释：一个月内不变
        ("taiyi_num_v4", "太乙数v4"),
        ("taiyi_wenchang_v4", "太乙文昌v4"),
        // ("taiyi_zhu_suan", "太乙主算"),  // 注释：一个月内不变
        // ("taiyi_ke_suan", "太乙客算"),  // 注释：一个月内不变
        ("taiyi_precise", "太乙精确"),
        // ("taiyi_main_star", "太乙主星"),  // 注释：一个月内不变
        ("taiyi_wenchang", "太乙文昌"),
        ("taiyi_num", "太乙数"),
        
        // ==================== 奇门遁甲特征 ====================
        ("qimen_ju_num", "奇门局数"),
        ("qimen_num_v4", "奇门数v4"),
        ("qimen_san_qi_v4", "奇门三奇v4"),
        ("qimen_liu_yi_v4", "奇门六仪v4"),
        ("qimen_ba_men_v4", "奇门八门v4"),
        ("qimen_jiu_xing_v4", "奇门九星v4"),
        ("qimen_men_jixiong", "奇门门吉凶"),
        ("qimen_san_qi", "奇门三奇"),
        ("qimen_liu_yi", "奇门六仪"),
        ("qimen_ba_men", "奇门八门"),
        ("qimen_jiu_xing", "奇门九星"),
        ("qimen_num", "奇门数"),
        // ("qimen_dun_type", "奇门遁类型"),  // 注释：一个月内不变
        ("qimen_ju", "奇门局"),
        ("qimen_san_qi_precise", "奇门三奇精确"),
        ("qimen_liu_yi_precise", "奇门六仪精确"),
        ("qimen_precise", "奇门精确"),
        
        // ==================== 六壬特征 ====================
        // ("liuren_yuejiang_v4", "六壬月将v4"),  // 注释：一个月内不变
        ("liuren_num_v4", "六壬数v4"),
        ("liuren_guishen", "六壬贵神"),
        ("liuren_sike_1", "六壬四课1"),
        ("liuren_sike_2", "六壬四课2"),
        ("liuren_sike_3", "六壬四课3"),
        ("liuren_sike_4", "六壬四课4"),
        ("liuren_sanchuan_1", "六壬三传1"),
        ("liuren_sanchuan_2", "六壬三传2"),
        ("liuren_sanchuan_3", "六壬三传3"),
        ("liuren_tianjiang_v4", "六壬天将v4"),
        // ("liuren_yuejiang_precise", "六壬月将精确"),  // 注释：一个月内不变
        ("liuren_precise", "六壬精确"),
        ("liuren_di_zhi", "六壬地支"),
        ("liuren_tian_gan", "六壬天干"),
        ("liuren_yue_jiang", "六壬月将"),
        ("liuren_num", "六壬数"),
        
        // ==================== 紫微斗数特征 ====================
        ("ziwei_ming_gong", "紫微命宫"),
        ("ziwei_shen_gong", "紫微身宫"),
        ("ziwei_star", "紫微星"),
        ("ziwei_num", "紫微数"),
        
        // ==================== 铁板神数特征 ====================
        ("tieban_base", "铁板基数"),
        ("tieban_ke", "铁板客数"),
        ("tieban_total", "铁板总数"),
        
        // ==================== 节气特征 ====================
        // ("jieqi_index_precise", "节气精确"),  // 注释：一个月内不变
        
        // ==================== 卦气特征 ====================
        ("gua_qi", "卦气"),
        ("dong_yao_energy", "动爻能量"),
        ("hu_gua_influence", "互卦影响"),
        
        // ==================== 时辰卦特征 ====================
        ("shi_chen_gua", "时辰卦"),
        ("ri_gua", "日卦"),
        // ("yue_gua", "月卦"),  // 注释：一个月内不变
        // ("nian_gua", "年卦"),  // 注释：一个月内不变
        
        // ==================== 建除特征 ====================
        ("jian_chu", "建除"),
        ("jian_chu_ji_xiong", "建除吉凶"),
        ("jian_chu_gua", "建除卦"),
        
        // ==================== 彭祖特征 ====================
        ("pengzu_tiangan", "彭祖天干"),
        ("pengzu_dizhi", "彭祖地支"),
        ("pengzu_num", "彭祖数"),
        
        // ==================== 日禄马贵特征 ====================
        ("ri_lu", "日禄"),
        ("ri_ma", "日马"),
        ("ri_gui", "日贵"),
        ("lu_ma_gui", "禄马贵"),
        
        // ==================== 皇极特征 ====================
        // ("huangji_hui", "皇极会"),  // 注释：一个月内不变
        // ("huangji_yun", "皇极运"),  // 注释：一个月内不变
        // ("huangji_shi", "皇极世"),  // 注释：一个月内不变
        ("huangji_sum", "皇极和"),
        ("huangji_gua", "皇极卦"),
        
        // ==================== 其他特征 ====================
        ("xing_su", "星宿"),
        ("si_xiang", "四象"),
        ("su_gua", "宿卦"),
        ("ti_wangshuai", "体旺衰"),
        ("yong_wangshuai", "用旺衰"),
        ("bian_wangshuai", "变旺衰"),
        ("gua_wangshuai_energy", "卦旺衰能量"),
        // ("shi_kong_num", "时空数"),  // 注释：一个月内不变
        
        // ==================== 以下特征在Python中被注释掉（性能原因） ====================
        // ("ben_gua_hetu1", "本卦河图数1"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_hetu2", "本卦河图数2"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_hetu1", "变卦河图数1"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_hetu2", "变卦河图数2"),  // 注释：性能优化时暂时关闭
        // ("hu_gua_hetu1", "互卦河图数1"),  // 注释：性能优化时暂时关闭
        // ("hu_gua_hetu2", "互卦河图数2"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_najia_t1", "本卦纳甲天干1"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_najia_t6", "本卦纳甲天干6"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_najia_d1", "本卦纳甲地支1"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_najia_d6", "本卦纳甲地支6"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_wangshuai", "本卦五行旺衰"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_wangshuai", "变卦五行旺衰"),  // 注释：性能优化时暂时关闭
        // ("hu_gua_wangshuai", "互卦五行旺衰"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_yao1", "本卦初爻"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_yao2", "本卦二爻"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_yao3", "本卦三爻"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_yao1", "变卦初爻"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_yao2", "变卦二爻"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_yao3", "变卦三爻"),  // 注释：性能优化时暂时关闭
    ]
}

/// 玄学操作定义（完整版，与Python版本一致）
/// 
/// 包含约100种玄学操作，涵盖：
/// - 移位操作
/// - 河图数系
/// - 洛书九宫
/// - 先天八卦数
/// - 后天八卦数
/// - 六十甲子
/// - 五行数
/// - 纳甲法
/// - 太玄大衍
/// - 节气三才
/// - 高级玄学运算
pub fn get_xuanxue_operations() -> Vec<(&'static str, fn(i32) -> i32, &'static str)> {
    vec![
        // ==================== 移位操作 ====================
        ("左移1", |a| a << 1, "左移1位"),
        ("左移2", |a| a << 2, "左移2位"),
        ("右移1", |a| a >> 1, "右移1位"),
        ("数字反转", |a| {
            if a > 0 {
                let s = a.abs().to_string();
                s.chars().rev().collect::<String>().parse().unwrap_or(0)
            } else {
                0
            }
        }, "数字反转"),
        ("各位相加", |a| {
            a.abs().to_string().chars()
                .filter_map(|c| c.to_digit(10))
                .map(|d| d as i32)
                .sum()
        }, "各位相加"),
        ("数根", |a| if a > 0 { (a - 1) % 9 + 1 } else { 0 }, "数根"),
        ("位1计数", |a| {
            a.abs().count_ones() as i32
        }, "位1计数"),
        ("各位平方和", |a| {
            a.abs().to_string().chars()
                .filter_map(|c| c.to_digit(10))
                .map(|d| (d as i32).pow(2))
                .sum()
        }, "各位平方和"),
        ("各位立方和", |a| {
            a.abs().to_string().chars()
                .filter_map(|c| c.to_digit(10))
                .map(|d| (d as i32).pow(3))
                .sum()
        }, "各位立方和"),
        ("奇数位和", |a| {
            a.abs().to_string().chars().enumerate()
                .filter(|(i, _)| i % 2 == 0)
                .filter_map(|(_, c)| c.to_digit(10))
                .map(|d| d as i32)
                .sum()
        }, "奇数位和"),
        ("偶数位和", |a| {
            a.abs().to_string().chars().enumerate()
                .filter(|(i, _)| i % 2 == 1)
                .filter_map(|(_, c)| c.to_digit(10))
                .map(|d| d as i32)
                .sum()
        }, "偶数位和"),
        
        // ==================== 河图数系 ====================
        ("河图数", |a| ((a % 10) + (a / 10)) % 10, "河图数"),
        ("河图水", |a| if a > 0 { (a % 6) + 1 } else { 1 }, "河图水"),
        ("河图火", |a| if a > 0 { (a % 7) + 2 } else { 2 }, "河图火"),
        ("河图木", |a| if a > 0 { (a % 8) + 3 } else { 3 }, "河图木"),
        ("河图金", |a| if a > 0 { (a % 9) + 4 } else { 4 }, "河图金"),
        ("河图土", |a| if a > 0 { (a % 5) + 5 } else { 5 }, "河图土"),
        
        // ==================== 洛书九宫 ====================
        ("洛书数", |a| if a > 0 { (a * 3) % 9 } else { 0 }, "洛书数"),
        ("洛书飞星", |a| if a > 0 { ((a - 1) % 9) + 1 } else { 1 }, "洛书飞星"),
        
        // ==================== 先天八卦数 ====================
        ("先天数", |a| (a + 7) % 8 + 1, "先天数"),
        ("先天乾", |a| if a % 8 == 1 { 1 } else { a % 8 }, "先天乾"),
        
        // ==================== 后天八卦数 ====================
        ("后天数", |a| (a + 3) % 8 + 1, "后天数"),
        
        // ==================== 六十甲子 ====================
        ("干支数", |a| (a % 60) + 1, "干支数"),
        ("天干数", |a| (a % 10) + 1, "天干数"),
        ("地支数", |a| (a % 12) + 1, "地支数"),
        
        // ==================== 五行数 ====================
        ("五行数", |a| (a % 5) + 1, "五行数"),
        
        // ==================== 纳甲法 ====================
        ("纳甲数", |a| ((a % 10) + 1) * 10 + (a % 10) + 1, "纳甲数"),
        
        // ==================== 太玄大衍 ====================
        ("太玄数", |a| if a > 0 { (a % 81) + 1 } else { 1 }, "太玄数"),
        ("大衍数", |a| if a > 0 { (a % 50) + 1 } else { 1 }, "大衍数"),
        
        // ==================== 节气三才 ====================
        ("节气数", |a| if a > 0 { (a % 24) + 1 } else { 1 }, "节气数"),
        ("三才数", |a| if a > 0 { (a % 3) + 1 } else { 1 }, "三才数"),
        
        // ==================== 高级玄学运算 ====================
        ("天干合化", |a| ((a % 10) + 5) % 10 + 1, "天干合化"),
        ("地支六合", |a| (13 - (a % 12)) % 12 + 1, "地支六合"),
        ("地支六冲", |a| (a + 6) % 12 + 1, "地支六冲"),
        ("五行相生", |a| (a % 5) + 1, "五行相生"),
        ("五行相克", |a| ((a + 2) % 5) + 1, "五行相克"),
        ("卦象能量", |a| ((a % 8) + 1) * ((a % 8) + 1), "卦象能量"),
        ("九宫中宫", |a| if a % 9 == 0 { 5 } else { a % 9 }, "九宫中宫"),
        ("太乙九宫", |a| ((a + 4) % 9) + 1, "太乙九宫"),
        ("奇门三奇", |a| ((a - 1) % 3) + 1 + 1, "奇门三奇"),
        ("奇门六仪", |a| ((a - 1) % 6) + 5, "奇门六仪"),
        ("六壬月将", |a| (12 - (a % 12)) % 12 + 1, "六壬月将"),
        ("二十八宿", |a| (a % 28) + 1, "二十八宿"),
        ("四象", |a| (a % 4) + 1, "四象"),
        ("十二建除", |a| (a % 12) + 1, "十二建除"),
        ("纳音五行", |a| ((a - 1) / 2 % 5) + 1, "纳音五行"),
        ("紫微主星", |a| (a % 14) + 1, "紫微主星"),
        ("禄马贵", |a| ((a % 12) + (a % 10)) % 12 + 1, "禄马贵"),
        ("彭祖百忌", |a| (a % 60) + 1, "彭祖百忌"),
        ("三元九运", |a| if a > 1864 { ((a - 1864) / 20) % 9 + 1 } else { (a % 9) + 1 }, "三元九运"),
        ("飞星入中", |a| (9 - (a % 9)) % 9 + 1, "飞星入中"),
        ("河洛合数", |a| ((a % 10) + 1) * 10 + ((a % 9) + 1), "河洛合数"),
        ("先后天合", |a| ((a + 7) % 8 + 1) * 10 + ((a + 3) % 8 + 1), "先后天合"),
        ("干支合数", |a| ((a % 10) + 1) * 12 + ((a % 12) + 1), "干支合数"),
        ("卦气数", |a| if a % 12 != 0 { (a % 12) + 1 } else { 12 }, "卦气数"),
        ("大衍筮", |a| ((a * 4 + 1) % 50) + 1, "大衍筮"),
        ("梅花易数", |a| (a % 8) + 1, "梅花易数"),
        ("金钱卦", |a| (a % 64) + 1, "金钱卦"),
        
        // ==================== 更精确的玄学运算 ====================
        ("地支三合", |a| ((a % 12) / 3) + 1, "地支三合"),
        ("地支三会", |a| ((a % 12) / 3) + 1, "地支三会"),
        ("地支相害", |a| ((a + 7) % 6) + 1, "地支相害"),
        ("地支相刑", |a| ((a % 12) + 3) % 12 + 1, "地支相刑"),
        ("天干五合", |a| ((a - 1) % 5) + 1, "天干五合"),
        ("天干相冲", |a| ((a + 4) % 10) + 1, "天干相冲"),
        ("八卦六亲", |a| (a % 5) + 1, "八卦六亲"),
        ("十二长生", |a| (a % 12) + 1, "十二长生"),
        ("长生帝旺", |a| ((a % 12) + 1 + ((a + 4) % 12) + 1), "长生帝旺"),
        ("太乙十六神", |a| (a % 16) + 1, "太乙十六神"),
        ("奇门八门", |a| (a % 8) + 1, "奇门八门"),
        ("奇门九星", |a| (a % 9) + 1, "奇门九星"),
        ("奇门格局", |a| (a % 10) + 1, "奇门格局"),
        ("六壬天将", |a| (a % 12) + 1, "六壬天将"),
        ("六壬四课", |a| (a % 4) + 1, "六壬四课"),
        ("六壬三传", |a| (a % 3) + 1, "六壬三传"),
        ("七政四余", |a| (a % 11) + 1, "七政四余"),
        ("二十八宿吉凶", |a| (a % 4) + 1, "二十八宿吉凶"),
        ("二十八宿方位", |a| (a % 4) + 1, "二十八宿方位"),
        ("紫微五行局", |a| (a % 5) + 2, "紫微五行局"),
        ("紫微命宫", |a| (a % 12) + 1, "紫微命宫"),
        ("紫微身宫", |a| ((a + 1) % 12) + 1, "紫微身宫"),
        ("铁板数", |a| (a % 120) + 1, "铁板数"),
        ("皇极数", |a| (a % 129600) + 1, "皇极数"),
        ("河图合化", |a| ((a % 5) + 1) + ((a + 5) % 5) + 1, "河图合化"),
        ("洛书轨迹", |a| ((a * 3 + 2) % 9) + 1, "洛书轨迹"),
        ("先后天变", |a| ((a + 3) % 8 + 1) + ((a + 7) % 8 + 1), "先后天变"),
        ("五行旺衰", |a| (a % 5) + 1, "五行旺衰"),
        ("五行十二宫", |a| ((a * 5) % 12) + 1, "五行十二宫"),
        ("八卦纳支", |a| ((a % 8) * 3 + (a % 3)) % 12 + 1, "八卦纳支"),
        ("六爻世应", |a| (a % 2) + 1, "六爻世应"),
        ("六亲取用", |a| (a % 6) + 1, "六亲取用"),
        ("岁君", |a| (a % 12) + 1, "岁君"),
        ("将星", |a| ((12 - (a % 12)) % 12) + 1, "将星"),
        ("驿马", |a| ((a % 12 + 2) % 12) + 1, "驿马"),
        ("华盖", |a| ((a % 12 + 3) % 12) + 1, "华盖"),
        ("桃花", |a| ((a % 12 + 9) % 12) + 1, "桃花"),
        ("天德", |a| (a % 12) + 1, "天德"),
        ("月德", |a| ((a + 4) % 12) + 1, "月德"),
        ("天乙贵人", |a| {
            let t = a % 10;
            if t == 1 || t == 5 || t == 7 {
                t + 1
            } else {
                t + 2
            }
        }, "天乙贵人"),
        ("数理吉凶", |a| (a % 81) + 1, "数理吉凶"),
        ("姓名五格", |a| (a % 5) + 1, "姓名五格"),
        ("大衍求一", |a| (a * 7 + 3) % 50 + 1, "大衍求一"),
        ("筮法演变", |a| ((a * 4 + 1) % 64) + 1, "筮法演变"),
        ("焦氏易林", |a| (a % 4096) + 1, "焦氏易林"),
        ("邵雍皇极", |a| ((a * 12 + 6) % 60) + 1, "邵雍皇极"),
        ("康节数", |a| ((a % 8) + 1) * 10 + ((a % 9) + 1), "康节数"),
        ("梅花数", |a| ((a % 8) + 1) * 10 + ((a % 8) + 1), "梅花数"),
        ("河洛理数", |a| ((a % 10) + 1) * ((a % 9) + 1), "河洛理数"),
        ("河洛天地数", |a| {
            let base = (1 + 3 + 5 + 7 + 9) * ((a % 5) + 1) + (2 + 4 + 6 + 8 + 10) * ((a % 5) + 1);
            base
        }, "河洛天地数"),
        
        // ==================== 三式合参、五术合参等 ====================
        ("三式合参", |a| ((a % 9) + (a % 8) + (a % 12)) % 33 + 1, "三式合参"),
        ("五术合参", |a| ((a % 5) + (a % 8) + (a % 12) + (a % 10) + (a % 64)) % 33 + 1, "五术合参"),
    ]
}

/// 数学操作定义（基础运算）
pub fn get_operation_definitions() -> Vec<(&'static str, &'static str, Vec<i32>)> {
    vec![
        // ==================== 基础运算 ====================
        ("add", "加法", vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        ("sub", "减法", vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10]),
        ("mul", "乘法", vec![2, 3, 4, 5]),
        ("div", "除法", vec![2, 3, 4, 5]),
        
        // ==================== 取模运算 ====================
        ("mod", "取模", vec![10, 12, 16, 20, 24, 30, 33, 35]),
        ("mod_add", "取模加1", vec![10, 12, 16, 20, 24, 30, 33, 35]),
        
        // ==================== 移位操作 ====================
        ("shift_left", "左移", vec![1, 2, 3]),
        ("shift_right", "右移", vec![1, 2, 3]),
        
        // ==================== 特殊操作 ====================
        ("bagua_transform", "八卦变换", vec![1, 2, 3]),
        ("wuxing_transform", "五行变换", vec![1, 2, 3]),
        ("hetu_transform", "河图变换", vec![1, 2, 3, 4]),
        ("najia_transform", "纳甲变换", vec![1, 2, 3, 4]),
        
        // ==================== 其他操作 ====================
        ("abs", "绝对值", vec![0]),
        ("neg", "取负", vec![0]),
        ("square", "平方", vec![0]),
        ("combine", "组合", vec![0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
        ("split_sum", "各位求和", vec![0]),
        ("reverse", "反转数字", vec![0]),
    ]
}

/// 获取有效特征键名列表（精简版）
/// 
/// 只保留有真实玄学/数学意义的特征键名
/// 注释掉一个月内不变的特征
/// 与Python版本generate_formula_candidates中的VALID_FEATURE_KEYS保持一致
pub fn get_valid_feature_keys() -> Vec<&'static str> {
    vec![
        // 基础卦象特征（梅花易数核心）
        "ben_gua_sum", "ben_gua_product", "ben_gua_diff",
        "bian_gua_sum", "bian_gua_product", "bian_gua_diff",
        "hu_gua_sum", "hu_gua_product", "hu_gua_diff",
        "total_gua_sum", "ben_gua_64", "bian_gua_64", "hu_gua_64",
        "bian_yao", "yang_count", "yin_count",
        "liu_yao", "ben_gua_shang", "ben_gua_xia",
        "bian_gua_shang", "bian_gua_xia", "hu_gua_shang", "hu_gua_xia",
        
        // 八字信息（四柱）- 注释掉一个月内不变的特征
        // "year_stem", "year_branch", "month_stem", "month_branch",
        // "time_stem", "time_branch",
        "day_stem", "day_branch", "bazi_sum",
        // "day_stem_wuxing", "day_branch_wuxing",
        
        // # 五行信息（Python中注释掉）
        // "wuxing_ben_shang", "wuxing_ben_xia", "wuxing_bian_shang", "wuxing_bian_xia",
        // "wuxing_hu_shang", "wuxing_hu_xia", "wuxing_flow",
        
        // 先天数与后天数
        "xiantian_ben_shang", "xiantian_ben_xia", "xiantian_bian_shang", "xiantian_bian_xia",
        "xiantian_hu_shang", "xiantian_hu_xia", "xiantian_sum",
        "houtian_ben_shang", "houtian_ben_xia", "houtian_bian_shang", "houtian_bian_xia",
        "houtian_hu_shang", "houtian_hu_xia",
        
        // 能量值
        "ti_energy", "yong_energy", "bian_shang_energy", "bian_xia_energy",
        "hu_shang_energy", "hu_xia_energy", "total_energy",
        "adjusted_energy", "metaphysics_score",
        
        // 纳甲法（正确版本）
        "najia_ben_shang", "najia_ben_xia", "najia_bian_shang", "najia_bian_xia",
        
        // 六神（正确版本）
        "liushen",
        
        // 河图洛书
        "hetu_shang_sum", "hetu_xia_sum", "hetu_sheng", "hetu_cheng",
        "luoshu_ben", "luoshu_fei_xing", "heluo_he", "heluo_precise",
        
        // # 体用关系（Python中注释掉）
        // "ti_yong_he", "ti_yong_cha", "ti_yong_score", "ti_yong_total_score",
        
        // # 天干地支组合（Python中注释掉）
        // "tiangan_he", "dizhi_liu_he", "dizhi_san_he", "dizhi_liu_chong",
        
        // # 纳音 - 注释掉一个月内不变（Python中注释掉）
        // "nayin_num",
        // "nayin_gua",
        
        // # 三元九运 - 注释掉一个月内不变（Python中注释掉）
        // "sanyuan_yuan", "sanyuan_yun",
        // "sanyuan_gua", "sanyuan_num",
        
        // # 飞星 - 注释掉一个月内不变（Python中注释掉）
        // "year_flying_star", "month_flying_star",
        // "day_flying_star",
        // "flying_star_gua",
        
        // # 太乙神数 - 注释掉一个月内不变（Python中注释掉）
        // "taiyi_gong_v4",
        // "taiyi_num_v4", "taiyi_wenchang_v4",
        // "taiyi_precise",
        // "taiyi_wenchang", "taiyi_num",
        
        // # 奇门遁甲 - 注释掉一个月内不变（Python中注释掉）
        // "qimen_ju_num", "qimen_num_v4", "qimen_san_qi_v4", "qimen_liu_yi_v4",
        // "qimen_ba_men_v4", "qimen_jiu_xing_v4", "qimen_men_jixiong",
        // "qimen_san_qi", "qimen_liu_yi", "qimen_ba_men", "qimen_jiu_xing", "qimen_num",
        // "qimen_ju", "qimen_san_qi_precise", "qimen_liu_yi_precise", "qimen_precise",
        
        // # 六壬 - 注释掉一个月内不变（Python中注释掉）
        // "liuren_yuejiang_v4",
        // "liuren_num_v4", "liuren_guishen",
        // "liuren_sike_1", "liuren_sike_2", "liuren_sike_3", "liuren_sike_4",
        // "liuren_sanchuan_1", "liuren_sanchuan_2", "liuren_sanchuan_3",
        // "liuren_tianjiang_v4",
        // "liuren_precise",
        // "liuren_di_zhi", "liuren_tian_gan", "liuren_yue_jiang", "liuren_num",
        
        // # 紫微斗数（Python中注释掉）
        // "ziwei_ming_gong", "ziwei_shen_gong", "ziwei_star", "ziwei_num",
        
        // # 铁板神数（Python中注释掉）
        // "tieban_base", "tieban_ke", "tieban_total",
        
        // # 月相（Python中注释掉）
        // "moon_energy",
        
        // # 节气 - 注释掉一个月内不变（Python中注释掉）
        // "jieqi_index_precise",
        
        // # 卦气（Python中注释掉）
        // "gua_qi", "dong_yao_energy", "hu_gua_influence",
        
        // # 时辰卦 - 注释掉一个月内不变（Python中注释掉）
        // "shi_chen_gua", "ri_gua",
        
        // # 建除（Python中注释掉）
        // "jian_chu", "jian_chu_ji_xiong", "jian_chu_gua",
        
        // # 彭祖（Python中注释掉）
        // "pengzu_tiangan", "pengzu_dizhi", "pengzu_num",
        
        // # 日禄马贵（Python中注释掉）
        // "ri_lu", "ri_ma", "ri_gui", "lu_ma_gui",
        
        // # 皇极 - 注释掉一个月内不变（Python中注释掉）
        // "huangji_sum", "huangji_gua",
        
        // # 其他（Python中注释掉）
        // "xing_su", "si_xiang", "su_gua",
        // "ti_wangshuai", "yong_wangshuai", "bian_wangshuai",
        // "gua_wangshuai_energy",
    ]
}

/// 获取扩展特征键名列表（激进版）
/// 
/// 包含所有有意义的玄学特征
/// 注释掉一个月内不变的特征
/// 与gua_features.rs中的to_features函数保持一致
pub fn get_valid_feature_keys_aggressive() -> Vec<&'static str> {
    vec![
        // ==================== 基础卦象特征 ====================
        "ben_gua_num", "ben_gua_xiantian", "ben_gua_houtian", "ben_gua_wuxing_num",
        "ben_gua_upper_num", "ben_gua_lower_num",
        "ben_gua_sum", "ben_gua_product", "ben_gua_diff",
        "ben_gua_64", "ben_gua_shang", "ben_gua_xia",
        // ("ben_gua_hetu1", "本卦河图数1"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_hetu2", "本卦河图数2"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_najia_t1", "本卦纳甲天干1"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_najia_t6", "本卦纳甲天干6"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_najia_d1", "本卦纳甲地支1"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_najia_d6", "本卦纳甲地支6"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_wangshuai", "本卦五行旺衰"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_yao1", "本卦初爻"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_yao2", "本卦二爻"),  // 注释：性能优化时暂时关闭
        // ("ben_gua_yao3", "本卦三爻"),  // 注释：性能优化时暂时关闭
        
        // ==================== 变卦特征 ====================
        "bian_gua_num", "bian_gua_xiantian", "bian_gua_houtian", "bian_gua_wuxing_num",
        "bian_gua_upper_num", "bian_gua_lower_num",
        "bian_gua_sum", "bian_gua_product", "bian_gua_diff",
        "bian_gua_64", "bian_gua_shang", "bian_gua_xia",
        // ("bian_gua_hetu1", "变卦河图数1"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_hetu2", "变卦河图数2"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_wangshuai", "变卦五行旺衰"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_yao1", "变卦初爻"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_yao2", "变卦二爻"),  // 注释：性能优化时暂时关闭
        // ("bian_gua_yao3", "变卦三爻"),  // 注释：性能优化时暂时关闭
        
        // ==================== 互卦特征 ====================
        "hu_gua_num", "hu_gua_xiantian", "hu_gua_houtian", "hu_gua_wuxing_num",
        "hu_gua_upper_num", "hu_gua_lower_num",
        "hu_gua_sum", "hu_gua_product", "hu_gua_diff",
        "hu_gua_64", "hu_gua_shang", "hu_gua_xia",
        // ("hu_gua_hetu1", "互卦河图数1"),  // 注释：性能优化时暂时关闭
        // ("hu_gua_hetu2", "互卦河图数2"),  // 注释：性能优化时暂时关闭
        // ("hu_gua_wangshuai", "互卦五行旺衰"),  // 注释：性能优化时暂时关闭
        
        // ==================== 变爻特征 ====================
        "bian_yao_pos", "bian_yao_num", "bian_yao",
        "yang_count", "yin_count", "liu_yao",
        "bian_yao_power",
        
        // ==================== 时间特征 ====================
        // "lunar_year", "lunar_month", "lunar_day", "lunar_hour",  // 注释：一个月内不变
        
        // ==================== 天干特征 ====================
        // "year_tiangan", "month_tiangan",  // 注释：一个月内不变
        "day_tiangan", "hour_tiangan", "day_stem",
        
        // ==================== 地支特征 ====================
        // "year_dizhi", "month_dizhi",  // 注释：一个月内不变
        "day_dizhi", "hour_dizhi", "day_branch",
        
        // ==================== 五行特征 ====================
        // "year_wuxing_num", "month_wuxing_num",  // 注释：一个月内不变
        "day_wuxing_num", "hour_wuxing_num",
        "wuxing_ben_shang", "wuxing_ben_xia", "wuxing_bian_shang", "wuxing_bian_xia",
        "wuxing_hu_shang", "wuxing_hu_xia", "wuxing_flow",
        "day_stem_wuxing", "day_branch_wuxing",
        
        // ==================== 组合特征 ====================
        // "year_month_sum",  // 注释：一个月内不变
        "day_hour_sum",
        // "year_day_sum", "month_hour_sum",  // 注释：一个月内不变
        
        // ==================== 卦象组合特征 ====================
        "ben_bian_sum", "ben_hu_sum", "bian_hu_sum", "three_gua_sum",
        "total_gua_sum",
        
        // ==================== 卦象乘积特征 ====================
        "ben_bian_product", "ben_hu_product", "bian_hu_product",
        
        // ==================== 八字信息 ====================
        "bazi_sum",
        
        // ==================== 月相特征 ====================
        "moon_energy",
        
        // ==================== 能量特征 ====================
        "total_energy", "ti_energy", "yong_energy",
        "bian_shang_energy", "bian_xia_energy",
        "hu_shang_energy", "hu_xia_energy",
        "adjusted_energy", "metaphysics_score",
        
        // ==================== 先天后天特征 ====================
        "xiantian_ben_shang", "xiantian_ben_xia", "xiantian_bian_shang", "xiantian_bian_xia",
        "xiantian_hu_shang", "xiantian_hu_xia", "xiantian_sum",
        "houtian_ben_shang", "houtian_ben_xia", "houtian_bian_shang", "houtian_bian_xia",
        "houtian_hu_shang", "houtian_hu_xia",
        
        // ==================== 纳甲特征 ====================
        "najia_ben_shang", "najia_ben_xia", "najia_bian_shang", "najia_bian_xia",
        
        // ==================== 六神特征 ====================
        "liushen",
        
        // ==================== 河图洛书特征 ====================
        "hetu_shang_sum", "hetu_xia_sum", "hetu_sheng", "hetu_cheng",
        "hetu_sheng_cheng",
        "luoshu_ben", "luoshu_fei_xing", "heluo_he", "heluo_precise",
        
        // ==================== 体用关系 ====================
        "ti_yong_he", "ti_yong_cha", "ti_yong_score", "ti_yong_total_score",
        
        // ==================== 天干地支组合 ====================
        "tiangan_he", "dizhi_liu_he", "dizhi_san_he", "dizhi_liu_chong",
        
        // ==================== 卦象指数 ====================
        "gua_index", "yinyang_balance",
        
        // ==================== 皇极秘数特征 ====================
        "huangji_sum", "huangji_gua",
        // "huangji_hui", "huangji_yun", "huangji_shi",  // 注释：一个月内不变
        
        // ==================== 太乙神数特征 ====================
        "taiyi_wenchang", "taiyi_gong", "taiyi_num",
        "taiyi_gong_precise", "taiyi_wenchang_precise",
        "taiyi_zhumu", "taiyi_kemu", "taiyi_precise",
        "taiyi_num_v4", "taiyi_wenchang_v4",
        // "taiyi_gong_v4", "taiyi_zhu_suan", "taiyi_ke_suan", "taiyi_main_star",  // 注释：一个月内不变
        
        // ==================== 奇门遁甲特征 ====================
        "qimen_san_qi", "qimen_liu_yi", "qimen_ba_men", "qimen_jiu_xing", "qimen_num",
        "qimen_ju", "qimen_san_qi_precise", "qimen_liu_yi_precise", "qimen_precise",
        "qimen_ju_num", "qimen_num_v4", "qimen_san_qi_v4", "qimen_liu_yi_v4",
        "qimen_ba_men_v4", "qimen_jiu_xing_v4", "qimen_men_jixiong",
        // "qimen_dun_type",  // 注释：一个月内不变
        
        // ==================== 六壬特征 ====================
        "liuren_di_zhi", "liuren_tian_gan", "liuren_yue_jiang", "liuren_num",
        "liuren_guishen", "liuren_sike_1", "liuren_sike_2", "liuren_sike_3", "liuren_sike_4",
        "liuren_precise",
        "liuren_num_v4", "liuren_tianjiang_v4",
        "liuren_sanchuan_1", "liuren_sanchuan_2", "liuren_sanchuan_3",
        // "liuren_yuejiang_v4", "liuren_yuejiang_precise",  // 注释：一个月内不变
        
        // ==================== 紫微斗数特征 ====================
        "ziwei_ming_gong", "ziwei_shen_gong", "ziwei_star", "ziwei_num",
        
        // ==================== 铁板神数特征 ====================
        "tieban_base", "tieban_ke", "tieban_total",
        
        // ==================== 梅花易数深度特征 ====================
        "gua_qi", "dong_yao_energy", "hu_gua_influence",
        
        // ==================== 时辰卦特征 ====================
        "shi_chen_gua", "ri_gua",
        // "shi_kong_num",  // 注释：一个月内不变
        // "yue_gua", "nian_gua",  // 注释：一个月内不变
        
        // ==================== 三元九运特征 ====================
        "sanyuan_gua", "sanyuan_num",
        // "sanyuan_yuan", "sanyuan_yun",  // 注释：一个月内不变
        
        // ==================== 飞星特征 ====================
        "day_flying_star", "flying_star_gua",
        // "year_flying_star", "month_flying_star", "jiuxing_sum",  // 注释：一个月内不变
        
        // ==================== 纳音特征 ====================
        "nayin_gua",
        // "nayin_num", "nayin_precise", "nayin_wuxing_detail",  // 注释：一个月内不变
        
        // ==================== 星宿特征 ====================
        "xing_su", "si_xiang", "su_gua",
        
        // ==================== 建除特征 ====================
        "jian_chu", "jian_chu_ji_xiong", "jian_chu_gua",
        
        // ==================== 彭祖特征 ====================
        "pengzu_tiangan", "pengzu_dizhi", "pengzu_num",
        
        // ==================== 日禄马贵特征 ====================
        "ri_lu", "ri_ma", "ri_gui", "lu_ma_gui",
        
        // ==================== 节气特征 ====================
        "jieqi_gua",
        // "jieqi_index_precise",  // 注释：一个月内不变
        
        // ==================== 其他特征 ====================
        "ti_wangshuai", "yong_wangshuai", "bian_wangshuai", "gua_wangshuai_energy",
    ]
}

/// 映射到目标范围
fn map_to_range(value: i32, min_val: i32, max_val: i32) -> i32 {
    if value < min_val {
        min_val
    } else if value > max_val {
        ((value - min_val) % (max_val - min_val + 1)) + min_val
    } else {
        value
    }
}

/// 生成公式候选（精简优化版 v5.0）
/// 
/// 参数:
/// - features: 卦象特征字典
/// - config: 全局配置
/// - target_range: 目标范围 (最小值, 最大值)
/// 
/// 返回:
/// - 公式候选列表 (公式规范, 初始值)
/// 
/// 说明:
/// ==========
/// 本函数生成精简版的公式候选，用于快速搜索。
/// 以下被注释的特征值在Python版本中因为性能问题被注释掉，
/// 但在Rust版本中保留这些注释，因为后续Rust性能好了之后还可能开启。
pub fn generate_formula_candidates(
    features: &HashMap<String, i32>,
    config: &GuaConfig,
    target_range: (i32, i32),
) -> Vec<FormulaCandidate> {
    let mut candidates = Vec::new();
    let min_val = target_range.0;
    let max_val = target_range.1;
    let range_size = max_val - min_val + 1;
    
    // 构建有效特征字典（过滤掉值为0或None的特征）
    let valid_keys = get_valid_feature_keys();
    let mut valid_features = HashMap::new();
    
    for key in &valid_keys {
        if let Some(&val) = features.get(*key) {
            if val != 0 {
                valid_features.insert(key.to_string(), val);
            }
        }
    }
    
    // 如果有效特征太少，使用所有可用特征
    if valid_features.len() < 10 {
        for (key, &val) in features.iter() {
            if val != 0 {
                valid_features.insert(key.clone(), val);
            }
        }
    }
    
    // 动态取模值
    let mut mod_values = vec![range_size];
    for mv in [7, 8, 9, 10, 12, 24, 49, 60, 64].iter() {
        if *mv != range_size {
            mod_values.push(*mv);
        }
    }
    mod_values.sort();
    
    // 获取特征列表
    let feature_list: Vec<(&String, &i32)> = valid_features.iter().collect();
    let n_features = feature_list.len();
    
    // 特征数量配置
    let default_feature_count = n_features;
    let dual_add_features = default_feature_count;
    let triple_add_features = default_feature_count;
    let xuanxue_combo_features = default_feature_count;
    
    // ==================== 模式1：单特征取模 ====================
    for (f_name, &f_val) in &feature_list {
        for &mod_val in &mod_values {
            if mod_val <= 0 {
                continue;
            }
            let result = f_val % mod_val;
            if result > 0 {
                let mapped = map_to_range(result, min_val, max_val);
                let formula = FormulaSpec::new(
                    format!("{}_mod{}", f_name, mod_val),
                    f_name.to_string(),
                    vec!["mod".to_string()],
                    vec![mod_val],
                    target_range,
                );
                candidates.push(FormulaCandidate::new(formula, mapped));
            }
        }
    }
    
    // ==================== 模式2：双特征组合运算（扩展版） ====================
    // 使用配置的特征数量，支持多种运算方式
    let dual_features: Vec<_> = feature_list.iter().take(dual_add_features).collect();
    // 双特征运算列表（扩展版）
    let dual_ops: Vec<(&str, fn(i32, i32) -> i32)> = vec![
        ("加", |a, b| a + b),
        ("减", |a, b| (a - b).abs()),
        ("乘", |a, b| a * b),
        ("除", |a, b| a / b.max(1)),
        ("模", |a, b| a % b.max(1)),
        ("平方加", |a, b| a * a + b),
        ("平方减", |a, b| (a * a - b).abs()),
        ("立方加", |a, b| a * a * a + b),
        ("异或", |a, b| a ^ b),
        ("与", |a, b| a & b),
        ("或", |a, b| a | b),
        ("最大", |a, b| a.max(b)),
        ("最小", |a, b| a.min(b)),
        ("平均", |a, b| (a + b) / 2),
        ("平方和", |a, b| a * a + b * b),
        ("差平方", |a, b| (a - b) * (a - b)),
    ];
    // 常用模值（精简版，与主mod_values一致）
    let dual_mod_values: Vec<i32> = vec![range_size, 7, 8, 9, 10, 12, 24, 49, 60, 64];
    
    for i in 0..dual_features.len() {
        for j in (i + 1)..dual_features.len() {
            let (f1_name, &f1_val) = dual_features[i];
            let (f2_name, &f2_val) = dual_features[j];
            
            for (op_name, op_func) in &dual_ops {
                for &mod_val in &dual_mod_values {
                    if mod_val <= 0 {
                        continue;
                    }
                    
                    let result = op_func(f1_val, f2_val) % mod_val;
                    if result > 0 {
                        let mapped = map_to_range(result, min_val, max_val);
                        let formula = FormulaSpec::new(
                            format!("{}_{}_{}_mod{}", f1_name, f2_name, op_name, mod_val),
                            format!("{},{}", f1_name, f2_name),
                            vec![op_name.to_string(), "mod".to_string()],
                            vec![0, mod_val],
                            target_range,
                        );
                        candidates.push(FormulaCandidate::new(formula, mapped));
                    }
                }
            }
        }
    }
    
    // ==================== 模式3：三特征组合运算（精简版） ====================
    // 使用配置的特征数量做三组合，只保留加法和乘法
    let triple_features: Vec<_> = feature_list.iter().take(triple_add_features).collect();
    // 三特征运算列表（精简版，只保留加和乘）
    let triple_ops: Vec<(&str, fn(i32, i32, i32) -> i32)> = vec![
        ("加", |a, b, c| a + b + c),
        ("乘", |a, b, c| a * b * c),
    ];
    
    for i in 0..triple_features.len() {
        for j in (i + 1)..triple_features.len() {
            for k in (j + 1)..triple_features.len() {
                let (f1_name, &f1_val) = triple_features[i];
                let (f2_name, &f2_val) = triple_features[j];
                let (f3_name, &f3_val) = triple_features[k];
                
                for (op_name, op_func) in &triple_ops {
                    let result = op_func(f1_val, f2_val, f3_val) % range_size;
                    if result > 0 {
                        let mapped = map_to_range(result, min_val, max_val);
                        let formula = FormulaSpec::new(
                            format!("{}_{}_{}_{}_mod{}", f1_name, f2_name, f3_name, op_name, range_size),
                            format!("{},{},{}", f1_name, f2_name, f3_name),
                            vec![op_name.to_string(), "mod".to_string()],
                            vec![0, range_size],
                            target_range,
                        );
                        candidates.push(FormulaCandidate::new(formula, mapped));
                    }
                }
            }
        }
    }
    
    // ==================== 模式4：玄学操作（单特征变换） ====================
    let xuanxue_ops = get_xuanxue_operations();
    let xuanxue_features: Vec<_> = feature_list.iter().take(xuanxue_combo_features).collect();
    
    for (f_name, &f_val) in &xuanxue_features {
        for (op_name, op_func, _op_desc) in &xuanxue_ops {
            let result = op_func(f_val);
            if result > 0 {
                let mapped = if result > range_size {
                    map_to_range(result % range_size, min_val, max_val)
                } else {
                    map_to_range(result, min_val, max_val)
                };
                if mapped >= min_val && mapped <= max_val {
                    let formula = FormulaSpec::new(
                        format!("{}_{}", f_name, op_name),
                        f_name.to_string(),
                        vec![op_name.to_string()],
                        vec![0],
                        target_range,
                    );
                    candidates.push(FormulaCandidate::new(formula, mapped));
                }
            }
        }
    }
    
    // ==================== 模式8：玄学操作 + 双特征组合 ====================
    let core_xuanxue: Vec<_> = feature_list.iter().take(xuanxue_combo_features).collect();
    let xuanxue_transforms: Vec<(&str, fn(i32) -> i32)> = vec![
        ("洛书飞星", |a| if a > 0 { ((a - 1) % 9) + 1 } else { 1 }),
        ("先天数", |a| (a + 7) % 8 + 1),
        ("地支数", |a| (a % 12) + 1),
        ("五行数", |a| (a % 5) + 1),
        ("干支数", |a| (a % 60) + 1),
    ];
    
    for i in 0..core_xuanxue.len() {
        for j in 0..core_xuanxue.len() {
            if i == j {
                continue;
            }
            let (f1_name, &f1_val) = core_xuanxue[i];
            let (f2_name, &f2_val) = core_xuanxue[j];
            
            for (op_name, op_func) in &xuanxue_transforms {
                let transformed = op_func(f1_val);
                let result = (transformed + f2_val) % range_size;
                if result > 0 {
                    let mapped = map_to_range(result, min_val, max_val);
                    let formula = FormulaSpec::new(
                        format!("{}_{}_{}加", f1_name, f2_name, op_name),
                        format!("{},{}", f1_name, f2_name),
                        vec![format!("{}加", op_name)],
                        vec![range_size],
                        target_range,
                    );
                    candidates.push(FormulaCandidate::new(formula, mapped));
                }
            }
        }
    }
    
    // 去重
    candidates.sort_by(|a, b| a.formula.formula_id.cmp(&b.formula.formula_id));
    candidates.dedup_by(|a, b| a.formula.formula_id == b.formula.formula_id);
    
    candidates
}

/// 生成公式候选（激进版）
/// 
/// 参数:
/// - features: 卦象特征字典
/// - config: 全局配置
/// - target_range: 目标范围 (最小值, 最大值)
/// - max_candidates: 最大候选数量
/// 
/// 返回:
/// - 公式候选列表 (公式规范, 初始值)
/// 
/// 说明:
/// ==========
/// 本函数生成更多更复杂的公式组合，用于深度搜索。
/// 包含所有有意义的玄学特征。
/// 以下被注释的特征值在Python版本中因为性能问题被注释掉，
/// 但在Rust版本中保留这些注释，因为后续Rust性能好了之后还可能开启。
pub fn generate_formula_candidates_aggressive(
    features: &HashMap<String, i32>,
    config: &GuaConfig,
    target_range: (i32, i32),
    max_candidates: i32,
) -> Vec<FormulaCandidate> {
    let mut candidates = Vec::new();
    let min_val = target_range.0;
    let max_val = target_range.1;
    let range_size = max_val - min_val + 1;
    
    // 构建有效特征字典（使用扩展特征列表）
    let valid_keys = get_valid_feature_keys_aggressive();
    let mut valid_features = HashMap::new();
    
    for key in &valid_keys {
        if let Some(&val) = features.get(*key) {
            if val != 0 {
                valid_features.insert(key.to_string(), val);
            }
        }
    }
    
    // 如果有效特征太少，使用所有可用特征
    if valid_features.len() < 20 {
        for (key, &val) in features.iter() {
            if val != 0 {
                valid_features.insert(key.clone(), val);
            }
        }
    }
    
    // 扩展模值列表
    let mut mod_values = vec![range_size];
    for mv in [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
               21, 22, 23, 24, 28, 30, 32, 33, 36, 40, 48, 60, 64, 72, 81, 100].iter() {
        if *mv != range_size {
            mod_values.push(*mv);
        }
    }
    mod_values.sort();
    
    let feature_list: Vec<(&String, &i32)> = valid_features.iter().collect();
    let n_features = feature_list.len();
    
    if n_features == 0 {
        return candidates;
    }
    
    // 特征数量配置
    let triple_combo_features = n_features;
    let quad_combo_features = n_features;
    let nested_op_features = n_features;
    let weighted_combo_features = n_features;
    let dual_xuanxue_features = n_features;
    
    // ==================== 第一步：单特征取模（扩展版） ====================
    for (f_name, &f_val) in &feature_list {
        for &mod_val in &mod_values {
            if mod_val <= 0 {
                continue;
            }
            let result = f_val % mod_val;
            if result > 0 {
                let mapped = map_to_range(result, min_val, max_val);
                let formula = FormulaSpec::new(
                    format!("{}_mod{}", f_name, mod_val),
                    f_name.to_string(),
                    vec!["mod".to_string()],
                    vec![mod_val],
                    target_range,
                );
                candidates.push(FormulaCandidate::new(formula, mapped));
            }
        }
    }
    
    // ==================== 第二步：双特征组合运算（扩展版） ====================
    // 双特征运算列表
    let dual_ops: Vec<(&str, fn(i32, i32) -> i32)> = vec![
        ("加", |a, b| a + b),
        ("减", |a, b| (a - b).abs()),
        ("乘", |a, b| a * b),
        ("除", |a, b| a / b.max(1)),
        ("模", |a, b| a % b.max(1)),
        ("平方加", |a, b| a * a + b),
        ("平方减", |a, b| (a * a - b).abs()),
        ("立方加", |a, b| a * a * a + b),
        ("异或", |a, b| a ^ b),
        ("与", |a, b| a & b),
        ("或", |a, b| a | b),
        ("最大", |a, b| a.max(b)),
        ("最小", |a, b| a.min(b)),
        ("平均", |a, b| (a + b) / 2),
        ("平方和", |a, b| a * a + b * b),
        ("差平方", |a, b| (a - b) * (a - b)),
    ];
    // 常用模值
    let dual_mod_values: Vec<i32> = vec![range_size, 8, 9, 10, 12, 16, 24, 33, 35, 60];
    
    for i in 0..n_features {
        for j in (i + 1)..n_features {
            let (f1_name, &f1_val) = feature_list[i];
            let (f2_name, &f2_val) = feature_list[j];
            
            for (op_name, op_func) in &dual_ops {
                for &mod_val in &dual_mod_values {
                    if mod_val <= 0 {
                        continue;
                    }
                    
                    let result = op_func(f1_val, f2_val) % mod_val;
                    if result > 0 {
                        let mapped = map_to_range(result, min_val, max_val);
                        let formula = FormulaSpec::new(
                            format!("{}_{}_{}_mod{}", f1_name, f2_name, op_name, mod_val),
                            format!("{},{}", f1_name, f2_name),
                            vec![op_name.to_string(), "mod".to_string()],
                            vec![0, mod_val],
                            target_range,
                        );
                        candidates.push(FormulaCandidate::new(formula, mapped));
                    }
                }
            }
            
            // 限制数量
            if candidates.len() >= max_candidates as usize {
                candidates.truncate(max_candidates as usize);
                return candidates;
            }
        }
    }
    
    // ==================== 第三步：三特征组合运算 ====================
    // 三特征运算列表
    let triple_ops: Vec<(&str, fn(i32, i32, i32) -> i32)> = vec![
        ("加", |a, b, c| a + b + c),
        ("乘", |a, b, c| a * b * c),
        ("差乘", |a, b, c| (a - b).abs() * c),
        ("和乘", |a, b, c| (a + b) * c),
        ("积加和", |a, b, c| a * b + c),
        ("和减积", |a, b, c| a + b - c),
    ];
    let triple_mod_values: Vec<i32> = vec![range_size, 8, 9, 10, 12, 16, 24, 33];
    
    let core_features: Vec<_> = feature_list.iter().take(triple_combo_features.min(n_features)).collect();
    for i in 0..core_features.len() {
        for j in (i + 1)..core_features.len() {
            for k in (j + 1)..core_features.len() {
                let (f1_name, &f1_val) = core_features[i];
                let (f2_name, &f2_val) = core_features[j];
                let (f3_name, &f3_val) = core_features[k];
                
                for (op_name, op_func) in &triple_ops {
                    for &mod_val in &triple_mod_values {
                        if mod_val <= 0 {
                            continue;
                        }
                        
                        let result = op_func(f1_val, f2_val, f3_val) % mod_val;
                        if result > 0 {
                            let mapped = map_to_range(result, min_val, max_val);
                            let formula = FormulaSpec::new(
                                format!("{}_{}_{}_{}_mod{}", f1_name, f2_name, f3_name, op_name, mod_val),
                                format!("{},{},{}", f1_name, f2_name, f3_name),
                                vec![op_name.to_string(), "mod".to_string()],
                                vec![0, mod_val],
                                target_range,
                            );
                            candidates.push(FormulaCandidate::new(formula, mapped));
                        }
                    }
                }
                
                if candidates.len() >= max_candidates as usize {
                    candidates.truncate(max_candidates as usize);
                    return candidates;
                }
            }
        }
    }
    
    // ==================== 第四步：玄学操作（完整版） ====================
    let xuanxue_ops = get_xuanxue_operations();
    
    for (f_name, &f_val) in &feature_list {
        for (op_name, op_func, _op_desc) in &xuanxue_ops {
            let result = op_func(f_val);
            if result > 0 {
                let mapped = if result > range_size {
                    map_to_range(result % range_size, min_val, max_val)
                } else {
                    map_to_range(result, min_val, max_val)
                };
                if mapped >= min_val && mapped <= max_val {
                    let formula = FormulaSpec::new(
                        format!("{}_{}", f_name, op_name),
                        f_name.to_string(),
                        vec![op_name.to_string()],
                        vec![0],
                        target_range,
                    );
                    candidates.push(FormulaCandidate::new(formula, mapped));
                }
            }
        }
        
        if candidates.len() >= max_candidates as usize {
            candidates.truncate(max_candidates as usize);
            return candidates;
        }
    }
    
    // ==================== 第五步：玄学操作 + 双特征组合 ====================
    let xuanxue_transforms: Vec<(&str, fn(i32) -> i32)> = vec![
        ("洛书飞星", |a| if a > 0 { ((a - 1) % 9) + 1 } else { 1 }),
        ("先天数", |a| (a + 7) % 8 + 1),
        ("后天数", |a| (a + 3) % 8 + 1),
        ("地支数", |a| (a % 12) + 1),
        ("天干数", |a| (a % 10) + 1),
        ("五行数", |a| (a % 5) + 1),
        ("干支数", |a| (a % 60) + 1),
        ("河图数", |a| ((a % 10) + (a / 10)) % 10),
        ("洛书数", |a| if a > 0 { (a * 3) % 9 } else { 0 }),
        ("卦象能量", |a| ((a % 8) + 1) * ((a % 8) + 1)),
        ("数根", |a| if a > 0 { (a - 1) % 9 + 1 } else { 0 }),
        ("太乙九宫", |a| ((a + 4) % 9) + 1),
    ];
    
    for i in 0..n_features {
        for j in 0..n_features {
            if i == j {
                continue;
            }
            let (f1_name, &f1_val) = feature_list[i];
            let (f2_name, &f2_val) = feature_list[j];
            
            for (op_name, op_func) in &xuanxue_transforms {
                let transformed = op_func(f1_val);
                
                // 加法组合
                for &mod_val in &[range_size, 8, 9, 10, 12, 16, 24, 33] {
                    if mod_val <= 0 {
                        continue;
                    }
                    let result = (transformed + f2_val) % mod_val;
                    if result > 0 {
                        let mapped = map_to_range(result, min_val, max_val);
                        let formula = FormulaSpec::new(
                            format!("{}_{}_{}加_mod{}", f1_name, f2_name, op_name, mod_val),
                            format!("{},{}", f1_name, f2_name),
                            vec![format!("{}加", op_name)],
                            vec![mod_val],
                            target_range,
                        );
                        candidates.push(FormulaCandidate::new(formula, mapped));
                    }
                    
                    // 减法组合
                    let result = (transformed - f2_val).abs() % mod_val;
                    if result > 0 {
                        let mapped = map_to_range(result, min_val, max_val);
                        let formula = FormulaSpec::new(
                            format!("{}_{}_{}减_mod{}", f1_name, f2_name, op_name, mod_val),
                            format!("{},{}", f1_name, f2_name),
                            vec![format!("{}减", op_name)],
                            vec![mod_val],
                            target_range,
                        );
                        candidates.push(FormulaCandidate::new(formula, mapped));
                    }
                    
                    // 乘法组合
                    let result = (transformed * f2_val) % mod_val;
                    if result > 0 {
                        let mapped = map_to_range(result, min_val, max_val);
                        let formula = FormulaSpec::new(
                            format!("{}_{}_{}乘_mod{}", f1_name, f2_name, op_name, mod_val),
                            format!("{},{}", f1_name, f2_name),
                            vec![format!("{}乘", op_name)],
                            vec![mod_val],
                            target_range,
                        );
                        candidates.push(FormulaCandidate::new(formula, mapped));
                    }
                }
            }
        }
        
        if candidates.len() >= max_candidates as usize {
            candidates.truncate(max_candidates as usize);
            return candidates;
        }
    }
    
    // ==================== 第六步：带权重的特征组合 ====================
    // k1*A + k2*B 形式，k1, k2为小整数权重
    let weights: Vec<i32> = vec![1, 2, 3, 4, 5];
    let weighted_features: Vec<_> = feature_list.iter().take(weighted_combo_features.min(n_features)).collect();
    
    for i in 0..weighted_features.len() {
        for j in (i + 1)..weighted_features.len() {
            let (f1_name, &f1_val) = weighted_features[i];
            let (f2_name, &f2_val) = weighted_features[j];
            
            for &w1 in &weights {
                for &w2 in &weights {
                    if w1 == 1 && w2 == 1 {
                        continue;  // 跳过普通加法
                    }
                    
                    for &mod_val in &[range_size, 8, 9, 10, 12, 16, 24, 33] {
                        if mod_val <= 0 {
                            continue;
                        }
                        
                        let result = (w1 * f1_val + w2 * f2_val) % mod_val;
                        if result > 0 {
                            let mapped = map_to_range(result, min_val, max_val);
                            let op_name = format!("加权{}{}", w1, w2);
                            let formula = FormulaSpec::new(
                                format!("{}_{}_{}_mod{}", f1_name, f2_name, op_name, mod_val),
                                format!("{},{}", f1_name, f2_name),
                                vec![op_name.clone(), "mod".to_string()],
                                vec![w1, w2, mod_val],
                                target_range,
                            );
                            candidates.push(FormulaCandidate::new(formula, mapped));
                        }
                    }
                }
            }
            
            if candidates.len() >= max_candidates as usize {
                candidates.truncate(max_candidates as usize);
                return candidates;
            }
        }
    }
    
    // ==================== 第七步：双玄学操作组合 ====================
    for i in 0..dual_xuanxue_features.min(n_features) {
        for j in (i + 1)..dual_xuanxue_features.min(n_features) {
            let (f1_name, &f1_val) = feature_list[i];
            let (f2_name, &f2_val) = feature_list[j];
            
            for (op1_name, op1_func) in xuanxue_transforms.iter().take(6) {
                for (op2_name, op2_func) in xuanxue_transforms.iter().take(6) {
                    let t1 = op1_func(f1_val);
                    let t2 = op2_func(f2_val);
                    
                    for &mod_val in &[range_size, 8, 9, 10, 12, 16, 24, 33] {
                        if mod_val <= 0 {
                            continue;
                        }
                        
                        let result = (t1 + t2) % mod_val;
                        if result > 0 {
                            let mapped = map_to_range(result, min_val, max_val);
                            let formula = FormulaSpec::new(
                                format!("{}_{}_{}+{}_mod{}", f1_name, f2_name, op1_name, op2_name, mod_val),
                                format!("{},{}", f1_name, f2_name),
                                vec![format!("{}+{}", op1_name, op2_name)],
                                vec![mod_val],
                                target_range,
                            );
                            candidates.push(FormulaCandidate::new(formula, mapped));
                        }
                    }
                }
            }
            
            if candidates.len() >= max_candidates as usize {
                candidates.truncate(max_candidates as usize);
                return candidates;
            }
        }
    }
    
    // ==================== 第八步：四特征组合 ====================
    // 使用配置的特征数量做四组合
    let quad_features: Vec<_> = feature_list.iter().take(quad_combo_features.min(n_features)).collect();
    // 四特征运算列表
    let quad_ops: Vec<(&str, fn(i32, i32, i32, i32) -> i32)> = vec![
        ("四加", |a, b, c, d| a + b + c + d),
        ("四乘", |a, b, c, d| a * b * c * d),
        ("混合", |a, b, c, d| a * b + c * d),
    ];
    let quad_mod_values: Vec<i32> = vec![range_size, 8, 9, 10, 12, 16, 24, 33];
    
    for i in 0..quad_features.len() {
        for j in (i + 1)..quad_features.len() {
            for k in (j + 1)..quad_features.len() {
                for l in (k + 1)..quad_features.len() {
                    let (f1_name, &f1_val) = quad_features[i];
                    let (f2_name, &f2_val) = quad_features[j];
                    let (f3_name, &f3_val) = quad_features[k];
                    let (f4_name, &f4_val) = quad_features[l];
                    
                    for (op_name, op_func) in &quad_ops {
                        for &mod_val in &quad_mod_values {
                            if mod_val <= 0 {
                                continue;
                            }
                            
                            let result = op_func(f1_val, f2_val, f3_val, f4_val) % mod_val;
                            if result > 0 {
                                let mapped = map_to_range(result, min_val, max_val);
                                let formula = FormulaSpec::new(
                                    format!("{}_{}_{}_{}_{}_mod{}", f1_name, f2_name, f3_name, f4_name, op_name, mod_val),
                                    format!("{},{},{},{}", f1_name, f2_name, f3_name, f4_name),
                                    vec![op_name.to_string(), "mod".to_string()],
                                    vec![0, mod_val],
                                    target_range,
                                );
                                candidates.push(FormulaCandidate::new(formula, mapped));
                            }
                        }
                    }
                    
                    if candidates.len() >= max_candidates as usize {
                        candidates.truncate(max_candidates as usize);
                        return candidates;
                    }
                }
            }
        }
    }
    
    // ==================== 第九步：嵌套运算（三特征） ====================
    // (A op B) op C 形式的嵌套运算
    let nested_ops: Vec<(&str, &str)> = vec![
        ("加", "乘"),  // (A+B)*C
        ("乘", "加"),  // (A*B)+C
        ("减", "乘"),  // (A-B)*C
        ("加", "减"),  // (A+B)-C
        ("乘", "减"),  // (A*B)-C
        ("减", "加"),  // (A-B)+C
    ];
    let nested_mod_values: Vec<i32> = vec![range_size, 8, 9, 10, 12, 16, 24, 33];
    
    let nested_features: Vec<_> = feature_list.iter().take(nested_op_features.min(n_features)).collect();
    for i in 0..nested_features.len() {
        for j in 0..nested_features.len() {
            if i == j {
                continue;
            }
            for k in 0..nested_features.len() {
                if k == i || k == j {
                    continue;
                }
                
                let (f1_name, &f1_val) = nested_features[i];
                let (f2_name, &f2_val) = nested_features[j];
                let (f3_name, &f3_val) = nested_features[k];
                
                for (op1, op2) in &nested_ops {
                    for &mod_val in &nested_mod_values {
                        if mod_val <= 0 {
                            continue;
                        }
                        
                        // 第一步运算
                        let temp = match *op1 {
                            "加" => f1_val + f2_val,
                            "减" => (f1_val - f2_val).abs(),
                            "乘" => f1_val * f2_val,
                            _ => continue,
                        };
                        
                        // 第二步运算
                        let result = match *op2 {
                            "加" => (temp + f3_val) % mod_val,
                            "减" => (temp - f3_val).abs() % mod_val,
                            "乘" => (temp * f3_val) % mod_val,
                            _ => continue,
                        };
                        
                        if result > 0 {
                            let mapped = map_to_range(result, min_val, max_val);
                            let op_name = format!("嵌套{}{}", op1, op2);
                            let formula = FormulaSpec::new(
                                format!("{}_{}_{}_{}_mod{}", f1_name, f2_name, f3_name, op_name, mod_val),
                                format!("{},{},{}", f1_name, f2_name, f3_name),
                                vec![op_name.clone(), "mod".to_string()],
                                vec![0, mod_val],
                                target_range,
                            );
                            candidates.push(FormulaCandidate::new(formula, mapped));
                        }
                    }
                }
                
                if candidates.len() >= max_candidates as usize {
                    candidates.truncate(max_candidates as usize);
                    return candidates;
                }
            }
        }
    }
    
    // ==================== 第十步：特殊组合 ====================
    // 定义一些有玄学意义的特殊特征组合
    let special_combos: Vec<(&str, &str, &str)> = vec![
        // 卦象组合
        ("ben_gua_sum", "bian_gua_sum", "加"),    // 本卦变卦和
        ("ben_gua_sum", "hu_gua_sum", "加"),    // 本卦互卦和
        ("ben_gua_product", "bian_gua_product", "加"),  // 本卦变卦积和
        // 能量相关
        ("ti_energy", "yong_energy", "加"),     // 体用能量和
        ("ti_energy", "yong_energy", "减"),     // 体用能量差
        ("total_energy", "adjusted_energy", "加"),  // 总能量
        // 天干地支
        ("day_stem", "day_branch", "加"),        // 日干支和
        // 五行
        ("wuxing_ben_shang", "wuxing_ben_xia", "加"),  // 本卦五行和
        ("wuxing_ben_shang", "wuxing_bian_shang", "减"),  // 五行变化
        // 先后天数
        ("xiantian_ben_shang", "houtian_ben_shang", "加"),  // 先后天和
        ("xiantian_ben_shang", "houtian_ben_shang", "减"),  // 先后天差
        // 纳甲
        ("najia_ben_shang", "najia_bian_shang", "加"),  // 纳甲和
        // 河图洛书
        ("hetu_shang_sum", "luoshu_ben", "加"),  // 河图洛书和
        // 太乙奇门六壬
        ("taiyi_num_v4", "qimen_num_v4", "加"),  // 太乙奇门和
        ("liuren_num_v4", "qimen_num_v4", "加"),  // 六壬奇门和
        ("taiyi_num_v4", "liuren_num_v4", "加"),  // 太乙六壬和
    ];
    
    for (f1_key, f2_key, op) in &special_combos {
        let f1_val = valid_features.get(*f1_key);
        let f2_val = valid_features.get(*f2_key);
        
        if f1_val.is_none() || f2_val.is_none() {
            continue;
        }
        
        let f1_val = f1_val.unwrap();
        let f2_val = f2_val.unwrap();
        
        for &mod_val in &[range_size, 8, 9, 10, 12, 16, 24, 33, 60, 64] {
            if mod_val <= 0 {
                continue;
            }
            
            let result = match *op {
                "加" => (f1_val + f2_val) % mod_val,
                "减" => (f1_val - f2_val).abs() % mod_val,
                "乘" => (f1_val * f2_val) % mod_val,
                _ => continue,
            };
            
            if result > 0 {
                let mapped = map_to_range(result, min_val, max_val);
                let formula = FormulaSpec::new(
                    format!("{}_{}_{}_mod{}", f1_key, f2_key, op, mod_val),
                    format!("{},{}", f1_key, f2_key),
                    vec![op.to_string(), "mod".to_string()],
                    vec![0, mod_val],
                    target_range,
                );
                candidates.push(FormulaCandidate::new(formula, mapped));
            }
        }
    }
    
    // 去重
    candidates.sort_by(|a, b| a.formula.formula_id.cmp(&b.formula.formula_id));
    candidates.dedup_by(|a, b| a.formula.formula_id == b.formula.formula_id);
    
    // 限制数量
    if candidates.len() > max_candidates as usize {
        candidates.truncate(max_candidates as usize);
    }
    
    candidates
}

/// 检查操作是否启用
fn is_operation_enabled(op_name: &str, config: &GuaConfig) -> bool {
    match op_name {
        "add" | "sub" | "mul" | "div" => config.enable_basic_ops,
        "mod" | "mod_add" => config.enable_mod_ops,
        "shift_left" | "shift_right" => config.enable_shift_ops,
        "bagua_transform" | "wuxing_transform" | "hetu_transform" | "najia_transform" => config.enable_special_ops,
        _ => true,  // 其他操作默认启用
    }
}

/// 特征提取器函数类型
pub type FeatureExtractor = fn(&HashMap<String, i32>) -> i32;

/// 数学操作函数类型
pub type MathOperation = fn(i32, i32) -> i32;

/// 特征提取器辅助宏
macro_rules! make_extractor {
    ($name:expr) => {
        |features: &HashMap<String, i32>| {
            features.get($name).copied().unwrap_or(0)
        }
    };
}

/// 获取启用的特征提取器列表
pub fn get_enabled_extractors(_config: &GuaConfig) -> Vec<(String, FeatureExtractor)> {
    vec![
        // 基础卦象特征
        ("ben_gua_num".to_string(), make_extractor!("ben_gua_num")),
        ("ben_gua_xiantian".to_string(), make_extractor!("ben_gua_xiantian")),
        ("ben_gua_houtian".to_string(), make_extractor!("ben_gua_houtian")),
        ("ben_gua_wuxing_num".to_string(), make_extractor!("ben_gua_wuxing_num")),
        ("ben_gua_upper_num".to_string(), make_extractor!("ben_gua_upper_num")),
        ("ben_gua_lower_num".to_string(), make_extractor!("ben_gua_lower_num")),
        ("ben_gua_sum".to_string(), make_extractor!("ben_gua_sum")),
        ("ben_gua_product".to_string(), make_extractor!("ben_gua_product")),
        ("ben_gua_diff".to_string(), make_extractor!("ben_gua_diff")),
        ("ben_gua_64".to_string(), make_extractor!("ben_gua_64")),
        
        // 变卦特征
        ("bian_gua_num".to_string(), make_extractor!("bian_gua_num")),
        ("bian_gua_xiantian".to_string(), make_extractor!("bian_gua_xiantian")),
        ("bian_gua_houtian".to_string(), make_extractor!("bian_gua_houtian")),
        ("bian_gua_wuxing_num".to_string(), make_extractor!("bian_gua_wuxing_num")),
        ("bian_gua_upper_num".to_string(), make_extractor!("bian_gua_upper_num")),
        ("bian_gua_lower_num".to_string(), make_extractor!("bian_gua_lower_num")),
        ("bian_gua_sum".to_string(), make_extractor!("bian_gua_sum")),
        ("bian_gua_product".to_string(), make_extractor!("bian_gua_product")),
        ("bian_gua_diff".to_string(), make_extractor!("bian_gua_diff")),
        ("bian_gua_64".to_string(), make_extractor!("bian_gua_64")),
        
        // 互卦特征
        ("hu_gua_num".to_string(), make_extractor!("hu_gua_num")),
        ("hu_gua_xiantian".to_string(), make_extractor!("hu_gua_xiantian")),
        ("hu_gua_houtian".to_string(), make_extractor!("hu_gua_houtian")),
        ("hu_gua_wuxing_num".to_string(), make_extractor!("hu_gua_wuxing_num")),
        ("hu_gua_upper_num".to_string(), make_extractor!("hu_gua_upper_num")),
        ("hu_gua_lower_num".to_string(), make_extractor!("hu_gua_lower_num")),
        ("hu_gua_sum".to_string(), make_extractor!("hu_gua_sum")),
        ("hu_gua_product".to_string(), make_extractor!("hu_gua_product")),
        ("hu_gua_diff".to_string(), make_extractor!("hu_gua_diff")),
        ("hu_gua_64".to_string(), make_extractor!("hu_gua_64")),
        
        // 变爻特征
        ("bian_yao_pos".to_string(), make_extractor!("bian_yao_pos")),
        ("bian_yao_num".to_string(), make_extractor!("bian_yao_num")),
        ("bian_yao".to_string(), make_extractor!("bian_yao")),
        ("yang_count".to_string(), make_extractor!("yang_count")),
        ("yin_count".to_string(), make_extractor!("yin_count")),
        ("liu_yao".to_string(), make_extractor!("liu_yao")),
        
        // 时间特征
        ("lunar_year".to_string(), make_extractor!("lunar_year")),
        ("lunar_month".to_string(), make_extractor!("lunar_month")),
        ("lunar_day".to_string(), make_extractor!("lunar_day")),
        ("lunar_hour".to_string(), make_extractor!("lunar_hour")),
        
        // 天干特征
        ("year_tiangan".to_string(), make_extractor!("year_tiangan")),
        ("month_tiangan".to_string(), make_extractor!("month_tiangan")),
        ("day_tiangan".to_string(), make_extractor!("day_tiangan")),
        ("hour_tiangan".to_string(), make_extractor!("hour_tiangan")),
        ("day_stem".to_string(), make_extractor!("day_stem")),
        
        // 地支特征
        ("year_dizhi".to_string(), make_extractor!("year_dizhi")),
        ("month_dizhi".to_string(), make_extractor!("month_dizhi")),
        ("day_dizhi".to_string(), make_extractor!("day_dizhi")),
        ("hour_dizhi".to_string(), make_extractor!("hour_dizhi")),
        ("day_branch".to_string(), make_extractor!("day_branch")),
        
        // 五行特征
        ("year_wuxing_num".to_string(), make_extractor!("year_wuxing_num")),
        ("month_wuxing_num".to_string(), make_extractor!("month_wuxing_num")),
        ("day_wuxing_num".to_string(), make_extractor!("day_wuxing_num")),
        ("hour_wuxing_num".to_string(), make_extractor!("hour_wuxing_num")),
        
        // 组合特征
        ("year_month_sum".to_string(), make_extractor!("year_month_sum")),
        ("day_hour_sum".to_string(), make_extractor!("day_hour_sum")),
        ("year_day_sum".to_string(), make_extractor!("year_day_sum")),
        ("month_hour_sum".to_string(), make_extractor!("month_hour_sum")),
        ("bazi_sum".to_string(), make_extractor!("bazi_sum")),
    ]
}

/// 获取启用的数学操作列表
pub fn get_enabled_operations(_config: &GuaConfig) -> Vec<(String, MathOperation)> {
    vec![
        ("add".to_string(), |v, p| v + p),
        ("sub".to_string(), |v, p| v - p),
        ("mul".to_string(), |v, p| v * p),
        ("div".to_string(), |v, p| if p != 0 { v / p } else { v }),
        ("mod".to_string(), |v, p| if p > 0 { ((v % p) + p) % p } else { v }),
        ("mod_add".to_string(), |v, p| if p > 0 { ((v % p) + p) % p + 1 } else { v }),
        ("abs".to_string(), |v, _| v.abs()),
        ("neg".to_string(), |v, _| -v),
        ("square".to_string(), |v, _| v * v),
    ]
}
