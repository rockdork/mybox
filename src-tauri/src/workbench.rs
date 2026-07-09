use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::settings;

/// 工作台启动项类型。
/// - web：网页链接（target 为完整 URL）
/// - obsidian：Obsidian 知识库（target 为 vault 名称，打开时拼成 obsidian:// 协议）
/// - app：本地应用（target 为 .app 路径或应用名）
/// - folder：本地文件夹（target 为文件夹路径）
pub type LauncherKind = String;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LauncherItem {
    pub id: String,
    pub name: String,
    pub kind: LauncherKind,
    pub target: String,
    pub icon: String,
    pub group_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LauncherGroup {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkbenchData {
    pub groups: Vec<LauncherGroup>,
    pub items: Vec<LauncherItem>,
}

/// workbench.json 路径：若已开启同步，优先存放于同步目录（iCloud）以实现跨设备同步；
/// 否则与数据库同目录（本地）。
fn workbench_path(app: &tauri::AppHandle) -> PathBuf {
    let s = settings::load_settings(app);
    if let Some(dir) = s.sync_dir {
        let p = PathBuf::from(dir);
        if p.is_dir() {
            return p.join("workbench.json");
        }
    }
    settings::resolve_data_dir(app).join("workbench.json")
}

pub fn load_workbench(app: &tauri::AppHandle) -> WorkbenchData {
    let path = workbench_path(app);
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => WorkbenchData::default(),
    }
}

pub fn save_workbench(app: &tauri::AppHandle, data: &WorkbenchData) -> Result<(), AppError> {
    let path = workbench_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Db(e.to_string()))?;
    }
    let json = serde_json::to_string_pretty(data).map_err(|e| AppError::Db(e.to_string()))?;
    std::fs::write(&path, &json).map_err(|e| AppError::Db(e.to_string()))?;

    // 同步开启时，额外镜像一份到本地 data_dir，保证关闭同步后本地仍有最新配置
    let s = settings::load_settings(app);
    if s.sync_dir.is_some() {
        let local = settings::resolve_data_dir(app).join("workbench.json");
        let _ = std::fs::write(&local, &json);
    }
    Ok(())
}

/// 首次开启同步时，将本地 data_dir 下的 workbench.json 迁移到同步目录。
pub fn migrate_to_sync_dir(app: &tauri::AppHandle, sync_dir: &PathBuf) {
    let local = settings::resolve_data_dir(app).join("workbench.json");
    let dest = sync_dir.join("workbench.json");
    if local.exists() && !dest.exists() {
        let _ = std::fs::copy(&local, &dest);
    }
}

/// 把用户的 (kind, target) 解析成 `open` 命令实际要打开的东西。
/// obsidian 类型拼成 obsidian:// 协议；其余直接透传（URL/路径/应用名均可被 macOS `open` 处理）。
fn resolve_open_target(kind: &str, target: &str) -> String {
    if kind == "obsidian" {
        format!("obsidian://open?vault={}", target)
    } else {
        target.to_string()
    }
}

/// 一键打开工作台项：调用系统 `open` 命令（非 shell，参数独立传递，无注入风险）。
#[tauri::command]
pub fn open_launcher(kind: String, target: String) -> Result<(), String> {
    let resolved = resolve_open_target(&kind, &target);
    std::process::Command::new("open")
        .arg(&resolved)
        .spawn()
        .map_err(|e| format!("打开失败：{}", e))?;
    Ok(())
}
