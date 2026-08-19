//! menu.rs - 主菜单和交互式界面模块
//!
//! 本模块实现程序的主菜单和交互式界面。
//!
//! 菜单功能说明：
//! ==========
//! 1. 切换彩种 (SSQ/DLT) - 在双色球和大乐透之间切换
//! 2. 搜索公式并预测下一期号码 - 搜索最佳公式并进行预测
//! 3. 按球位预测下一期号码（使用已保存模型）- 使用已保存的模型进行预测
//! 4. 配置投票策略参数 - 配置投票策略的各种参数
//! 5. 查看系统配置 - 查看当前系统配置
//! 6. 测试单期卦象计算 - 测试指定日期的卦象计算
//! 7. 寻找最优训练集/验证集配置 - 自动寻找最优的训练集和验证集配置
//! 8. 多参数组合联合搜索预测 - 使用多个参数组合进行联合搜索预测
//! 0. 退出系统 - 退出程序

#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]

use std::io::{self, Write};
use std::collections::HashMap;
use chrono::{Local, NaiveDate, Datelike};

use crate::config::GuaConfig;
use crate::color_printer::{print_header, print_success, print_error, print_warning, print_info, print_highlight, print_color, print_data};
use crate::gua_features::{calculate_time_gua, GuaData};
use crate::formula::FormulaSpec;
use crate::search::{search_all_positions, search_best_formulas_by_position_base, SearchResult, LotteryRecord, predict_with_voting};
use crate::data_loader::{load_lottery_data, calculate_features_for_records, save_search_results, load_search_results, create_sample_data_file};
use crate::voting::{AdvancedVotingStrategy, EnsembleVoting};

/// 全局数据状态
/// 
/// 用于在菜单操作之间保持数据状态
struct MenuState {
    /// 开奖记录列表
    records: Vec<LotteryRecord>,
    /// 卦象特征列表
    features_list: Vec<HashMap<String, i32>>,
    /// 搜索结果
    search_results: Vec<SearchResult>,
    /// 数据是否已加载
    data_loaded: bool,
}

impl Default for MenuState {
    fn default() -> Self {
        MenuState {
            records: Vec::new(),
            features_list: Vec::new(),
            search_results: Vec::new(),
            data_loaded: false,
        }
    }
}

/// 运行交互式菜单
/// 
/// 这是主菜单循环，持续运行直到用户选择退出
pub fn run_interactive_menu(mut config: GuaConfig) {
    let mut state = MenuState::default();
    
    loop {
        // 显示主菜单
        print_main_menu(&config);
        
        // 获取用户输入
        let choice = get_user_input("请输入选项");
        
        match choice.trim() {
            "1" => {
                // 切换彩种
                run_switch_mode(&mut config, &mut state);
            }
            "2" => {
                // 搜索公式并预测下一期号码
                run_search_and_predict(&mut config, &mut state);
            }
            "3" => {
                // 按球位预测下一期号码（使用已保存模型）
                run_predict_by_position(&config);
            }
            "4" => {
                // 配置投票策略参数
                run_configure_voting(&mut config);
            }
            "5" => {
                // 查看系统配置
                run_view_config(&config);
            }
            "6" => {
                // 测试单期卦象计算
                run_test_gua_calculation(&config);
            }
            "7" => {
                // 寻找最优训练集/验证集配置
                run_find_optimal_config(&mut config, &mut state);
            }
            "8" => {
                // 多参数组合联合搜索预测
                run_multi_param_prediction(&mut config, &mut state);
            }
            "0" | "q" | "Q" => {
                print_info("感谢使用，再见！");
                break;
            }
            _ => {
                print_warning("无效选项，请重新选择");
            }
        }
        
        println!("\n按回车键继续...");
        let _ = io::stdout().flush();
        let mut dummy = String::new();
        let _ = io::stdin().read_line(&mut dummy);
    }
}

/// 打印主菜单
/// 
/// 与Python版本的print_main_menu函数保持一致
fn print_main_menu(config: &GuaConfig) {
    print_header("周易卦象彩票预测系统（增强版）");
    
    // 获取当前彩种名称
    let mode_name = config.mode_config.get(&config.mode)
        .map(|m| m.name.as_str())
        .unwrap_or("未知");
    print_info(&format!("当前彩种: {}", mode_name));
    
    println!("\n请选择操作:");
    println!("  1. 切换彩种 (SSQ/DLT)");
    println!("  2. 搜索公式并预测下一期号码");
    println!("  3. 按球位预测下一期号码（使用已保存模型）");
    println!("  4. 配置投票策略参数");
    println!("  5. 查看系统配置");
    println!("  6. 测试单期卦象计算");
    println!("  7. 寻找最优训练集/验证集配置");
    println!("  8. 多参数组合联合搜索预测");
    println!("  0. 退出系统");
    println!();
}

/// 获取用户输入
fn get_user_input(prompt: &str) -> String {
    print!("{}: ", prompt);
    let _ = io::stdout().flush();
    
    let mut input = String::new();
    io::stdin().read_line(&mut input).expect("读取输入失败");
    input.trim().to_string()
}

