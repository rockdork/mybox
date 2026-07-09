use rusqlite::{params, Connection};

use crate::db::{item_mapper, log_change, now_ms, validate_status, validate_type, InboxItem, SELECT_COLS};
use crate::error::AppError;

/// 创建条目。标题会 trim，空标题视为非法；类型/状态做白名单校验。
/// 返回新建的条目，并写入 change_log（payload 为整行 JSON）。
pub fn create_item(
    conn: &Connection,
    title: &str,
    content: &str,
    item_type: &str,
    source: &str,
) -> Result<InboxItem, AppError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::Validation("标题不能为空".into()));
    }
    validate_type(item_type)?;

    let id = uuid::Uuid::new_v4().to_string();
    let now = now_ms();
    conn.execute(
        "INSERT INTO inbox_items (id, item_type, title, content, status, source, obsidian_ref, created_at, updated_at) VALUES (?1,?2,?3,?4,'open',?5,NULL,?6,?7)",
        params![id, item_type, title, content, source, now, now],
    )?;

    let item = get_item(conn, &id)?;
    let payload = serde_json::to_string(&item).unwrap_or_default();
    log_change(conn, "inbox_item", &id, "create", &payload)?;
    Ok(item)
}

/// 按 id 查询单条，不存在返回 NotFound
pub fn get_item(conn: &Connection, id: &str) -> Result<InboxItem, AppError> {
    let mut stmt = conn.prepare(&format!("SELECT {SELECT_COLS} FROM inbox_items WHERE id = ?1"))?;
    stmt.query_row(params![id], item_mapper).map_err(|e| e.into())
}

/// 列出条目，可按 item_type 过滤
pub fn list_items(conn: &Connection, filter: Option<&str>) -> Result<Vec<InboxItem>, AppError> {
    let to_items = |stmt: &mut rusqlite::Statement<'_>| -> Result<Vec<InboxItem>, AppError> {
        let rows = stmt.query_map([], item_mapper)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.into())
    };

    match filter {
        Some(ft) => {
            validate_type(ft)?;
            let mut stmt = conn.prepare(&format!(
                "SELECT {SELECT_COLS} FROM inbox_items WHERE item_type = ?1 ORDER BY created_at DESC"
            ))?;
            let rows = stmt.query_map(params![ft], item_mapper)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.into())
        }
        None => {
            let mut stmt = conn.prepare(&format!(
                "SELECT {SELECT_COLS} FROM inbox_items ORDER BY created_at DESC"
            ))?;
            to_items(&mut stmt)
        }
    }
}

/// 全量更新条目（标题/内容/状态/类型）。先校验存在性，再做白名单校验。
pub fn update_item(
    conn: &Connection,
    id: &str,
    title: &str,
    content: &str,
    status: &str,
    item_type: &str,
) -> Result<InboxItem, AppError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::Validation("标题不能为空".into()));
    }
    let _ = get_item(conn, id)?; // 不存在则提前返回 NotFound
    validate_type(item_type)?;
    validate_status(status)?;

    let now = now_ms();
    conn.execute(
        "UPDATE inbox_items SET title = ?2, content = ?3, status = ?4, item_type = ?5, updated_at = ?6 WHERE id = ?1",
        params![id, title, content, status, item_type, now],
    )?;

    let item = get_item(conn, id)?;
    let payload = serde_json::to_string(&item).unwrap_or_default();
    log_change(conn, "inbox_item", id, "update", &payload)?;
    Ok(item)
}

/// 删除条目，写入变更事件（payload 为删除前的整行 JSON，便于回滚/同步）。
/// 返回被删除的整行，供上层同步 emit 使用。
pub fn delete_item(conn: &Connection, id: &str) -> Result<InboxItem, AppError> {
    let item = get_item(conn, id)?; // 不存在则 NotFound
    conn.execute("DELETE FROM inbox_items WHERE id = ?1", params![id])?;
    let payload = serde_json::to_string(&item).unwrap_or_default();
    log_change(conn, "inbox_item", id, "delete", &payload)?;
    Ok(item)
}

/// 整理：将条目转为 task / note（改 item_type），status 可选覆盖
pub fn process_item(
    conn: &Connection,
    id: &str,
    target_type: &str,
    status: Option<&str>,
) -> Result<InboxItem, AppError> {
    validate_type(target_type)?;
    let current = get_item(conn, id)?; // 不存在则 NotFound
    let new_status = status.unwrap_or(&current.status);
    validate_status(new_status)?;

    let now = now_ms();
    conn.execute(
        "UPDATE inbox_items SET item_type = ?2, status = ?3, updated_at = ?4 WHERE id = ?1",
        params![id, target_type, new_status, now],
    )?;

    let item = get_item(conn, id)?;
    let payload = serde_json::to_string(&item).unwrap_or_default();
    log_change(conn, "inbox_item", id, "process", &payload)?;
    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;
    use crate::error::AppError;
    use rusqlite::params;

    fn test_conn() -> Connection {
        let conn = Connection::open(":memory:").unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn migrate_creates_tables_and_version() {
        let conn = test_conn();
        let cnt: i64 = conn
            .query_row("SELECT count(*) FROM inbox_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cnt, 0);
        let v: i64 = conn
            .query_row("SELECT version FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, 2);
    }

    #[test]
    fn create_trims_title_and_logs() {
        let conn = test_conn();
        let item = create_item(&conn, "  买菜  ", "清单", "note", "desktop").unwrap();
        assert_eq!(item.title, "买菜");
        let list = list_items(&conn, None).unwrap();
        assert_eq!(list.len(), 1);
        let payload: String = conn
            .query_row("SELECT payload FROM change_log WHERE op='create'", [], |r| r.get(0))
            .unwrap();
        assert!(payload.contains("买菜"));
        assert!(serde_json::from_str::<InboxItem>(&payload).is_ok());
    }

    #[test]
    fn rejects_empty_title() {
        let conn = test_conn();
        let r = create_item(&conn, "   ", "x", "note", "desktop");
        assert!(matches!(r, Err(AppError::Validation(_))));
    }

    #[test]
    fn rejects_bad_type() {
        let conn = test_conn();
        let r = create_item(&conn, "ok", "", "bogus", "desktop");
        assert!(matches!(r, Err(AppError::Validation(_))));
    }

    #[test]
    fn update_and_delete_require_existing() {
        let conn = test_conn();
        assert!(matches!(
            update_item(&conn, "nope", "t", "", "open", "note"),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            delete_item(&conn, "nope"),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn delete_writes_change_log() {
        let conn = test_conn();
        let item = create_item(&conn, "t", "", "note", "desktop").unwrap();
        delete_item(&conn, &item.id).unwrap();
        // 同一 entity_id 下应存在一条 op='delete' 的变更记录
        let op: String = conn
            .query_row(
                "SELECT op FROM change_log WHERE entity_id=?1 AND op='delete'",
                params![item.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(op, "delete");
    }

    #[test]
    fn process_updates_type() {
        let conn = test_conn();
        let item = create_item(&conn, "t", "", "note", "desktop").unwrap();
        let p = process_item(&conn, &item.id, "task", None).unwrap();
        assert_eq!(p.item_type, "task");
        assert_eq!(p.status, "open");
    }
}
