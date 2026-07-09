use serde::Serialize;

/// 应用层错误。命令边界处统一转为面向用户的中文文案（String）。
/// 未来 M3 的 HTTP server 可直接序列化该结构，映射到 400/404/500。
#[derive(Debug, Serialize)]
pub enum AppError {
    /// 入参不合法（标题为空、类型/状态越界等）
    Validation(String),
    /// 资源不存在（如更新/删除一个不存在的条目）
    NotFound(String),
    /// 数据库底层错误
    Db(String),
    /// iCloud 同步相关错误（文件写失败、监听启动失败等）
    Sync(String),
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::Validation(m) => write!(f, "{}", m),
            AppError::NotFound(m) => write!(f, "{}", m),
            AppError::Db(m) => write!(f, "数据库错误：{}", m),
            AppError::Sync(m) => write!(f, "同步错误：{}", m),
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
            AppError::NotFound("未找到该条目".into())
        } else {
            AppError::Db(e.to_string())
        }
    }
}