/// 确保数据已加载
/// 
/// 如果数据未加载，则自动加载历史数据
fn ensure_data_loaded(config: &GuaConfig, state: &mut MenuState) -> bool {
    if state.data_loaded && !state.records.is_empty() && !state.features_list.is_empty() {
        return true;
    }
    
    print_info("自动加载历史数据...");
    
    // 获取数据文件路径
    let mode_cfg = config.mode_config.get(&config.mode);
    let default_file = mode_cfg.map(|m| m.data_file.as_str()).unwrap_or("ssq.txt");
    
    // 加载数据
    match load_lottery_data(default_file, config) {
        Ok(mut records) => {
            if !records.is_empty() {
                // 计算卦象特征
                let features_list = calculate_features_for_records(&mut records);
                
                state.records = records;
                state.features_list = features_list;
                state.data_loaded = true;
                
                print_success(&format!("成功加载 {} 期历史数据", state.records.len()));
                return true;
            }
        }
        Err(e) => {
            print_error(&format!("加载数据失败: {}", e));
        }
    }
    
    false
}

/// 1. 切换彩种
/// 
/// 在双色球(SSQ)和大乐透(DLT)之间切换
fn run_switch_mode(config: &mut GuaConfig, state: &mut MenuState) {
    if config.mode == "ssq" {
        config.mode = "dlt".to_string();
    } else {
        config.mode = "ssq".to_string();
    }
    
    let mode_name = config.mode_config.get(&config.mode)
        .map(|m| m.name.as_str())
        .unwrap_or("未知");
    print_success(&format!("已切换到 {}", mode_name));
    
    // 清空已加载的数据
    state.records.clear();
    state.features_list.clear();
    state.search_results.clear();
    state.data_loaded = false;
}

/// 2. 搜索公式并预测下一期号码
/// 
/// 搜索最佳公式并使用内存中的结果进行预测
fn run_search_and_predict(config: &mut GuaConfig, state: &mut MenuState) {
    // 确保数据已加载
    if !ensure_data_loaded(config, state) {
        print_error("无法加载历史数据");
        return;
    }
    
    // 获取预测日期
    print_info("\n请输入要预测的日期 (YYYY-MM-DD)，直接回车使用当天日期:");
    let date_input = get_user_input("");
    
    let predict_date = if date_input.is_empty() {
        Local::now().naive_local().date()
    } else {
        match NaiveDate::parse_from_str(&date_input, "%Y-%m-%d") {
            Ok(d) => d,
            Err(_) => {
                print_error("日期格式错误，使用当天日期");
                Local::now().naive_local().date()
            }
        }
    };
    
    print_info(&format!("预测日期: {}", predict_date.format("%Y-%m-%d")));
    
    // 获取目标命中率
    print_info("\n请输入目标命中率（默认0.9，即90%），直接回车使用默认值:");
    let target_input = get_user_input("");
    let target_hit_rate: f64 = target_input.parse().unwrap_or(0.9);
    
    // 执行搜索
    print_header(&format!("搜索所有球位公式（增强版） - {}", 
        config.mode_config.get(&config.mode).map(|m| m.name.as_str()).unwrap_or("未知")));
    print_info(&format!("目标命中率: {:.0}%", target_hit_rate * 100.0));
    
    // 计算预测日期的卦象特征
    let predict_features = calculate_time_gua(
        predict_date.year(),
        predict_date.month() as i32,
        predict_date.day() as i32,
        12, // 默认午时
    );
    
    // 将预测日期的特征加入特征列表末尾
    let mut features_with_predict = state.features_list.clone();
    let mut predict_feature_map = predict_features.to_features();
    // 标记为预测日期数据
    predict_feature_map.insert("is_predict_date".to_string(), 1);
    features_with_predict.push(predict_feature_map);
    
    // 搜索所有球位
    let results = search_all_positions(&features_with_predict, &state.records, config, true);
    
    // 保存搜索结果
    state.search_results = results.clone();
    
    // 自动保存搜索结果
    print_info("\n正在保存球位搜索结果...");
    let result_file = format!("{}/{}_results.json", config.result_dir, config.mode);
    match save_search_results(&results, &result_file) {
        Ok(_) => print_success("搜索结果已保存"),
        Err(e) => print_error(&format!("保存结果失败: {}", e)),
    }
    
    // 进行预测
    print_highlight("\n============================================================");
    print_highlight("开始预测下一期号码（使用内存中的搜索结果）");
    print_highlight("============================================================");
    
    // 调用预测功能
    predict_with_memory_results_impl(&results, &state.features_list, config, predict_date);
}

