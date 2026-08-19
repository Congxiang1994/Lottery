//! formula.rs - 公式规范类
//!
//! 存储完整的公式计算逻辑，包括特征提取、操作链、结果映射等。
//! FormulaSpec类是整个系统的核心数据结构之一。

#![allow(dead_code)]

use serde::{Serialize, Deserialize};

/// 公式规范类 - 存储完整的公式计算逻辑
/// 
/// 一个完整的公式包括：
/// 1. 特征提取器：从卦象特征中提取初始值
/// 2. 操作链：对初始值进行一系列数学操作
/// 3. 结果映射：将计算结果映射到目标范围
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormulaSpec {
    /// 公式名称（描述性名称）
    pub name: String,
    
    /// 特征提取器名称
    pub extractor_name: String,
    
    /// 操作链（操作名称列表）
    pub operations: Vec<String>,
    
    /// 操作参数（可选）
    pub operation_params: Vec<i32>,
    
    /// 目标范围 (最小值, 最大值)
    pub target_range: (i32, i32),
    
    /// 公式描述
    pub description: String,
    
    /// 公式ID（用于唯一标识）
    pub formula_id: String,
    
    /// 命中次数（训练集）
    pub train_hits: i32,
    
    /// 总期数（训练集）
    pub train_total: i32,
    
    /// 命中率（训练集）
    pub train_hit_rate: f64,
    
    /// 命中次数（验证集）
    pub val_hits: i32,
    
    /// 总期数（验证集）
    pub val_total: i32,
    
    /// 命中率（验证集）
    pub val_hit_rate: f64,
    
    /// p值（统计显著性）
    pub p_value: f64,
    
    /// 是否显著
    pub is_significant: bool,
    
    /// 权重（用于投票）
    pub weight: f64,
    
    /// 验证集预测结果列表
    pub val_results: Vec<i32>,
    
    /// 验证集目标值列表
    pub val_targets: Vec<i32>,
    
    /// 训练集预测结果列表
    pub train_results: Vec<i32>,
    
    /// 训练集目标值列表
    pub train_targets: Vec<i32>,
}

impl Default for FormulaSpec {
    fn default() -> Self {
        FormulaSpec {
            name: String::new(),
            extractor_name: String::new(),
            operations: Vec::new(),
            operation_params: Vec::new(),
            target_range: (1, 33),
            description: String::new(),
            formula_id: String::new(),
            train_hits: 0,
            train_total: 0,
            train_hit_rate: 0.0,
            val_hits: 0,
            val_total: 0,
            val_hit_rate: 0.0,
            p_value: 1.0,
            is_significant: false,
            weight: 1.0,
            val_results: Vec::new(),
            val_targets: Vec::new(),
            train_results: Vec::new(),
            train_targets: Vec::new(),
        }
    }
}

impl FormulaSpec {
    /// 创建新的公式规范
    pub fn new(
        name: String,
        extractor_name: String,
        operations: Vec<String>,
        operation_params: Vec<i32>,
        target_range: (i32, i32),
    ) -> Self {
        let formula_id = Self::generate_formula_id(&extractor_name, &operations, &operation_params);
        let description = Self::generate_description(&extractor_name, &operations, &operation_params);
        
        FormulaSpec {
            name,
            extractor_name,
            operations,
            operation_params,
            target_range,
            description,
            formula_id,
            ..Default::default()
        }
    }
    
    /// 生成公式ID
    fn generate_formula_id(extractor: &str, ops: &[String], params: &[i32]) -> String {
        let mut id = extractor.to_string();
        for (i, op) in ops.iter().enumerate() {
            id.push_str(&format!("_{}", op));
            if i < params.len() {
                id.push_str(&format!("_{}", params[i]));
            }
        }
        id
    }
    
    /// 生成公式描述
    fn generate_description(extractor: &str, ops: &[String], params: &[i32]) -> String {
        let mut desc = format!("特征[{}]", extractor);
        for (i, op) in ops.iter().enumerate() {
            if i < params.len() {
                desc.push_str(&format!(" -> {}({})", op, params[i]));
            } else {
                desc.push_str(&format!(" -> {}", op));
            }
        }
        desc
    }
    
    /// 计算公式结果
    /// 
    /// 参数:
    /// - initial_value: 初始值（从特征提取器获得）
    /// 
    /// 返回:
    /// - 计算结果（已映射到目标范围）
    pub fn calculate(&self, initial_value: i32) -> i32 {
        let mut result = initial_value;
        
        // 应用操作链
        for (i, op_name) in self.operations.iter().enumerate() {
            let param = if i < self.operation_params.len() {
                self.operation_params[i]
            } else {
                0
            };
            
            result = self.apply_operation(result, op_name, param);
        }
        
        // 映射到目标范围
        self.map_to_range(result)
    }
    
