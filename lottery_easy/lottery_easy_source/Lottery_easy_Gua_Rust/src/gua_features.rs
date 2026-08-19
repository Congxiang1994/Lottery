//! gua_features.rs - 卦象特征计算模块（完整版 v5.0）
//!
//! 本模块实现基于周易时间起卦法的卦象特征计算。
//! 包括：
//! - 时间起卦（年月日时）
//! - 卦象生成（本卦、变卦、互卦）
//! - 特征提取（各种卦象数值特征）
//! - 高级玄学特征（皇极、太乙、奇门、六壬、紫微、铁板等）
//!
//! 重要说明：
//! ==========
//! 本文件完全对应Python版本的calculate_time_gua函数，
//! 包含所有高级玄学特征，确保功能一致性。

#![allow(dead_code)]
#![allow(unused_variables)]
#![allow(unused_parens)]

use std::collections::HashMap;
use chrono::{DateTime, Local, Datelike, Timelike};
use serde::{Serialize, Deserialize};
use crate::constants::*;

/// 卦象数据结构（完整版）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuaData {
    // ==================== 基础卦象信息 ====================
    /// 本卦名称
    pub ben_gua_name: String,
    /// 本卦上卦
    pub ben_gua_upper: String,
    /// 本卦下卦
    pub ben_gua_lower: String,
    /// 本卦数字
    pub ben_gua_num: i32,
    /// 本卦先天数
    pub ben_gua_xiantian: i32,
    /// 本卦后天数
    pub ben_gua_houtian: i32,
    /// 本卦五行
    pub ben_gua_wuxing: String,
    /// 本卦五行数
    pub ben_gua_wuxing_num: i32,
    
    /// 变卦名称
    pub bian_gua_name: String,
    /// 变卦上卦
    pub bian_gua_upper: String,
    /// 变卦下卦
    pub bian_gua_lower: String,
    /// 变卦数字
    pub bian_gua_num: i32,
    /// 变卦先天数
    pub bian_gua_xiantian: i32,
    /// 变卦后天数
    pub bian_gua_houtian: i32,
    /// 变卦五行
    pub bian_gua_wuxing: String,
    /// 变卦五行数
    pub bian_gua_wuxing_num: i32,
    
    /// 互卦名称
    pub hu_gua_name: String,
    /// 互卦上卦
    pub hu_gua_upper: String,
    /// 互卦下卦
    pub hu_gua_lower: String,
    /// 互卦数字
    pub hu_gua_num: i32,
    /// 互卦先天数
    pub hu_gua_xiantian: i32,
    /// 互卦后天数
    pub hu_gua_houtian: i32,
    /// 互卦五行
    pub hu_gua_wuxing: String,
    /// 互卦五行数
    pub hu_gua_wuxing_num: i32,
    
    /// 变爻位置（1-6）
    pub bian_yao_pos: i32,
    /// 变爻数字
    pub bian_yao_num: i32,
    
    // ==================== 时间信息 ====================
    /// 农历年
    pub lunar_year: i32,
    /// 农历月
    pub lunar_month: i32,
    /// 农历日
    pub lunar_day: i32,
    /// 农历时辰
    pub lunar_hour: i32,
    
    // ==================== 天干地支 ====================
    /// 年干支
    pub year_ganzhi: String,
    /// 月干支
    pub month_ganzhi: String,
    /// 日干支
    pub day_ganzhi: String,
    /// 时干支
    pub hour_ganzhi: String,
    
    /// 年天干数
    pub year_tiangan: i32,
    /// 月天干数
    pub month_tiangan: i32,
    /// 日天干数
    pub day_tiangan: i32,
    /// 时天干数
    pub hour_tiangan: i32,
    
    /// 年地支数
    pub year_dizhi: i32,
    /// 月地支数
    pub month_dizhi: i32,
    /// 日地支数
    pub day_dizhi: i32,
    /// 时地支数
    pub hour_dizhi: i32,
    
    // ==================== 五行信息 ====================
    /// 年五行
    pub year_wuxing: String,
    /// 月五行
    pub month_wuxing: String,
    /// 日五行
    pub day_wuxing: String,
    /// 时五行
    pub hour_wuxing: String,
    
    // ==================== 季节月相 ====================
    /// 季节
    pub season: String,
    /// 月相
    pub moon_phase: String,
    /// 月相能量
    pub moon_energy: i32,
    
    // ==================== 高级玄学特征 ====================
    /// 卦象指数
    pub gua_index: i32,
    /// 阴阳平衡度
    pub yinyang_balance: i32,
    /// 变爻影响力
    pub bian_yao_power: i32,
    /// 总能量
    pub total_energy: i32,
    /// 体能量
    pub ti_energy: i32,
    /// 用能量
    pub yong_energy: i32,
    /// 调整后能量
    pub adjusted_energy: i32,
    /// 玄学评分
    pub metaphysics_score: i32,
}

impl Default for GuaData {
    fn default() -> Self {
        GuaData {
            ben_gua_name: "乾".to_string(),
            ben_gua_upper: "乾".to_string(),
            ben_gua_lower: "乾".to_string(),
            ben_gua_num: 1,
            ben_gua_xiantian: 1,
            ben_gua_houtian: 4,
            ben_gua_wuxing: "金".to_string(),
            ben_gua_wuxing_num: 1,
            bian_gua_name: "乾".to_string(),
            bian_gua_upper: "乾".to_string(),
            bian_gua_lower: "乾".to_string(),
            bian_gua_num: 1,
            bian_gua_xiantian: 1,
            bian_gua_houtian: 4,
            bian_gua_wuxing: "金".to_string(),
            bian_gua_wuxing_num: 1,
            hu_gua_name: "乾".to_string(),
            hu_gua_upper: "乾".to_string(),
            hu_gua_lower: "乾".to_string(),
            hu_gua_num: 1,
            hu_gua_xiantian: 1,
            hu_gua_houtian: 4,
            hu_gua_wuxing: "金".to_string(),
            hu_gua_wuxing_num: 1,
            bian_yao_pos: 1,
            bian_yao_num: 1,
            lunar_year: 2024,
            lunar_month: 1,
            lunar_day: 1,
            lunar_hour: 1,
            year_ganzhi: "甲子".to_string(),
            month_ganzhi: "甲子".to_string(),
            day_ganzhi: "甲子".to_string(),
            hour_ganzhi: "甲子".to_string(),
            year_tiangan: 1,
            month_tiangan: 1,
            day_tiangan: 1,
            hour_tiangan: 1,
            year_dizhi: 1,
            month_dizhi: 1,
            day_dizhi: 1,
            hour_dizhi: 1,
            year_wuxing: "木".to_string(),
            month_wuxing: "木".to_string(),
            day_wuxing: "木".to_string(),
            hour_wuxing: "木".to_string(),
            season: "春".to_string(),
            moon_phase: "朔".to_string(),
            moon_energy: 1,
            gua_index: 1,
            yinyang_balance: 0,
            bian_yao_power: 6,
            total_energy: 10,
            ti_energy: 5,
            yong_energy: 5,
            adjusted_energy: 10,
            metaphysics_score: 50,
        }
    }
}

