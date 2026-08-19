//! optimization.rs - 优化函数模块
//!
//! 本模块实现各种优化函数，包括条件概率、集成学习等。

#![allow(dead_code)]
#![allow(unused_variables)]

use std::collections::HashMap;
use crate::formula::FormulaSpec;
use crate::config::GuaConfig;

/// 条件概率优化器
pub struct ConditionalProbabilityOptimizer {
    /// 条件概率表
    pub probability_table: HashMap<String, HashMap<i32, f64>>,
    /// 平滑参数
    pub smoothing: f64,
}

impl Default for ConditionalProbabilityOptimizer {
    fn default() -> Self {
        ConditionalProbabilityOptimizer {
            probability_table: HashMap::new(),
            smoothing: 1.0,
        }
    }
}

impl ConditionalProbabilityOptimizer {
    /// 创建新的条件概率优化器
    pub fn new() -> Self {
        ConditionalProbabilityOptimizer::default()
    }
    
    /// 训练条件概率模型
    /// 
    /// 参数:
    /// - conditions: 条件列表
    /// - results: 结果列表
    pub fn train(&mut self, conditions: &[String], results: &[i32]) {
        for (condition, result) in conditions.iter().zip(results.iter()) {
            let entry = self.probability_table
                .entry(condition.clone())
                .or_insert_with(HashMap::new);
            *entry.entry(*result).or_insert(0.0) += 1.0;
        }
    }
    
    /// 应用拉普拉斯平滑
    pub fn apply_smoothing(&mut self, total_results: i32) {
        for table in self.probability_table.values_mut() {
            for value in table.values_mut() {
                *value += self.smoothing;
            }
            
            // 归一化
            let total: f64 = table.values().copied().sum::<f64>() + self.smoothing * total_results as f64;
            for value in table.values_mut() {
                *value /= total;
            }
        }
    }
    
    /// 预测
    /// 
    /// 参数:
    /// - condition: 条件
    /// - top_n: 返回前N个结果
    /// 
    /// 返回:
    /// - 预测结果列表
    pub fn predict(&self, condition: &str, top_n: i32) -> Vec<(i32, f64)> {
        let mut results: Vec<(i32, f64)> = self.probability_table
            .get(condition)
            .map(|table| table.iter().map(|(&k, &v)| (k, v)).collect())
            .unwrap_or_default();
        
        results.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
        results.into_iter().take(top_n as usize).collect()
    }
}

/// 集成学习优化器
pub struct EnsembleOptimizer {
    /// 基学习器数量
    pub n_estimators: i32,
    /// 学习率
    pub learning_rate: f64,
    /// 最大深度
    pub max_depth: i32,
}

impl Default for EnsembleOptimizer {
    fn default() -> Self {
        EnsembleOptimizer {
            n_estimators: 10,
            learning_rate: 0.1,
            max_depth: 3,
        }
    }
}

impl EnsembleOptimizer {
    /// 创建新的集成学习优化器
    pub fn new() -> Self {
        EnsembleOptimizer::default()
    }
    
    /// 优化公式权重
    /// 
    /// 参数:
    /// - formulas: 公式列表
    /// - history: 历史预测结果
    /// 
    /// 返回:
    /// - 优化后的权重
    pub fn optimize_weights(
        &self,
        formulas: &[FormulaSpec],
        history: &[(Vec<i32>, i32)],  // (预测列表, 实际结果)
    ) -> Vec<f64> {
        let n = formulas.len();
        let mut weights = vec![1.0 / n as f64; n];
        
        // 简化的梯度下降优化
        for _ in 0..100 {
            let mut gradients = vec![0.0; n];
            
            for (predictions, actual) in history {
                for (i, pred) in predictions.iter().enumerate() {
                    if i < n {
                        if *pred == *actual {
                            gradients[i] += self.learning_rate;
                        } else {
                            gradients[i] -= self.learning_rate * 0.1;
                        }
                    }
                }
            }
            
            // 更新权重
            for (i, w) in weights.iter_mut().enumerate() {
                *w += gradients[i];
                *w = w.max(0.01).min(10.0);
            }
            
            // 归一化
            let total: f64 = weights.iter().sum();
            for w in &mut weights {
                *w /= total;
            }
        }
        
        weights
    }
}

/// 公式筛选优化器
pub struct FormulaFilterOptimizer {
    /// 最小命中率
    pub min_hit_rate: f64,
    /// 最大p值
    pub max_p_value: f64,
    /// 最小验证集改进
    pub min_val_improvement: f64,
}

impl Default for FormulaFilterOptimizer {
    fn default() -> Self {
        FormulaFilterOptimizer {
            min_hit_rate: 0.03,
            max_p_value: 0.15,
            min_val_improvement: 1.0,
        }
    }
}

impl FormulaFilterOptimizer {
    /// 创建新的公式筛选优化器
    pub fn new() -> Self {
        FormulaFilterOptimizer::default()
    }
    
    /// 筛选公式
    /// 
    /// 参数:
    /// - formulas: 公式列表
    /// - random_rate: 随机命中率
    /// 
    /// 返回:
    /// - 筛选后的公式列表
    pub fn filter(&self, formulas: Vec<FormulaSpec>, random_rate: f64) -> Vec<FormulaSpec> {
        formulas
            .into_iter()
            .filter(|f| {
                f.train_hit_rate >= self.min_hit_rate
                    && f.p_value <= self.max_p_value
                    && f.val_hit_rate >= random_rate * self.min_val_improvement
            })
            .collect()
    }
    
