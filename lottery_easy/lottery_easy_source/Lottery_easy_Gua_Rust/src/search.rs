//! search.rs - 公式搜索模块
//!
//! 本模块实现核心的公式搜索算法，包括多线程并行处理和进度条显示。
//! 
//! 关键优化：
//! ==========
//! 系统的计算瓶颈在_search_best_formulas_by_position_base函数的执行过程中，
//! 尤其是其内部的第一、第二步的计算，这两步在Rust重写时使用多线程并行处理。
//!
//! 重要配置：
//! ==========
//! - train_include_val: 训练集是否包含验证集
//! - sort_balls_for_position: 开奖号码是否按升序排列后再分配球位
//! - BH-FDR校正: 使用Benjamini-Hochberg方法替代Bonferroni校正

#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use rayon::prelude::*;
use indicatif::{ProgressBar, ProgressStyle};
use serde::{Serialize, Deserialize};

use crate::config::GuaConfig;
use crate::formula::{FormulaSpec, FormulaCandidate};
use crate::formula_generator::{generate_formula_candidates, generate_formula_candidates_aggressive};
use crate::gua_features::GuaData;

/// 开奖记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LotteryRecord {
    /// 期号
    pub issue: String,
    /// 开奖日期
    pub date: String,
    /// 红球号码（原始顺序）
    pub red_balls: Vec<i32>,
    /// 蓝球号码（原始顺序）
    pub blue_balls: Vec<i32>,
    /// 卦象数据
    pub gua_data: Option<GuaData>,
    /// 卦象特征
    pub features: Option<HashMap<String, i32>>,
}

impl Default for LotteryRecord {
    fn default() -> Self {
        LotteryRecord {
            issue: String::new(),
            date: String::new(),
            red_balls: Vec::new(),
            blue_balls: Vec::new(),
            gua_data: None,
            features: None,
        }
    }
}

impl LotteryRecord {
    /// 获取指定球位的开奖号码
    /// 
    /// 参数:
    /// - ball_type: 球类型 ("red" 或 "blue")
    /// - position: 球位编号
    /// - sort_balls: 是否按升序排列后再分配球位
    pub fn get_ball_by_position(&self, ball_type: &str, position: i32, sort_balls: bool) -> Option<i32> {
        match ball_type {
            "red" => {
                let balls = if sort_balls {
                    let mut sorted = self.red_balls.clone();
                    sorted.sort();
                    sorted
                } else {
                    self.red_balls.clone()
                };
                let idx = (position - 1) as usize;
                balls.get(idx).copied()
            }
            "blue" => {
                let balls = if sort_balls {
                    let mut sorted = self.blue_balls.clone();
                    sorted.sort();
                    sorted
                } else {
                    self.blue_balls.clone()
                };
                let idx = (position - 1) as usize;
                balls.get(idx).copied()
            }
            _ => None,
        }
    }
    
    /// 获取处理后的球列表
    /// 
    /// 参数:
    /// - ball_type: 球类型 ("red" 或 "blue")
    /// - sort_balls: 是否按升序排列
    pub fn get_balls(&self, ball_type: &str, sort_balls: bool) -> Vec<i32> {
        match ball_type {
            "red" => {
                if sort_balls {
                    let mut sorted = self.red_balls.clone();
                    sorted.sort();
                    sorted
                } else {
                    self.red_balls.clone()
                }
            }
            "blue" => {
                if sort_balls {
                    let mut sorted = self.blue_balls.clone();
                    sorted.sort();
                    sorted
                } else {
                    self.blue_balls.clone()
                }
            }
            _ => Vec::new()
        }
    }
}

/// 搜索结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    /// 球位key
    pub position_key: String,
    /// 球类型
    pub ball_type: String,
    /// 球位编号
    pub position: i32,
    /// 最佳公式列表
    pub best_formulas: Vec<FormulaSpec>,
    /// 训练集统计
    pub train_stats: TrainStats,
    /// 验证集统计
    pub val_stats: ValStats,
    /// 搜索耗时（毫秒）
    pub search_time_ms: u64,
}