    /// 从特征字典计算预测值并映射到目标范围
    /// 
    /// 参数:
    /// - features: 卦象特征字典
    /// - min_val: 目标最小值
    /// - max_val: 目标最大值
    /// 
    /// 返回:
    /// - 计算结果（已映射到目标范围）
    pub fn compute_mapped(&self, features: &std::collections::HashMap<String, i32>, min_val: i32, max_val: i32) -> i32 {
        // 从特征字典中提取初始值
        let initial_value = features.get(&self.extractor_name).copied().unwrap_or(0);
        
        // 计算结果
        let mut result = initial_value;
        
        // 应用操作链
        for (i, op_name) in self.operations.iter().enumerate() {
            let param = if i < self.operation_params.len() {
                self.operation_params[i]
            } else {
                0
            };
            
            result = self.apply_operation(result, op_name, param);
        }
        
        // 映射到目标范围
        let range_size = max_val - min_val + 1;
        if range_size <= 0 {
            return min_val;
        }
        let mapped = ((result - min_val) % range_size + range_size) % range_size + min_val;
        mapped.max(min_val).min(max_val)
    }
    
    /// 应用单个操作
    fn apply_operation(&self, value: i32, op_name: &str, param: i32) -> i32 {
        match op_name {
            // 基础运算
            "add" => value + param,
            "sub" => value - param,
            "mul" => value * param,
            "div" => {
                if param != 0 {
                    value / param
                } else {
                    value
                }
            }
            
            // 取模运算
            "mod" => {
                if param > 0 {
                    ((value % param) + param) % param
                } else {
                    value
                }
            }
            "mod_add" => {
                if param > 0 {
                    ((value % param) + param) % param + 1
                } else {
                    value
                }
            }
            
            // 移位操作
            "shift_left" => value << param,
            "shift_right" => value >> param,
            "rotate_left" => {
                let bits = param as u32;
                (value << bits) | (value >> (32 - bits))
            }
            "rotate_right" => {
                let bits = param as u32;
                (value >> bits) | (value << (32 - bits))
            }
            
            // 特殊操作（玄学相关）
            "bagua_transform" => self.bagua_transform(value, param),
            "wuxing_transform" => self.wuxing_transform(value, param),
            "hetu_transform" => self.hetu_transform(value, param),
            "najia_transform" => self.najia_transform(value, param),
            
            // 其他操作
            "abs" => value.abs(),
            "neg" => -value,
            "square" => value * value,
            "sqrt" => (value as f64).sqrt() as i32,
            
            // 组合操作
            "combine" => value * 10 + param,
            "split_sum" => self.digit_sum(value),
            "reverse" => self.reverse_digits(value),
            
            // 默认
            _ => value,
        }
    }
    
    /// 八卦变换
    fn bagua_transform(&self, value: i32, param: i32) -> i32 {
        // 将值映射到八卦，然后根据参数进行变换
        let gua_num = ((value - 1) % 8 + 8) % 8 + 1;
        match param {
            1 => gua_num,                    // 直接取八卦数
            2 => gua_num * value,            // 八卦数乘原值
            3 => (gua_num + value) % 64,     // 卦象组合
            _ => gua_num,
        }
    }
    
    /// 五行变换
    fn wuxing_transform(&self, value: i32, param: i32) -> i32 {
        // 将值映射到五行
        let wuxing_num = ((value - 1) % 5 + 5) % 5 + 1;
        match param {
            1 => wuxing_num,
            2 => wuxing_num * value,
            3 => (wuxing_num + value) % 10,
            _ => wuxing_num,
        }
    }
    
    /// 河图变换
    fn hetu_transform(&self, value: i32, param: i32) -> i32 {
        // 河图数：一六水、二七火、三八木、四九金、五十土
        let hetu_pairs = [(1, 6), (2, 7), (3, 8), (4, 9), (5, 10)];
        let idx = ((value - 1) % 5) as usize;
        if idx < hetu_pairs.len() {
            let (a, b) = hetu_pairs[idx];
            match param {
                1 => a,
                2 => b,
                3 => a + b,
                4 => b - a,
                _ => a,
            }
        } else {
            value
        }
    }
    
    /// 纳甲变换
    fn najia_transform(&self, value: i32, param: i32) -> i32 {
        // 纳甲法：将天干地支纳入卦象
        let tiangan = ((value - 1) % 10 + 10) % 10 + 1;
        let dizhi = ((value - 1) % 12 + 12) % 12 + 1;
        match param {
            1 => tiangan,
            2 => dizhi,
            3 => tiangan + dizhi,
            4 => tiangan * dizhi,
            _ => tiangan,
        }
    }
    
