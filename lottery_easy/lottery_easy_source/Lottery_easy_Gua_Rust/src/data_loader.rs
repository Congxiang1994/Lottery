//! data_loader.rs - 数据加载和保存模块
//!
//! 本模块实现彩票数据的加载、解析和保存功能。

#![allow(dead_code)]
#![allow(unused_imports)]

use std::fs::{self, File};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::collections::HashMap;
use chrono::{Local, NaiveDate, Datelike};
use serde::{Serialize, Deserialize};

use crate::config::GuaConfig;
use crate::gua_features::{calculate_time_gua, GuaData};
use crate::search::{LotteryRecord, SearchResult};

/// 开奖数据格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawLotteryData {
    /// 期号
    pub issue: String,
    /// 开奖日期
    pub date: String,
    /// 红球号码
    pub red_balls: String,
    /// 蓝球号码
    pub blue_balls: String,
}

/// 加载彩票数据
/// 
/// 参数:
/// - file_path: 数据文件路径
/// - config: 全局配置
/// 
/// 返回:
/// - 开奖记录列表
pub fn load_lottery_data(file_path: &str, config: &GuaConfig) -> Result<Vec<LotteryRecord>, String> {
    let path = Path::new(file_path);
    
    if !path.exists() {
        return Err(format!("数据文件不存在: {}", file_path));
    }
    
    let file = File::open(path).map_err(|e| format!("无法打开文件: {}", e))?;
    let reader = BufReader::new(file);
    
    let mut records = Vec::new();
    
    for (line_num, line) in reader.lines().enumerate() {
        let line = line.map_err(|e| format!("读取行失败: {}", e))?;
        
        // 跳过空行和注释行
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        
        // 解析数据行
        match parse_lottery_line(line, config) {
            Ok(record) => records.push(record),
            Err(e) => {
                eprintln!("警告: 第{}行解析失败: {}", line_num + 1, e);
            }
        }
    }
    
    // 按期号排序
    records.sort_by(|a, b| a.issue.cmp(&b.issue));
    
    println!("成功加载 {} 条开奖记录", records.len());
    
    Ok(records)
}

/// 解析开奖数据行
/// 
/// 支持多种格式:
/// 1. 格式1: 期号 日期 红球 蓝球 (空格分隔)
/// 2. 格式2: 期号,日期,红球,蓝球 (逗号分隔)
/// 3. 格式3: 期号|日期|红球|蓝球 (竖线分隔)
/// 4. 格式4: 日期,红球1-6,蓝球 (双色球，无期号)
/// 5. 格式5: 日期,红球1-5,蓝球1-2 (大乐透，无期号)
fn parse_lottery_line(line: &str, config: &GuaConfig) -> Result<LotteryRecord, String> {
    // 尝试不同的分隔符
    let parts: Vec<&str> = if line.contains(',') {
        line.split(',').collect()
    } else if line.contains('|') {
        line.split('|').collect()
    } else {
        line.split_whitespace().collect()
    };
    
    if parts.len() < 3 {
        return Err(format!("数据格式错误: {}", line));
    }
    
    let mode_cfg = config.mode_config.get(&config.mode)
        .ok_or_else(|| format!("未知的彩种模式: {}", config.mode))?;
    
    let red_count = mode_cfg.red_count as usize;
    let blue_count = mode_cfg.blue_count as usize;
    
    // 检测数据格式：第一个字段是日期还是期号
    let first_field = parts[0].trim();
    let is_date_format = first_field.contains('-') || first_field.contains('/');
    
    let (issue, date, ball_start_idx) = if is_date_format {
        // 格式: 日期,红球1,红球2,...,蓝球 (无期号)
        // 期号使用日期作为标识
        let date = first_field.to_string();
        let issue = date.replace("-", "");
        (issue, date, 1)
    } else {
        // 格式: 期号,日期,红球1,红球2,...,蓝球
        let issue = first_field.to_string();
        let date = parts[1].trim().to_string();
        (issue, date, 2)
    };
    
    // 解析红球和蓝球
    let (red_balls, blue_balls) = if parts.len() == ball_start_idx + 1 {
        // 格式: 期号 日期 "红球,红球,... 蓝球,蓝球,..."
        let balls_part = parts[ball_start_idx].trim();
        parse_balls_from_combined(balls_part, config)?
    } else if parts.len() == ball_start_idx + 2 {
        // 格式: 期号 日期 红球 蓝球
        let red_str = parts[ball_start_idx].trim();
        let blue_str = parts[ball_start_idx + 1].trim();
        (parse_balls(red_str), parse_balls(blue_str))
    } else {
        // 格式: 日期,红球1,红球2,...,蓝球 或 期号,日期,红球1,...,蓝球
        let expected_len = ball_start_idx + red_count + blue_count;
        if parts.len() < expected_len {
            return Err(format!("数据格式错误，期望至少{}个字段，实际{}个字段", expected_len, parts.len()));
        }
        
        let red_balls: Vec<i32> = parts[ball_start_idx..ball_start_idx+red_count]
            .iter()
            .filter_map(|s| s.trim().parse().ok())
            .collect();
        
        let blue_balls: Vec<i32> = parts[ball_start_idx+red_count..ball_start_idx+red_count+blue_count]
            .iter()
            .filter_map(|s| s.trim().parse().ok())
            .collect();
        
        (red_balls, blue_balls)
    };
    
    // 验证数据
    let mode_cfg = config.mode_config.get(&config.mode)
        .ok_or_else(|| format!("未知的彩种模式: {}", config.mode))?;
    
    if red_balls.len() != mode_cfg.red_count as usize {
        return Err(format!("红球数量错误，期望{}个，实际{}个", mode_cfg.red_count, red_balls.len()));
    }
    
    if blue_balls.len() != mode_cfg.blue_count as usize {
        return Err(format!("蓝球数量错误，期望{}个，实际{}个", mode_cfg.blue_count, blue_balls.len()));
    }
    
    // 创建记录
    let mut record = LotteryRecord {
        issue,
        date,
        red_balls,
        blue_balls,
        gua_data: None,
        features: None,
    };
    
    // 排序红球
    record.red_balls.sort();
    record.blue_balls.sort();
    
    Ok(record)
}