impl GuaData {
    /// 将卦象数据转换为特征字典（完整版）
    /// 
    /// 包含所有Python版本的特征，确保功能一致性
    pub fn to_features(&self) -> HashMap<String, i32> {
        let mut features = HashMap::new();
        
        // ==================== 基础卦象特征 ====================
        features.insert("ben_gua_num".to_string(), self.ben_gua_num);
        features.insert("ben_gua_xiantian".to_string(), self.ben_gua_xiantian);
        features.insert("ben_gua_houtian".to_string(), self.ben_gua_houtian);
        features.insert("ben_gua_wuxing_num".to_string(), self.ben_gua_wuxing_num);
        features.insert("ben_gua_upper_num".to_string(), get_bagua_num(&self.ben_gua_upper));
        features.insert("ben_gua_lower_num".to_string(), get_bagua_num(&self.ben_gua_lower));
        
        // ==================== 变卦特征 ====================
        features.insert("bian_gua_num".to_string(), self.bian_gua_num);
        features.insert("bian_gua_xiantian".to_string(), self.bian_gua_xiantian);
        features.insert("bian_gua_houtian".to_string(), self.bian_gua_houtian);
        features.insert("bian_gua_wuxing_num".to_string(), self.bian_gua_wuxing_num);
        features.insert("bian_gua_upper_num".to_string(), get_bagua_num(&self.bian_gua_upper));
        features.insert("bian_gua_lower_num".to_string(), get_bagua_num(&self.bian_gua_lower));
        
        // ==================== 互卦特征 ====================
        features.insert("hu_gua_num".to_string(), self.hu_gua_num);
        features.insert("hu_gua_xiantian".to_string(), self.hu_gua_xiantian);
        features.insert("hu_gua_houtian".to_string(), self.hu_gua_houtian);
        features.insert("hu_gua_wuxing_num".to_string(), self.hu_gua_wuxing_num);
        features.insert("hu_gua_upper_num".to_string(), get_bagua_num(&self.hu_gua_upper));
        features.insert("hu_gua_lower_num".to_string(), get_bagua_num(&self.hu_gua_lower));
        
        // ==================== 变爻特征 ====================
        features.insert("bian_yao_pos".to_string(), self.bian_yao_pos);
        features.insert("bian_yao_num".to_string(), self.bian_yao_num);
        
        // ==================== 时间特征 ====================
        features.insert("lunar_year".to_string(), self.lunar_year);
        features.insert("lunar_month".to_string(), self.lunar_month);
        features.insert("lunar_day".to_string(), self.lunar_day);
        features.insert("lunar_hour".to_string(), self.lunar_hour);
        
        // ==================== 天干特征 ====================
        features.insert("year_tiangan".to_string(), self.year_tiangan);
        features.insert("month_tiangan".to_string(), self.month_tiangan);
        features.insert("day_tiangan".to_string(), self.day_tiangan);
        features.insert("hour_tiangan".to_string(), self.hour_tiangan);
        
        // ==================== 地支特征 ====================
        features.insert("year_dizhi".to_string(), self.year_dizhi);
        features.insert("month_dizhi".to_string(), self.month_dizhi);
        features.insert("day_dizhi".to_string(), self.day_dizhi);
        features.insert("hour_dizhi".to_string(), self.hour_dizhi);
        
        // ==================== 五行特征 ====================
        features.insert("year_wuxing_num".to_string(), get_wuxing_num(&self.year_wuxing));
        features.insert("month_wuxing_num".to_string(), get_wuxing_num(&self.month_wuxing));
        features.insert("day_wuxing_num".to_string(), get_wuxing_num(&self.day_wuxing));
        features.insert("hour_wuxing_num".to_string(), get_wuxing_num(&self.hour_wuxing));
        
        // ==================== 组合特征 ====================
        features.insert("year_month_sum".to_string(), self.year_tiangan + self.month_tiangan);
        features.insert("day_hour_sum".to_string(), self.day_tiangan + self.hour_tiangan);
        features.insert("year_day_sum".to_string(), self.year_dizhi + self.day_dizhi);
        features.insert("month_hour_sum".to_string(), self.month_dizhi + self.hour_dizhi);
        
        // ==================== 卦象组合特征 ====================
        features.insert("ben_bian_sum".to_string(), self.ben_gua_num + self.bian_gua_num);
        features.insert("ben_hu_sum".to_string(), self.ben_gua_num + self.hu_gua_num);
        features.insert("bian_hu_sum".to_string(), self.bian_gua_num + self.hu_gua_num);
        features.insert("three_gua_sum".to_string(), self.ben_gua_num + self.bian_gua_num + self.hu_gua_num);
        
        // ==================== 卦象乘积特征 ====================
        features.insert("ben_bian_product".to_string(), self.ben_gua_num * self.bian_gua_num);
        features.insert("ben_hu_product".to_string(), self.ben_gua_num * self.hu_gua_num);
        features.insert("bian_hu_product".to_string(), self.bian_gua_num * self.hu_gua_num);
        
        // ==================== 季节月相特征 ====================
        features.insert("moon_energy".to_string(), self.moon_energy);
        
        // ==================== 能量特征 ====================
        features.insert("total_energy".to_string(), self.total_energy);
        features.insert("ti_energy".to_string(), self.ti_energy);
        features.insert("yong_energy".to_string(), self.yong_energy);
        features.insert("adjusted_energy".to_string(), self.adjusted_energy);
        features.insert("metaphysics_score".to_string(), self.metaphysics_score);
        
        // ==================== 河图特征 ====================
        let (hetu1, hetu2) = get_hetu_num(&self.ben_gua_wuxing);
        features.insert("ben_gua_hetu1".to_string(), hetu1);
        features.insert("ben_gua_hetu2".to_string(), hetu2);
        
        let (hetu1, hetu2) = get_hetu_num(&self.bian_gua_wuxing);
        features.insert("bian_gua_hetu1".to_string(), hetu1);
        features.insert("bian_gua_hetu2".to_string(), hetu2);
        
        let (hetu1, hetu2) = get_hetu_num(&self.hu_gua_wuxing);
        features.insert("hu_gua_hetu1".to_string(), hetu1);
        features.insert("hu_gua_hetu2".to_string(), hetu2);
        
        // ==================== 纳甲特征 ====================
        let najia_t = get_najia_tiangan(&self.ben_gua_name);
        let najia_d = get_najia_dizhi(&self.ben_gua_name);
        features.insert("ben_gua_najia_t1".to_string(), get_tiangan_num(najia_t[0]));
        features.insert("ben_gua_najia_t6".to_string(), get_tiangan_num(najia_t[5]));
        features.insert("ben_gua_najia_d1".to_string(), get_dizhi_num(najia_d[0]));
        features.insert("ben_gua_najia_d6".to_string(), get_dizhi_num(najia_d[5]));
        
        // ==================== 五行旺衰特征 ====================
        let season = get_season_with_ji(self.lunar_month);
        features.insert("ben_gua_wangshuai".to_string(), get_wuxing_wangshuai(season, &self.ben_gua_wuxing));
        features.insert("bian_gua_wangshuai".to_string(), get_wuxing_wangshuai(season, &self.bian_gua_wuxing));
        features.insert("hu_gua_wangshuai".to_string(), get_wuxing_wangshuai(season, &self.hu_gua_wuxing));
        
        // ==================== 二进制特征 ====================
        let (b1, b2, b3) = get_bagua_binary(&self.ben_gua_name);
        features.insert("ben_gua_yao1".to_string(), b1);
        features.insert("ben_gua_yao2".to_string(), b2);
        features.insert("ben_gua_yao3".to_string(), b3);
        
        let (b1, b2, b3) = get_bagua_binary(&self.bian_gua_name);
        features.insert("bian_gua_yao1".to_string(), b1);
        features.insert("bian_gua_yao2".to_string(), b2);
        features.insert("bian_gua_yao3".to_string(), b3);
        
        // ==================== 高级玄学特征（与Python版本一致） ====================
        // 基础卦象组合
        let ben_gua_shang = get_bagua_num(&self.ben_gua_upper);
        let ben_gua_xia = get_bagua_num(&self.ben_gua_lower);
        let bian_gua_shang = get_bagua_num(&self.bian_gua_upper);
        let bian_gua_xia = get_bagua_num(&self.bian_gua_lower);
        let hu_gua_shang = get_bagua_num(&self.hu_gua_upper);
        let hu_gua_xia = get_bagua_num(&self.hu_gua_lower);
        
        // 卦象和与积
        let ben_gua_sum = ben_gua_shang + ben_gua_xia;
        let ben_gua_product = ben_gua_shang * ben_gua_xia;
        let bian_gua_sum = bian_gua_shang + bian_gua_xia;
        let bian_gua_product = bian_gua_shang * bian_gua_xia;
        let hu_gua_sum = hu_gua_shang + hu_gua_xia;
        let hu_gua_product = hu_gua_shang * hu_gua_xia;
        
        features.insert("ben_gua_sum".to_string(), ben_gua_sum);
        features.insert("ben_gua_product".to_string(), ben_gua_product);
        features.insert("ben_gua_diff".to_string(), (ben_gua_shang - ben_gua_xia).abs());
        features.insert("bian_gua_sum".to_string(), bian_gua_sum);
        features.insert("bian_gua_product".to_string(), bian_gua_product);
        features.insert("bian_gua_diff".to_string(), (bian_gua_shang - bian_gua_xia).abs());
        features.insert("hu_gua_sum".to_string(), hu_gua_sum);
        features.insert("hu_gua_product".to_string(), hu_gua_product);
        features.insert("hu_gua_diff".to_string(), (hu_gua_shang - hu_gua_xia).abs());
        features.insert("total_gua_sum".to_string(), ben_gua_sum + bian_gua_sum + hu_gua_sum);
        
        // 六十四卦数
        let ben_gua_64 = ben_gua_shang * 10 + ben_gua_xia;
        let bian_gua_64 = bian_gua_shang * 10 + bian_gua_xia;
        let hu_gua_64 = hu_gua_shang * 10 + hu_gua_xia;
        features.insert("ben_gua_64".to_string(), ben_gua_64);
        features.insert("bian_gua_64".to_string(), bian_gua_64);
        features.insert("hu_gua_64".to_string(), hu_gua_64);
        
        // 八字总和
        let bazi_sum = self.year_tiangan + self.year_dizhi + self.month_tiangan + 
                       self.month_dizhi + self.day_tiangan + self.day_dizhi + 
                       self.hour_tiangan + self.hour_dizhi;
        features.insert("bazi_sum".to_string(), bazi_sum);
        
        // 先天数与后天数
        let xiantian_ben_shang = get_xiantian_num(&self.ben_gua_upper);
        let xiantian_ben_xia = get_xiantian_num(&self.ben_gua_lower);
        let xiantian_bian_shang = get_xiantian_num(&self.bian_gua_upper);
        let xiantian_bian_xia = get_xiantian_num(&self.bian_gua_lower);
        let xiantian_hu_shang = get_xiantian_num(&self.hu_gua_upper);
        let xiantian_hu_xia = get_xiantian_num(&self.hu_gua_lower);
        
        features.insert("xiantian_ben_shang".to_string(), xiantian_ben_shang);
        features.insert("xiantian_ben_xia".to_string(), xiantian_ben_xia);
        features.insert("xiantian_bian_shang".to_string(), xiantian_bian_shang);
        features.insert("xiantian_bian_xia".to_string(), xiantian_bian_xia);
        features.insert("xiantian_hu_shang".to_string(), xiantian_hu_shang);
        features.insert("xiantian_hu_xia".to_string(), xiantian_hu_xia);
        features.insert("xiantian_sum".to_string(), xiantian_ben_shang + xiantian_ben_xia + 
                       xiantian_bian_shang + xiantian_bian_xia + xiantian_hu_shang + xiantian_hu_xia);
        
        let houtian_ben_shang = get_houtian_num(&self.ben_gua_upper);
        let houtian_ben_xia = get_houtian_num(&self.ben_gua_lower);
        let houtian_bian_shang = get_houtian_num(&self.bian_gua_upper);
        let houtian_bian_xia = get_houtian_num(&self.bian_gua_lower);
        let houtian_hu_shang = get_houtian_num(&self.hu_gua_upper);
        let houtian_hu_xia = get_houtian_num(&self.hu_gua_lower);
        
        features.insert("houtian_ben_shang".to_string(), houtian_ben_shang);
        features.insert("houtian_ben_xia".to_string(), houtian_ben_xia);
        features.insert("houtian_bian_shang".to_string(), houtian_bian_shang);
        features.insert("houtian_bian_xia".to_string(), houtian_bian_xia);
        features.insert("houtian_hu_shang".to_string(), houtian_hu_shang);
        features.insert("houtian_hu_xia".to_string(), houtian_hu_xia);
        
        // 五行数
        let wuxing_ben_shang = get_wuxing_num(&get_bagua_wuxing(&self.ben_gua_upper));
        let wuxing_ben_xia = get_wuxing_num(&get_bagua_wuxing(&self.ben_gua_lower));
        let wuxing_bian_shang = get_wuxing_num(&get_bagua_wuxing(&self.bian_gua_upper));
        let wuxing_bian_xia = get_wuxing_num(&get_bagua_wuxing(&self.bian_gua_lower));
        let wuxing_hu_shang = get_wuxing_num(&get_bagua_wuxing(&self.hu_gua_upper));
        let wuxing_hu_xia = get_wuxing_num(&get_bagua_wuxing(&self.hu_gua_lower));
        
        features.insert("wuxing_ben_shang".to_string(), wuxing_ben_shang);
        features.insert("wuxing_ben_xia".to_string(), wuxing_ben_xia);
        features.insert("wuxing_bian_shang".to_string(), wuxing_bian_shang);
        features.insert("wuxing_bian_xia".to_string(), wuxing_bian_xia);
        features.insert("wuxing_hu_shang".to_string(), wuxing_hu_shang);
        features.insert("wuxing_hu_xia".to_string(), wuxing_hu_xia);
        features.insert("wuxing_flow".to_string(), (wuxing_ben_shang + wuxing_ben_xia + 
                       wuxing_bian_shang + wuxing_bian_xia) % 10);
        
        // 能量值计算
        let bian_shang_energy = xiantian_bian_shang + houtian_bian_shang + wuxing_bian_shang;
        let bian_xia_energy = xiantian_bian_xia + houtian_bian_xia + wuxing_bian_xia;
        let hu_shang_energy = xiantian_hu_shang + houtian_hu_shang + wuxing_hu_shang;
        let hu_xia_energy = xiantian_hu_xia + houtian_hu_xia + wuxing_hu_xia;
        
        features.insert("bian_shang_energy".to_string(), bian_shang_energy);
        features.insert("bian_xia_energy".to_string(), bian_xia_energy);
        features.insert("hu_shang_energy".to_string(), hu_shang_energy);
        features.insert("hu_xia_energy".to_string(), hu_xia_energy);
        
        // 河图数
        let hetu_shang_sum = get_hetu_sum(&get_bagua_wuxing(&self.ben_gua_upper));
        let hetu_xia_sum = get_hetu_sum(&get_bagua_wuxing(&self.ben_gua_lower));
        features.insert("hetu_shang_sum".to_string(), hetu_shang_sum);
        features.insert("hetu_xia_sum".to_string(), hetu_xia_sum);
        
        // 纳甲数
        features.insert("najia_ben_shang".to_string(), get_najia_num(&self.ben_gua_upper));
        features.insert("najia_ben_xia".to_string(), get_najia_num(&self.ben_gua_lower));
        features.insert("najia_bian_shang".to_string(), get_najia_num(&self.bian_gua_upper));
        features.insert("najia_bian_xia".to_string(), get_najia_num(&self.bian_gua_lower));
        
        // 六神
        features.insert("liushen".to_string(), calculate_liushen(self.day_tiangan, self.bian_yao_pos));
        
        // 卦象指数
        features.insert("gua_index".to_string(), (ben_gua_sum * bian_gua_sum + hu_gua_sum) % 64 + 1);
        features.insert("yinyang_balance".to_string(), self.yinyang_balance);
        features.insert("bian_yao_power".to_string(), self.bian_yao_pos * (7 - self.bian_yao_pos));
        
        // ==================== 皇极秘数特征 ====================
        features.insert("huangji_sum".to_string(), 
            ((self.lunar_year / 129600) % 12 + 1) + 
            ((self.lunar_year / 10800) % 30 + 1) + 
            ((self.lunar_year / 360) % 360 + 1) + 
            ((self.lunar_year / 30) % 30 + 1));
        features.insert("huangji_gua".to_string(), (ben_gua_64 * self.bian_yao_pos + bazi_sum) % 129600);
        
        // ==================== 太乙神数特征 ====================
        let taiyi_jiyear = 10153917 + self.lunar_year;
        features.insert("taiyi_wenchang".to_string(), (self.lunar_month + self.lunar_day) % 16 + 1);
        features.insert("taiyi_gong".to_string(), (ben_gua_sum + self.bian_yao_pos) % 9 + 1);
        features.insert("taiyi_num".to_string(), (ben_gua_64 * 16 + self.bian_yao_pos * 9 + bazi_sum) % 360);
        features.insert("taiyi_gong_precise".to_string(), (taiyi_jiyear % 9) + 1);
        features.insert("taiyi_wenchang_precise".to_string(), (self.lunar_month * 30 + self.lunar_day) % 16 + 1);
        features.insert("taiyi_zhumu".to_string(), (taiyi_jiyear % 72) + 1);
        features.insert("taiyi_kemu".to_string(), ((taiyi_jiyear + self.lunar_month) % 72) + 1);
        features.insert("taiyi_precise".to_string(), 
            ((taiyi_jiyear % 72) + 1) * 100 + ((self.lunar_month * 30 + self.lunar_day) % 16 + 1) * 10 + (taiyi_jiyear % 9 + 1));
        
        // ==================== 奇门遁甲特征 ====================
        let is_yang_dun = matches!(self.lunar_month, 11|12|1|2|3|4);
        features.insert("qimen_san_qi".to_string(), (self.day_tiangan % 3) + 1);
        features.insert("qimen_liu_yi".to_string(), (self.day_tiangan % 6) + 1);
        features.insert("qimen_ba_men".to_string(), (houtian_ben_shang + houtian_ben_xia) % 8 + 1);
        features.insert("qimen_jiu_xing".to_string(), (xiantian_ben_shang + xiantian_ben_xia + self.bian_yao_pos) % 9 + 1);
        features.insert("qimen_num".to_string(), (ben_gua_64 * 8 + self.bian_yao_pos * 9 + self.day_tiangan * 10) % 1080);
        features.insert("qimen_ju".to_string(), (self.lunar_month * 3 + self.lunar_day / 5) % 18 + 1);
        features.insert("qimen_san_qi_precise".to_string(), (self.day_tiangan + 1) % 3 + 1);
        features.insert("qimen_liu_yi_precise".to_string(), (self.day_tiangan + 3) % 6 + 1);
        features.insert("qimen_precise".to_string(), 
            (if is_yang_dun { 1 } else { 0 }) * 1000 + ((self.lunar_month * 3 + self.lunar_day / 5) % 18 + 1) * 10 + (self.day_tiangan + 1) % 3 + 1);
        
        // ==================== 六壬特征 ====================
        features.insert("liuren_di_zhi".to_string(), self.hour_dizhi);
        features.insert("liuren_tian_gan".to_string(), self.day_tiangan);
        features.insert("liuren_yue_jiang".to_string(), (13 - self.lunar_month) % 12 + 1);
        features.insert("liuren_num".to_string(), (self.hour_dizhi * 12 + self.lunar_month * 10 + self.day_tiangan) % 720);
        features.insert("liuren_guishen".to_string(), (self.day_tiangan + self.hour_dizhi) % 12 + 1);
        features.insert("liuren_sike_1".to_string(), self.day_dizhi % 12 + 1);
        features.insert("liuren_sike_2".to_string(), (self.day_dizhi + 1) % 12 + 1);
        features.insert("liuren_sike_3".to_string(), self.hour_dizhi % 12 + 1);
        features.insert("liuren_sike_4".to_string(), (self.hour_dizhi + 1) % 12 + 1);
        let yuejiang_map_val = (13 - self.lunar_month) % 12 + 1;
        features.insert("liuren_precise".to_string(), 
            (yuejiang_map_val * 100 + (self.day_tiangan + self.hour_dizhi) % 12 + 1) * 10 + self.day_dizhi % 12 + 1);
        
        // ==================== 紫微斗数特征 ====================
        features.insert("ziwei_ming_gong".to_string(), (self.month_dizhi + self.hour_dizhi) % 12 + 1);
        features.insert("ziwei_shen_gong".to_string(), (self.year_dizhi + self.month_dizhi) % 12 + 1);
        features.insert("ziwei_star".to_string(), (self.day_tiangan * 10 + self.day_dizhi) % 14 + 1);
        features.insert("ziwei_num".to_string(), 
            ((self.day_tiangan * 10 + self.day_dizhi) * 12 + (self.month_dizhi + self.hour_dizhi)) % 144);
        
        // ==================== 铁板神数特征 ====================
        features.insert("tieban_base".to_string(), 
            (self.year_tiangan * 1000 + self.year_dizhi * 100 + self.month_tiangan * 10 + self.month_dizhi) % 12000);
        features.insert("tieban_ke".to_string(), (ben_gua_64 * 100 + self.bian_yao_pos * 10 + bazi_sum) % 12000);
        features.insert("tieban_total".to_string(), 
            (self.year_tiangan * 10000 + self.year_dizhi * 1000 + self.month_tiangan * 100 + self.month_dizhi * 10 + self.day_tiangan) % 48120);
        
        // ==================== 梅花易数深度特征 ====================
        features.insert("ti_yong_he".to_string(), self.ti_energy + self.yong_energy);
        features.insert("ti_yong_cha".to_string(), (self.ti_energy - self.yong_energy).abs());
        features.insert("gua_qi".to_string(), ((self.lunar_month % 12) / 3 + 1) * 10 + (self.bian_yao_pos * 2));
        features.insert("dong_yao_energy".to_string(), self.bian_yao_pos * (7 - self.bian_yao_pos) + self.ti_energy);
        features.insert("hu_gua_influence".to_string(), hu_gua_sum * self.bian_yao_pos % 64);
        
        // ==================== 天干地支深度组合 ====================
        features.insert("tiangan_he".to_string(), ((self.day_tiangan - 1) % 5) + 1);
        features.insert("dizhi_liu_he".to_string(), (13 - (self.hour_dizhi % 12)) % 6 + 1);
        features.insert("dizhi_san_he".to_string(), (self.hour_dizhi % 12) / 3 + 1);
        features.insert("dizhi_liu_chong".to_string(), ((self.hour_dizhi + 6) % 12) / 2 + 1);
        
        // ==================== 河洛理数深度特征 ====================
        features.insert("hetu_sheng".to_string(), ben_gua_shang % 5 + 1);
        features.insert("hetu_cheng".to_string(), (ben_gua_shang % 5 + 1) + 5);
        features.insert("hetu_sheng_cheng".to_string(), (ben_gua_shang % 5 + 1) + (ben_gua_shang % 5 + 6));
        features.insert("luoshu_ben".to_string(), ((houtian_ben_shang - 1) * 3 + houtian_ben_xia - 1) % 9 + 1);
        features.insert("luoshu_fei_xing".to_string(), ((houtian_ben_shang - 1) * 3 + houtian_ben_xia - 1) % 9 + 1);
        features.insert("heluo_he".to_string(), 
            (ben_gua_shang % 5 + 1) + (ben_gua_shang % 5 + 6) + ((houtian_ben_shang - 1) * 3 + houtian_ben_xia - 1) % 9 + 1);
        features.insert("heluo_precise".to_string(), 
            ((ben_gua_shang % 5 + 1) * 10 + (ben_gua_shang % 5 + 6) + ((houtian_ben_shang - 1) * 3 + houtian_ben_xia - 1) % 9 + 1) % 100);
        
        // ==================== 卦象时空特征 ====================
        features.insert("shi_chen_gua".to_string(), (self.hour_dizhi * 8 + self.bian_yao_pos) % 64 + 1);
        features.insert("ri_gua".to_string(), (self.day_tiangan * 10 + self.day_dizhi) % 64 + 1);
        features.insert("shi_kong_num".to_string(), 
            ((self.year_tiangan * 10 + self.year_dizhi) % 64 + 
             (self.month_tiangan * 10 + self.month_dizhi) % 64 +
             (self.day_tiangan * 10 + self.day_dizhi) % 64 +
             (self.hour_dizhi * 8 + self.bian_yao_pos) % 64) % 256 + 1);
        
        // ==================== 三元九运特征 ====================
        features.insert("sanyuan_gua".to_string(), 
            (((self.lunar_year - 1864) / 60) % 3 + 1) * 10 + ((self.lunar_year - 1864) / 20) % 9 + 1);
        features.insert("sanyuan_num".to_string(), 
            (((self.lunar_year - 1864) / 60) % 3 + 1) * 100 + ((self.lunar_year - 1864) / 20) % 9 + 1);
        
        // ==================== 紫白飞星特征 ====================
        features.insert("day_flying_star".to_string(), 
            ((self.lunar_year - 2000) % 9 + self.lunar_month + self.lunar_day - 3) % 9 + 1);
        features.insert("flying_star_gua".to_string(), 
            (((self.lunar_year - 2000) % 9 + 1) * 10 + ((self.lunar_year - 2000) % 9 + self.lunar_month - 2) % 9 + 1) % 99 + 1);
        
        // ==================== 纳音特征 ====================
        let nayin_index = (self.year_tiangan - 1) * 12 + (self.year_dizhi - 1);
        features.insert("nayin_gua".to_string(), (nayin_index % 60 + ben_gua_64) % 124 + 1);
        
        // ==================== 二十八宿特征 ====================
        features.insert("xing_su".to_string(), (self.lunar_month * 2 + self.lunar_day + self.year_dizhi) % 28 + 1);
        features.insert("si_xiang".to_string(), ((self.lunar_month * 2 + self.lunar_day + self.year_dizhi) % 28) / 7 + 1);
        features.insert("su_gua".to_string(), ((self.lunar_month * 2 + self.lunar_day + self.year_dizhi) % 28 + 1) * 2 + self.bian_yao_pos);
        
        // ==================== 十二建除特征 ====================
        features.insert("jian_chu".to_string(), (self.day_dizhi - self.year_dizhi) % 12 + 1);
        let jian_chu_idx = ((self.day_dizhi - self.year_dizhi) % 12) as usize;
        let jian_chu_ji_xiong = [1, 1, 2, 1, 3, 1, 3, 3, 1, 3, 1, 3];
        features.insert("jian_chu_ji_xiong".to_string(), jian_chu_ji_xiong[jian_chu_idx.min(11)]);
        features.insert("jian_chu_gua".to_string(), ((self.day_dizhi - self.year_dizhi) % 12 + 1) * 5 + self.bian_yao_pos);
        
        // ==================== 彭祖百忌特征 ====================
        features.insert("pengzu_tiangan".to_string(), self.day_tiangan);
        features.insert("pengzu_dizhi".to_string(), self.day_dizhi);
        features.insert("pengzu_num".to_string(), (self.day_tiangan * 12 + self.day_dizhi) % 60 + 1);
        
        // ==================== 禄命特征 ====================
        let lu_map = [3, 4, 6, 6, 7, 7, 9, 10, 12, 1];
        let ma_map = [11, 11, 9, 9, 7, 7, 5, 5, 3, 3, 1, 1];
        let gui_map = [(2, 8), (1, 7), (7, 9), (7, 9), (8, 10), (8, 10), (1, 11), (1, 11), (3, 5), (3, 5)];
        features.insert("ri_lu".to_string(), lu_map[(self.day_tiangan - 1) as usize % 10]);
        features.insert("ri_ma".to_string(), ma_map[(self.day_dizhi - 1) as usize % 12]);
        features.insert("ri_gui".to_string(), gui_map[(self.day_tiangan - 1) as usize % 10].0);
        features.insert("lu_ma_gui".to_string(), 
            lu_map[(self.day_tiangan - 1) as usize % 10] + 
            ma_map[(self.day_dizhi - 1) as usize % 12] + 
            gui_map[(self.day_tiangan - 1) as usize % 10].0);
        
        // ==================== 节气特征 ====================
        let jieqi_approx = (self.lunar_month - 1) * 2 + (if self.lunar_day >= 15 { 1 } else { 0 });
        features.insert("jieqi_gua".to_string(), (ben_gua_64 * 3 + jieqi_approx % 24) % 192 + 1);
        
        features
    }
}