/// 3. 按球位预测下一期号码（使用已保存模型）
/// 
/// 使用已保存的搜索结果进行预测
fn run_predict_by_position(config: &GuaConfig) {
    print_header("按球位预测下一期号码");
    
    // 加载搜索结果
    let result_file = format!("{}/{}_results.json", config.result_dir, config.mode);
    let results = match load_search_results(&result_file) {
        Ok(r) => r,
        Err(e) => {
            print_error(&format!("加载搜索结果失败: {}", e));
            print_info("请先运行'搜索公式并预测下一期号码'功能");
            return;
        }
    };
    
    // 获取预测日期
    print_info("\n请输入预测日期 (YYYY-MM-DD)，直接回车使用当天日期:");
    let date_input = get_user_input("");
    
    let predict_date = if date_input.is_empty() {
        Local::now().naive_local().date()
    } else {
        match NaiveDate::parse_from_str(&date_input, "%Y-%m-%d") {
            Ok(d) => d,
            Err(_) => {
                print_error("日期格式错误，使用当天日期");
                Local::now().naive_local().date()
            }
        }
    };
    
    // 计算卦象特征
    let gua_data = calculate_time_gua(
        predict_date.year(),
        predict_date.month() as i32,
        predict_date.day() as i32,
        12,
    );
    let features = gua_data.to_features();
    
    // 显示卦象信息
    print_header("卦象信息");
    display_gua_info(&gua_data);
    
    // 进行预测
    print_header("预测结果");
    
    let mut red_predictions = Vec::new();
    let mut blue_predictions = Vec::new();
    
    for result in &results {
        if result.best_formulas.is_empty() {
            continue;
        }
        
        let target_range = config.get_position_range(&result.ball_type, result.position);
        let output_count = config.get_position_output_count(&result.ball_type, result.position);
        
        // 使用投票进行预测
        let predictions = predict_with_voting(
            &result.best_formulas,
            &features,
            target_range,
            output_count,
        );
        
        if !predictions.is_empty() {
            println!("\n{}:", result.position_key);
            for (i, (num, score)) in predictions.iter().enumerate() {
                println!("  {}. 号码 {} (票数: {:.2})", i + 1, num, score);
            }
            
            if result.ball_type == "red" {
                red_predictions.extend(predictions.iter().map(|(n, _)| *n));
            } else {
                blue_predictions.extend(predictions.iter().map(|(n, _)| *n));
            }
        }
    }
    
    // 汇总预测结果
    print_header("汇总预测");
    
    if !red_predictions.is_empty() {
        red_predictions.sort();
        red_predictions.dedup();
        print_color(&format!("红球推荐: {:?}", red_predictions), "red", false, "\n");
    }
    
    if !blue_predictions.is_empty() {
        blue_predictions.sort();
        blue_predictions.dedup();
        print_color(&format!("蓝球推荐: {:?}", blue_predictions), "blue", false, "\n");
    }
}

/// 4. 配置投票策略参数
/// 
/// 配置投票策略的各种参数
fn run_configure_voting(config: &mut GuaConfig) {
    print_header("配置投票策略参数");
    
    print_info("当前配置:");
    print_data(&format!("  1. SSQ红球阈值: >{:.1}%", config.ssq_red_threshold * 100.0));
    print_data(&format!("  2. SSQ蓝球阈值: >{:.1}%", config.ssq_blue_threshold * 100.0));
    print_data(&format!("  3. DLT红球阈值: >{:.1}%", config.dlt_red_threshold * 100.0));
    print_data(&format!("  4. DLT蓝球阈值: >{:.1}%", config.dlt_blue_threshold * 100.0));
    print_data(&format!("  5. SSQ红球输出数: {}个", config.ssq_red_output));
    print_data(&format!("  6. SSQ蓝球输出数: {}个", config.ssq_blue_output));
    print_data(&format!("  7. DLT红球输出数: {}个", config.dlt_red_output));
    print_data(&format!("  8. DLT蓝球输出数: {}个", config.dlt_blue_output));
    print_data(&format!("  9. 最大公式数量: {}", config.max_formulas_for_voting));
    
    println!("\n请输入要修改的参数编号（1-9），或按回车跳过:");
    let choice = get_user_input("");
    
    match choice.as_str() {
        "1" => {
            let val = get_user_input(&format!("请输入SSQ红球阈值（当前{:.1}%，如0.22表示22%）", config.ssq_red_threshold * 100.0));
            if let Ok(v) = val.parse::<f64>() {
                config.ssq_red_threshold = v;
                print_success("参数已更新");
            }
        }
        "2" => {
            let val = get_user_input(&format!("请输入SSQ蓝球阈值（当前{:.1}%）", config.ssq_blue_threshold * 100.0));
            if let Ok(v) = val.parse::<f64>() {
                config.ssq_blue_threshold = v;
                print_success("参数已更新");
            }
        }
        "3" => {
            let val = get_user_input(&format!("请输入DLT红球阈值（当前{:.1}%）", config.dlt_red_threshold * 100.0));
            if let Ok(v) = val.parse::<f64>() {
                config.dlt_red_threshold = v;
                print_success("参数已更新");
            }
        }
        "4" => {
            let val = get_user_input(&format!("请输入DLT蓝球阈值（当前{:.1}%）", config.dlt_blue_threshold * 100.0));
            if let Ok(v) = val.parse::<f64>() {
                config.dlt_blue_threshold = v;
                print_success("参数已更新");
            }
        }
        "5" => {
            let val = get_user_input(&format!("请输入SSQ红球输出数（当前{}）", config.ssq_red_output));
            if let Ok(v) = val.parse::<i32>() {
                config.ssq_red_output = v;
                print_success("参数已更新");
            }
        }
        "6" => {
            let val = get_user_input(&format!("请输入SSQ蓝球输出数（当前{}）", config.ssq_blue_output));
            if let Ok(v) = val.parse::<i32>() {
                config.ssq_blue_output = v;
                print_success("参数已更新");
            }
        }
        "7" => {
            let val = get_user_input(&format!("请输入DLT红球输出数（当前{}）", config.dlt_red_output));
            if let Ok(v) = val.parse::<i32>() {
                config.dlt_red_output = v;
                print_success("参数已更新");
            }
        }
        "8" => {
            let val = get_user_input(&format!("请输入DLT蓝球输出数（当前{}）", config.dlt_blue_output));
            if let Ok(v) = val.parse::<i32>() {
                config.dlt_blue_output = v;
                print_success("参数已更新");
            }
        }
        "9" => {
            let val = get_user_input(&format!("请输入最大公式数量（当前{}）", config.max_formulas_for_voting));
            if let Ok(v) = val.parse::<i32>() {
                config.max_formulas_for_voting = v;
                print_success("参数已更新");
            }
        }
        _ => {}
    }
}

