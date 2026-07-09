use std::collections::HashSet;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::error::AppError;

/// 用户偏好设置。
/// - data_dir：本地 SQLite 工作副本所在目录（绝对路径），默认 App 数据目录。**不应指向 iCloud**，避免多机并发写损坏数据库。
/// - sync_dir：iCloud Drive 文件夹（用户自选），仅存放同步用的轻量事件文件 + workbench.json，不存放数据库本体。
/// - machine_id：本机唯一标识，用于事件溯源与 last-writer-wins 区分，持久化在本地（不进 iCloud）。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    pub data_dir: Option<String>,
    pub sync_dir: Option<String>,
    pub machine_id: String,
}

/// settings.json 始终存放在「默认 App 数据目录」下（该位置永远可解析），
/// 不受用户自定义 data_dir / sync_dir 影响，避免「找不到自己的配置」的死循环。
pub fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
        .join("settings.json")
}

/// 本机同步状态（仅本地，不进 iCloud）：已应用的事件文件名集合 + 最近一次同步时间。
/// 用于跨运行去重，避免重复重放同一事件文件。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncState {
    pub applied: HashSet<String>,
    pub last_synced: Option<i64>,
}

pub fn sync_state_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
        .join("sync_state.json")
}

pub fn load_settings(app: &tauri::AppHandle) -> Settings {
    let path = settings_path(app);
    let mut s: Settings = match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Settings::default(),
    };
    // 首次启动生成稳定的本机 machine_id
    if s.machine_id.is_empty() {
        s.machine_id = uuid::Uuid::new_v4().to_string();
        let _ = save_settings(app, &s);
    }
    s
}

pub fn save_settings(app: &tauri::AppHandle, s: &Settings) -> Result<(), AppError> {
    let path = settings_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Db(e.to_string()))?;
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| AppError::Db(e.to_string()))?;
    std::fs::write(&path, json).map_err(|e| AppError::Db(e.to_string()))?;
    Ok(())
}

pub fn load_sync_state(app: &tauri::AppHandle) -> SyncState {
    let path = sync_state_path(app);
    match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => SyncState::default(),
    }
}

pub fn save_sync_state(app: &tauri::AppHandle, st: &SyncState) -> Result<(), AppError> {
    let path = sync_state_path(app);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::Db(e.to_string()))?;
    }
    let json = serde_json::to_string_pretty(st).map_err(|e| AppError::Db(e.to_string()))?;
    std::fs::write(&path, json).map_err(|e| AppError::Db(e.to_string()))?;
    Ok(())
}

/// 解析实际数据目录：有配置且目录存在则用配置，否则回退默认 App 数据目录。
pub fn resolve_data_dir(app: &tauri::AppHandle) -> PathBuf {
    let settings = load_settings(app);
    if let Some(dir) = settings.data_dir {
        let p = PathBuf::from(&dir);
        if p.is_dir() {
            return p;
        }
    }
    app.path()
        .app_data_dir()
        .expect("failed to resolve app data dir")
}
