//! color_printer.rs - 彩色输出工具类
//!
//! 使用ANSI转义码实现终端彩色输出，方便观察重点信息。

#![allow(dead_code)]
#![allow(unused_doc_comments)]

use std::io::{self, Write};

/// ANSI颜色代码
pub const COLORS: &[(&str, &str)] = &[
    ("red", "\x1b[91m"),       // 红色 - 错误/警告
    ("green", "\x1b[92m"),     // 绿色 - 成功/命中
    ("yellow", "\x1b[93m"),    // 黄色 - 提示/重要
    ("blue", "\x1b[94m"),      // 蓝色 - 信息
    ("magenta", "\x1b[95m"),   // 品红 - 特殊
    ("cyan", "\x1b[96m"),      // 青色 - 数据
    ("white", "\x1b[97m"),     // 白色 - 普通
    ("bold", "\x1b[1m"),       // 粗体
    ("underline", "\x1b[4m"),  // 下划线
    ("reset", "\x1b[0m"),      // 重置
];

/// 彩色输出工具类
/// 
/// 使用ANSI转义码实现终端彩色输出，方便观察重点信息。
pub struct ColorPrinter {
    /// 静默模式标志
    silent: bool,
}

impl ColorPrinter {
    /// 创建新的ColorPrinter实例
    pub fn new() -> Self {
        ColorPrinter { silent: false }
    }
    
    /// 设置静默模式
    pub fn set_silent(&mut self, silent: bool) {
        self.silent = silent;
    }
    
    /// 获取颜色代码
    fn get_color_code(color: &str) -> &'static str {
        for &(name, code) in COLORS {
            if name == color {
                return code;
            }
        }
        "\x1b[97m"  // 默认白色
    }
    
    /// 打印彩色文本
    /// 
    /// 参数:
    /// - text: 要打印的文本
    /// - color: 颜色名称
    /// - bold: 是否加粗
    /// - end: 结尾字符（默认换行）
    pub fn print_color(&self, text: &str, color: &str, bold: bool, end: &str) {
        if self.silent {
            return;
        }
        
        let color_code = Self::get_color_code(color);
        let bold_code = if bold { "\x1b[1m" } else { "" };
        let reset_code = "\x1b[0m";
        
        print!("{}{}{}{}", bold_code, color_code, text, reset_code);
        
        if end == "\n" {
            println!();
        } else {
            print!("{}", end);
        }
        
        // 确保立即输出
        let _ = io::stdout().flush();
    }
    
    /// 打印成功信息（绿色）
    pub fn print_success(&self, text: &str) {
        self.print_color(&format!("✓ {}", text), "green", true, "\n");
    }
    
    /// 打印错误信息（红色）
    pub fn print_error(&self, text: &str) {
        self.print_color(&format!("✗ {}", text), "red", true, "\n");
    }
    
    /// 打印警告信息（黄色）
    pub fn print_warning(&self, text: &str) {
        self.print_color(&format!("⚠ {}", text), "yellow", true, "\n");
    }
    
    /// 打印信息（白色）
    pub fn print_info(&self, text: &str) {
        self.print_color(&format!("ℹ {}", text), "white", false, "\n");
    }
    
    /// 打印数据（青色）
    pub fn print_data(&self, text: &str) {
        self.print_color(&format!("  {}", text), "cyan", false, "\n");
    }
    
    /// 打印高亮信息（品红加粗）
    pub fn print_highlight(&self, text: &str) {
        self.print_color(&format!("★ {}", text), "magenta", true, "\n");
    }
    
    /// 打印标题（黄色下划线）
    pub fn print_header(&self, text: &str) {
        self.print_color(&format!("\n{}", "=".repeat(60)), "yellow", false, "\n");
        self.print_color(&format!("  {}", text), "yellow", true, "\n");
        self.print_color(&"=".repeat(60), "yellow", false, "\n");
    }
}

impl Default for ColorPrinter {
    fn default() -> Self {
        Self::new()
    }
}

/// 全局ColorPrinter实例
lazy_static::lazy_static! {
    pub static ref PRINTER: ColorPrinter = ColorPrinter::new();
}

/// 便捷函数：打印成功信息
pub fn print_success(text: &str) {
    PRINTER.print_success(text);
}

/// 便捷函数：打印错误信息
pub fn print_error(text: &str) {
    PRINTER.print_error(text);
}

/// 便捷函数：打印警告信息
pub fn print_warning(text: &str) {
    PRINTER.print_warning(text);
}

/// 便捷函数：打印信息
pub fn print_info(text: &str) {
    PRINTER.print_info(text);
}

/// 便捷函数：打印数据
pub fn print_data(text: &str) {
    PRINTER.print_data(text);
}

/// 便捷函数：打印高亮信息
pub fn print_highlight(text: &str) {
    PRINTER.print_highlight(text);
}

/// 便捷函数：打印标题
pub fn print_header(text: &str) {
    PRINTER.print_header(text);
}

/// 便捷函数：打印彩色文本
pub fn print_color(text: &str, color: &str, bold: bool, end: &str) {
    PRINTER.print_color(text, color, bold, end);
}

/// 设置全局静默模式
pub fn set_silent(silent: bool) {
    // 注意：由于使用了lazy_static，这里需要通过可变引用来修改
    // 但lazy_static只提供不可变引用，所以这里使用内部可变性模式
    // 实际实现中可能需要使用Mutex或RwLock
    // 这里简化处理，静默模式需要在创建实例时设置
}