/// 从合并的字符串解析红球和蓝球
fn parse_balls_from_combined(balls_str: &str, config: &GuaConfig) -> Result<(Vec<i32>, Vec<i32>), String> {
    let mode_cfg = config.mode_config.get(&config.mode)
        .ok_or_else(|| format!("未知的彩种模式: {}", config.mode))?;
    
    // 尝试用空格分隔红球和蓝球
    let parts: Vec<&str> = balls_str.split_whitespace().collect();
    
    if parts.len() == 2 {
        // 第一部分是红球，第二部分是蓝球
        let red_balls = parse_balls(parts[0]);
        let blue_balls = parse_balls(parts[1]);
        return Ok((red_balls, blue_balls));
    }
    
    // 尝试解析所有数字，然后按彩种规则分割
    let all_balls: Vec<i32> = balls_str
        .split(|c: char| !c.is_numeric())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect();
    
    let red_count = mode_cfg.red_count as usize;
    if all_balls.len() >= red_count {
        let red_balls: Vec<i32> = all_balls[..red_count].to_vec();
        let blue_balls: Vec<i32> = all_balls[red_count..].to_vec();
        return Ok((red_balls, blue_balls));
    }
    
    Err(format!("无法解析球号: {}", balls_str))
}

/// 解析球号字符串
fn parse_balls(balls_str: &str) -> Vec<i32> {
    balls_str
        .split(|c: char| !c.is_numeric())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect()
}

/// 为开奖记录计算卦象特征
/// 
/// 参数:
/// - records: 开奖记录列表
/// 
/// 返回:
/// - 卦象特征列表
pub fn calculate_features_for_records(records: &mut [LotteryRecord]) -> Vec<HashMap<String, i32>> {
    let mut features_list = Vec::new();
    
    println!("\n计算卦象特征...");
    
    for record in records.iter_mut() {
        // 解析日期
        let (lunar_year, lunar_month, lunar_day, lunar_hour) = parse_date_to_lunar(&record.date);
        
        // 计算卦象
        let gua_data = calculate_time_gua(lunar_year, lunar_month, lunar_day, lunar_hour);
        
        // 提取特征
        let features = gua_data.to_features();
        
        // 保存到记录
        record.gua_data = Some(gua_data);
        record.features = Some(features.clone());
        
        features_list.push(features);
    }
    
    println!("卦象特征计算完成");
    
    features_list
}

/// 解析日期到农历（简化版）
/// 
/// 注意：这是一个简化版本，实际应该使用农历转换库
fn parse_date_to_lunar(date_str: &str) -> (i32, i32, i32, i32) {
    // 尝试解析日期
    if let Ok(date) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
        // 简化处理：直接使用公历日期作为农历日期
        // 实际应该使用农历转换库
        let year = date.year();
        let month = date.month() as i32;
        let day = date.day() as i32;
        let hour = 12;  // 默认中午
        
        return (year, month, day, hour);
    }
    
    // 默认值
    (2024, 1, 1, 12)
}