/// 训练集统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainStats {
    pub total_periods: i32,
    pub total_formulas: i32,
    pub significant_formulas: i32,
}

/// 验证集统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValStats {
    pub total_periods: i32,
    pub high_rate_formulas: i32,
    pub best_hit_rate: f64,
}

/// BH-FDR校正（Benjamini-Hochberg方法）
/// 
/// 这是一种比Bonferroni更宽松的多重假设检验校正方法，
/// 特别适合大量测试的情况。
/// 
/// 参数:
/// - p_values: (公式ID, p值) 列表
/// - alpha: 显著性水平
/// 
/// 返回:
/// - 通过校正的公式ID列表
pub fn bh_fdr_correction(p_values: &[(String, f64)], alpha: f64) -> Vec<String> {
    if p_values.is_empty() {
        return Vec::new();
    }
    
    let num_tests = p_values.len() as f64;
    
    // 按p值排序
    let mut sorted_p: Vec<(String, f64)> = p_values.to_vec();
    sorted_p.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
    
    // 找到最大的k，使得 p(k) <= (k / m) * alpha
    let mut max_k = 0;
    for (k, (_, p_val)) in sorted_p.iter().enumerate() {
        let k_f64 = (k + 1) as f64;
        if *p_val <= (k_f64 / num_tests) * alpha {
            max_k = k + 1;
        }
    }
    
    // 返回前max_k个显著的结果
    sorted_p.iter()
        .take(max_k)
        .map(|(id, _)| id.clone())
        .collect()
}

/// 计算二项分布的p值
/// 
/// 使用正态近似计算p值（单侧检验：检验命中次数是否显著高于随机期望）
/// 
/// 参数:
/// - hits: 命中次数
/// - total: 总次数
/// - expected_rate: 期望命中率（随机概率）
/// 
/// 返回:
/// - p值（越小越显著）
pub fn calculate_p_value(hits: i32, total: i32, expected_rate: f64) -> f64 {
    if total == 0 || hits <= 0 {
        return 1.0;
    }
    
    // 期望命中次数
    let expected_hits = total as f64 * expected_rate;
    
    // 二项分布的标准差
    let variance = total as f64 * expected_rate * (1.0 - expected_rate);
    if variance <= 0.0 {
        return 1.0;
    }
    let std_dev = variance.sqrt();
    
    // z分数：检验命中次数是否显著高于期望
    let z_score = (hits as f64 - expected_hits) / std_dev;
    
    // 如果z分数 <= 0，说明不显著
    if z_score <= 0.0 {
        return 1.0;
    }
    
    // 使用近似公式计算标准正态分布的累积分布函数
    // P(Z > z) = 1 - Phi(z)
    // 使用Abramowitz and Stegun近似公式
    let t = 1.0 / (1.0 + 0.2316419 * z_score);
    let d = 0.3989422804 * (-z_score * z_score / 2.0).exp();
    let p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    
    // 返回单侧检验p值
    p
}

