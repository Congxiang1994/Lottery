//! config.rs - 卦象预测系统全局配置类（球位版本）
//!
//! 核心概念：
//! ==========
//! 不再按红球/蓝球分类，而是按球位分类。
//! 每个球位有独立的公式搜索和预测逻辑。
//!
//! 球位定义：
//! - SSQ（双色球）：
//!   - 红球位1-6：开奖6个红球，按升序排列后分别对应位1-6
//!   - 蓝球位1：开奖1个蓝球
//! - DLT（大乐透）：
//!   - 红球位1-5：开奖5个红球，按升序排列后分别对应位1-5
//!   - 蓝球位1-2：开奖2个蓝球，按升序排列后分别对应位1-2

#![allow(dead_code)]
#![allow(unused_variables)]

use std::collections::HashMap;
use serde::{Serialize, Deserialize};

/// 彩种模式配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModeConfig {
    /// 彩种名称
    pub name: String,
    /// 数据文件名
    pub data_file: String,
    /// 红球范围 (最小值, 最大值)
    pub red_range: (i32, i32),
    /// 蓝球范围 (最小值, 最大值)
    pub blue_range: (i32, i32),
    /// 红球数量
    pub red_count: i32,
    /// 蓝球数量
    pub blue_count: i32,
}

impl Default for ModeConfig {
    fn default() -> Self {
        ModeConfig {
            name: "双色球".to_string(),
            data_file: "ssq.txt".to_string(),
            red_range: (1, 33),
            blue_range: (1, 16),
            red_count: 6,
            blue_count: 1,
        }
    }
}

/// 球位配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionConfig {
    /// 球位名称
    pub name: String,
    /// 球位描述
    pub description: String,
    /// 号码范围 (最小值, 最大值)
    pub range: (i32, i32),
    /// 公式筛选阈值
    pub threshold: f64,
    /// 预测时输出候选数量
    pub output_count: i32,
    /// 球类型 (red/blue)
    pub ball_type: String,
    /// 球位编号
    pub position: i32,
}

impl Default for PositionConfig {
    fn default() -> Self {
        PositionConfig {
            name: "红球位1".to_string(),
            description: "开奖红球中第1小的球".to_string(),
            range: (1, 33),
            threshold: 0.08,
            output_count: 2,
            ball_type: "red".to_string(),
            position: 1,
        }
    }
}

/// 卦象预测系统全局配置类（球位版本）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuaConfig {
    // ==================== 基础配置 ====================
    /// 彩种模式: "ssq"=双色球, "dlt"=大乐透
    pub mode: String,
    /// 是否显示详细输出
    pub verbose: bool,
    
    // ==================== 数据配置 ====================
    /// 数据目录
    pub data_dir: String,
    /// 结果保存目录
    pub result_dir: String,
    
    // ==================== 彩种基础配置 ====================
    /// 彩种配置映射
    pub mode_config: HashMap<String, ModeConfig>,
    
    // ==================== 球位配置（核心配置） ====================
    /// 每个球位的详细配置
    pub position_config: HashMap<String, PositionConfig>,
    
    // ==================== 搜索配置 ====================
    /// 最大操作数量（组合复杂度）
    pub max_operations: i32,
    /// 总使用期数
    pub total_periods: i32,
    /// 训练集期数
    pub train_periods: i32,
    /// 验证集期数
    pub val_periods: i32,
    /// 搜索期数（保持兼容）
    pub search_periods: i32,
    /// 保存前N个最佳结果
    pub top_n_results: i32,
    /// 进度显示间隔
    pub progress_interval: i32,
    
    // ==================== 训练集包含验证集开关 ====================
    /// 训练集是否包含验证集
    pub train_include_val: bool,
    
    // ==================== 公式生成器配置 ====================
    /// 是否使用激进公式生成器
    pub use_aggressive_formula_generator: bool,
    /// 激进公式生成器的最大候选数量
    pub max_formula_candidates: i32,
    
    // ==================== 统计显著性检验配置 ====================
    /// 显著性水平（p-value阈值）
    pub significance_level: f64,
    /// 是否启用Bonferroni校正
    pub bonferroni_correction: bool,
    /// 训练集最低命中率门槛
    pub min_train_hit_rate: f64,
    /// 验证集命中率至少是随机的N倍
    pub min_val_improvement: f64,
    
    // ==================== 公式数量配置 ====================
    /// 训练集筛选后保留的最大显著公式数
    pub max_significant_formulas: i32,
    /// 验证集筛选后保留的最大高命中率公式数
    pub max_high_rate_formulas: i32,
    
    // ==================== 数学操作配置 ====================
    /// 启用基础运算（加减乘）
    pub enable_basic_ops: bool,
    /// 启用取模运算
    pub enable_mod_ops: bool,
    /// 启用移位操作
    pub enable_shift_ops: bool,
    /// 启用特殊操作（玄学相关）
    pub enable_special_ops: bool,
    
    // ==================== 投票策略配置 ====================
    /// SSQ红球公式筛选阈值
    pub ssq_red_threshold: f64,
    /// SSQ蓝球公式筛选阈值
    pub ssq_blue_threshold: f64,
    /// DLT红球公式筛选阈值
    pub dlt_red_threshold: f64,
    /// DLT蓝球公式筛选阈值
    pub dlt_blue_threshold: f64,
    
    /// SSQ红球输出数字个数
    pub ssq_red_output: i32,
    /// SSQ蓝球输出数字个数
    pub ssq_blue_output: i32,
    /// DLT红球输出数字个数
    pub dlt_red_output: i32,
    /// DLT蓝球输出数字个数
    pub dlt_blue_output: i32,
    
    /// 最大使用公式数量
    pub max_formulas_for_voting: i32,
    
    // ==================== 球位排序配置 ====================
    /// 开奖号码是否按升序排列后再分配球位
    pub sort_balls_for_position: bool,
    
    // ==================== 输出配置 ====================
    /// 显示搜索进度
    pub show_progress: bool,
}