/// 保存搜索结果
/// 
/// 参数:
/// - results: 搜索结果列表
/// - file_path: 保存文件路径
pub fn save_search_results(results: &[SearchResult], file_path: &str) -> Result<(), String> {
    let path = Path::new(file_path);
    
    // 确保目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    
    // 序列化为JSON
    let json = serde_json::to_string_pretty(results)
        .map_err(|e| format!("序列化失败: {}", e))?;
    
    // 写入文件
    let mut file = File::create(path).map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(json.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
    
    println!("搜索结果已保存到: {}", file_path);
    
    Ok(())
}

/// 加载搜索结果
/// 
/// 参数:
/// - file_path: 文件路径
/// 
/// 返回:
/// - 搜索结果列表
pub fn load_search_results(file_path: &str) -> Result<Vec<SearchResult>, String> {
    let path = Path::new(file_path);
    
    if !path.exists() {
        return Err(format!("文件不存在: {}", file_path));
    }
    
    let content = fs::read_to_string(path).map_err(|e| format!("读取文件失败: {}", e))?;
    
    let results: Vec<SearchResult> = serde_json::from_str(&content)
        .map_err(|e| format!("解析文件失败: {}", e))?;
    
    println!("成功加载 {} 个搜索结果", results.len());
    
    Ok(results)
}

/// 保存公式到文本文件
/// 
/// 参数:
/// - results: 搜索结果列表
/// - file_path: 保存文件路径
pub fn save_formulas_to_text(results: &[SearchResult], file_path: &str) -> Result<(), String> {
    let path = Path::new(file_path);
    
    // 确保目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    
    let mut file = File::create(path).map_err(|e| format!("创建文件失败: {}", e))?;
    
    // 写入头部
    writeln!(file, "# 周易卦象彩票预测公式").map_err(|e| format!("写入失败: {}", e))?;
    writeln!(file, "# 生成时间: {}", Local::now().format("%Y-%m-%d %H:%M:%S")).map_err(|e| format!("写入失败: {}", e))?;
    writeln!(file).map_err(|e| format!("写入失败: {}", e))?;
    
    // 写入每个球位的公式
    for result in results {
        writeln!(file, "## {} ({}位{})", result.position_key, result.ball_type, result.position)
            .map_err(|e| format!("写入失败: {}", e))?;
        writeln!(file, "搜索耗时: {} 毫秒", result.search_time_ms)
            .map_err(|e| format!("写入失败: {}", e))?;
        writeln!(file).map_err(|e| format!("写入失败: {}", e))?;
        
        for (i, formula) in result.best_formulas.iter().enumerate() {
            writeln!(file, "  {}. {}", i + 1, formula.format())
                .map_err(|e| format!("写入失败: {}", e))?;
        }
        
        writeln!(file).map_err(|e| format!("写入失败: {}", e))?;
    }
    
    println!("公式已保存到: {}", file_path);
    
    Ok(())
}

/// 创建示例数据文件
pub fn create_sample_data_file(file_path: &str, config: &GuaConfig) -> Result<(), String> {
    let path = Path::new(file_path);
    
    // 确保目录存在
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    
    let mut file = File::create(path).map_err(|e| format!("创建文件失败: {}", e))?;
    
    // 写入示例数据
    writeln!(file, "# 彩票开奖数据示例").map_err(|e| format!("写入失败: {}", e))?;
    writeln!(file, "# 格式: 期号 日期 红球 蓝球").map_err(|e| format!("写入失败: {}", e))?;
    writeln!(file).map_err(|e| format!("写入失败: {}", e))?;
    
    // 根据彩种写入不同的示例
    if config.mode == "ssq" {
        writeln!(file, "2024001 2024-01-02 01 05 12 18 25 33 07").map_err(|e| format!("写入失败: {}", e))?;
        writeln!(file, "2024002 2024-01-04 03 08 15 22 29 31 12").map_err(|e| format!("写入失败: {}", e))?;
        writeln!(file, "2024003 2024-01-07 02 11 16 23 28 32 05").map_err(|e| format!("写入失败: {}", e))?;
    } else {
        writeln!(file, "2024001 2024-01-03 01 05 12 18 25 07 09").map_err(|e| format!("写入失败: {}", e))?;
        writeln!(file, "2024002 2024-01-06 03 08 15 22 29 03 11").map_err(|e| format!("写入失败: {}", e))?;
        writeln!(file, "2024003 2024-01-10 02 11 16 23 28 05 08").map_err(|e| format!("写入失败: {}", e))?;
    }
    
    println!("示例数据文件已创建: {}", file_path);
    
    Ok(())
}

/// 球位搜索结果（用于保存和加载）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionResult {
    /// 球位键（如'ssq_red_1'）
    pub position_key: String,
    /// 球类型
    pub ball_type: String,
    /// 球位编号
    pub position: i32,
    /// 公式列表
    pub formulas: Vec<crate::formula::FormulaSpec>,
    /// 高命中率公式列表
    pub high_rate_formulas: Vec<crate::formula::FormulaSpec>,
    /// 组合命中率
    pub combo_hit_rate: f64,
    /// 优化后命中率
    pub optimized_hit_rate: f64,
    /// 优化策略
    pub optimized_strategy: String,
    /// 搜索耗时（毫秒）
    pub search_time_ms: u64,
}