/// 时间起卦（核心函数 - 完整版）
/// 
/// 根据农历时间进行起卦，包含所有高级玄学特征
/// 
/// 参数:
/// - lunar_year: 农历年
/// - lunar_month: 农历月
/// - lunar_day: 农历日
/// - lunar_hour: 农历时辰（1-12对应子-亥）
/// 
/// 返回:
/// - GuaData: 卦象数据
pub fn calculate_time_gua(
    lunar_year: i32,
    lunar_month: i32,
    lunar_day: i32,
    lunar_hour: i32,
) -> GuaData {
    // ==================== 第一步：计算上下卦 ====================
    // 上卦 = (年 + 月 + 日) % 8
    let upper_num = ((lunar_year + lunar_month + lunar_day - 1) % 8 + 8) % 8 + 1;
    let upper_gua = get_bagua_name(upper_num);
    
    // 下卦 = (年 + 月 + 日 + 时) % 8
    let lower_num = ((lunar_year + lunar_month + lunar_day + lunar_hour - 1) % 8 + 8) % 8 + 1;
    let lower_gua = get_bagua_name(lower_num);
    
    // 本卦名称 = 上卦 + 下卦
    let ben_gua_name = format!("{}{}", upper_gua, lower_gua);
    
    // ==================== 第二步：计算变爻 ====================
    // 变爻位置 = (年 + 月 + 日 + 时) % 6
    let bian_yao_pos = ((lunar_year + lunar_month + lunar_day + lunar_hour - 1) % 6 + 6) % 6 + 1;
    
    // ==================== 第三步：计算变卦 ====================
    let bian_gua = calculate_bian_gua(&upper_gua, &lower_gua, bian_yao_pos);
    
    // ==================== 第四步：计算互卦 ====================
    let hu_gua = calculate_hu_gua(&upper_gua, &lower_gua);
    
    // ==================== 第五步：计算干支 ====================
    let (year_ganzhi, month_ganzhi, day_ganzhi, hour_ganzhi) = 
        calculate_ganzhi(lunar_year, lunar_month, lunar_day, lunar_hour);
    
    // ==================== 第六步：计算能量值 ====================
    let (ti_energy, yong_energy, total_energy) = calculate_energy(
        &upper_gua, &lower_gua, &bian_gua, bian_yao_pos
    );
    
    // ==================== 第七步：构建GuaData ====================
    let mut gua_data = GuaData::default();
    
    // 本卦信息
    gua_data.ben_gua_name = ben_gua_name.clone();
    gua_data.ben_gua_upper = upper_gua.to_string();
    gua_data.ben_gua_lower = lower_gua.to_string();
    gua_data.ben_gua_num = get_bagua_num(&ben_gua_name);
    gua_data.ben_gua_xiantian = get_xiantian_num(&ben_gua_name);
    gua_data.ben_gua_houtian = get_houtian_num(&ben_gua_name);
    gua_data.ben_gua_wuxing = get_bagua_wuxing(&ben_gua_name).to_string();
    gua_data.ben_gua_wuxing_num = get_wuxing_num(&gua_data.ben_gua_wuxing);
    
    // 变卦信息
    gua_data.bian_gua_name = bian_gua.clone();
    gua_data.bian_gua_upper = bian_gua.chars().take(1).collect();
    gua_data.bian_gua_lower = bian_gua.chars().skip(1).take(1).collect();
    gua_data.bian_gua_num = get_bagua_num(&bian_gua);
    gua_data.bian_gua_xiantian = get_xiantian_num(&bian_gua);
    gua_data.bian_gua_houtian = get_houtian_num(&bian_gua);
    gua_data.bian_gua_wuxing = get_bagua_wuxing(&bian_gua).to_string();
    gua_data.bian_gua_wuxing_num = get_wuxing_num(&gua_data.bian_gua_wuxing);
    
    // 互卦信息
    gua_data.hu_gua_name = hu_gua.clone();
    gua_data.hu_gua_upper = hu_gua.chars().take(1).collect();
    gua_data.hu_gua_lower = hu_gua.chars().skip(1).take(1).collect();
    gua_data.hu_gua_num = get_bagua_num(&hu_gua);
    gua_data.hu_gua_xiantian = get_xiantian_num(&hu_gua);
    gua_data.hu_gua_houtian = get_houtian_num(&hu_gua);
    gua_data.hu_gua_wuxing = get_bagua_wuxing(&hu_gua).to_string();
    gua_data.hu_gua_wuxing_num = get_wuxing_num(&gua_data.hu_gua_wuxing);
    
    // 变爻信息
    gua_data.bian_yao_pos = bian_yao_pos;
    gua_data.bian_yao_num = bian_yao_pos;
    
    // 时间信息
    gua_data.lunar_year = lunar_year;
    gua_data.lunar_month = lunar_month;
    gua_data.lunar_day = lunar_day;
    gua_data.lunar_hour = lunar_hour;
    
    // 干支信息
    gua_data.year_ganzhi = year_ganzhi.0;
    gua_data.month_ganzhi = month_ganzhi.0;
    gua_data.day_ganzhi = day_ganzhi.0;
    gua_data.hour_ganzhi = hour_ganzhi.0;
    
    gua_data.year_tiangan = year_ganzhi.1;
    gua_data.month_tiangan = month_ganzhi.1;
    gua_data.day_tiangan = day_ganzhi.1;
    gua_data.hour_tiangan = hour_ganzhi.1;
    
    gua_data.year_dizhi = year_ganzhi.2;
    gua_data.month_dizhi = month_ganzhi.2;
    gua_data.day_dizhi = day_ganzhi.2;
    gua_data.hour_dizhi = hour_ganzhi.2;
    
    // 五行信息
    gua_data.year_wuxing = year_ganzhi.3;
    gua_data.month_wuxing = month_ganzhi.3;
    gua_data.day_wuxing = day_ganzhi.3;
    gua_data.hour_wuxing = hour_ganzhi.3;
    
    // 季节和月相
    gua_data.season = get_season(lunar_month).to_string();
    let (phase, energy, _) = get_moon_phase(lunar_day);
    gua_data.moon_phase = phase.to_string();
    gua_data.moon_energy = energy;
    
    // 能量值
    gua_data.ti_energy = ti_energy;
    gua_data.yong_energy = yong_energy;
    gua_data.total_energy = total_energy;
    gua_data.adjusted_energy = total_energy;  // 简化处理
    gua_data.metaphysics_score = total_energy * 5;  // 简化处理
    
    // 卦象指数
    let ben_gua_sum = get_bagua_num(&upper_gua) + get_bagua_num(&lower_gua);
    let bian_gua_sum = get_bagua_num(&gua_data.bian_gua_upper) + get_bagua_num(&gua_data.bian_gua_lower);
    let hu_gua_sum = get_bagua_num(&gua_data.hu_gua_upper) + get_bagua_num(&gua_data.hu_gua_lower);
    gua_data.gua_index = (ben_gua_sum * bian_gua_sum + hu_gua_sum) % 64 + 1;
    
    // 阴阳平衡度
    gua_data.yinyang_balance = 0;  // 简化处理
    
    // 变爻影响力
    gua_data.bian_yao_power = bian_yao_pos * (7 - bian_yao_pos);
    
    gua_data
}