/// 按球位搜索最佳公式（基础版 v5.0 - 内部函数）
/// 
/// 这是系统的核心计算瓶颈，使用多线程并行处理优化性能。
/// 
/// 参数:
/// - features_list: 卦象特征列表（每期一个）
/// - records: 开奖记录列表
/// - config: 全局配置
/// - ball_type: 球类型 ("red" 或 "blue")
/// - position: 球位编号
/// - has_predict_date: 是否有预测日期
/// 
/// 返回:
/// - SearchResult: 搜索结果
/// 
/// 计算瓶颈说明：
/// ==========
/// 第一步：生成所有候选公式 - 计算量大，使用并行处理
/// 第二步：计算每个公式在训练集上的命中率 - 计算量最大，使用并行处理
/// 第三步：统计显著性检验（使用BH-FDR校正） - 相对较快
/// 第四步：验证集评估 - 使用并行处理
pub fn search_best_formulas_by_position_base(
    features_list: &[HashMap<String, i32>],
    records: &[LotteryRecord],
    config: &GuaConfig,
    ball_type: &str,
    position: i32,
    has_predict_date: bool,
) -> SearchResult {
    let start_time = std::time::Instant::now();
    
    // 获取球位配置
    let target_range = config.get_position_range(ball_type, position);
    let position_key = config.get_position_key(ball_type, position);
    let sort_balls = config.sort_balls_for_position;
    
    // 球位分配模式
    let sort_mode = if sort_balls { "排序后按位置" } else { "原始顺序按位置" };
    
    println!("\n{}", "=".repeat(60));
    println!("开始搜索: {} (范围: {}-{})", position_key, target_range.0, target_range.1);
    println!("球位分配模式: {}", sort_mode);
    println!("{}", "=".repeat(60));
    
    // ==================== 数据准备 ====================
    // 根据train_include_val配置分割训练集和验证集
    let total_count = records.len();
    let train_count = config.train_periods as usize;
    let val_count = config.val_periods as usize;
    
    let (train_features, train_records, val_features, val_records) = if config.train_include_val {
        // 开关打开：训练集包含验证集（所有数据）
        let train_data = features_list.to_vec();
        let train_recs = records.to_vec();
        
        // 验证集是最新N个数据
        let (val_feats, val_recs) = if has_predict_date {
            let val_size = val_count + 1;
            let val_feats = features_list[total_count.saturating_sub(val_size)..].to_vec();
            let val_recs = records[total_count.saturating_sub(val_size)..].to_vec();
            (val_feats, val_recs)
        } else {
            let val_feats = features_list[total_count.saturating_sub(val_count)..].to_vec();
            let val_recs = records[total_count.saturating_sub(val_count)..].to_vec();
            (val_feats, val_recs)
        };
        
        println!("\n数据分割 (训练集包含验证集模式):");
        println!("  总可用期数: {}", total_count);
        println!("  训练集: {} 期 (包含验证集)", train_data.len());
        println!("  验证集: {} 期 (最新)", val_recs.len());
        println!("  注意: 训练集包含验证集，存在数据泄露风险");
        
        (train_data, train_recs, val_feats, val_recs)
    } else {
        // 开关关闭：训练集和验证集分离
        let (train_start, train_end, val_start, val_end) = if has_predict_date {
            let val_size = val_count + 1;
            let train_end_idx = train_count.min(total_count.saturating_sub(val_size));
            (0, train_end_idx, train_end_idx, train_end_idx + val_size)
        } else {
            let train_end_idx = train_count.min(total_count.saturating_sub(val_count));
            (0, train_end_idx, train_end_idx, total_count)
        };
        
        let train_feats = features_list[train_start..train_end].to_vec();
        let train_recs = records[train_start..train_end].to_vec();
        let val_feats = features_list[val_start..val_end].to_vec();
        let val_recs = records[val_start..val_end].to_vec();
        
        println!("\n数据分割 (训练集与验证集分离模式):");
        println!("  总可用期数: {}", total_count);
        println!("  训练集: {} 期", train_recs.len());
        println!("  验证集: {} 期 (最新)", val_recs.len());
        
        (train_feats, train_recs, val_feats, val_recs)
    };
    
    // ==================== 第一步：生成候选公式（并行处理） ====================
    println!("\n[第一步] 生成候选公式...");
    let progress1 = ProgressBar::new(train_features.len() as u64);
    progress1.set_style(ProgressStyle::default_bar()
        .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta})")
        .unwrap()
        .progress_chars("#>-"));
    
    // 使用并行处理生成所有期的候选公式
    let all_candidates: Vec<Vec<FormulaCandidate>> = train_features
        .par_iter()
        .map(|features| {
            progress1.inc(1);
            if config.use_aggressive_formula_generator {
                generate_formula_candidates_aggressive(features, config, target_range, config.max_formula_candidates)
            } else {
                generate_formula_candidates(features, config, target_range)
            }
        })
        .collect();
    
    progress1.finish();
    
    // 合并并去重候选公式
    let mut unique_formulas: HashMap<String, FormulaSpec> = HashMap::new();
    for candidates in &all_candidates {
        for candidate in candidates {
            if !unique_formulas.contains_key(&candidate.formula.formula_id) {
                unique_formulas.insert(candidate.formula.formula_id.clone(), candidate.formula.clone());
            }
        }
    }
    
    let total_formulas = unique_formulas.len();
    println!("生成候选公式总数: {}", total_formulas);
    
    if total_formulas == 0 {
        println!("警告: 未发现任何公式候选！");
        return SearchResult {
            position_key,
            ball_type: ball_type.to_string(),
            position,
            best_formulas: Vec::new(),
            train_stats: TrainStats {
                total_periods: train_records.len() as i32,
                total_formulas: 0,
                significant_formulas: 0,
            },
            val_stats: ValStats {
                total_periods: val_records.len() as i32,
                high_rate_formulas: 0,
                best_hit_rate: 0.0,
            },
            search_time_ms: start_time.elapsed().as_millis() as u64,
        };
    }
    
    // ==================== 第二步：计算训练集命中率（并行处理 - 核心瓶颈） ====================
    println!("\n[第二步] 计算训练集命中率...");
    let progress2 = ProgressBar::new(total_formulas as u64);
    progress2.set_style(ProgressStyle::default_bar()
        .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta})")
        .unwrap()
        .progress_chars("#>-"));
    
    // 将公式转换为向量以便并行处理
    let formulas: Vec<FormulaSpec> = unique_formulas.into_values().collect();
    let formulas_arc = Arc::new(formulas);
    let train_features_arc = Arc::new(train_features.clone());
    let train_records_arc = Arc::new(train_records.clone());
    
    // 使用并行处理计算每个公式的命中率
    let hit_results: Vec<(String, i32, i32)> = formulas_arc
        .par_iter()
        .map(|formula| {
            progress2.inc(1);
            
            let mut hits = 0;
            let mut total = 0;
            
            for (idx, record) in train_records_arc.iter().enumerate() {
                // 使用sort_balls_for_position配置获取目标球
                if let Some(target_ball) = record.get_ball_by_position(ball_type, position, sort_balls) {
                    total += 1;
                    
                    // 获取该期的特征值
                    if let Some(features) = train_features_arc.get(idx) {
                        // 获取初始值
                        if let Some(&initial_value) = features.get(&formula.extractor_name) {
                            // 计算公式结果
                            let result = formula.calculate(initial_value);
                            
                            // 检查是否命中
                            if result == target_ball {
                                hits += 1;
                            }
                        }
                    }
                }
            }
            
            (formula.formula_id.clone(), hits, total)
        })
        .collect();
    
    progress2.finish();
    
    // 更新公式统计
    let mut formula_stats: HashMap<String, (i32, i32, f64)> = HashMap::new();
    for (id, hits, total) in hit_results {
        let hit_rate = if total > 0 { hits as f64 / total as f64 } else { 0.0 };
        formula_stats.insert(id, (hits, total, hit_rate));
    }
    
    // ==================== 第三步：统计显著性检验（使用BH-FDR校正） ====================
    println!("\n[第三步] 统计显著性检验...");
    
    let random_rate = 1.0 / (target_range.1 - target_range.0 + 1) as f64;
    
    // 第一步：筛选满足最低命中率要求的公式
    let min_rate = config.min_train_hit_rate.max(random_rate * 1.2);
    let mut candidates_pass_train: HashMap<String, FormulaSpec> = HashMap::new();
    
    for mut formula in formulas_arc.iter().cloned() {
        if let Some((hits, total, hit_rate)) = formula_stats.get(&formula.formula_id) {
            formula.update_train_stats(*hits, *total);
            
            if *hit_rate >= min_rate {
                candidates_pass_train.insert(formula.formula_id.clone(), formula);
            }
        }
    }
    
    println!("  训练集命中率 >{:.2}% 的公式: {}", min_rate * 100.0, candidates_pass_train.len());
    
    // 第二步：按特征组合去重（同特征不同mod_val本质上是同一测试）
    // combo_key = (sorted(features_keys), op_name)
    let mut unique_feature_combos: HashMap<(Vec<String>, String), (String, FormulaSpec)> = HashMap::new();
    
    for (id, formula) in candidates_pass_train.iter() {
        let features_keys = formula.get_sorted_features_keys();
        let op_name = formula.get_primary_op_name();
        let combo_key = (features_keys, op_name);
        
        // 如果这个组合不存在，或者当前公式的命中率更高，则更新
        let should_update = match unique_feature_combos.get(&combo_key) {
            None => true,
            Some((_, existing_formula)) => formula.train_hit_rate > existing_formula.train_hit_rate
        };
        
        if should_update {
            unique_feature_combos.insert(combo_key, (id.clone(), formula.clone()));
        }
    }
    
    // 构建去重后的公式数据
    let mut deduped_formulas: HashMap<String, FormulaSpec> = HashMap::new();
    for (_, (id, formula)) in unique_feature_combos.iter() {
        deduped_formulas.insert(id.clone(), formula.clone());
    }
    
    let num_tests = deduped_formulas.len();
    println!("  去重后独立特征组合: {}（原{}）", num_tests, candidates_pass_train.len());
    
    // 第三步：计算所有去重后公式的p值
    let mut p_values: Vec<(String, f64)> = Vec::new();
    
    for (id, formula) in deduped_formulas.iter() {
        let p_value = calculate_p_value(formula.train_hits, formula.train_total, random_rate);
        p_values.push((id.clone(), p_value));
    }
    
    // 应用BH-FDR校正
    let significant_ids = bh_fdr_correction(&p_values, config.significance_level);
    
    println!("  通过BH-FDR检验的公式: {}", significant_ids.len());
    
    // 创建p值映射表
    let p_value_map: HashMap<String, f64> = p_values.into_iter().collect();
    
    // 获取显著公式并更新p值
    let mut significant_formulas: Vec<FormulaSpec> = significant_ids.iter()
        .filter_map(|id| {
            let mut formula = deduped_formulas.get(id).cloned()?;
            // 更新p值
            if let Some(&p_val) = p_value_map.get(id) {
                formula.p_value = p_val;
            }
            Some(formula)
        })
        .collect();
    
    // 如果通过FDR的公式太少，补充训练集Top公式
    if significant_formulas.len() < 5 {
        println!("警告: 通过FDR的公式仅{}个，补充训练集Top公式...", significant_formulas.len());
        
        // 按命中率排序，补充公式（按特征组合去重）
        let mut sorted_by_rate: Vec<_> = deduped_formulas.iter()
            .filter(|(id, _)| !significant_ids.contains(id))
            .collect();
        sorted_by_rate.sort_by(|a, b| b.1.train_hit_rate.partial_cmp(&a.1.train_hit_rate).unwrap());
        
        // 按特征组合去重补充
        let mut seen_combos: std::collections::HashSet<(Vec<String>, String)> = std::collections::HashSet::new();
        let mut count = 0;
        
        for (id, formula) in sorted_by_rate.iter() {
            let combo_key = (formula.get_sorted_features_keys(), formula.get_primary_op_name());
            if !seen_combos.contains(&combo_key) {
                seen_combos.insert(combo_key);
                let mut f = (*formula).clone();
                // 更新p值
                if let Some(&p_val) = p_value_map.get(*id) {
                    f.p_value = p_val;
                }
                significant_formulas.push(f);
                count += 1;
                if count >= 50 {
                    break;
                }
            }
        }
    }
    
    // 按命中率排序
    significant_formulas.sort_by(|a, b| {
        b.train_hit_rate.partial_cmp(&a.train_hit_rate).unwrap()
    });
    
    // 限制数量
    if significant_formulas.len() > config.max_significant_formulas as usize {
        significant_formulas.truncate(config.max_significant_formulas as usize);
    }
    
    println!("显著公式数量: {}", significant_formulas.len());
    
    // ==================== 第四步：验证集评估（并行处理） ====================
    println!("\n[第四步] 验证集评估...");
    
    let mut best_hit_rate = 0.0;
    
    if !val_records.is_empty() && !significant_formulas.is_empty() {
        let progress4 = ProgressBar::new(significant_formulas.len() as u64);
        progress4.set_style(ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({eta})")
            .unwrap()
            .progress_chars("#>-"));
        
        let significant_formulas_arc = Arc::new(significant_formulas.clone());
        let val_features_arc = Arc::new(val_features.clone());
        let val_records_arc = Arc::new(val_records.clone());
        
        // 使用并行处理计算验证集命中率
        let val_results: Vec<(String, i32, i32)> = significant_formulas_arc
            .par_iter()
            .map(|formula| {
                progress4.inc(1);
                
                let mut hits = 0;
                let mut total = 0;
                
                for (idx, record) in val_records_arc.iter().enumerate() {
                    // 使用sort_balls_for_position配置获取目标球
                    if let Some(target_ball) = record.get_ball_by_position(ball_type, position, sort_balls) {
                        total += 1;
                        
                        if let Some(features) = val_features_arc.get(idx) {
                            if let Some(&initial_value) = features.get(&formula.extractor_name) {
                                let result = formula.calculate(initial_value);
                                if result == target_ball {
                                    hits += 1;
                                }
                            }
                        }
                    }
                }
                
                (formula.formula_id.clone(), hits, total)
            })
            .collect();
        
        progress4.finish();
        
        // 更新验证集统计
        let mut val_stats_map: HashMap<String, (i32, i32)> = HashMap::new();
        for (id, hits, total) in val_results {
            val_stats_map.insert(id, (hits, total));
        }
        
        for formula in &mut significant_formulas {
            if let Some((hits, total)) = val_stats_map.get(&formula.formula_id) {
                formula.update_val_stats(*hits, *total);
                if formula.val_hit_rate > best_hit_rate {
                    best_hit_rate = formula.val_hit_rate;
                }
            }
        }
        
        // 筛选高命中率公式
        significant_formulas.retain(|f| {
            f.val_hit_rate >= random_rate * config.min_val_improvement
        });
        
        // 按验证集命中率排序
        significant_formulas.sort_by(|a, b| {
            b.val_hit_rate.partial_cmp(&a.val_hit_rate).unwrap()
        });
    }
    
    // 限制数量
    if significant_formulas.len() > config.max_high_rate_formulas as usize {
        significant_formulas.truncate(config.max_high_rate_formulas as usize);
    }
    
    // ==================== 构建结果 ====================
    let elapsed = start_time.elapsed();
    
    println!("\n搜索完成!");
    println!("最佳公式数量: {}", significant_formulas.len());
    println!("耗时: {:.2} 秒", elapsed.as_secs_f64());
    
    // 打印前5个最佳公式
    if !significant_formulas.is_empty() {
        println!("\n前5个最佳公式:");
        for (i, formula) in significant_formulas.iter().take(5).enumerate() {
            println!("  {}. {}", i + 1, formula.format());
        }
    }
    
    SearchResult {
        position_key,
        ball_type: ball_type.to_string(),
        position,
        best_formulas: significant_formulas,
        train_stats: TrainStats {
            total_periods: train_records.len() as i32,
            total_formulas: total_formulas as i32,
            significant_formulas: 0,
        },
        val_stats: ValStats {
            total_periods: val_records.len() as i32,
            high_rate_formulas: 0,
            best_hit_rate,
        },
        search_time_ms: elapsed.as_millis() as u64,
    }
}

