use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::error::AppError;

/// 被 Tauri 托管的数据库连接类型。用 Option 包裹，便于「更改保存位置」时
/// 在持有锁的临界区内关闭旧连接、搬迁文件、再装入新连接。
pub type Db = std::sync::Mutex<Option<Connection>>;

/// 核心实体 InboxItem：笔记（速记/笔记已合并为 note）/ 任务，统一一张表按 item_type 区分
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxItem {
    pub id: String,
    pub item_type: String, // note | task
    pub title: String,
    pub content: String,
    pub status: String, // open | done | archived
    pub source: String, // desktop | mobile
    pub obsidian_ref: Option<String>, // 预留：M2 关联 Obsidian 笔记
    // —— v3 新增：任务/笔记各自特色字段 ——
    pub due_date: Option<i64>, // 任务截止日（unix ms），笔记为 NULL
    pub priority: String,     // 任务优先级 high | normal | low
    pub pinned: bool,         // 笔记置顶
    pub tags: String,         // 笔记标签，逗号分隔
    pub created_at: i64, // unix ms
    pub updated_at: i64, // unix ms
}

/// 当前时间戳（毫秒）
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub const VALID_TYPES: &[&str] = &["note", "task"];
pub const VALID_STATUS: &[&str] = &["open", "done", "archived"];
pub const VALID_PRIORITY: &[&str] = &["high", "normal", "low"];

pub fn validate_priority(p: &str) -> Result<(), AppError> {
    validate_value(p, VALID_PRIORITY, "优先级")
}

fn validate_value(value: &str, allowed: &[&str], field: &str) -> Result<(), AppError> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(AppError::Validation(format!("无效的{}：{}", field, value)))
    }
}

pub fn validate_type(t: &str) -> Result<(), AppError> {
    validate_value(t, VALID_TYPES, "条目类型")
}

pub fn validate_status(s: &str) -> Result<(), AppError> {
    validate_value(s, VALID_STATUS, "状态")
}

/// 所有 SELECT 统一的列顺序，必须与 item_mapper 的索引一一对应
pub const SELECT_COLS: &str =
    "id, item_type, title, content, status, source, obsidian_ref, due_date, priority, pinned, tags, created_at, updated_at";

/// 将一行 ResultSet 映射为 InboxItem
pub fn item_mapper(row: &rusqlite::Row) -> Result<InboxItem, rusqlite::Error> {
    Ok(InboxItem {
        id: row.get(0)?,
        item_type: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        status: row.get(4)?,
        source: row.get(5)?,
        obsidian_ref: row.get(6)?,
        due_date: row.get(7)?,
        priority: row.get(8)?,
        pinned: row.get(9)?,
        tags: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
    })
}

/// 写入变更事件（best-effort，失败不影响主流程）。
/// payload 统一存整行 JSON，未来 M3 服务器同步可直接 replay。
pub fn log_change(
    conn: &Connection,
    entity: &str,
    entity_id: &str,
    op: &str,
    payload: &str,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO change_log (entity, entity_id, op, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![entity, entity_id, op, payload, now_ms()],
    )?;
    Ok(())
}

const TARGET_VERSION: i64 = 3;

/// 幂等加列：SQLite 不支持 `ADD COLUMN IF NOT EXISTS`，先查 PRAGMA 再决定。
fn add_column_if_missing(
    conn: &Connection,
    col: &str,
    definition: &str,
) -> Result<(), AppError> {
    let exists = conn
        .prepare("PRAGMA table_info(inbox_items)")?
        .query_map([], |r| r.get::<usize, String>(1))?
        .any(|c| c.map(|name| name == col).unwrap_or(false));
    if !exists {
        conn.execute(
            &format!("ALTER TABLE inbox_items ADD COLUMN {} {}", col, definition),
            [],
        )?;
    }
    Ok(())
}

