use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use notify::{Event as NotifyEvent, RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::db::{now_ms, InboxItem};
use crate::error::AppError;
use crate::settings::{load_settings, load_sync_state, save_sync_state, SyncState};

/// 单个同步事件文件：`<sync_dir>/sync/<seq>-<machine>.json`
/// seq 为 unix 微秒，文件名天然有序 = 事件时间序，重放时按序应用保证 create→delete 等因果正确。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEvent {
    pub seq: i64,
    pub machine_id: String,
    pub entity: String, // "inbox_item"
    pub entity_id: String,
    pub op: String, // create | update | delete | process
    pub payload: String, // InboxItem JSON；delete 时为 {"id": ...}
    pub ts: i64,  // 事件发生时该项的 updated_at，用于 last-writer-wins
    pub created_at: i64,
}

/// 同步运行时状态（Tauri 托管）。watcher 监听 sync 目录，worker 线程做去重后的重放。
pub struct SyncRuntime {
    pub watcher: Mutex<Option<RecommendedWatcher>>,
    pub stop: Arc<AtomicBool>,
    pub worker: Mutex<Option<JoinHandle<()>>>,
}

impl Default for SyncRuntime {
    fn default() -> Self {
        SyncRuntime {
            watcher: Mutex::new(None),
            stop: Arc::new(AtomicBool::new(false)),
            worker: Mutex::new(None),
        }
    }
}

fn now_micros() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_micros() as i64)
        .unwrap_or(0)
}

/// 当前同步目录（iCloud 文件夹），未开启返回 None
pub fn sync_dir_path(app: &AppHandle) -> Option<PathBuf> {
    load_settings(app).sync_dir.map(PathBuf::from)
}

fn machine_id(app: &AppHandle) -> String {
    load_settings(app).machine_id
}

// ============ 事件写入（本地变更 → iCloud 事件文件）============

/// 本地发生变更后调用：把变更写成一个事件文件落到 iCloud 同步目录，
/// 并立即在本地 applied 集合里登记，避免本机 watcher 触发重复重放。
pub fn emit_event(
    app: &AppHandle,
    entity_id: &str,
    op: &str,
    payload: &str,
    ts: i64,
) -> Result<(), AppError> {
    let dir = match sync_dir_path(app) {
        Some(d) => d,
        None => return Ok(()), // 未开启同步，不写事件
    };
    let sync_sub = dir.join("sync");
    std::fs::create_dir_all(&sync_sub).map_err(|e| AppError::Sync(e.to_string()))?;

    let seq = now_micros();
    let mid = machine_id(app);
    let short = &mid[..mid.len().min(8)];
    let fname = format!("{:020}-{}.json", seq, short);
    let ev = SyncEvent {
        seq,
        machine_id: mid,
        entity: "inbox_item".to_string(),
        entity_id: entity_id.to_string(),
        op: op.to_string(),
        payload: payload.to_string(),
        ts,
        created_at: now_ms(),
    };
    let json =
        serde_json::to_string_pretty(&ev).map_err(|e| AppError::Sync(e.to_string()))?;
    let fpath = sync_sub.join(&fname);
    std::fs::write(&fpath, json).map_err(|e| AppError::Sync(e.to_string()))?;

    // 本机已应用，登记避免自我重放
    let mut st = load_sync_state(app);
    st.applied.insert(fname);
    save_sync_state(app, &st)
}

// ============ 事件重放（iCloud 事件文件 → 本地 SQLite）============

/// 把单个事件应用到本地数据库。直接使用 SQL（不经由 crud，避免再次 emit 造成环路）。
/// Last-writer-wins：本地同项 updated_at 更新则跳过；delete 仅在本地不更新于事件时间戳时生效。
pub fn apply_event(conn: &rusqlite::Connection, ev: &SyncEvent) -> Result<(), AppError> {
    match ev.op.as_str() {
        "delete" => {
            conn.execute(
                "DELETE FROM inbox_items WHERE id = ?1 AND updated_at <= ?2",
                params![ev.entity_id, ev.ts],
            )?;
        }
        _ => {
            // create / update / process：payload 为 InboxItem
            let item: InboxItem =
                serde_json::from_str(&ev.payload).map_err(|e| AppError::Sync(e.to_string()))?;
            // LWW：本地若已有且更新，则跳过
            let existing_newer = conn
                .query_row(
                    "SELECT 1 FROM inbox_items WHERE id = ?1 AND updated_at > ?2",
                    params![item.id, item.updated_at],
                    |_| Ok(()),
                )
                .is_ok();
            if existing_newer {
                return Ok(());
            }
            conn.execute(
                "INSERT OR REPLACE INTO inbox_items \
                 (id, item_type, title, content, status, source, obsidian_ref, due_date, priority, pinned, tags, created_at, updated_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![
                    item.id,
                    item.item_type,
                    item.title,
                    item.content,
                    item.status,
                    item.source,
                    item.obsidian_ref,
                    item.due_date,
                    item.priority,
                    item.pinned,
                    item.tags,
                    item.created_at,
                    item.updated_at,
                ],
            )?;
        }
    }
    Ok(())
}

