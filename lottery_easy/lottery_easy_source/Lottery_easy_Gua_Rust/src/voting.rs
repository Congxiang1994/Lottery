//! voting.rs - 高级投票策略模块
//!
//! 本模块实现多种投票策略和动态权重调整。
//! 
//! 投票策略包括：
//! - 简单多数投票
//! - 加权投票
//! - 贝叶斯投票
//! - 动态权重调整
//! - 排序融合投票
//! - Borda计数法投票
//! - 自适应投票策略
//! - 多策略融合预测
//!
//! 核心优化策略：
//! 1. 公式多样性选择：确保选中的公式预测结果互补
//! 2. 动态权重调整：根据近期表现调整公式权重
//! 3. 多策略融合：结合多种投票策略
//! 4. 置信度评估：评估预测结果的可靠性
//! 5. 自适应输出：根据置信度动态调整输出数量

#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]

use std::collections::HashMap;
use crate::formula::FormulaSpec;
use crate::config::GuaConfig;

/// 高级投票策略类
/// 
/// 包含多种投票策略和动态权重调整
/// 
/// 目标：在output_count=3的情况下，将投票命中率提高到50%以上
pub struct AdvancedVotingStrategy {
    /// 号码最小值
    pub min_val: i32,
    /// 号码最大值
    pub max_val: i32,
    /// 号码范围大小
    pub range_size: i32,
    /// 输出候选数量
    pub output_count: i32,
    /// 随机命中率
    pub random_rate: f64,
}

impl AdvancedVotingStrategy {
    /// 创建新的投票策略
    /// 
    /// 参数:
    /// - min_val: 号码最小值
    /// - max_val: 号码最大值
    /// - output_count: 输出候选数量
    pub fn new(min_val: i32, max_val: i32, output_count: i32) -> Self {
        let range_size = max_val - min_val + 1;
        let random_rate = output_count as f64 / range_size as f64;
        AdvancedVotingStrategy {
            min_val,
            max_val,
            range_size,
            output_count,
            random_rate,
        }
    }
    
    /// 选择多样化的公式组合
    /// 
    /// 核心思想：
    /// - 不同公式应该产生不同的预测结果
    /// - 避免选择预测结果高度相似的公式
    /// - 优先选择命中率高的公式
    /// 
    /// 参数:
    /// - formulas: 公式列表
    /// - max_count: 最大选择数量
    /// - diversity_threshold: 多样性阈值（0-1，越高越严格）
    /// 
    /// 返回:
    /// - 选中的公式列表
    pub fn select_diverse_formulas(
        &self,
        formulas: &[FormulaSpec],
        max_count: i32,
        diversity_threshold: f64,
    ) -> Vec<FormulaSpec> {
        if formulas.len() <= max_count as usize {
            return formulas.to_vec();
        }
        
        let mut selected: Vec<FormulaSpec> = Vec::new();
        let mut selected_predictions: Vec<Vec<i32>> = Vec::new();
        
        // 按验证集命中率排序
        let mut sorted_formulas = formulas.to_vec();
        sorted_formulas.sort_by(|a, b| {
            b.val_hit_rate.partial_cmp(&a.val_hit_rate).unwrap()
        });
        
        for formula in sorted_formulas {
            if selected.len() >= max_count as usize {
                break;
            }
            
            // 获取该公式的预测序列
            let predictions = formula.val_results.clone();
            if predictions.is_empty() {
                continue;
            }
            
            // 计算与已选公式的相似度
            let mut is_diverse = true;
            for existing_preds in &selected_predictions {
                let similarity = self.calculate_prediction_similarity(&predictions, existing_preds);
                if similarity > diversity_threshold {
                    is_diverse = false;
                    break;
                }
            }
            
            if is_diverse {
                selected.push(formula);
                selected_predictions.push(predictions);
            }
        }
        
        selected
    }
    
    /// 计算两个预测序列的相似度
    /// 
    /// 使用Jaccard相似度计算
    /// 
    /// 参数:
    /// - preds1: 预测序列1
    /// - preds2: 预测序列2
    /// 
    /// 返回:
    /// - 相似度（0-1）
    fn calculate_prediction_similarity(&self, preds1: &[i32], preds2: &[i32]) -> f64 {
        if preds1.is_empty() || preds2.is_empty() {
            return 0.0;
        }
        
        let set1: std::collections::HashSet<i32> = preds1.iter().cloned().collect();
        let set2: std::collections::HashSet<i32> = preds2.iter().cloned().collect();
        
        let intersection = set1.intersection(&set2).count();
        let union = set1.union(&set2).count();
        
        if union > 0 {
            intersection as f64 / union as f64
        } else {
            0.0
        }
    }
    