/// 幂等迁移。对已有数据库（M1 早期版本无 schema_version）安全：
/// 建表用 IF NOT EXISTS，再补登记版本号，最后开启 WAL。
/// v2：将早期 `inbox`(速记) / `lightnote`(轻笔记) 两种类型合并为统一的 `note`(笔记)。
pub fn migrate(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);")?;

    let version: i64 = conn
        .query_row("SELECT version FROM schema_version", [], |r| r.get(0))
        .unwrap_or(0);

    if version < TARGET_VERSION {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS inbox_items (
                id TEXT PRIMARY KEY,
                item_type TEXT NOT NULL DEFAULT 'note',
                title TEXT NOT NULL,
                content TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                source TEXT DEFAULT 'desktop',
                obsidian_ref TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS change_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entity TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                op TEXT NOT NULL,
                payload TEXT,
                created_at INTEGER NOT NULL
            );",
        )?;

        // v2 数据迁移：合并旧的速记/轻笔记为笔记（idempotent，已为 note 的行不受影响）
        if version < 2 {
            conn.execute(
                "UPDATE inbox_items SET item_type = 'note' WHERE item_type IN ('inbox', 'lightnote')",
                [],
            )?;
        }

        // v3 数据迁移：新增任务/笔记各自特色字段（幂等，老库自动补齐）
        if version < 3 {
            add_column_if_missing(conn, "due_date", "INTEGER")?; // 可空
            add_column_if_missing(conn, "priority", "TEXT NOT NULL DEFAULT 'normal'")?;
            add_column_if_missing(conn, "pinned", "INTEGER NOT NULL DEFAULT 0")?;
            add_column_if_missing(conn, "tags", "TEXT NOT NULL DEFAULT ''")?;
        }

        if version == 0 {
            conn.execute(
                "INSERT INTO schema_version (version) VALUES (?1)",
                params![TARGET_VERSION],
            )?;
        } else {
            conn.execute(
                "UPDATE schema_version SET version = ?1",
                params![TARGET_VERSION],
            )?;
        }
    }

    // WAL：读写互不阻塞，为 M3 局域网多端并发访问铺路
    conn.execute_batch("PRAGMA journal_mode=WAL;")?;
    Ok(())
}

/// 在指定目录打开（必要时创建）数据库并执行迁移。供启动初始化与「更改保存位置」复用。
pub fn open_db(dir: &Path) -> Result<Connection, AppError> {
    std::fs::create_dir_all(dir).map_err(|e| AppError::Db(e.to_string()))?;
    let db_path = dir.join("inbox.sqlite");
    let conn = Connection::open(&db_path).map_err(|e| AppError::Db(e.to_string()))?;
    migrate(&conn)?;
    Ok(conn)
}

/// 将数据库三件套（主库 + WAL + SHM）从 from 目录整体搬迁到 to 目录。
/// 优先 rename（同文件系统最快），跨设备失败则回退 copy + remove。
pub fn move_db_files(from: &Path, to: &Path) -> Result<(), AppError> {
    std::fs::create_dir_all(to).map_err(|e| AppError::Db(e.to_string()))?;
    for name in ["inbox.sqlite", "inbox.sqlite-wal", "inbox.sqlite-shm"] {
        let src = from.join(name);
        if src.exists() {
            let dst: PathBuf = to.join(name);
            if std::fs::rename(&src, &dst).is_err() {
                std::fs::copy(&src, &dst).map_err(|e| AppError::Db(e.to_string()))?;
                std::fs::remove_file(&src).map_err(|e| AppError::Db(e.to_string()))?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    #[test]
    fn move_db_files_preserves_data() {
        let base = std::env::temp_dir().join(format!("inboxtest_{}", uuid::Uuid::new_v4()));
        let src = base.join("src");
        let dst = base.join("dst");

        // 在 src 建库并写入一条数据（触发 WAL）
        let conn = open_db(&src).unwrap();
        conn.execute(
            "INSERT INTO inbox_items (id,item_type,title,content,status,source,obsidian_ref,created_at,updated_at) VALUES (?1,'inbox','hello','','open','desktop',NULL,1,1)",
            params!["abc"],
        )
        .unwrap();
        drop(conn);

        // 搬迁到 dst
        move_db_files(&src, &dst).unwrap();

        // dst 应能打开且数据完整
        let conn2 = open_db(&dst).unwrap();
        let cnt: i64 = conn2
            .query_row("SELECT count(*) FROM inbox_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cnt, 1);

        // 源目录的主库应已被移走
        assert!(!src.join("inbox.sqlite").exists());

        let _ = std::fs::remove_dir_all(&base);
    }
}
