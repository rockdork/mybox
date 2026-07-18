mod crud;
mod db;
mod error;
mod settings;
mod sync;
mod workbench;

use db::{open_db, Db, InboxItem};
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::MutexGuard;
use tauri::Manager;

use crate::settings::Settings;
use crate::sync::SyncRuntime;
use crate::workbench::WorkbenchData;

/// 取数据库连接，遇到 poisoned 锁时降级为只读旧数据继续运行（而非 panic）。
/// 返回 Option 守护：正常情况恒为 Some；仅在「更改保存位置」搬迁的极短临界区内为 None。
fn lock_db<'a>(state: &'a tauri::State<'a, Db>) -> MutexGuard<'a, Option<Connection>> {
    match state.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

#[tauri::command]
fn create_inbox_item(
    app: tauri::AppHandle,
    state: tauri::State<Db>,
    title: String,
    content: Option<String>,
    item_type: Option<String>,
    source: Option<String>,
) -> Result<InboxItem, String> {
    let guard = lock_db(&state);
    let conn = guard.as_ref().expect("database not initialized");
    let item_type = item_type.unwrap_or_else(|| "note".to_string());
    let source = source.unwrap_or_else(|| "desktop".to_string());
    let item = crud::create_item(
        conn,
        &title,
        &content.unwrap_or_default(),
        &item_type,
        &source,
    )
    .map_err(|e| e.to_string())?;
    // 本地变更 → 同步事件（best-effort，失败不影响主流程）
    let _ = sync::emit_event(
        &app,
        &item.id,
        "create",
        &serde_json::to_string(&item).unwrap_or_default(),
        item.updated_at,
    );
    Ok(item)
}

#[tauri::command]
fn get_inbox_item(state: tauri::State<Db>, id: String) -> Result<InboxItem, String> {
    let guard = lock_db(&state);
    let conn = guard.as_ref().expect("database not initialized");
    crud::get_item(conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_inbox_items(
    state: tauri::State<Db>,
    filter_type: Option<String>,
) -> Result<Vec<InboxItem>, String> {
    let guard = lock_db(&state);
    let conn = guard.as_ref().expect("database not initialized");
    crud::list_items(conn, filter_type.as_deref()).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_inbox_item(
    app: tauri::AppHandle,
    state: tauri::State<Db>,
    id: String,
    title: String,
    content: String,
    status: String,
    item_type: String,
    due_date: Option<i64>,
    priority: Option<String>,
    pinned: Option<bool>,
    tags: Option<String>,
) -> Result<InboxItem, String> {
    let guard = lock_db(&state);
    let conn = guard.as_ref().expect("database not initialized");
    let item = crud::update_item(
        conn,
        &id,
        &title,
        &content,
        &status,
        &item_type,
        due_date,
        &priority.unwrap_or_else(|| "normal".to_string()),
        pinned.unwrap_or(false),
        &tags.unwrap_or_default(),
    )
    .map_err(|e| e.to_string())?;
    let _ = sync::emit_event(
        &app,
        &item.id,
        "update",
        &serde_json::to_string(&item).unwrap_or_default(),
        item.updated_at,
    );
    Ok(item)
}

#[tauri::command]
fn delete_inbox_item(app: tauri::AppHandle, state: tauri::State<Db>, id: String) -> Result<(), String> {
    let guard = lock_db(&state);
    let conn = guard.as_ref().expect("database not initialized");
    let item = crud::delete_item(conn, &id).map_err(|e| e.to_string())?;
    let _ = sync::emit_event(
        &app,
        &item.id,
        "delete",
        &serde_json::to_string(&item).unwrap_or_default(),
        item.updated_at,
    );
    Ok(())
}

#[tauri::command]
fn process_inbox_item(
    app: tauri::AppHandle,
    state: tauri::State<Db>,
    id: String,
    target_type: String,
    status: Option<String>,
) -> Result<InboxItem, String> {
    let guard = lock_db(&state);
    let conn = guard.as_ref().expect("database not initialized");
    let item = crud::process_item(conn, &id, &target_type, status.as_deref())
        .map_err(|e| e.to_string())?;
    let _ = sync::emit_event(
        &app,
        &item.id,
        "process",
        &serde_json::to_string(&item).unwrap_or_default(),
        item.updated_at,
    );
    Ok(item)
}

/// 读取当前数据保存位置设置，供前端展示。
#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let settings = settings::load_settings(&app);
    let default_dir = app
        .path()
        .app_data_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let data_dir = settings.data_dir.clone();
    // 实际当前数据库路径 = 解析后的数据目录 / inbox.sqlite
    let current_db = settings::resolve_data_dir(&app)
        .join("inbox.sqlite")
        .to_string_lossy()
        .to_string();
    Ok(serde_json::json!({
        "dataDir": data_dir,
        "defaultDir": default_dir,
        "currentDb": current_db,
    }))
}

/// 更改数据保存位置：校验 → 刷盘 → 关旧连接 → 搬迁文件 → 新位置重开 → 记住设置。
/// 全程持有锁，期间其他命令无法并发访问，保证搬迁原子性。
#[tauri::command]
fn set_data_dir(
    app: tauri::AppHandle,
    state: tauri::State<Db>,
    new_dir: String,
) -> Result<(), String> {
    let new_path = PathBuf::from(&new_dir);
    if !new_path.is_absolute() {
        return Err("请选择绝对路径的文件夹".into());
    }
    std::fs::create_dir_all(&new_path).map_err(|e| e.to_string())?;

    // 目标已存在数据库则拒绝，避免覆盖用户数据
    if new_path.join("inbox.sqlite").exists() {
        return Err("该文件夹已存在数据库文件 inbox.sqlite，为避免覆盖请选择空文件夹。".into());
    }

    let current_dir = settings::resolve_data_dir(&app);
    if current_dir == new_path {
        return Ok(()); // 与当前一致，无需操作
    }

    let mut guard = lock_db(&state);
    // 1) 先刷盘 + 关闭旧连接，释放文件句柄
    if let Some(conn) = guard.take() {
        let _ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []);
        drop(conn);
    }
    // 2) 搬迁文件
    db::move_db_files(&current_dir, &new_path).map_err(|e| e.to_string())?;
    // 3) 新位置重开连接（含迁移 / WAL 初始化）
    let new_conn = db::open_db(&new_path).map_err(|e| e.to_string())?;
    *guard = Some(new_conn);
    drop(guard);
    // 4) 记住设置（保留已有同步配置与本机 id）
    let prev = settings::load_settings(&app);
    let settings = Settings {
        data_dir: Some(new_dir),
        sync_dir: prev.sync_dir,
        machine_id: prev.machine_id,
    };
    settings::save_settings(&app, &settings).map_err(|e| e.to_string())?;
    Ok(())
}

/// 在访达中显示当前数据库文件（open -R）。
#[tauri::command]
fn open_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = settings::resolve_data_dir(&app);
    let target = dir.join("inbox.sqlite");
    std::process::Command::new("open")
        .arg("-R")
        .arg(&target)
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ============ iCloud 同步 ============

/// 开启/更换同步目录（指向用户自选的 iCloud Drive 文件夹）。
/// 首次开启：导出本机全量条目为事件，使加入同步的其他机器能收敛一致；
/// 随后立即重放一次（拉取已有远端事件），并启动文件夹监听实现实时同步。
#[tauri::command]
fn set_sync_dir(app: tauri::AppHandle, state: tauri::State<Db>, new_dir: String) -> Result<(), String> {
    let new_path = PathBuf::from(&new_dir);
    if !new_path.is_absolute() {
        return Err("请选择绝对路径的文件夹".into());
    }
    std::fs::create_dir_all(&new_path).map_err(|e| e.to_string())?;

    let prev = settings::load_settings(&app);
    let first_enable = prev.sync_dir.as_deref() != Some(new_dir.as_str());

    // 记忆设置
    let settings = Settings {
        data_dir: prev.data_dir.clone(),
        sync_dir: Some(new_dir),
        machine_id: prev.machine_id,
    };
    settings::save_settings(&app, &settings).map_err(|e| e.to_string())?;

    let guard = lock_db(&state);
    let conn = guard.as_ref().expect("database not initialized");

    // 首次启用：把 data_dir 下的 workbench.json 迁移到 sync 目录，并导出全量条目
    if first_enable {
        workbench::migrate_to_sync_dir(&app, &new_path);
        if let Err(e) = sync::export_all(&app, conn) {
            return Err(e.to_string());
        }
    }
    // 拉取已有远端事件
    if let Err(e) = sync::replay_pending(&app, conn) {
        return Err(e.to_string());
    }
    drop(guard);

    // 启动/重启监听
    sync::start_watcher(&app).map_err(|e| e.to_string())?;
    Ok(())
}

/// 关闭同步：清除 sync_dir 并停止监听（本地数据保留）。
#[tauri::command]
fn disable_sync(app: tauri::AppHandle) -> Result<(), String> {
    let prev = settings::load_settings(&app);
    let settings = Settings {
        data_dir: prev.data_dir.clone(),
        sync_dir: None,
        machine_id: prev.machine_id,
    };
    settings::save_settings(&app, &settings).map_err(|e| e.to_string())?;
    sync::stop_watcher(&app);
    Ok(())
}

/// 查询同步状态（是否开启、目录、本机 id、最近同步时间、条目数）。
#[tauri::command]
fn get_sync_status(app: tauri::AppHandle, state: tauri::State<Db>) -> Result<serde_json::Value, String> {
    let guard = lock_db(&state);
    let conn = guard.as_ref().expect("database not initialized");
    Ok(sync::get_sync_status(&app, conn))
}

/// 手动触发一次同步（重放远端事件）。
#[tauri::command]
fn trigger_sync(app: tauri::AppHandle, state: tauri::State<Db>) -> Result<(), String> {
    let guard = lock_db(&state);
    let conn = guard.as_ref().expect("database not initialized");
    sync::replay_pending(&app, conn).map_err(|e| e.to_string())?;
    Ok(())
}

// ============ 工作台 ============

#[tauri::command]
fn get_workbench(app: tauri::AppHandle) -> Result<WorkbenchData, String> {
    Ok(workbench::load_workbench(&app))
}

#[tauri::command]
fn save_workbench(app: tauri::AppHandle, data: WorkbenchData) -> Result<(), String> {
    workbench::save_workbench(&app, &data).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = settings::resolve_data_dir(app.handle());
            std::fs::create_dir_all(&dir).expect("failed to create data dir");

            let conn = open_db(&dir).expect("failed to open database");
            app.manage(Db::new(Some(conn)));

            // 托管同步运行时（watcher + worker 线程）
            app.manage(SyncRuntime::default());

            // 若已配置同步目录：启动即拉取远端事件 + 启动监听，实现跨设备自动同步
            let s = settings::load_settings(app.handle());
            if let Some(sync_dir) = s.sync_dir {
                let p = PathBuf::from(&sync_dir);
                if p.is_dir() {
                    if let Ok(guard) = app.state::<Db>().lock() {
                        if let Some(conn) = guard.as_ref() {
                            let _ = sync::replay_pending(app.handle(), conn);
                        }
                    }
                    let _ = sync::start_watcher(app.handle());
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_inbox_item,
            get_inbox_item,
            list_inbox_items,
            update_inbox_item,
            delete_inbox_item,
            process_inbox_item,
            get_settings,
            set_data_dir,
            open_data_dir,
            get_sync_status,
            set_sync_dir,
            disable_sync,
            trigger_sync,
            get_workbench,
            save_workbench,
            workbench::open_launcher,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