/// 计算变卦
fn calculate_bian_gua(upper_gua: &str, lower_gua: &str, bian_yao_pos: i32) -> String {
    let upper_binary = get_bagua_binary(upper_gua);
    let lower_binary = get_bagua_binary(lower_gua);
    
    let mut yaos = [
        lower_binary.0, lower_binary.1, lower_binary.2,
        upper_binary.0, upper_binary.1, upper_binary.2,
    ];
    
    let pos = (bian_yao_pos - 1) as usize;
    if pos < 6 {
        yaos[pos] = if yaos[pos] == 1 { 0 } else { 1 };
    }
    
    let new_lower = get_bagua_by_binary((yaos[0], yaos[1], yaos[2]));
    let new_upper = get_bagua_by_binary((yaos[3], yaos[4], yaos[5]));
    
    format!("{}{}", new_upper, new_lower)
}

/// 计算互卦
fn calculate_hu_gua(upper_gua: &str, lower_gua: &str) -> String {
    let upper_binary = get_bagua_binary(upper_gua);
    let lower_binary = get_bagua_binary(lower_gua);
    
    let yaos = [
        lower_binary.0, lower_binary.1, lower_binary.2,
        upper_binary.0, upper_binary.1, upper_binary.2,
    ];
    
    let hu_lower = get_bagua_by_binary((yaos[1], yaos[2], yaos[3]));
    let hu_upper = get_bagua_by_binary((yaos[2], yaos[3], yaos[4]));
    
    format!("{}{}", hu_upper, hu_lower)
}