/// 扫描同步目录中所有尚未应用的事件文件，按时间序重放。
/// 返回是否有变更（用于决定是否向前端广播刷新）。
pub fn replay_pending(app: &AppHandle, conn: &rusqlite::Connection) -> Result<bool, AppError> {
    let dir = match sync_dir_path(app) {
        Some(d) => d,
        None => return Ok(false),
    };
    let sync_sub = dir.join("sync");
    if !sync_sub.is_dir() {
        return Ok(false);
    }

    let mut files: Vec<PathBuf> = std::fs::read_dir(&sync_sub)
        .map_err(|e| AppError::Sync(e.to_string()))?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    // 文件名有序 = 事件时间序
    files.sort();

    let mut st: SyncState = load_sync_state(app);
    let mut changed = false;

    for f in files {
        let name = match f.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if st.applied.contains(&name) {
            continue;
        }
        let content = match std::fs::read_to_string(&f) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if let Ok(ev) = serde_json::from_str::<SyncEvent>(&content) {
            apply_event(conn, &ev)?;
            st.applied.insert(name);
            changed = true;
        }
    }

    if changed {
        st.last_synced = Some(now_ms());
        save_sync_state(app, &st)?;
    }
    Ok(changed)
}

/// 首次开启同步时，把本机现有全部条目导出为 create 事件，
/// 使加入同步的其他机器能通过重放收敛到一致状态。
/// 幂等：upsert + LWW，重复导出不会造成数据冲突。
pub fn export_all(app: &AppHandle, conn: &rusqlite::Connection) -> Result<(), AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, item_type, title, content, status, source, obsidian_ref, created_at, updated_at \
         FROM inbox_items ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([], crate::db::item_mapper)?;
    for r in rows {
        let item = r?;
        let payload = serde_json::to_string(&item).map_err(|e| AppError::Sync(e.to_string()))?;
        emit_event(app, &item.id, "create", &payload, item.updated_at)?;
    }
    Ok(())
}

// ============ 状态查询 ============

pub fn get_sync_status(app: &AppHandle, conn: &rusqlite::Connection) -> serde_json::Value {
    let s = load_settings(app);
    let st = load_sync_state(app);
    let count: i64 = conn
        .query_row("SELECT count(*) FROM inbox_items", [], |r| r.get(0))
        .unwrap_or(0);
    serde_json::json!({
        "enabled": s.sync_dir.is_some(),
        "syncDir": s.sync_dir,
        "machineId": s.machine_id,
        "lastSynced": st.last_synced,
        "itemCount": count,
    })
}

// ============ 文件夹监听（实时同步）============

/// 启动监听：监听 sync 目录（Recursive，覆盖 sync/*.json 与 workbench.json）。
/// 任意变更经去重后触发重放 + 前端广播。已开启则先停后启（目录可能变化）。
pub fn start_watcher(app: &AppHandle) -> Result<(), AppError> {
    stop_watcher(app);
    let dir = match sync_dir_path(app) {
        Some(d) => d,
        None => return Ok(()),
    };
    let sync_sub = dir.join("sync");
    std::fs::create_dir_all(&sync_sub).map_err(|e| AppError::Sync(e.to_string()))?;

    let app2 = app.clone();
    let (tx, rx) = mpsc::channel::<()>();
    let stop = app.state::<SyncRuntime>().stop.clone();
    stop.store(false, Ordering::SeqCst);
    let stop2 = stop.clone();

    let worker: JoinHandle<()> = std::thread::spawn(move || {
        loop {
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(()) => {
                    // 合并突发变更（iCloud 可能一次落下多个文件）
                    while rx.recv_timeout(Duration::from_millis(400)).is_ok() {}
                    if stop2.load(Ordering::SeqCst) {
                        break;
                    }
                    if let Ok(guard) = app2.state::<crate::db::Db>().lock() {
                        if let Some(conn) = guard.as_ref() {
                            let _ = replay_pending(&app2, conn);
                        }
                    }
                    // 统一广播：笔记/任务 + 工作台（workbench.json 变化也走这条）
                    let _ = app2.emit("sync-updated", ());
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    if stop2.load(Ordering::SeqCst) {
                        break;
                    }
                }
            }
        }
    });

    let tx2 = tx.clone();
    let mut watcher = notify::recommended_watcher(move |_res: notify::Result<NotifyEvent>| {
        let _ = tx2.send(());
    })
    .map_err(|e| AppError::Sync(e.to_string()))?;
    watcher
        .watch(&dir, RecursiveMode::Recursive)
        .map_err(|e| AppError::Sync(e.to_string()))?;

    let rt = app.state::<SyncRuntime>();
    *rt.watcher.lock().unwrap() = Some(watcher);
    *rt.worker.lock().unwrap() = Some(worker);
    Ok(())
}