/// 保存球位搜索结果到文件
/// 
/// 将所有球位的搜索结果保存到一个JSON文件中，便于后续回测和预测使用。
/// 
/// 参数:
/// - position_results: 球位搜索结果字典
/// - config: 系统配置
/// 
/// 返回:
/// - 保存的文件路径
pub fn save_position_results(
    position_results: &HashMap<String, PositionResult>,
    config: &GuaConfig,
) -> Result<String, String> {
    let timestamp = Local::now().format("%Y%m%d_%H%M%S").to_string();
    let filename = format!("{}_position_all_{}.json", config.mode, timestamp);
    let filepath = Path::new(&config.result_dir).join(&filename);
    
    // 确保目录存在
    if let Some(parent) = filepath.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {}", e))?;
    }
    
    // 统计各球位信息
    let mut summary = HashMap::new();
    for (position_key, result) in position_results {
        summary.insert(position_key.clone(), serde_json::json!({
            "name": position_key,
            "total_formulas": result.formulas.len(),
            "high_rate_count": result.high_rate_formulas.len(),
            "combo_hit_rate": result.combo_hit_rate,
            "optimized_hit_rate": result.optimized_hit_rate,
            "optimized_strategy": result.optimized_strategy,
        }));
    }
    
    // 构建保存数据
    let save_data = serde_json::json!({
        "mode": config.mode,
        "timestamp": timestamp,
        "search_periods": config.search_periods,
        "total_periods": config.total_periods,
        "train_periods": config.train_periods,
        "val_periods": config.val_periods,
        "position_count": position_results.len(),
        "summary": summary,
        "results": position_results,
    });
    
    // 序列化为JSON
    let json = serde_json::to_string_pretty(&save_data)
        .map_err(|e| format!("序列化失败: {}", e))?;
    
    // 写入文件
    let mut file = File::create(&filepath).map_err(|e| format!("创建文件失败: {}", e))?;
    file.write_all(json.as_bytes()).map_err(|e| format!("写入文件失败: {}", e))?;
    
    println!("球位搜索结果已保存到: {}", filepath.display());
    println!("  共保存 {} 个球位的公式", position_results.len());
    
    Ok(filepath.to_string_lossy().to_string())
}