impl Default for GuaConfig {
    fn default() -> Self {
        let mut mode_config = HashMap::new();
        mode_config.insert("ssq".to_string(), ModeConfig {
            name: "双色球".to_string(),
            data_file: "ssq.txt".to_string(),
            red_range: (1, 33),
            blue_range: (1, 16),
            red_count: 6,
            blue_count: 1,
        });
        mode_config.insert("dlt".to_string(), ModeConfig {
            name: "大乐透".to_string(),
            data_file: "dlt.txt".to_string(),
            red_range: (1, 35),
            blue_range: (1, 12),
            red_count: 5,
            blue_count: 2,
        });
        
        let position_config = create_default_position_config();
        
        GuaConfig {
            mode: "ssq".to_string(),
            verbose: true,
            data_dir: ".".to_string(),
            result_dir: "./gua_results".to_string(),
            mode_config,
            position_config,
            max_operations: 3,
            total_periods: 153+12,  // 1000 + 153
            train_periods: 153,
            val_periods: 12,
            search_periods: 1500,
            top_n_results: 200,
            progress_interval: 100,
            train_include_val: false,
            use_aggressive_formula_generator: false,
            max_formula_candidates: 10_000_000,
            significance_level: 0.15,
            bonferroni_correction: true,
            min_train_hit_rate: 0.03,
            min_val_improvement: 1.0,
            max_significant_formulas: 1000,
            max_high_rate_formulas: 300,
            enable_basic_ops: true,
            enable_mod_ops: true,
            enable_shift_ops: true,
            enable_special_ops: true,
            ssq_red_threshold: 0.22,
            ssq_blue_threshold: 0.19,
            dlt_red_threshold: 0.22,
            dlt_blue_threshold: 0.19,
            ssq_red_output: 8,
            ssq_blue_output: 2,
            dlt_red_output: 7,
            dlt_blue_output: 3,
            max_formulas_for_voting: 10,
            sort_balls_for_position: false,
            show_progress: true,
        }
    }
}