/// 5. 查看系统配置
/// 
/// 显示当前系统配置
fn run_view_config(config: &GuaConfig) {
    print_header("当前系统配置");
    
    let mode_name = config.mode_config.get(&config.mode)
        .map(|m| m.name.as_str())
        .unwrap_or("未知");
    
    print_data(&format!("  彩种: {}", mode_name));
    print_data(&format!("  数据目录: {}", config.data_dir));
    print_data(&format!("  结果目录: {}", config.result_dir));
    print_data(&format!("  搜索期数: {}", config.search_periods));
    print_data(&format!("  最大操作数: {}", config.max_operations));
    print_data(&format!("  保存前N个结果: {}", config.top_n_results));
    
    println!();
    print_data("投票策略配置:");
    print_data(&format!("  SSQ红球阈值: >{:.1}%, 输出{}个", config.ssq_red_threshold * 100.0, config.ssq_red_output));
    print_data(&format!("  SSQ蓝球阈值: >{:.1}%, 输出{}个", config.ssq_blue_threshold * 100.0, config.ssq_blue_output));
    print_data(&format!("  DLT红球阈值: >{:.1}%, 输出{}个", config.dlt_red_threshold * 100.0, config.dlt_red_output));
    print_data(&format!("  DLT蓝球阈值: >{:.1}%, 输出{}个", config.dlt_blue_threshold * 100.0, config.dlt_blue_output));
    print_data(&format!("  最大公式数量: {}", config.max_formulas_for_voting));
}

/// 6. 测试单期卦象计算
/// 
/// 测试指定日期的卦象计算
fn run_test_gua_calculation(config: &GuaConfig) {
    print_header("测试单期卦象计算");
    
    // 获取日期
    let date_str = get_user_input("请输入日期 (YYYY-MM-DD)");
    
    let test_date = match NaiveDate::parse_from_str(&date_str, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => {
            print_error("日期格式错误");
            return;
        }
    };
    
    // 计算卦象
    let gua_data = calculate_time_gua(
        test_date.year(),
        test_date.month() as i32,
        test_date.day() as i32,
        12, // 默认午时
    );
    
    // 显示卦象信息
    display_gua_info(&gua_data);
    
    print_success("卦象计算成功");
}