/// 加载已保存的球位搜索结果
/// 
/// 自动查找最新的球位结果文件并加载。用于回测和预测时自动加载已保存的公式。
/// 
/// 参数:
/// - config: 系统配置
/// 
/// 返回:
/// - 球位搜索结果字典，如果文件不存在则返回None
pub fn load_position_results(config: &GuaConfig) -> Option<HashMap<String, PositionResult>> {
    let result_dir = Path::new(&config.result_dir);
    
    if !result_dir.exists() {
        println!("结果目录不存在: {}", result_dir.display());
        return None;
    }
    
    // 查找最新的球位结果文件
    let mut files: Vec<String> = Vec::new();
    if let Ok(entries) = fs::read_dir(result_dir) {
        for entry in entries.flatten() {
            if let Some(filename) = entry.file_name().to_str() {
                // 匹配格式: ssq_position_all_20240101_120000.json 或 dlt_position_all_20240101_120000.json
                if filename.starts_with(&format!("{}_position_all_", config.mode)) && filename.ends_with(".json") {
                    files.push(filename.to_string());
                }
            }
        }
    }
    
    if files.is_empty() {
        println!("未找到 {} 的球位公式文件", config.mode);
        return None;
    }
    
    // 按时间排序，取最新的
    files.sort();
    files.reverse();
    let latest_file = files[0].clone();
    let filepath = result_dir.join(&latest_file);
    
    // 读取文件
    let content = match fs::read_to_string(&filepath) {
        Ok(c) => c,
        Err(e) => {
            println!("读取文件失败: {}", e);
            return None;
        }
    };
    
    // 解析JSON
    let data: serde_json::Value = match serde_json::from_str(&content) {
        Ok(d) => d,
        Err(e) => {
            println!("解析文件失败: {}", e);
            return None;
        }
    };
    
    // 显示加载信息
    println!("已加载球位公式文件: {}", latest_file);
    
    // 显示保存时的搜索参数
    if let Some(saved_periods) = data.get("search_periods") {
        println!("  搜索期数: {}", saved_periods);
    }
    if let Some(timestamp) = data.get("timestamp") {
        println!("  保存时间: {}", timestamp);
    }
    
    // 获取结果
    let results: HashMap<String, PositionResult> = match data.get("results") {
        Some(r) => {
            match serde_json::from_value(r.clone()) {
                Ok(res) => res,
                Err(e) => {
                    println!("解析结果失败: {}", e);
                    return None;
                }
            }
        }
        None => {
            println!("结果字段不存在");
            return None;
        }
    };
    
    // 显示各球位统计
    if let Some(summary) = data.get("summary") {
        println!("  球位数量: {}", results.len());
        if let Some(summary_obj) = summary.as_object() {
            for (position_key, info) in summary_obj {
                if let Some(info_obj) = info.as_object() {
                    let name = info_obj.get("name").and_then(|v| v.as_str()).unwrap_or(position_key);
                    let high_count = info_obj.get("high_rate_count").and_then(|v| v.as_i64()).unwrap_or(0);
                    let combo_rate = info_obj.get("combo_hit_rate").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let optimized_rate = info_obj.get("optimized_hit_rate").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let optimized_strategy = info_obj.get("optimized_strategy").and_then(|v| v.as_str()).unwrap_or("");
                    
                    if optimized_rate > 0.0 {
                        println!("    {}: {}个公式, 基础{:.2}%, 优化{:.2}% ({})", 
                            name, high_count, combo_rate * 100.0, optimized_rate * 100.0, optimized_strategy);
                    } else {
                        println!("    {}: {}个高命中率公式, 命中率{:.2}%", name, high_count, combo_rate * 100.0);
                    }
                }
            }
        }
    }
    
    Some(results)
}

/// 检查并加载球位公式，如果没有则提示用户
/// 
/// 这是回测和预测功能的辅助函数，用于自动加载已保存的公式。
/// 如果没有找到已保存的公式，会提示用户先执行搜索。
/// 
/// 参数:
/// - config: 系统配置
/// 
/// 返回:
/// - 球位搜索结果字典，如果没有则返回None
pub fn check_and_load_position_formulas(config: &GuaConfig) -> Option<HashMap<String, PositionResult>> {
    let position_results = load_position_results(config);
    
    if position_results.is_none() {
        println!("\n{}", "=".repeat(50));
        println!("未找到已保存的球位公式！");
        println!("请先执行以下操作之一：");
        println!("  1. 选择菜单选项 [12] 搜索所有球位公式");
        println!("  2. 或者手动搜索后再进行回测/预测");
        println!("{}", "=".repeat(50));
        return None;
    }
    
    let results = position_results.unwrap();
    
    // 检查是否有足够的高命中率公式
    let total_high_formulas: usize = results.values()
        .map(|r| r.high_rate_formulas.len())
        .sum();
    
    if total_high_formulas == 0 {
        println!("已加载的球位公式中没有高命中率公式");
        println!("建议重新搜索公式（菜单选项 [12]）");
        return None;
    }
    
    println!("成功加载球位公式，共 {} 个高命中率公式", total_high_formulas);
    Some(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_parse_balls() {
        let balls = parse_balls("01,05,12,18,25,33");
        assert_eq!(balls, vec![1, 5, 12, 18, 25, 33]);
        
        let balls = parse_balls("01 05 12 18 25 33");
        assert_eq!(balls, vec![1, 5, 12, 18, 25, 33]);
    }
    
    #[test]
    fn test_parse_date_to_lunar() {
        let (year, month, day, hour) = parse_date_to_lunar("2024-01-15");
        assert_eq!(year, 2024);
        assert_eq!(month, 1);
        assert_eq!(day, 15);
    }
}