/// 搜索所有球位的最佳公式
/// 
/// 参数:
/// - features_list: 卦象特征列表
/// - records: 开奖记录列表
/// - config: 全局配置
/// - has_predict_date: 是否有预测日期
/// 
/// 返回:
/// - 所有球位的搜索结果
pub fn search_all_positions(
    features_list: &[HashMap<String, i32>],
    records: &[LotteryRecord],
    config: &GuaConfig,
    has_predict_date: bool,
) -> Vec<SearchResult> {
    let mut results = Vec::new();
    
    // 获取所有球位key
    let position_keys = config.get_all_position_keys();
    
    println!("\n开始搜索所有球位...");
    println!("球位数量: {}", position_keys.len());
    
    for position_key in &position_keys {
        // 解析球位key
        let parts: Vec<&str> = position_key.split('_').collect();
        if parts.len() >= 3 {
            let ball_type = parts[1];
            let position: i32 = parts[2].parse().unwrap_or(1);
            
            let result = search_best_formulas_by_position_base(
                features_list,
                records,
                config,
                ball_type,
                position,
                has_predict_date,
            );
            
            results.push(result);
        }
    }
    
    results
}

/// 使用公式进行预测
/// 
/// 参数:
/// - formula: 公式规范
/// - features: 卦象特征
/// 
/// 返回:
/// - 预测号码
pub fn predict_with_formula(formula: &FormulaSpec, features: &HashMap<String, i32>) -> Option<i32> {
    if let Some(&initial_value) = features.get(&formula.extractor_name) {
        Some(formula.calculate(initial_value))
    } else {
        None
    }
}