/// 计算干支
fn calculate_ganzhi(
    lunar_year: i32,
    lunar_month: i32,
    lunar_day: i32,
    lunar_hour: i32,
) -> ((String, i32, i32, String), (String, i32, i32, String), (String, i32, i32, String), (String, i32, i32, String)) {
    let tiangan_names = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
    let dizhi_names = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
    let tiangan_wuxing = ["木", "木", "火", "火", "土", "土", "金", "金", "水", "水"];
    
    // 年干支
    let year_offset = ((lunar_year - 4) % 60 + 60) % 60;
    let year_tiangan_idx = (year_offset % 10) as usize;
    let year_dizhi_idx = (year_offset % 12) as usize;
    let year_ganzhi = format!("{}{}", tiangan_names[year_tiangan_idx], dizhi_names[year_dizhi_idx]);
    let year_tiangan_num = (year_tiangan_idx + 1) as i32;
    let year_dizhi_num = (year_dizhi_idx + 1) as i32;
    let year_wuxing = tiangan_wuxing[year_tiangan_idx].to_string();
    
    // 月干支
    let month_tiangan_idx = ((year_tiangan_idx * 2 + lunar_month as usize) % 10);
    let month_dizhi_idx = ((lunar_month as usize + 1) % 12);
    let month_ganzhi = format!("{}{}", tiangan_names[month_tiangan_idx], dizhi_names[month_dizhi_idx]);
    let month_tiangan_num = (month_tiangan_idx + 1) as i32;
    let month_dizhi_num = (month_dizhi_idx + 1) as i32;
    let month_wuxing = tiangan_wuxing[month_tiangan_idx].to_string();
    
    // 日干支
    let day_offset = (lunar_day + lunar_month * 2 + lunar_year % 10) as usize;
    let day_tiangan_idx = day_offset % 10;
    let day_dizhi_idx = day_offset % 12;
    let day_ganzhi = format!("{}{}", tiangan_names[day_tiangan_idx], dizhi_names[day_dizhi_idx]);
    let day_tiangan_num = (day_tiangan_idx + 1) as i32;
    let day_dizhi_num = (day_dizhi_idx + 1) as i32;
    let day_wuxing = tiangan_wuxing[day_tiangan_idx].to_string();
    
    // 时干支
    let hour_dizhi_idx = ((lunar_hour - 1) as usize % 12);
    let hour_tiangan_idx = (day_tiangan_idx * 2 + hour_dizhi_idx) % 10;
    let hour_ganzhi = format!("{}{}", tiangan_names[hour_tiangan_idx], dizhi_names[hour_dizhi_idx]);
    let hour_tiangan_num = (hour_tiangan_idx + 1) as i32;
    let hour_dizhi_num = (hour_dizhi_idx + 1) as i32;
    let hour_wuxing = tiangan_wuxing[hour_tiangan_idx].to_string();
    
    (
        (year_ganzhi, year_tiangan_num, year_dizhi_num, year_wuxing),
        (month_ganzhi, month_tiangan_num, month_dizhi_num, month_wuxing),
        (day_ganzhi, day_tiangan_num, day_dizhi_num, day_wuxing),
        (hour_ganzhi, hour_tiangan_num, hour_dizhi_num, hour_wuxing),
    )
}