    /// 计算动态权重
    /// 
    /// 根据近期表现调整公式权重：
    /// - 近期命中率高的公式权重增加
    /// - 近期命中率低的公式权重降低
    /// - 结合历史命中率和近期表现
    /// 
    /// 参数:
    /// - formulas: 公式列表
    /// - recent_periods: 近期期数
    /// 
    /// 返回:
    /// - 权重列表
    pub fn calculate_dynamic_weights(
        &self,
        formulas: &[FormulaSpec],
        recent_periods: i32,
    ) -> Vec<f64> {
        let mut weights = Vec::new();
        
        for formula in formulas {
            // 基础权重：验证集命中率
            let base_weight = formula.val_hit_rate;
            
            // 近期表现权重
            let combined_weight = if formula.val_results.len() >= recent_periods as usize {
                let recent_results: Vec<i32> = formula.val_results.iter()
                    .rev()
                    .take(recent_periods as usize)
                    .cloned()
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                
                let recent_targets: Vec<i32> = formula.val_targets.iter()
                    .rev()
                    .take(recent_periods as usize)
                    .cloned()
                    .collect::<Vec<_>>()
                    .into_iter()
                    .rev()
                    .collect();
                
                let recent_weight = if !recent_targets.is_empty() {
                    let recent_hits = recent_results.iter()
                        .zip(recent_targets.iter())
                        .filter(|(r, t)| r == t)
                        .count();
                    recent_hits as f64 / recent_results.len() as f64
                } else {
                    base_weight
                };
                
                // 综合权重：70%历史 + 30%近期
                0.7 * base_weight + 0.3 * recent_weight
            } else {
                base_weight
            };
            
            // 稳定性加成：命中率波动小的公式更可靠
            let train_rate = formula.train_hit_rate;
            let val_rate = formula.val_hit_rate;
            let stability = 1.0 - (train_rate - val_rate).abs();  // 稳定性因子
            let stability_bonus = 1.0 + 0.2 * stability;  // 最多增加20%
            
            let final_weight = combined_weight * stability_bonus;
            weights.push(final_weight);
        }
        
        // 归一化权重
        let total_weight: f64 = weights.iter().sum();
        if total_weight > 0.0 {
            weights = weights.iter().map(|w| w / total_weight).collect();
        }
        
        weights
    }
    
    /// 高级投票策略
    /// 
    /// 支持多种投票策略：
    /// 1. weighted_sum: 加权求和（默认）
    /// 2. rank_fusion: 排序融合
    /// 3. borda_count: Borda计数法
    /// 4. adaptive: 自适应策略
    /// 
    /// 参数:
    /// - formulas: 公式列表
    /// - features: 卦象特征
    /// - weights: 权重列表（可选）
    /// - strategy: 投票策略
    /// 
    /// 返回:
    /// - (预测数字列表, 票数字典, 置信度)
    pub fn advanced_voting(
        &self,
        formulas: &[FormulaSpec],
        features: &HashMap<String, i32>,
        weights: Option<&[f64]>,
        strategy: &str,
    ) -> (Vec<i32>, HashMap<i32, f64>, f64) {
        if formulas.is_empty() {
            return (Vec::new(), HashMap::new(), 0.0);
        }
        
        // 计算权重
        let weights = match weights {
            Some(w) => w.to_vec(),
            None => self.calculate_dynamic_weights(formulas, 30),
        };
        
        // 根据策略选择投票方法
        match strategy {
            "weighted_sum" => self.weighted_sum_voting(formulas, features, &weights),
            "rank_fusion" => self.rank_fusion_voting(formulas, features, &weights),
            "borda_count" => self.borda_count_voting(formulas, features, &weights),
            "adaptive" => self.adaptive_voting(formulas, features, &weights),
            _ => self.weighted_sum_voting(formulas, features, &weights),
        }
    }
    