/// 使用多个公式进行预测（投票）
/// 
/// 参数:
/// - formulas: 公式列表
/// - features: 卦象特征
/// - target_range: 目标范围
/// - top_n: 返回前N个预测结果
/// 
/// 返回:
/// - 预测号码列表（按票数排序）
pub fn predict_with_voting(
    formulas: &[FormulaSpec],
    features: &HashMap<String, i32>,
    target_range: (i32, i32),
    top_n: i32,
) -> Vec<(i32, i32)> {
    let mut votes: HashMap<i32, i32> = HashMap::new();
    
    for formula in formulas {
        if let Some(result) = predict_with_formula(formula, features) {
            // 确保结果在目标范围内
            let mapped = map_to_range(result, target_range.0, target_range.1);
            *votes.entry(mapped).or_insert(0) += 1;
        }
    }
    
    // 按票数排序
    let mut sorted_votes: Vec<(i32, i32)> = votes.into_iter().collect();
    sorted_votes.sort_by(|a, b| b.1.cmp(&a.1));
    
    // 返回前N个
    sorted_votes.into_iter().take(top_n as usize).collect()
}

/// 映射到目标范围
fn map_to_range(value: i32, min_val: i32, max_val: i32) -> i32 {
    let range_size = max_val - min_val + 1;
    if range_size <= 0 {
        return min_val;
    }
    let result = ((value - min_val) % range_size + range_size) % range_size + min_val;
    result.max(min_val).min(max_val)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_lottery_record() {
        let record = LotteryRecord {
            issue: "2024001".to_string(),
            date: "2024-01-01".to_string(),
            red_balls: vec![15, 5, 10, 1, 20, 25],
            blue_balls: vec![7],
            ..Default::default()
        };
        
        // 测试不排序
        assert_eq!(record.get_ball_by_position("red", 1, false), Some(15));
        assert_eq!(record.get_ball_by_position("red", 6, false), Some(25));
        
        // 测试排序后
        assert_eq!(record.get_ball_by_position("red", 1, true), Some(1));
        assert_eq!(record.get_ball_by_position("red", 6, true), Some(25));
        
        assert_eq!(record.get_ball_by_position("blue", 1, false), Some(7));
    }
    
    #[test]
    fn test_map_to_range() {
        assert_eq!(map_to_range(5, 1, 33), 5);
        assert_eq!(map_to_range(35, 1, 33), 2);
        assert_eq!(map_to_range(0, 1, 33), 33);
    }
    
    #[test]
    fn test_bh_fdr_correction() {
        let p_values = vec![
            ("f1".to_string(), 0.001),
            ("f2".to_string(), 0.01),
            ("f3".to_string(), 0.05),
            ("f4".to_string(), 0.1),
            ("f5".to_string(), 0.2),
        ];
        
        let significant = bh_fdr_correction(&p_values, 0.05);
        assert!(!significant.is_empty());
    }
    
    #[test]
    fn test_calculate_p_value() {
        // 高命中率应该有低p值
        let p1 = calculate_p_value(50, 100, 0.03);
        assert!(p1 < 0.001);
        
        // 低命中率应该有高p值
        let p2 = calculate_p_value(3, 100, 0.03);
        assert!(p2 > 0.5);
    }
}