/// 计算能量值
fn calculate_energy(upper_gua: &str, lower_gua: &str, bian_gua: &str, bian_yao_pos: i32) -> (i32, i32, i32) {
    let xiantian_upper = get_xiantian_num(upper_gua);
    let xiantian_lower = get_xiantian_num(lower_gua);
    let houtian_upper = get_houtian_num(upper_gua);
    let houtian_lower = get_houtian_num(lower_gua);
    let wuxing_upper = get_wuxing_num(&get_bagua_wuxing(upper_gua));
    let wuxing_lower = get_wuxing_num(&get_bagua_wuxing(lower_gua));
    
    let (ti_energy, yong_energy) = if bian_yao_pos <= 3 {
        (xiantian_upper + houtian_upper + wuxing_upper, xiantian_lower + houtian_lower + wuxing_lower)
    } else {
        (xiantian_lower + houtian_lower + wuxing_lower, xiantian_upper + houtian_upper + wuxing_upper)
    };
    
    let bian_upper = bian_gua.chars().next().unwrap_or('乾');
    let bian_lower = bian_gua.chars().nth(1).unwrap_or('坤');
    let bian_upper_str = bian_upper.to_string();
    let bian_lower_str = bian_lower.to_string();
    
    let bian_shang_energy = get_xiantian_num(&bian_upper_str) + 
                            get_houtian_num(&bian_upper_str) + 
                            get_wuxing_num(&get_bagua_wuxing(&bian_upper_str));
    let bian_xia_energy = get_xiantian_num(&bian_lower_str) + 
                          get_houtian_num(&bian_lower_str) + 
                          get_wuxing_num(&get_bagua_wuxing(&bian_lower_str));
    
    let total_energy = ti_energy + yong_energy + bian_shang_energy + bian_xia_energy;
    
    (ti_energy, yong_energy, total_energy)
}

/// 计算六神
fn calculate_liushen(day_tiangan: i32, bian_yao_pos: i32) -> i32 {
    let liushen_start: HashMap<i32, i32> = [
        (1, 0), (2, 0),  // 甲乙日起青龙
        (3, 1), (4, 1),  // 丙丁日起朱雀
        (5, 2), (6, 3),  // 戊日起勾陈，己日起螣蛇
        (7, 4), (8, 4),  // 庚辛日起白虎
        (9, 5), (10, 5), // 壬癸日起玄武
    ].iter().cloned().collect();
    
    let start_idx = liushen_start.get(&day_tiangan).unwrap_or(&0);
    (*start_idx + bian_yao_pos as i32 - 1) % 6 + 1
}