/// 7. 寻找最优训练集/验证集配置
/// 
/// 通过遍历不同的训练集和验证集大小组合，找出针对目标日期和目标开奖数据的最佳配置
fn run_find_optimal_config(config: &mut GuaConfig, state: &mut MenuState) {
    print_header("寻找最优训练集/验证集配置");
    
    // 1. 让用户输入目标日期
    print_info("\n请输入目标日期 (YYYY-MM-DD):");
    let date_input = get_user_input("");
    
    let target_date = match NaiveDate::parse_from_str(&date_input, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => {
            print_error("日期格式错误");
            return;
        }
    };
    
    print_info(&format!("目标日期: {}", target_date.format("%Y-%m-%d")));
    
    // 2. 让用户输入目标开奖数据
    let mode_cfg = config.mode_config.get(&config.mode);
    let red_count = mode_cfg.map(|m| m.red_count).unwrap_or(6);
    let blue_count = mode_cfg.map(|m| m.blue_count).unwrap_or(1);
    
    print_info(&format!("\n请输入目标开奖数据（共{}个数字）:", red_count + blue_count));
    print_info(&format!("  - {}: {}个红球 + {}个蓝球", 
        mode_cfg.map(|m| m.name.as_str()).unwrap_or("未知"), red_count, blue_count));
    print_info(&format!("  - 格式: 红球1,红球2,...,红球{},蓝球1,蓝球2,... (用逗号或空格分隔)", red_count));
    
    let numbers_input = get_user_input("");
    
    // 解析号码
    let numbers: Vec<i32> = if numbers_input.contains(',') {
        numbers_input.split(',')
            .filter_map(|x| x.trim().parse().ok())
            .collect()
    } else {
        numbers_input.split_whitespace()
            .filter_map(|x| x.parse().ok())
            .collect()
    };
    
    if numbers.len() != (red_count + blue_count) as usize {
        print_error(&format!("需要输入{}个数字，实际输入了{}个", red_count + blue_count, numbers.len()));
        return;
    }
    
    let mut target_red_balls: Vec<i32> = numbers[..red_count as usize].to_vec();
    target_red_balls.sort();
    let target_blue_balls: Vec<i32> = numbers[red_count as usize..].to_vec();
    
    print_success("目标开奖数据:");
    print_color(&format!("  红球: {:?}", target_red_balls), "red", false, "\n");
    print_color(&format!("  蓝球: {:?}", target_blue_balls), "blue", false, "\n");
    
    // 3. 确保数据已加载
    if !ensure_data_loaded(config, state) {
        print_error("无法加载历史数据");
        return;
    }
    
    // 4. 定义参数组合
    // 格式：[[训练集大小, 验证集大小], ...]
    // 注释：以下参数组合与Python版本保持一致，可以根据需要调整
    let param_combinations: Vec<(i32, i32)> = vec![
        // [2000, 450],  // 注释：数据量较大时可以启用
        // [2000, 192],
        // [2000, 96],
        // [2000, 48],
        // [2000, 24],
        // [2000, 12],
        // [2000, 6],
        // [1500, 96],
        // [1500, 48],
        // [1500, 24],
        // [1500, 12],
        // [1500, 6],
        // [1000, 96],
        // [1000, 48],
        // [1000, 24],
        // [1000, 12],
        // [1000, 6],
        // [450, 450],
        // [500, 48],
        // [500, 24],
        // [500, 12],
        // [500, 6],
        // [153, 153],
        // [153, 48],
        // [153, 24],
        (153, 12),
        (153, 6),
        // [48, 48],
        // [48, 24],
        (48, 12),
        (48, 6),
        // [24, 24],
        (24, 12),
        (24, 6),
    ];
    
    // 5. 遍历所有组合
    let mut results: Vec<OptimalConfigResult> = Vec::new();
    let total_combinations = param_combinations.len();
    
    print_info(&format!("\n开始遍历 {} 种训练集/验证集组合...", total_combinations));
    print_info(&"=".repeat(60));
    
    for (combination_count, (train_size, val_size)) in param_combinations.iter().enumerate() {
        // 检查数据是否足够
        if train_size + val_size > state.features_list.len() as i32 {
            print_warning(&format!("  [{}/{}] 跳过: 训练{}+验证{}={} > 数据{}", 
                combination_count + 1, total_combinations, train_size, val_size, 
                train_size + val_size, state.features_list.len()));
            continue;
        }
        
        print_info(&format!("\n[{}/{}] 测试配置: 训练集={}, 验证集={}", 
            combination_count + 1, total_combinations, train_size, val_size));
        
        // 创建临时配置
        let mut temp_config = config.clone();
        temp_config.train_periods = *train_size;
        temp_config.val_periods = *val_size;
        temp_config.total_periods = train_size + val_size;
        
        // 执行搜索和预测
        match run_single_optimal_test(&state.features_list, &state.records, &temp_config, target_date) {
            Ok(result) => {
                // 计算命中情况
                let val_red_hits = result.val_predicted_red.iter()
                    .filter(|n| target_red_balls.contains(n)).count();
                let val_blue_hits = result.val_predicted_blue.iter()
                    .filter(|n| target_blue_balls.contains(n)).count();
                
                let normal_red_hits = result.normal_predicted_red.iter()
                    .filter(|n| target_red_balls.contains(n)).count();
                let normal_blue_hits = result.normal_predicted_blue.iter()
                    .filter(|n| target_blue_balls.contains(n)).count();
                
                results.push(OptimalConfigResult {
                    train_size: *train_size,
                    val_size: *val_size,
                    val_predicted_red: result.val_predicted_red.clone(),
                    val_predicted_blue: result.val_predicted_blue.clone(),
                    val_red_hits,
                    val_blue_hits,
                    normal_predicted_red: result.normal_predicted_red.clone(),
                    normal_predicted_blue: result.normal_predicted_blue.clone(),
                    normal_red_hits,
                    normal_blue_hits,
                    success: true,
                });
                
                print_success(&format!("  验证集预测: 红球命中{}/{}, 蓝球命中{}/{}", 
                    val_red_hits, result.val_predicted_red.len(),
                    val_blue_hits, result.val_predicted_blue.len()));
                print_success(&format!("  正常预测: 红球命中{}/{}, 蓝球命中{}/{}", 
                    normal_red_hits, result.normal_predicted_red.len(),
                    normal_blue_hits, result.normal_predicted_blue.len()));
            }
            Err(e) => {
                print_error(&format!("  测试失败: {}", e));
            }
        }
    }
    
    // 6. 输出结果表格
    print_header("\n============================================================");
    print_header("最优配置搜索结果");
    print_header("============================================================");
    
    print_info(&format!("\n目标日期: {}", target_date.format("%Y-%m-%d")));
    print_color(&format!("目标红球: {:?}", target_red_balls), "red", false, "\n");
    print_color(&format!("目标蓝球: {:?}", target_blue_balls), "blue", false, "\n");
    
    // 按验证集总命中数排序
    results.sort_by(|a, b| {
        (b.val_red_hits + b.val_blue_hits).cmp(&(a.val_red_hits + a.val_blue_hits))
    });
    
    // 输出验证集预测表格
    print_highlight("\n【验证集预测结果】");
    println!("\n{}", "=".repeat(100));
    println!("{:^8} | {:^8} | {:^14} | {:^14} | {:^8}", 
        "训练集", "验证集", "红球命中", "蓝球命中", "总命中");
    println!("{}", "=".repeat(100));
    
    for r in &results {
        let marker = if r == results.first().unwrap() { "★" } else { " " };
        println!("{} {:^6} | {:^6} | {:^14} | {:^14} | {:^8}",
            marker, r.train_size, r.val_size,
            format!("{}/{}", r.val_red_hits, r.val_predicted_red.len()),
            format!("{}/{}", r.val_blue_hits, r.val_predicted_blue.len()),
            r.val_red_hits + r.val_blue_hits);
    }
    
    println!("{}", "=".repeat(100));
    
    // 输出最佳配置
    if let Some(best) = results.first() {
        print_highlight("\n【最佳配置】");
        print_success(&format!("  训练集大小: {}", best.train_size));
        print_success(&format!("  验证集大小: {}", best.val_size));
        print_success(&format!("  红球命中: {}/{}", best.val_red_hits, best.val_predicted_red.len()));
        print_success(&format!("  蓝球命中: {}/{}", best.val_blue_hits, best.val_predicted_blue.len()));
        print_color(&format!("  预测红球: {:?}", best.val_predicted_red), "red", false, "\n");
        print_color(&format!("  预测蓝球: {:?}", best.val_predicted_blue), "blue", false, "\n");
    }
}