    /// 加权求和投票
    /// 
    /// 每个公式计算一个预测值，根据权重累加票数
    fn weighted_sum_voting(
        &self,
        formulas: &[FormulaSpec],
        features: &HashMap<String, i32>,
        weights: &[f64],
    ) -> (Vec<i32>, HashMap<i32, f64>, f64) {
        let mut number_votes: HashMap<i32, f64> = HashMap::new();
        
        for (i, formula) in formulas.iter().enumerate() {
            let weight = if i < weights.len() { weights[i] } else { 1.0 };
            
            // 使用FormulaSpec计算预测值
            let result = formula.compute_mapped(features, self.min_val, self.max_val);
            
            *number_votes.entry(result).or_insert(0.0) += weight;
        }
        
        // 排序并选择
        let mut sorted_numbers: Vec<(i32, f64)> = number_votes.iter()
            .map(|(&k, &v)| (k, v))
            .collect();
        sorted_numbers.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        
        let predicted: Vec<i32> = sorted_numbers.iter()
            .take(self.output_count as usize)
            .map(|(num, _)| *num)
            .collect();
        
        // 计算置信度
        let confidence = self.calculate_confidence(&sorted_numbers, formulas.len());
        
        (predicted, number_votes, confidence)
    }
    
    /// 排序融合投票
    /// 
    /// 每个公式给出一个排序，融合多个排序得到最终结果
    fn rank_fusion_voting(
        &self,
        formulas: &[FormulaSpec],
        features: &HashMap<String, i32>,
        weights: &[f64],
    ) -> (Vec<i32>, HashMap<i32, f64>, f64) {
        // 收集所有预测值
        let mut all_predictions: Vec<(i32, f64)> = Vec::new();
        
        for (i, formula) in formulas.iter().enumerate() {
            let weight = if i < weights.len() { weights[i] } else { 1.0 };
            
            let result = formula.compute_mapped(features, self.min_val, self.max_val);
            all_predictions.push((result, weight));
        }
        
        // 排序融合：每个数字获得分数 = sum(weight / rank)
        let mut number_scores: HashMap<i32, f64> = HashMap::new();
        all_predictions.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        
        for (rank, (num, weight)) in all_predictions.iter().enumerate() {
            let rank = (rank + 1) as f64;
            *number_scores.entry(*num).or_insert(0.0) += weight / rank;
        }
        
        let mut sorted_numbers: Vec<(i32, f64)> = number_scores.iter()
            .map(|(&k, &v)| (k, v))
            .collect();
        sorted_numbers.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        
        let predicted: Vec<i32> = sorted_numbers.iter()
            .take(self.output_count as usize)
            .map(|(num, _)| *num)
            .collect();
        
        let confidence = self.calculate_confidence(&sorted_numbers, formulas.len());
        
        (predicted, number_scores, confidence)
    }
    
    /// Borda计数法投票
    /// 
    /// 每个公式给出一个完整排序，按Borda计数统计
    fn borda_count_voting(
        &self,
        formulas: &[FormulaSpec],
        features: &HashMap<String, i32>,
        weights: &[f64],
    ) -> (Vec<i32>, HashMap<i32, f64>, f64) {
        // 收集所有公式的预测值并排序
        let mut all_rankings: Vec<(i32, f64)> = Vec::new();
        
        for (i, formula) in formulas.iter().enumerate() {
            let weight = if i < weights.len() { weights[i] } else { 1.0 };
            
            let result = formula.compute_mapped(features, self.min_val, self.max_val);
            all_rankings.push((result, weight));
        }
        
        // Borda计数：第一名得range_size分，第二名得range_size-1分...
        let mut borda_scores: HashMap<i32, f64> = HashMap::new();
        all_rankings.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        
        for (rank, (num, weight)) in all_rankings.iter().enumerate() {
            let borda_score = (self.range_size - rank as i32) as f64 * weight;
            *borda_scores.entry(*num).or_insert(0.0) += borda_score;
        }
        
        let mut sorted_numbers: Vec<(i32, f64)> = borda_scores.iter()
            .map(|(&k, &v)| (k, v))
            .collect();
        sorted_numbers.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        
        let predicted: Vec<i32> = sorted_numbers.iter()
            .take(self.output_count as usize)
            .map(|(num, _)| *num)
            .collect();
        
        let confidence = self.calculate_confidence(&sorted_numbers, formulas.len());
        
        (predicted, borda_scores, confidence)
    }
    