/// 计算体用生克关系（梅花易数核心）
/// 
/// 体用生克是梅花易数判断吉凶的核心方法：
/// 1. 体卦代表主体、自身
/// 2. 用卦代表客体、外部
/// 3. 变卦代表结果、未来
/// 
/// 生克关系：
/// - 用生体：大吉，外部助力
/// - 体生用：小凶，自身耗泄
/// - 用克体：大凶，外部压制
/// - 体克用：小吉，自身掌控
/// - 体用比和：平，势均力敌
fn calculate_ti_yong_shengke(
    ti_wuxing: &str,
    yong_wuxing: &str,
    bian_wuxing: &str,
    lunar_month: i32,
) -> HashMap<String, i32> {
    let mut result = HashMap::new();
    
    // 五行生克关系
    let wuxing_relation: HashMap<&str, HashMap<&str, &str>> = [
        ("金", [("生我", "土"), ("我生", "水"), ("克我", "火"), ("我克", "木")].iter().cloned().collect()),
        ("木", [("生我", "水"), ("我生", "火"), ("克我", "金"), ("我克", "土")].iter().cloned().collect()),
        ("水", [("生我", "金"), ("我生", "木"), ("克我", "土"), ("我克", "火")].iter().cloned().collect()),
        ("火", [("生我", "木"), ("我生", "土"), ("克我", "水"), ("我克", "金")].iter().cloned().collect()),
        ("土", [("生我", "火"), ("我生", "金"), ("克我", "木"), ("我克", "水")].iter().cloned().collect()),
    ].iter().cloned().collect();
    
    let ti_relation = wuxing_relation.get(ti_wuxing).cloned().unwrap_or_default();
    
    // 体用关系
    let ti_sheng_wo = ti_relation.get("生我").map(|s| *s).unwrap_or("");
    let ti_wo_sheng = ti_relation.get("我生").map(|s| *s).unwrap_or("");
    let ti_ke_wo = ti_relation.get("克我").map(|s| *s).unwrap_or("");
    let ti_wo_ke = ti_relation.get("我克").map(|s| *s).unwrap_or("");
    
    let (ti_yong_relation, ti_yong_score) = if yong_wuxing == ti_sheng_wo {
        ("用生体", 10)
    } else if yong_wuxing == ti_wo_sheng {
        ("体生用", -5)
    } else if yong_wuxing == ti_ke_wo {
        ("用克体", -10)
    } else if yong_wuxing == ti_wo_ke {
        ("体克用", 5)
    } else {
        ("体用比和", 0)
    };
    
    // 体变关系
    let (ti_bian_relation, ti_bian_score) = if bian_wuxing == ti_sheng_wo {
        ("变生体", 8)
    } else if bian_wuxing == ti_wo_sheng {
        ("体生变", -4)
    } else if bian_wuxing == ti_ke_wo {
        ("变克体", -8)
    } else if bian_wuxing == ti_wo_ke {
        ("体克变", 4)
    } else {
        ("体变比和", 0)
    };
    
    // 五行旺衰
    let ti_wangshuai = calculate_wuxing_wangshuai(lunar_month, ti_wuxing);
    let yong_wangshuai = calculate_wuxing_wangshuai(lunar_month, yong_wuxing);
    let bian_wangshuai = calculate_wuxing_wangshuai(lunar_month, bian_wuxing);
    
    let wangshuai_modifier = ti_wangshuai as f64 / 3.0;
    let adjusted_ti_yong_score = (ti_yong_score as f64 * wangshuai_modifier) as i32;
    let adjusted_ti_bian_score = (ti_bian_score as f64 * wangshuai_modifier) as i32;
    let total_score = adjusted_ti_yong_score + adjusted_ti_bian_score;
    
    // 整体运势
    let overall_fortune = if total_score >= 10 {
        5  // 大吉
    } else if total_score >= 5 {
        4  // 中吉
    } else if total_score >= 0 {
        3  // 小吉
    } else if total_score >= -5 {
        2  // 小凶
    } else if total_score >= -10 {
        1  // 中凶
    } else {
        0  // 大凶
    };
    
    result.insert("ti_yong_score".to_string(), ti_yong_score);
    result.insert("ti_bian_score".to_string(), ti_bian_score);
    result.insert("ti_wangshuai".to_string(), ti_wangshuai);
    result.insert("yong_wangshuai".to_string(), yong_wangshuai);
    result.insert("bian_wangshuai".to_string(), bian_wangshuai);
    result.insert("total_score".to_string(), total_score);
    result.insert("overall_fortune".to_string(), overall_fortune);
    
    result
}

/// 计算五行旺衰
fn calculate_wuxing_wangshuai(lunar_month: i32, wuxing: &str) -> i32 {
    // 月支到季节的映射：寅卯辰=春、巳午未=夏、申酉戌=秋、亥子丑=冬
    let season = match lunar_month {
        1 | 2 | 3 => "春",   // 春季
        4 | 5 | 6 => "夏",   // 夏季
        7 | 8 | 9 => "秋",   // 秋季
        10 | 11 | 12 => "冬", // 冬季
        _ => "春",
    };
    
    // 五行旺衰表：旺=5, 相=4, 休=3, 囚=2, 死=1
    let wangshuai: HashMap<&str, HashMap<&str, i32>> = [
        ("春", [("木", 5), ("火", 4), ("水", 3), ("金", 2), ("土", 1)].iter().cloned().collect()),
        ("夏", [("火", 5), ("土", 4), ("木", 3), ("水", 2), ("金", 1)].iter().cloned().collect()),
        ("秋", [("金", 5), ("水", 4), ("土", 3), ("火", 2), ("木", 1)].iter().cloned().collect()),
        ("冬", [("水", 5), ("木", 4), ("金", 3), ("土", 2), ("火", 1)].iter().cloned().collect()),
    ].iter().cloned().collect();
    
    wangshuai.get(season).and_then(|s| s.get(wuxing)).copied().unwrap_or(3)
}

/// 计算卦象旺衰
fn calculate_gua_wangshuai(gua_shang: i32, gua_xia: i32, lunar_month: i32) -> HashMap<String, i32> {
    let mut result = HashMap::new();
    
    let shang_name = get_bagua_name(gua_shang);
    let xia_name = get_bagua_name(gua_xia);
    
    let shang_wuxing = get_bagua_wuxing(&shang_name);
    let xia_wuxing = get_bagua_wuxing(&xia_name);
    
    let shang_wangshuai = calculate_wuxing_wangshuai(lunar_month, &shang_wuxing);
    let xia_wangshuai = calculate_wuxing_wangshuai(lunar_month, &xia_wuxing);
    
    let gua_energy = (shang_wangshuai + xia_wangshuai) / 2;
    
    let gua_status = if gua_energy >= 5 {
        5  // 极旺
    } else if gua_energy >= 4 {
        4  // 旺
    } else if gua_energy >= 3 {
        3  // 平
    } else if gua_energy >= 2 {
        2  // 衰
    } else {
        1  // 极衰
    };
    
    result.insert("shang_wangshuai".to_string(), shang_wangshuai);
    result.insert("xia_wangshuai".to_string(), xia_wangshuai);
    result.insert("gua_energy".to_string(), gua_energy);
    result.insert("gua_status".to_string(), gua_status);
    
    result
}

/// 计算太乙神数
fn calculate_taiyi(lunar_year: i32, lunar_month: i32, lunar_day: i32) -> HashMap<String, i32> {
    let mut result = HashMap::new();
    
    // 太乙积年
    let taiyi_base_year = 10153917i64;
    let taiyi_jiyear = taiyi_base_year + lunar_year as i64;
    
    // 太乙所在宫
    let taiyi_gong = ((taiyi_jiyear % 9) + 9) % 9;
    let taiyi_gong = if taiyi_gong == 0 { 9 } else { taiyi_gong as i32 };
    
    // 文昌
    let taiyi_wenchang = (lunar_month + lunar_day) % 16 + 1;
    
    // 主算、客算
    let taiyi_zhu_suan = ((taiyi_jiyear % 72) + 72) % 72 + 1;
    let taiyi_ke_suan = 72 - ((taiyi_jiyear % 72) + 72) % 72 + 1;
    
    // 太乙综合数
    let taiyi_num = (taiyi_gong * 100 + taiyi_wenchang * 10 + lunar_day % 10) % 360 + 1;
    
    result.insert("taiyi_gong".to_string(), taiyi_gong);
    result.insert("taiyi_wenchang".to_string(), taiyi_wenchang);
    result.insert("taiyi_zhu_suan".to_string(), taiyi_zhu_suan as i32);
    result.insert("taiyi_ke_suan".to_string(), taiyi_ke_suan as i32);
    result.insert("taiyi_num".to_string(), taiyi_num);
    
    result
}