    /// 按命中率排序
    pub fn sort_by_hit_rate(&self, mut formulas: Vec<FormulaSpec>) -> Vec<FormulaSpec> {
        formulas.sort_by(|a, b| {
            b.train_hit_rate.partial_cmp(&a.train_hit_rate).unwrap()
        });
        formulas
    }
    
    /// 按p值排序
    pub fn sort_by_p_value(&self, mut formulas: Vec<FormulaSpec>) -> Vec<FormulaSpec> {
        formulas.sort_by(|a, b| {
            a.p_value.partial_cmp(&b.p_value).unwrap()
        });
        formulas
    }
}

/// 动态参数优化器
pub struct DynamicParameterOptimizer {
    /// 参数历史
    pub parameter_history: Vec<HashMap<String, f64>>,
    /// 性能历史
    pub performance_history: Vec<f64>,
}

impl Default for DynamicParameterOptimizer {
    fn default() -> Self {
        DynamicParameterOptimizer {
            parameter_history: Vec::new(),
            performance_history: Vec::new(),
        }
    }
}

impl DynamicParameterOptimizer {
    /// 创建新的动态参数优化器
    pub fn new() -> Self {
        DynamicParameterOptimizer::default()
    }
    
    /// 记录参数和性能
    pub fn record(&mut self, parameters: HashMap<String, f64>, performance: f64) {
        self.parameter_history.push(parameters);
        self.performance_history.push(performance);
    }
    
    /// 获取最佳参数
    /// 
    /// 返回:
    /// - 最佳参数
    pub fn get_best_parameters(&self) -> Option<HashMap<String, f64>> {
        if self.performance_history.is_empty() {
            return None;
        }
        
        let best_idx = self.performance_history
            .iter()
            .enumerate()
            .max_by(|(_, a), (_, b)| a.partial_cmp(b).unwrap())
            .map(|(idx, _)| idx);
        
        best_idx.and_then(|idx| self.parameter_history.get(idx).cloned())
    }
    
    /// 建议新参数
    /// 
    /// 基于历史性能建议新的参数组合
    pub fn suggest_parameters(&self) -> HashMap<String, f64> {
        if let Some(best) = self.get_best_parameters() {
            // 在最佳参数附近随机探索
            let mut new_params = best.clone();
            for (_, value) in new_params.iter_mut() {
                // 添加小扰动
                let noise = (rand::random::<f64>() - 0.5) * 0.1;
                *value = (*value + noise).max(0.01).min(1.0);
            }
            new_params
        } else {
            HashMap::new()
        }
    }
}

/// 统计显著性检验
pub fn statistical_significance_test(
    hits: i32,
    total: i32,
    random_rate: f64,
) -> f64 {
    if total == 0 {
        return 1.0;
    }
    
    let n = total as f64;
    let p = random_rate;
    let q = 1.0 - p;
    let expected = n * p;
    let std_dev = (n * p * q).sqrt();
    
    if std_dev > 0.0 {
        let z = (hits as f64 - expected) / std_dev;
        1.0 - normal_cdf(z)
    } else {
        1.0
    }
}

/// 标准正态分布的累积分布函数
fn normal_cdf(x: f64) -> f64 {
    0.5 * (1.0 + erf(x / std::f64::consts::SQRT_2))
}

/// 误差函数（erf）的近似计算
fn erf(x: f64) -> f64 {
    let a1 = 0.254829592;
    let a2 = -0.284496736;
    let a3 = 1.421413741;
    let a4 = -1.453152027;
    let a5 = 1.061405429;
    let p = 0.3275911;

    let sign = if x < 0.0 { -1.0 } else { 1.0 };
    let x = x.abs();

    let t = 1.0 / (1.0 + p * x);
    let y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * (-x * x).exp();

    sign * y
}

/// Bonferroni校正
pub fn bonferroni_correction(p_values: &[f64]) -> Vec<f64> {
    let n = p_values.len() as f64;
    p_values.iter().map(|&p| (p * n).min(1.0)).collect()
}

/// 贝叶斯平均
pub fn bayesian_average(
    hits: i32,
    total: i32,
    prior_hits: f64,
    prior_total: f64,
) -> f64 {
    (hits as f64 + prior_hits) / (total as f64 + prior_total)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_statistical_significance() {
        // 测试高命中率应该有低p值
        let p_value = statistical_significance_test(100, 1000, 1.0 / 33.0);
        assert!(p_value < 0.05);
    }
    
    #[test]
    fn test_bonferroni_correction() {
        let p_values = vec![0.01, 0.02, 0.03];
        let corrected = bonferroni_correction(&p_values);
        
        // 校正后p值应该增大
        assert!(corrected[0] >= p_values[0]);
    }
    
    #[test]
    fn test_bayesian_average() {
        let rate = bayesian_average(10, 100, 1.0, 10.0);
        
        // 贝叶斯平均应该在0和1之间
        assert!(rate > 0.0 && rate < 1.0);
    }
}