/// 最优配置搜索结果
#[derive(Debug, Clone, PartialEq)]
struct OptimalConfigResult {
    train_size: i32,
    val_size: i32,
    val_predicted_red: Vec<i32>,
    val_predicted_blue: Vec<i32>,
    val_red_hits: usize,
    val_blue_hits: usize,
    normal_predicted_red: Vec<i32>,
    normal_predicted_blue: Vec<i32>,
    normal_red_hits: usize,
    normal_blue_hits: usize,
    success: bool,
}

/// 单次最优配置测试结果
struct SingleTestResult {
    val_predicted_red: Vec<i32>,
    val_predicted_blue: Vec<i32>,
    normal_predicted_red: Vec<i32>,
    normal_predicted_blue: Vec<i32>,
}

/// 执行单次最优配置测试
fn run_single_optimal_test(
    features_list: &[HashMap<String, i32>],
    records: &[LotteryRecord],
    config: &GuaConfig,
    _target_date: NaiveDate,
) -> Result<SingleTestResult, String> {
    // 执行搜索
    let results = search_all_positions(features_list, records, config, false);
    
    // 收集预测结果
    let mut val_predicted_red = Vec::new();
    let mut val_predicted_blue = Vec::new();
    let mut normal_predicted_red = Vec::new();
    let mut normal_predicted_blue = Vec::new();
    
    for result in &results {
        if result.best_formulas.is_empty() {
            continue;
        }
        
        // 获取最后一期的特征（用于预测）
        if let Some(last_features) = features_list.last() {
            let target_range = config.get_position_range(&result.ball_type, result.position);
            let output_count = config.get_position_output_count(&result.ball_type, result.position);
            
            let predictions = predict_with_voting(
                &result.best_formulas,
                last_features,
                target_range,
                output_count,
            );
            
            for (num, _) in predictions {
                if result.ball_type == "red" {
                    val_predicted_red.push(num);
                    normal_predicted_red.push(num);
                } else {
                    val_predicted_blue.push(num);
                    normal_predicted_blue.push(num);
                }
            }
        }
    }
    
    // 去重并排序
    val_predicted_red.sort();
    val_predicted_red.dedup();
    val_predicted_blue.sort();
    val_predicted_blue.dedup();
    normal_predicted_red.sort();
    normal_predicted_red.dedup();
    normal_predicted_blue.sort();
    normal_predicted_blue.dedup();
    
    Ok(SingleTestResult {
        val_predicted_red,
        val_predicted_blue,
        normal_predicted_red,
        normal_predicted_blue,
    })
}