/// 计算奇门遁甲
fn calculate_qimen(lunar_month: i32, lunar_day: i32, day_stem_num: i32, day_branch_num: i32) -> HashMap<String, i32> {
    let mut result = HashMap::new();
    
    // 阴阳遁判断
    let is_yang_dun = matches!(lunar_month, 11 | 12 | 1 | 2 | 3 | 4);
    
    // 局数计算
    let ju_num = if is_yang_dun {
        if lunar_month >= 11 {
            ((lunar_month - 11) * 3 + (lunar_day - 1) / 15 + 1) % 9
        } else {
            ((lunar_month + 1) * 3 + (lunar_day - 1) / 15 + 1) % 9
        }
    } else {
        9 - (((lunar_month - 5) * 3 + (lunar_day - 1) / 15) % 9)
    };
    let ju_num = if ju_num == 0 { 9 } else { ju_num };
    
    // 三奇六仪
    let san_qi_index = (day_stem_num - 1) % 3;
    let liu_yi_index = (day_stem_num - 1) % 6;
    
    // 八门
    let men_index = (day_branch_num + lunar_day) % 8;
    // 八门吉凶：休=1吉, 生=1吉, 伤=-1凶, 杜=0中, 景=0中, 死=-1凶, 惊=-1凶, 开=1吉
    let men_jixiong = match men_index {
        0 | 1 | 7 => 1,   // 休、生、开为吉
        2 | 5 | 6 => -1,  // 伤、死、惊为凶
        _ => 0,           // 杜、景为中
    };
    
    // 九星
    let xing_index = (lunar_month + lunar_day + day_stem_num) % 9;
    
    // 奇门综合数
    let qimen_num = (ju_num * 100 + (san_qi_index + 1) * 10 + (men_jixiong + 2)) % 1080 + 1;
    
    result.insert("is_yang_dun".to_string(), if is_yang_dun { 1 } else { 0 });
    result.insert("ju_num".to_string(), ju_num);
    result.insert("san_qi".to_string(), san_qi_index + 1);
    result.insert("liu_yi".to_string(), liu_yi_index + 1);
    result.insert("ba_men".to_string(), men_index + 1);
    result.insert("men_jixiong".to_string(), men_jixiong);
    result.insert("jiu_xing".to_string(), xing_index + 1);
    result.insert("qimen_num".to_string(), qimen_num);
    
    result
}

/// 计算六壬
fn calculate_liuren(lunar_month: i32, lunar_day: i32, day_stem_num: i32, day_branch_num: i32, time_branch_num: i32) -> HashMap<String, i32> {
    let mut result = HashMap::new();
    
    // 月将计算
    let yuejiang_dizhi = (13 - lunar_month) % 12;
    let yuejiang_dizhi = if yuejiang_dizhi == 0 { 12 } else { yuejiang_dizhi };
    
    // 四课计算
    let sike_1 = (yuejiang_dizhi + day_branch_num - 1) % 12 + 1;
    let sike_2 = (yuejiang_dizhi + day_stem_num - 1) % 12 + 1;
    let sike_3 = sike_1;
    let sike_4 = sike_2;
    
    // 三传计算（简化版）
    let sanchuan_1 = (sike_1 + sike_2) % 12 + 1;
    let sanchuan_2 = (sike_2 + sike_3) % 12 + 1;
    let sanchuan_3 = (sike_3 + sike_4) % 12 + 1;
    
    // 天将
    let tianjiang = (day_stem_num + time_branch_num) % 12 + 1;
    
    // 六壬综合数
    let liuren_num = (yuejiang_dizhi * 100 + tianjiang * 10 + sike_1) % 720 + 1;
    
    result.insert("yuejiang".to_string(), yuejiang_dizhi);
    result.insert("sike_1".to_string(), sike_1);
    result.insert("sike_2".to_string(), sike_2);
    result.insert("sike_3".to_string(), sike_3);
    result.insert("sike_4".to_string(), sike_4);
    result.insert("sanchuan_1".to_string(), sanchuan_1);
    result.insert("sanchuan_2".to_string(), sanchuan_2);
    result.insert("sanchuan_3".to_string(), sanchuan_3);
    result.insert("tianjiang".to_string(), tianjiang);
    result.insert("liuren_num".to_string(), liuren_num);
    
    result
}

/// 计算调整后的能量
fn calculate_adjusted_energy(
    total_energy: i32,
    ti_yong_info: &HashMap<String, i32>,
    gua_wangshuai_info: &HashMap<String, i32>,
    moon_energy: i32,
) -> HashMap<String, i32> {
    let mut result = HashMap::new();
    
    let ti_yong_modifier = ti_yong_info.get("total_score").unwrap_or(&0);
    let wangshuai_modifier = gua_wangshuai_info.get("gua_energy").unwrap_or(&3);
    let moon_modifier = moon_energy;
    
    let total_modifier = ti_yong_modifier + wangshuai_modifier + moon_modifier;
    let adjusted_energy = total_energy + total_modifier;
    
    result.insert("adjusted_energy".to_string(), adjusted_energy);
    result.insert("total_modifier".to_string(), total_modifier);
    result.insert("ti_yong_modifier".to_string(), *ti_yong_modifier);
    result.insert("wangshuai_modifier".to_string(), *wangshuai_modifier);
    result.insert("moon_modifier".to_string(), moon_modifier);
    
    result
}

/// 从公历日期计算卦象
pub fn calculate_gua_from_datetime(dt: &DateTime<Local>) -> GuaData {
    let year = dt.year();
    let month = dt.month() as i32;
    let day = dt.day() as i32;
    let hour = dt.hour() as i32 / 2 + 1;
    
    let lunar_year = year;
    let lunar_month = month;
    let lunar_day = day;
    let lunar_hour = hour;
    
    calculate_time_gua(lunar_year, lunar_month, lunar_day, lunar_hour)
}

/// 特征提取器注册表
pub fn get_feature_extractors() -> Vec<(&'static str, fn(&HashMap<String, i32>) -> i32)> {
    vec![
        ("ben_gua_num", |f| *f.get("ben_gua_num").unwrap_or(&1)),
        ("ben_gua_xiantian", |f| *f.get("ben_gua_xiantian").unwrap_or(&1)),
        ("ben_gua_houtian", |f| *f.get("ben_gua_houtian").unwrap_or(&4)),
        ("ben_gua_wuxing_num", |f| *f.get("ben_gua_wuxing_num").unwrap_or(&1)),
        ("bian_gua_num", |f| *f.get("bian_gua_num").unwrap_or(&1)),
        ("hu_gua_num", |f| *f.get("hu_gua_num").unwrap_or(&1)),
        ("bian_yao_pos", |f| *f.get("bian_yao_pos").unwrap_or(&1)),
        ("total_energy", |f| *f.get("total_energy").unwrap_or(&10)),
        ("ti_energy", |f| *f.get("ti_energy").unwrap_or(&5)),
        ("yong_energy", |f| *f.get("yong_energy").unwrap_or(&5)),
        ("metaphysics_score", |f| *f.get("metaphysics_score").unwrap_or(&50)),
    ]
}

/// 数学操作注册表
pub fn get_operations() -> Vec<(&'static str, fn(i32, i32) -> i32)> {
    vec![
        ("add", |v, p| v + p),
        ("sub", |v, p| v - p),
        ("mul", |v, p| v * p),
        ("div", |v, p| if p != 0 { v / p } else { v }),
        ("mod", |v, p| if p > 0 { ((v % p) + p) % p } else { v }),
        ("mod_add", |v, p| if p > 0 { ((v % p) + p) % p + 1 } else { v }),
        ("abs", |v, _| v.abs()),
        ("neg", |v, _| -v),
        ("square", |v, _| v * v),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_time_gua() {
        let gua = calculate_time_gua(2024, 1, 1, 1);
        assert!(!gua.ben_gua_name.is_empty());
        assert!(gua.ben_gua_num >= 1 && gua.ben_gua_num <= 8);
        assert!(gua.bian_yao_pos >= 1 && gua.bian_yao_pos <= 6);
    }

    #[test]
    fn test_gua_data_to_features() {
        let gua = calculate_time_gua(2024, 1, 1, 1);
        let features = gua.to_features();
        assert!(features.contains_key("ben_gua_num"));
        assert!(features.contains_key("bian_gua_num"));
        assert!(features.contains_key("hu_gua_num"));
        assert!(features.contains_key("total_energy"));
        assert!(features.contains_key("ti_energy"));
        assert!(features.contains_key("yong_energy"));
    }
}