    /// 自适应投票策略
    /// 
    /// 根据公式数量和分布自动选择最佳投票策略
    fn adaptive_voting(
        &self,
        formulas: &[FormulaSpec],
        features: &HashMap<String, i32>,
        weights: &[f64],
    ) -> (Vec<i32>, HashMap<i32, f64>, f64) {
        // 计算公式预测的多样性
        let predictions: Vec<i32> = formulas.iter()
            .map(|formula| formula.compute_mapped(features, self.min_val, self.max_val))
            .collect();
        
        let unique_predictions = predictions.iter().cloned().collect::<std::collections::HashSet<i32>>().len();
        let diversity_ratio = if !predictions.is_empty() {
            unique_predictions as f64 / predictions.len() as f64
        } else {
            0.0
        };
        
        // 根据多样性选择策略
        if diversity_ratio > 0.8 {
            // 高多样性：使用Borda计数
            self.borda_count_voting(formulas, features, weights)
        } else if diversity_ratio > 0.5 {
            // 中等多样性：使用排序融合
            self.rank_fusion_voting(formulas, features, weights)
        } else {
            // 低多样性：使用加权求和
            self.weighted_sum_voting(formulas, features, weights)
        }
    }
    
    /// 计算预测置信度
    /// 
    /// 基于以下因素：
    /// 1. 票数集中度：前几名的票数占比
    /// 2. 公式数量：更多公式意味着更高的可靠性
    /// 3. 票数差距：前几名之间的票数差距
    /// 
    /// 参数:
    /// - sorted_numbers: 排序后的(数字, 票数)列表
    /// - total_formulas: 公式总数
    /// 
    /// 返回:
    /// - 置信度（0-1）
    fn calculate_confidence(
        &self,
        sorted_numbers: &[(i32, f64)],
        total_formulas: usize,
    ) -> f64 {
        if sorted_numbers.is_empty() || total_formulas == 0 {
            return 0.0;
        }
        
        // 计算票数集中度
        let total_votes: f64 = sorted_numbers.iter().map(|(_, v)| v).sum();
        if total_votes == 0.0 {
            return 0.0;
        }
        
        let top_votes: f64 = sorted_numbers.iter()
            .take(self.output_count as usize)
            .map(|(_, v)| v)
            .sum();
        let concentration = top_votes / total_votes;
        
        // 计算票数差距
        let gap = if sorted_numbers.len() >= 2 {
            (sorted_numbers[0].1 - sorted_numbers[1].1) / total_votes
        } else {
            1.0
        };
        
        // 公式数量因子
        let formula_factor = (total_formulas as f64 / 10.0).min(1.0);  // 10个公式达到饱和
        
        // 综合置信度
        let confidence = 0.5 * concentration + 0.3 * gap + 0.2 * formula_factor;
        
        confidence.min(1.0)
    }
    
    /// 多策略融合预测
    /// 
    /// 结合多种投票策略的结果，取交集和并集的平衡
    /// 
    /// 参数:
    /// - formulas: 公式列表
    /// - features: 卦象特征
    /// - weights: 权重列表
    /// 
    /// 返回:
    /// - (预测数字列表, 票数字典, 置信度)
    pub fn multi_strategy_fusion(
        &self,
        formulas: &[FormulaSpec],
        features: &HashMap<String, i32>,
        weights: Option<&[f64]>,
    ) -> (Vec<i32>, HashMap<i32, f64>, f64) {
        if formulas.is_empty() {
            return (Vec::new(), HashMap::new(), 0.0);
        }
        
        let weights = match weights {
            Some(w) => w.to_vec(),
            None => self.calculate_dynamic_weights(formulas, 30),
        };
        
        // 使用多种策略预测
        let strategies = ["weighted_sum", "rank_fusion", "borda_count"];
        let mut all_predictions: Vec<Vec<i32>> = Vec::new();
        let mut all_votes: Vec<HashMap<i32, f64>> = Vec::new();
        
        for strategy in &strategies {
            let (predicted, votes, _) = self.advanced_voting(formulas, features, Some(&weights), strategy);
            all_predictions.push(predicted);
            all_votes.push(votes);
        }
        
        // 融合票数
        let mut fused_votes: HashMap<i32, f64> = HashMap::new();
        for votes in &all_votes {
            for (&num, &vote) in votes {
                *fused_votes.entry(num).or_insert(0.0) += vote;
            }
        }
        
        // 归一化
        for vote in fused_votes.values_mut() {
            *vote /= strategies.len() as f64;
        }
        
        // 排序
        let mut sorted_numbers: Vec<(i32, f64)> = fused_votes.iter()
            .map(|(&k, &v)| (k, v))
            .collect();
        sorted_numbers.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        
        // 选择预测结果：优先选择多策略都认可的数字
        let intersection: std::collections::HashSet<i32> = all_predictions[0].iter()
            .cloned()
            .collect::<std::collections::HashSet<i32>>()
            .intersection(&all_predictions[1].iter().cloned().collect())
            .cloned()
            .collect::<std::collections::HashSet<i32>>()
            .intersection(&all_predictions[2].iter().cloned().collect())
            .cloned()
            .collect();
        
        let mut predicted: Vec<i32> = Vec::new();
        
        // 先添加交集
        for (num, _) in &sorted_numbers {
            if intersection.contains(num) && !predicted.contains(num) {
                predicted.push(*num);
                if predicted.len() >= self.output_count as usize {
                    break;
                }
            }
        }
        
        // 如果交集不够，添加票数最高的
        for (num, _) in &sorted_numbers {
            if !predicted.contains(num) {
                predicted.push(*num);
                if predicted.len() >= self.output_count as usize {
                    break;
                }
            }
        }
        
        let confidence = self.calculate_confidence(&sorted_numbers, formulas.len());
        
        (predicted, fused_votes, confidence)
    }
}

