#!/usr/bin/env rust
//! lottery_easy_gua.rs - 基于周易卦象的彩票预测系统 (Rust版本)
//!
//! 系统说明：
//! ==========
//! 本系统基于周易时间起卦法，通过农历时间生成卦象特征，然后使用组合式数学操作
//! 搜索算法，找出能够命中开奖数字的卦象数字变换方式。
//!
//! 核心原理：
//! 1. 时间起卦：使用农历年、月、日、时进行起卦
//! 2. 卦象特征：本卦、变卦、互卦、变爻等
//! 3. 数学操作：加减乘、移位、取模、组合等
//! 4. 搜索匹配：遍历各种组合，计算命中率
//! 5. 结果保存：保存高命中率的组合公式
//!
//! 作者：周易彩票预测系统
//! 日期：2024
//! Rust重写版本：2024

#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]

// 模块声明
mod constants;
mod color_printer;
mod config;
mod formula;
mod gua_features;
mod formula_generator;
mod search;
mod voting;
mod optimization;
mod data_loader;
mod menu;

use std::env;

use config::GuaConfig;
use menu::run_interactive_menu;

/// 主程序入口
fn main() {
    // 打印欢迎信息
    println!();
    println!("============================================================");
    println!("  周易卦象彩票预测系统 (Rust版 v1.0)");
    println!("============================================================");
    println!();
    
    // 创建默认配置
    let config = GuaConfig::new();
    
    // 检查命令行参数
    let args: Vec<String> = env::args().collect();
    
    if args.len() > 1 {
        // 处理命令行参数
        match args[1].as_str() {
            "--help" | "-h" => {
                print_help();
                return;
            }
            "--version" | "-v" => {
                println!("版本: 1.0.0");
                return;
            }
            "--mode" => {
                if args.len() > 2 {
                    let mode = args[2].as_str();
                    if mode == "ssq" || mode == "dlt" {
                        let mut config = GuaConfig::new();
                        config.mode = mode.to_string();
                        run_interactive_menu(config);
                    } else {
                        eprintln!("错误: 无效的彩种模式，请使用 'ssq' 或 'dlt'");
                    }
                } else {
                    eprintln!("错误: --mode 需要指定彩种 (ssq/dlt)");
                }
                return;
            }
            _ => {
                eprintln!("错误: 未知参数 '{}'", args[1]);
                eprintln!("使用 --help 查看帮助信息");
                return;
            }
        }
    }
    
    // 运行交互式菜单
    run_interactive_menu(config);
}

/// 打印帮助信息
fn print_help() {
    println!("用法: lottery_easy_gua [选项]");
    println!();
    println!("选项:");
    println!("  -h, --help      显示帮助信息");
    println!("  -v, --version   显示版本信息");
    println!("  --mode <彩种>   指定彩种模式 (ssq=双色球, dlt=大乐透)");
    println!();
    println!("示例:");
    println!("  lottery_easy_gua              # 启动交互式菜单");
    println!("  lottery_easy_gua --mode ssq   # 启动双色球模式");
    println!("  lottery_easy_gua --mode dlt   # 启动大乐透模式");
}