/// 8. 多参数组合联合搜索预测
/// 
/// 使用多个训练集和验证集参数组合执行搜索和预测，记录每次结果并输出合并分析
fn run_multi_param_prediction(config: &mut GuaConfig, state: &mut MenuState) {
    print_header("多参数组合联合搜索预测");
    
    // 1. 让用户输入预测日期
    print_info("\n请输入预测日期 (YYYY-MM-DD):");
    let date_input = get_user_input("");
    
    let predict_date = match NaiveDate::parse_from_str(&date_input, "%Y-%m-%d") {
        Ok(d) => d,
        Err(_) => {
            print_error("日期格式错误");
            return;
        }
    };
    
    // 2. 确保数据已加载
    if !ensure_data_loaded(config, state) {
        print_error("数据加载失败，请检查数据文件");
        return;
    }
    
    // 3. 定义参数组合
    // 注释：以下参数组合与Python版本保持一致
    let param_combinations: Vec<(i32, i32)> = vec![
        // [2000, 450],  // 注释：数据量较大时可以启用
        // [2000, 192],
        // [2000, 96],
        // [2000, 48],
        // [2000, 24],
        // [2000, 12],
        // [2000, 6],
        // [1500, 96],
        // [1500, 48],
        // [1500, 24],
        // [1500, 12],
        // [1500, 6],
        // [1000, 96],
        // [1000, 48],
        // [1000, 24],
        // [1000, 12],
        // [1000, 6],
        // [450, 450],
        // [500, 48],
        // [500, 24],
        // [500, 12],
        // [500, 6],
        // [153, 153],
        // [153, 48],
        // [153, 24],
        (153, 12),
        (153, 6),
        // [48, 48],
        // [48, 24],
        (48, 12),
        (48, 6),
        // [24, 24],
        (24, 12),
        (24, 6),
    ];
    
    let mode_cfg = config.mode_config.get(&config.mode);
    let red_count = mode_cfg.map(|m| m.red_count).unwrap_or(6);
    let blue_count = mode_cfg.map(|m| m.blue_count).unwrap_or(1);
    
    print_info(&format!("\n预测日期: {}", predict_date.format("%Y-%m-%d")));
    print_info(&format!("参数组合: {:?}", param_combinations));
    print_info(&format!("总组合数: {}", param_combinations.len()));
    
    // 4. 遍历所有组合
    let mut results: Vec<MultiParamResult> = Vec::new();
    let total_combinations = param_combinations.len();
    
    print_info(&format!("\n开始遍历 {} 种训练集/验证集组合...", total_combinations));
    print_info(&"=".repeat(60));
    
    for (combination_count, (train_size, val_size)) in param_combinations.iter().enumerate() {
        // 检查数据是否足够
        if train_size + val_size > state.features_list.len() as i32 {
            print_warning(&format!("  [{}/{}] 跳过: 数据不足", 
                combination_count + 1, total_combinations));
            continue;
        }
        
        print_info(&format!("\n[{}/{}] 测试配置: 训练集={}, 验证集={}", 
            combination_count + 1, total_combinations, train_size, val_size));
        
        // 创建临时配置
        let mut temp_config = config.clone();
        temp_config.train_periods = *train_size;
        temp_config.val_periods = *val_size;
        temp_config.total_periods = train_size + val_size;
        
        // 执行搜索和预测
        match run_single_optimal_test(&state.features_list, &state.records, &temp_config, predict_date) {
            Ok(test_result) => {
                results.push(MultiParamResult {
                    train_size: *train_size,
                    val_size: *val_size,
                    val_predicted_red: test_result.val_predicted_red,
                    val_predicted_blue: test_result.val_predicted_blue,
                    normal_predicted_red: test_result.normal_predicted_red,
                    normal_predicted_blue: test_result.normal_predicted_blue,
                    success: true,
                });
                
                print_success(&format!("  验证集预测红球: {:?}", results.last().unwrap().val_predicted_red));
                print_success(&format!("  验证集预测蓝球: {:?}", results.last().unwrap().val_predicted_blue));
            }
            Err(e) => {
                print_error(&format!("  测试失败: {}", e));
            }
        }
    }
    
    // 5. 输出结果表格
    print_header("\n============================================================");
    print_header("多参数组合联合搜索预测结果");
    print_header("============================================================");
    
    print_info(&format!("\n预测日期: {}", predict_date.format("%Y-%m-%d")));
    
    // 输出验证集预测表格
    print_highlight("\n【验证集预测结果】");
    println!("\n{}", "=".repeat(100));
    println!("{:^8} | {:^8} | {:^45} | {:^20}", 
        "训练集", "验证集", "预测红球", "预测蓝球");
    println!("{}", "=".repeat(100));
    
    for r in &results {
        if r.success {
            println!("  {:^6} | {:^6} | {:^45} | {:^20}",
                r.train_size, r.val_size,
                format!("{:?}", r.val_predicted_red),
                format!("{:?}", r.val_predicted_blue));
        }
    }
    
    println!("{}", "=".repeat(100));
    
    // 6. 合并分析
    print_header("\n============================================================");
    print_header("合并分析：所有组合预测结果合并");
    print_header("============================================================");
    
    let successful_results: Vec<&MultiParamResult> = results.iter().filter(|r| r.success).collect();
    
    if !successful_results.is_empty() {
        // 合并验证集预测的所有红球和蓝球
        let mut val_merged_red: Vec<i32> = Vec::new();
        let mut val_merged_blue: Vec<i32> = Vec::new();
        
        for r in &successful_results {
            val_merged_red.extend(r.val_predicted_red.iter().cloned());
            val_merged_blue.extend(r.val_predicted_blue.iter().cloned());
        }
        
        val_merged_red.sort();
        val_merged_red.dedup();
        val_merged_blue.sort();
        val_merged_blue.dedup();
        
        // 输出合并结果
        print_highlight("\n【验证集预测合并结果】");
        print_info(&format!("  合并后红球号码 ({}个): {:?}", val_merged_red.len(), val_merged_red));
        print_info(&format!("  合并后蓝球号码 ({}个): {:?}", val_merged_blue.len(), val_merged_blue));
        
        // 统计号码出现频率
        print_highlight("\n【红球号码出现频率统计】");
        let mut red_frequency: HashMap<i32, i32> = HashMap::new();
        for r in &successful_results {
            for n in &r.val_predicted_red {
                *red_frequency.entry(*n).or_insert(0) += 1;
            }
        }
        
        let mut sorted_red: Vec<_> = red_frequency.iter().collect();
        sorted_red.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
        
        for (num, freq) in sorted_red.iter().take(10) {
            print_data(&format!("  红球 {:02}: 出现 {} 次", num, freq));
        }
        
        // 推荐号码（按频率排序取前N个）
        print_highlight("\n【推荐号码（按出现频率排序）】");
        let recommended_red: Vec<i32> = sorted_red.iter().take(red_count as usize).map(|(n, _)| **n).collect();
        let recommended_blue: Vec<i32> = val_merged_blue.iter().take(blue_count as usize).cloned().collect();
        
        print_color(&format!("  推荐红球: {:?}", recommended_red), "red", false, "\n");
        print_color(&format!("  推荐蓝球: {:?}", recommended_blue), "blue", false, "\n");
    } else {
        print_warning("\n没有成功的预测结果");
    }
}