/// 创建默认的球位配置
fn create_default_position_config() -> HashMap<String, PositionConfig> {
    let mut config = HashMap::new();
    
    // ==================== 双色球（SSQ）球位配置 ====================
    // 红球位1-6
    for i in 1..=6 {
        config.insert(
            format!("ssq_red_{}", i),
            PositionConfig {
                name: format!("红球位{}", i),
                description: format!("开奖红球中第{}小的球", i),
                range: (1, 33),
                threshold: 0.08,
                output_count: 2,
                ball_type: "red".to_string(),
                position: i,
            },
        );
    }
    // 蓝球位1
    config.insert(
        "ssq_blue_1".to_string(),
        PositionConfig {
            name: "蓝球位1".to_string(),
            description: "开奖蓝球".to_string(),
            range: (1, 16),
            threshold: 0.10,
            output_count: 2,
            ball_type: "blue".to_string(),
            position: 1,
        },
    );
    
    // ==================== 大乐透（DLT）球位配置 ====================
    // 红球位1-5
    for i in 1..=5 {
        config.insert(
            format!("dlt_red_{}", i),
            PositionConfig {
                name: format!("红球位{}", i),
                description: format!("开奖红球中第{}小的球", i),
                range: (1, 35),
                threshold: 0.08,
                output_count: 2,
                ball_type: "red".to_string(),
                position: i,
            },
        );
    }
    // 蓝球位1-2
    for i in 1..=2 {
        config.insert(
            format!("dlt_blue_{}", i),
            PositionConfig {
                name: format!("蓝球位{}", i),
                description: format!("开奖蓝球中第{}小的球", i),
                range: (1, 12),
                threshold: 0.12,
                output_count: 2,
                ball_type: "blue".to_string(),
                position: i,
            },
        );
    }
    
    config
}

impl GuaConfig {
    /// 创建新的配置实例
    pub fn new() -> Self {
        GuaConfig::default()
    }
    
    /// 根据球类型和位置生成球位key
    pub fn get_position_key(&self, ball_type: &str, position: i32) -> String {
        format!("{}_{}_{}", self.mode, ball_type, position)
    }
    
    /// 获取当前彩种所有球位的key列表
    pub fn get_all_position_keys(&self) -> Vec<String> {
        let mut keys = Vec::new();
        
        if let Some(mode_cfg) = self.mode_config.get(&self.mode) {
            // 添加红球位
            for i in 1..=mode_cfg.red_count {
                keys.push(format!("{}_red_{}", self.mode, i));
            }
            // 添加蓝球位
            for i in 1..=mode_cfg.blue_count {
                keys.push(format!("{}_blue_{}", self.mode, i));
            }
        }
        
        keys
    }
    
    /// 获取指定球位的配置
    pub fn get_position_config(&self, ball_type: &str, position: i32) -> Option<&PositionConfig> {
        let key = self.get_position_key(ball_type, position);
        self.position_config.get(&key)
    }
    
    /// 获取指定球位的公式筛选阈值
    pub fn get_position_threshold(&self, ball_type: &str, position: i32) -> f64 {
        self.get_position_config(ball_type, position)
            .map(|c| c.threshold)
            .unwrap_or(0.1)
    }
    
    /// 获取指定球位的输出数字个数
    pub fn get_position_output_count(&self, ball_type: &str, position: i32) -> i32 {
        self.get_position_config(ball_type, position)
            .map(|c| c.output_count)
            .unwrap_or(2)
    }
    
    /// 获取指定球位的号码范围
    pub fn get_position_range(&self, ball_type: &str, position: i32) -> (i32, i32) {
        self.get_position_config(ball_type, position)
            .map(|c| c.range)
            .unwrap_or((1, 33))
    }
    
    /// 获取指定球位的显示名称
    pub fn get_position_name(&self, ball_type: &str, position: i32) -> String {
        self.get_position_config(ball_type, position)
            .map(|c| c.name.clone())
            .unwrap_or_else(|| format!("{}位{}", ball_type, position))
    }
    
    /// 获取指定球位的描述
    pub fn get_position_description(&self, ball_type: &str, position: i32) -> String {
        self.get_position_config(ball_type, position)
            .map(|c| c.description.clone())
            .unwrap_or_default()
    }
    
    /// 获取当前彩种的公式筛选阈值（旧方法，保持兼容性）
    pub fn get_threshold(&self, target_type: &str) -> f64 {
        if self.mode == "ssq" {
            if target_type == "red" { self.ssq_red_threshold } else { self.ssq_blue_threshold }
        } else {
            if target_type == "red" { self.dlt_red_threshold } else { self.dlt_blue_threshold }
        }
    }
    
    /// 获取当前彩种的输出数字个数（旧方法，保持兼容性）
    pub fn get_output_count(&self, target_type: &str) -> i32 {
        if self.mode == "ssq" {
            if target_type == "red" { self.ssq_red_output } else { self.ssq_blue_output }
        } else {
            if target_type == "red" { self.dlt_red_output } else { self.dlt_blue_output }
        }
    }
    
    /// 初始化后处理
    pub fn post_init(&self) {
        // 确保目录存在
        std::fs::create_dir_all(&self.data_dir).ok();
        std::fs::create_dir_all(&self.result_dir).ok();
    }
}