/// 多策略集成投票
/// 
/// 使用多种投票策略进行集成投票
pub struct EnsembleVoting {
    /// 投票策略列表
    pub strategies: Vec<AdvancedVotingStrategy>,
    /// 策略权重
    pub strategy_weights: Vec<f64>,
}

impl Default for EnsembleVoting {
    fn default() -> Self {
        EnsembleVoting {
            strategies: vec![
                AdvancedVotingStrategy::new(1, 33, 3),
                AdvancedVotingStrategy::new(1, 33, 3),
                AdvancedVotingStrategy::new(1, 33, 3),
            ],
            strategy_weights: vec![1.0, 1.5, 2.0],
        }
    }
}

impl EnsembleVoting {
    /// 创建新的集成投票
    pub fn new() -> Self {
        EnsembleVoting::default()
    }
    
    /// 执行集成投票
    /// 
    /// 参数:
    /// - formulas: 公式列表
    /// - features: 卦象特征
    /// - target_range: 目标范围
    /// - top_n: 返回前N个结果
    /// 
    /// 返回:
    /// - 预测号码列表（按票数排序）
    pub fn vote(
        &self,
        formulas: &[FormulaSpec],
        features: &HashMap<String, i32>,
        target_range: (i32, i32),
        top_n: i32,
    ) -> Vec<(i32, f64)> {
        let mut total_votes: HashMap<i32, f64> = HashMap::new();
        
        // 对每个策略进行投票
        for (strategy, &weight) in self.strategies.iter().zip(self.strategy_weights.iter()) {
            let (predicted, votes, _) = strategy.multi_strategy_fusion(formulas, features, None);
            
            // 加权合并
            for num in predicted {
                let vote = votes.get(&num).copied().unwrap_or(0.0);
                *total_votes.entry(num).or_insert(0.0) += vote * weight;
            }
        }
        
        // 按票数排序
        let mut sorted_votes: Vec<(i32, f64)> = total_votes.into_iter().collect();
        sorted_votes.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        
        // 返回前N个
        sorted_votes.into_iter().take(top_n as usize).collect()
    }
}

/// 条件概率投票
/// 
/// 根据条件概率进行投票
pub struct ConditionalProbabilityVoting {
    /// 条件概率表
    pub probability_table: HashMap<String, HashMap<i32, f64>>,
}

impl Default for ConditionalProbabilityVoting {
    fn default() -> Self {
        ConditionalProbabilityVoting {
            probability_table: HashMap::new(),
        }
    }
}

impl ConditionalProbabilityVoting {
    /// 创建新的条件概率投票
    pub fn new() -> Self {
        ConditionalProbabilityVoting::default()
    }
    
    /// 更新条件概率表
    /// 
    /// 参数:
    /// - condition: 条件名称
    /// - result: 结果号码
    pub fn update(&mut self, condition: &str, result: i32) {
        let entry = self.probability_table.entry(condition.to_string()).or_insert_with(HashMap::new);
        *entry.entry(result).or_insert(0.0) += 1.0;
    }
    