/// 多参数组合预测结果
struct MultiParamResult {
    train_size: i32,
    val_size: i32,
    val_predicted_red: Vec<i32>,
    val_predicted_blue: Vec<i32>,
    normal_predicted_red: Vec<i32>,
    normal_predicted_blue: Vec<i32>,
    success: bool,
}

/// 使用内存中的搜索结果进行预测（实现版本）
/// 
/// 与Python版本的predict_with_memory_results函数保持一致
fn predict_with_memory_results_impl(
    results: &[SearchResult],
    _features_list: &[HashMap<String, i32>],
    config: &GuaConfig,
    predict_date: NaiveDate,
) {
    print_header(&format!("预测日期: {}", predict_date.format("%Y-%m-%d")));
    
    // 计算预测日期的卦象特征
    let gua_features = calculate_time_gua(
        predict_date.year(),
        predict_date.month() as i32,
        predict_date.day() as i32,
        12, // 默认午时
    );
    
    // 显示卦象信息
    print_info("\n============================================================");
    print_info("步骤1: 计算卦象特征详情");
    print_info("============================================================");
    
    display_gua_info(&gua_features);
    
    // 进行预测
    print_info("\n============================================================");
    print_info("步骤2: 进行预测");
    print_info("============================================================");
    
    let features = gua_features.to_features();
    
    let mut red_predictions = Vec::new();
    let mut blue_predictions = Vec::new();
    
    for result in results {
        if result.best_formulas.is_empty() {
            continue;
        }
        
        let target_range = config.get_position_range(&result.ball_type, result.position);
        let output_count = config.get_position_output_count(&result.ball_type, result.position);
        
        // 使用投票进行预测
        let predictions = predict_with_voting(
            &result.best_formulas,
            &features,
            target_range,
            output_count,
        );
        
        if !predictions.is_empty() {
            println!("\n{}:", result.position_key);
            println!("  号码范围: {}-{}", target_range.0, target_range.1);
            println!("  公式数量: {}", result.best_formulas.len());
            
            for (i, (num, score)) in predictions.iter().enumerate() {
                println!("  {}. 号码 {} (票数: {:.2})", i + 1, num, score);
            }
            
            if result.ball_type == "red" {
                red_predictions.extend(predictions.iter().map(|(n, _)| *n));
            } else {
                blue_predictions.extend(predictions.iter().map(|(n, _)| *n));
            }
        }
    }
    
    // 汇总预测结果
    print_highlight("\n============================================================");
    print_highlight("预测结果汇总");
    print_highlight("============================================================");
    
    if !red_predictions.is_empty() {
        red_predictions.sort();
        red_predictions.dedup();
        print_color(&format!("红球推荐: {:?}", red_predictions), "red", false, "\n");
    }
    
    if !blue_predictions.is_empty() {
        blue_predictions.sort();
        blue_predictions.dedup();
        print_color(&format!("蓝球推荐: {:?}", blue_predictions), "blue", false, "\n");
    }
}

/// 显示卦象信息
/// 
/// 与Python版本的display_gua_info函数保持一致
fn display_gua_info(gua_data: &GuaData) {
    println!();
    println!("时间: {}年{}月{}日 {}时", 
        gua_data.lunar_year, gua_data.lunar_month, gua_data.lunar_day, gua_data.lunar_hour);
    println!();
    
    // 本卦
    print_color("本卦: ", "yellow", true, "");
    print_color(&format!("{} ({}{}) ", 
        gua_data.ben_gua_name, gua_data.ben_gua_upper, gua_data.ben_gua_lower), 
        "green", false, "");
    print_color(&format!("先天数:{} 后天数:{} 五行:{}", 
        gua_data.ben_gua_xiantian, gua_data.ben_gua_houtian, gua_data.ben_gua_wuxing), 
        "cyan", false, "\n");
    
    // 变卦
    print_color("变卦: ", "yellow", true, "");
    print_color(&format!("{} ({}{}) ", 
        gua_data.bian_gua_name, gua_data.bian_gua_upper, gua_data.bian_gua_lower), 
        "green", false, "");
    print_color(&format!("先天数:{} 后天数:{} 五行:{}", 
        gua_data.bian_gua_xiantian, gua_data.bian_gua_houtian, gua_data.bian_gua_wuxing), 
        "cyan", false, "\n");
    
    // 互卦
    print_color("互卦: ", "yellow", true, "");
    print_color(&format!("{} ({}{}) ", 
        gua_data.hu_gua_name, gua_data.hu_gua_upper, gua_data.hu_gua_lower), 
        "green", false, "");
    print_color(&format!("先天数:{} 后天数:{} 五行:{}", 
        gua_data.hu_gua_xiantian, gua_data.hu_gua_houtian, gua_data.hu_gua_wuxing), 
        "cyan", false, "\n");
    
    // 变爻
    print_color("变爻: ", "yellow", true, "");
    print_color(&format!("第{}爻\n", gua_data.bian_yao_pos), "green", false, "");
    
    // 干支
    println!();
    print_color("干支: ", "yellow", true, "");
    print_color(&format!("年:{} 月:{} 日:{} 时:{}", 
        gua_data.year_ganzhi, gua_data.month_ganzhi, gua_data.day_ganzhi, gua_data.hour_ganzhi), 
        "cyan", false, "\n");
    
    // 月相
    print_color("月相: ", "yellow", true, "");
    print_color(&format!("{} (能量:{})\n", gua_data.moon_phase, gua_data.moon_energy), "green", false, "");
}