/// 停止监听并回收 worker 线程。
pub fn stop_watcher(app: &AppHandle) {
    let rt = app.state::<SyncRuntime>();
    rt.stop.store(true, Ordering::SeqCst);
    if let Some(mut w) = rt.watcher.lock().unwrap().take() {
        // 释放 watcher（drop 即停止监听）
        let _ = w.unwatch(&Path::new(""));
    }
    if let Some(h) = rt.worker.lock().unwrap().take() {
        let _ = h.join();
    }
    rt.stop.store(false, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{migrate, open_db};

    fn tmp_dir() -> PathBuf {
        std::env::temp_dir().join(format!("sync_test_{}", uuid::Uuid::new_v4()))
    }

    // 借用 crate 内的 settings 持久化做一个最小 AppHandle 替身较繁，
    // 这里直接测试纯逻辑：emit/apply/replay 通过临时目录与 in-memory 状态模拟。
    #[test]
    fn apply_event_upsert_and_lww() {
        let base = tmp_dir();
        let conn = open_db(&base).unwrap();
        migrate(&conn).unwrap();

        let item_a = InboxItem {
            id: "a".into(),
            item_type: "note".into(),
            title: "A".into(),
            content: "".into(),
            status: "open".into(),
            source: "desktop".into(),
            obsidian_ref: None,
            due_date: None,
            priority: "normal".into(),
            pinned: false,
            tags: "".into(),
            created_at: 1,
            updated_at: 100,
        };
        let ev = SyncEvent {
            seq: 1,
            machine_id: "m1".into(),
            entity: "inbox_item".into(),
            entity_id: "a".into(),
            op: "create".into(),
            payload: serde_json::to_string(&item_a).unwrap(),
            ts: 100,
            created_at: 1,
        };
        apply_event(&conn, &ev).unwrap();
        let cnt: i64 = conn.query_row("SELECT count(*) FROM inbox_items WHERE id='a'", [], |r| r.get(0)).unwrap();
        assert_eq!(cnt, 1);

        // 更旧的更新应被 LWW 跳过
        let older = InboxItem { id: "a".into(), title: "OLD".into(), updated_at: 50, ..item_a.clone() };
        let ev_old = SyncEvent { seq: 2, ts: 50, payload: serde_json::to_string(&older).unwrap(), ..ev.clone() };
        apply_event(&conn, &ev_old).unwrap();
        let title: String = conn.query_row("SELECT title FROM inbox_items WHERE id='a'", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "A"); // 仍是较新的

        // 更新的更新应覆盖
        let newer = InboxItem { id: "a".into(), title: "NEW".into(), updated_at: 200, ..item_a.clone() };
        let ev_new = SyncEvent { seq: 3, ts: 200, payload: serde_json::to_string(&newer).unwrap(), ..ev.clone() };
        apply_event(&conn, &ev_new).unwrap();
        let title: String = conn.query_row("SELECT title FROM inbox_items WHERE id='a'", [], |r| r.get(0)).unwrap();
        assert_eq!(title, "NEW");

        // delete 应生效（updated_at <= ts）
        let ev_del = SyncEvent { seq: 4, op: "delete".into(), ts: 200, payload: "{\"id\":\"a\"}".into(), ..ev.clone() };
        apply_event(&conn, &ev_del).unwrap();
        let cnt: i64 = conn.query_row("SELECT count(*) FROM inbox_items WHERE id='a'", [], |r| r.get(0)).unwrap();
        assert_eq!(cnt, 0);

        let _ = std::fs::remove_dir_all(&base);
    }
}