    /// 归一化概率表
    pub fn normalize(&mut self) {
        for (_, table) in self.probability_table.iter_mut() {
            let total: f64 = table.values().sum();
            if total > 0.0 {
                for value in table.values_mut() {
                    *value /= total;
                }
            }
        }
    }
    
    /// 获取条件概率
    /// 
    /// 参数:
    /// - condition: 条件名称
    /// - result: 结果号码
    /// 
    /// 返回:
    /// - 条件概率
    pub fn get_probability(&self, condition: &str, result: i32) -> f64 {
        self.probability_table
            .get(condition)
            .and_then(|table| table.get(&result))
            .copied()
            .unwrap_or(0.0)
    }
    
    /// 执行条件概率投票
    /// 
    /// 参数:
    /// - conditions: 条件列表
    /// - target_range: 目标范围
    /// - top_n: 返回前N个结果
    /// 
    /// 返回:
    /// - 预测号码列表（按概率排序）
    pub fn vote(
        &self,
        conditions: &[String],
        target_range: (i32, i32),
        top_n: i32,
    ) -> Vec<(i32, f64)> {
        let mut probabilities: HashMap<i32, f64> = HashMap::new();
        
        // 对每个条件进行概率计算
        for condition in conditions {
            if let Some(table) = self.probability_table.get(condition) {
                for (&result, &prob) in table {
                    *probabilities.entry(result).or_insert(0.0) += prob;
                }
            }
        }
        
        // 归一化
        let total: f64 = probabilities.values().sum();
        if total > 0.0 {
            for value in probabilities.values_mut() {
                *value /= total;
            }
        }
        
        // 按概率排序
        let mut sorted_probs: Vec<(i32, f64)> = probabilities.into_iter().collect();
        sorted_probs.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        
        // 返回前N个
        sorted_probs.into_iter().take(top_n as usize).collect()
    }
}

/// 投票结果
#[derive(Debug, Clone)]
pub struct VotingResult {
    /// 预测号码
    pub number: i32,
    /// 票数/概率
    pub score: f64,
    /// 来源公式数量
    pub formula_count: i32,
    /// 来源策略
    pub strategies: Vec<String>,
}

impl VotingResult {
    pub fn new(number: i32, score: f64) -> Self {
        VotingResult {
            number,
            score,
            formula_count: 1,
            strategies: Vec::new(),
        }
    }
    
    pub fn add_strategy(&mut self, strategy: &str) {
        if !self.strategies.contains(&strategy.to_string()) {
            self.strategies.push(strategy.to_string());
        }
    }
}

/// 映射到目标范围
pub fn map_to_range(value: i32, min_val: i32, max_val: i32) -> i32 {
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
    fn test_advanced_voting_strategy() {
        let strategy = AdvancedVotingStrategy::new(1, 33, 3);
        
        assert_eq!(strategy.min_val, 1);
        assert_eq!(strategy.max_val, 33);
        assert_eq!(strategy.output_count, 3);
        assert!((strategy.random_rate - 3.0 / 33.0).abs() < 0.001);
    }
    
    #[test]
    fn test_select_diverse_formulas() {
        let strategy = AdvancedVotingStrategy::new(1, 33, 3);
        let formulas = vec![
            FormulaSpec::default(),
            FormulaSpec::default(),
            FormulaSpec::default(),
        ];
        
        let selected = strategy.select_diverse_formulas(&formulas, 2, 0.7);
        
        assert!(selected.len() <= 2);
    }
    
    #[test]
    fn test_conditional_probability_voting() {
        let mut voting = ConditionalProbabilityVoting::new();
        
        // 更新概率表
        voting.update("condition1", 5);
        voting.update("condition1", 5);
        voting.update("condition1", 10);
        voting.normalize();
        
        // 验证概率
        let prob5 = voting.get_probability("condition1", 5);
        let prob10 = voting.get_probability("condition1", 10);
        
        assert!(prob5 > prob10);
    }
    
    #[test]
    fn test_map_to_range() {
        assert_eq!(map_to_range(5, 1, 33), 5);
        assert_eq!(map_to_range(35, 1, 33), 2);
        assert_eq!(map_to_range(-1, 1, 33), 32);
    }
}