    /// 数字各位之和
    fn digit_sum(&self, value: i32) -> i32 {
        let mut sum = 0;
        let mut n = value.abs();
        while n > 0 {
            sum += n % 10;
            n /= 10;
        }
        sum
    }
    
    /// 反转数字各位
    fn reverse_digits(&self, value: i32) -> i32 {
        let mut reversed = 0;
        let mut n = value.abs();
        while n > 0 {
            reversed = reversed * 10 + n % 10;
            n /= 10;
        }
        if value < 0 { -reversed } else { reversed }
    }
    
    /// 映射到目标范围
    fn map_to_range(&self, value: i32) -> i32 {
        let (min_val, max_val) = self.target_range;
        let range_size = max_val - min_val + 1;
        if range_size <= 0 {
            return min_val;
        }
        let result = ((value - min_val) % range_size + range_size) % range_size + min_val;
        result.max(min_val).min(max_val)
    }
    
    /// 更新训练集统计
    pub fn update_train_stats(&mut self, hits: i32, total: i32) {
        self.train_hits = hits;
        self.train_total = total;
        self.train_hit_rate = if total > 0 {
            hits as f64 / total as f64
        } else {
            0.0
        };
    }
    
    /// 更新验证集统计
    pub fn update_val_stats(&mut self, hits: i32, total: i32) {
        self.val_hits = hits;
        self.val_total = total;
        self.val_hit_rate = if total > 0 {
            hits as f64 / total as f64
        } else {
            0.0
        };
    }
    
    /// 计算p值（二项检验）
    pub fn calculate_p_value(&mut self, random_rate: f64) {
        if self.train_total > 0 {
            // 使用正态近似计算p值
            let n = self.train_total as f64;
            let p = random_rate;
            let q = 1.0 - p;
            let expected = n * p;
            let std_dev = (n * p * q).sqrt();
            
            if std_dev > 0.0 {
                let z = (self.train_hits as f64 - expected) / std_dev;
                // 使用标准正态分布的累积分布函数
                self.p_value = 1.0 - normal_cdf(z);
            } else {
                self.p_value = 1.0;
            }
        }
    }
    
    /// 获取排序后的特征键列表（用于去重）
    /// 
    /// extractor_name格式: "feature1,feature2,feature3"
    /// 返回排序后的特征键向量
    pub fn get_sorted_features_keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = self.extractor_name
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();
        keys.sort();
        keys
    }
    
    /// 获取主操作名称（用于去重）
    /// 
    /// 返回第一个操作名称，如果没有操作则返回空字符串
    pub fn get_primary_op_name(&self) -> String {
        self.operations.first().cloned().unwrap_or_default()
    }
    
    /// 格式化输出
    pub fn format(&self) -> String {
        format!(
            "{} | 训练: {}/{} ({:.2}%) | 验证: {}/{} ({:.2}%) | p={:.4} | 权重={:.2}",
            self.description,
            self.train_hits, self.train_total, self.train_hit_rate * 100.0,
            self.val_hits, self.val_total, self.val_hit_rate * 100.0,
            self.p_value,
            self.weight,
        )
    }
}

/// 标准正态分布的累积分布函数
fn normal_cdf(x: f64) -> f64 {
    // 使用近似公式
    0.5 * (1.0 + erf(x / std::f64::consts::SQRT_2))
}

/// 误差函数（erf）的近似计算
fn erf(x: f64) -> f64 {
    // 使用Horner方法的近似
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

/// 公式候选（公式规范 + 初始值）
#[derive(Debug, Clone)]
pub struct FormulaCandidate {
    /// 公式规范
    pub formula: FormulaSpec,
    /// 初始值（从特征提取器获得）
    pub initial_value: i32,
}

impl FormulaCandidate {
    pub fn new(formula: FormulaSpec, initial_value: i32) -> Self {
        FormulaCandidate {
            formula,
            initial_value,
        }
    }
    
    /// 计算公式结果
    pub fn calculate(&self) -> i32 {
        self.formula.calculate(self.initial_value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_formula_spec_basic() {
        let formula = FormulaSpec::new(
            "测试公式".to_string(),
            "ben_gua_num".to_string(),
            vec!["add".to_string(), "mod".to_string()],
            vec![5, 33],
            (1, 33),
        );
        
        // 测试计算: (1 + 5) % 33 = 6
        let result = formula.calculate(1);
        assert_eq!(result, 6);
    }
    
    #[test]
    fn test_formula_spec_map_to_range() {
        let formula = FormulaSpec::new(
            "测试公式".to_string(),
            "ben_gua_num".to_string(),
            vec![],
            vec![],
            (1, 33),
        );
        
        // 测试范围映射
        assert_eq!(formula.map_to_range(35), 2);
        assert_eq!(formula.map_to_range(0), 33);
        assert_eq!(formula.map_to_range(-1), 32);
    }
}
