//! SQLite persistence for threads, messages, and the project list.
//!
//! One connection behind a mutex. The app is single-user and single-window and
//! its writes are small and infrequent — a pool would be complexity with no
//! payoff, and a mutex makes the ordering guarantees obvious.
//!
//! Schema changes go through [`migrate`], which is idempotent and additive.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thread {
    pub id: String,
    pub title: String,
    pub project_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Populated by [`Store::list_threads`] for the sidebar.
    #[serde(default)]
    pub message_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredMessage {
    pub id: String,
    pub thread_id: String,
    /// `user` | `assistant`
    pub role: String,
    pub content: String,
    pub created_at: String,
    /// Free-form JSON: tool activity, fleet reports, usage. Rendered by the UI.
    #[serde(default)]
    pub meta: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub path: String,
    pub name: String,
    pub last_opened_at: String,
    /// False once the folder has been moved or deleted — the picker greys it out
    /// rather than silently dropping a project the user might want to relocate.
    #[serde(default)]
    pub exists: bool,
}

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    pub fn open_default() -> Result<Self> {
        let dir = crate::config::data_dir();
        std::fs::create_dir_all(&dir).context("could not create the application data directory")?;
        Self::open(dir.join("tripplet-computer.sqlite3"))
    }

    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path.as_ref()).context("could not open the database")?;
        // WAL survives an unclean shutdown far better than the rollback journal,
        // which matters when the app is killed mid-turn.
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let store = Self { conn: Mutex::new(conn) };
        store.migrate()?;
        Ok(store)
    }

    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        conn.pragma_update(None, "foreign_keys", "ON")?;
        let store = Self { conn: Mutex::new(conn) };
        store.migrate()?;
        Ok(store)
    }

    fn migrate(&self) -> Result<()> {
        self.conn.lock().execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS threads (
                id           TEXT PRIMARY KEY,
                title        TEXT NOT NULL DEFAULT 'New thread',
                project_path TEXT,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id         TEXT PRIMARY KEY,
                thread_id  TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
                role       TEXT NOT NULL,
                content    TEXT NOT NULL,
                meta       TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS projects (
                path           TEXT PRIMARY KEY,
                name           TEXT NOT NULL,
                last_opened_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_threads_updated ON threads(updated_at DESC);
            "#,
        )?;
        Ok(())
    }

    // ── Threads ──

    pub fn create_thread(&self, project_path: Option<&str>) -> Result<Thread> {
        let now = now();
        let thread = Thread {
            id: uuid::Uuid::new_v4().to_string(),
            title: "New thread".into(),
            project_path: project_path.map(str::to_string),
            created_at: now.clone(),
            updated_at: now,
            message_count: 0,
        };
        self.conn.lock().execute(
            "INSERT INTO threads (id, title, project_path, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                thread.id,
                thread.title,
                thread.project_path,
                thread.created_at,
                thread.updated_at
            ],
        )?;
        Ok(thread)
    }

    pub fn list_threads(&self, limit: i64) -> Result<Vec<Thread>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT t.id, t.title, t.project_path, t.created_at, t.updated_at,
                    (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id)
             FROM threads t
             ORDER BY t.updated_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(Thread {
                id: row.get(0)?,
                title: row.get(1)?,
                project_path: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                message_count: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn get_thread(&self, id: &str) -> Result<Option<Thread>> {
        let conn = self.conn.lock();
        let thread = conn
            .query_row(
                "SELECT id, title, project_path, created_at, updated_at FROM threads WHERE id = ?1",
                params![id],
                |row| {
                    Ok(Thread {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        project_path: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                        message_count: 0,
                    })
                },
            )
            .optional()?;
        Ok(thread)
    }

    pub fn rename_thread(&self, id: &str, title: &str) -> Result<()> {
        self.conn.lock().execute(
            "UPDATE threads SET title = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, title, now()],
        )?;
        Ok(())
    }

    pub fn touch_thread(&self, id: &str) -> Result<()> {
        self.conn.lock().execute(
            "UPDATE threads SET updated_at = ?2 WHERE id = ?1",
            params![id, now()],
        )?;
        Ok(())
    }

    /// Cascades to the thread's messages via the foreign key.
    pub fn delete_thread(&self, id: &str) -> Result<()> {
        self.conn.lock().execute("DELETE FROM threads WHERE id = ?1", params![id])?;
        Ok(())
    }

    // ── Messages ──

    pub fn add_message(
        &self,
        thread_id: &str,
        role: &str,
        content: &str,
        meta: &serde_json::Value,
    ) -> Result<StoredMessage> {
        let message = StoredMessage {
            id: uuid::Uuid::new_v4().to_string(),
            thread_id: thread_id.to_string(),
            role: role.to_string(),
            content: content.to_string(),
            created_at: now(),
            meta: meta.clone(),
        };
        self.write_message(&message)?;
        Ok(message)
    }

    /// Insert (or replace) a message with a caller-chosen id. The agent picks
    /// the assistant message id up front so its streaming events can reference
    /// it before the row exists.
    pub fn upsert_message(&self, message: &StoredMessage) -> Result<()> {
        self.write_message(message)
    }

    fn write_message(&self, message: &StoredMessage) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute(
            "INSERT INTO messages (id, thread_id, role, content, meta, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET content = excluded.content, meta = excluded.meta",
            params![
                message.id,
                message.thread_id,
                message.role,
                message.content,
                message.meta.to_string(),
                message.created_at
            ],
        )?;
        conn.execute(
            "UPDATE threads SET updated_at = ?2 WHERE id = ?1",
            params![message.thread_id, now()],
        )?;
        Ok(())
    }

    pub fn list_messages(&self, thread_id: &str) -> Result<Vec<StoredMessage>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, thread_id, role, content, meta, created_at
             FROM messages WHERE thread_id = ?1 ORDER BY created_at ASC, rowid ASC",
        )?;
        let rows = stmt.query_map(params![thread_id], |row| {
            let meta: String = row.get(4)?;
            Ok(StoredMessage {
                id: row.get(0)?,
                thread_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                // A corrupt meta blob must not make a thread unopenable.
                meta: serde_json::from_str(&meta).unwrap_or(serde_json::Value::Null),
                created_at: row.get(5)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    // ── Projects ──

    pub fn remember_project(&self, path: &Path) -> Result<Project> {
        let path_str = path.to_string_lossy().to_string();
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone());
        let project = Project {
            path: path_str,
            name,
            last_opened_at: now(),
            exists: path.is_dir(),
        };
        self.conn.lock().execute(
            "INSERT INTO projects (path, name, last_opened_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET name = excluded.name, last_opened_at = excluded.last_opened_at",
            params![project.path, project.name, project.last_opened_at],
        )?;
        Ok(project)
    }

    pub fn list_projects(&self, limit: i64) -> Result<Vec<Project>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT path, name, last_opened_at FROM projects ORDER BY last_opened_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            let path: String = row.get(0)?;
            Ok(Project {
                exists: Path::new(&path).is_dir(),
                path,
                name: row.get(1)?,
                last_opened_at: row.get(2)?,
            })
        })?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    pub fn forget_project(&self, path: &str) -> Result<()> {
        self.conn.lock().execute("DELETE FROM projects WHERE path = ?1", params![path])?;
        Ok(())
    }
}

/// RFC3339 UTC. Stored as text so it sorts lexicographically.
fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

/// Human-friendly project name for a path.
pub fn project_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// Expand `~` and normalise a user-supplied project path.
pub fn normalise_project_path(raw: &str) -> PathBuf {
    let expanded = crate::config::shellexpand_home(raw);
    std::fs::canonicalize(&expanded).unwrap_or(expanded)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        Store::open_in_memory().unwrap()
    }

    #[test]
    fn a_new_thread_starts_empty_and_listable() {
        let s = store();
        let thread = s.create_thread(Some("/proj")).unwrap();
        assert_eq!(thread.title, "New thread");
        let listed = s.list_threads(10).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, thread.id);
        assert_eq!(listed[0].message_count, 0);
        assert_eq!(listed[0].project_path.as_deref(), Some("/proj"));
    }

    #[test]
    fn messages_round_trip_in_order_with_their_meta() {
        let s = store();
        let t = s.create_thread(None).unwrap();
        s.add_message(&t.id, "user", "hello", &serde_json::json!({})).unwrap();
        s.add_message(&t.id, "assistant", "hi", &serde_json::json!({ "tools": ["read_file"] }))
            .unwrap();

        let messages = s.list_messages(&t.id).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "hello");
        assert_eq!(messages[1].meta["tools"][0], "read_file");
        assert_eq!(s.list_threads(10).unwrap()[0].message_count, 2);
    }

    #[test]
    fn upsert_replaces_content_without_duplicating_the_row() {
        let s = store();
        let t = s.create_thread(None).unwrap();
        let mut m = StoredMessage {
            id: "fixed-id".into(),
            thread_id: t.id.clone(),
            role: "assistant".into(),
            content: "partial".into(),
            created_at: now(),
            meta: serde_json::json!({}),
        };
        s.upsert_message(&m).unwrap();
        m.content = "complete".into();
        m.meta = serde_json::json!({ "usage": { "total_tokens": 10 } });
        s.upsert_message(&m).unwrap();

        let messages = s.list_messages(&t.id).unwrap();
        assert_eq!(messages.len(), 1, "streaming updates must not duplicate rows");
        assert_eq!(messages[0].content, "complete");
        assert_eq!(messages[0].meta["usage"]["total_tokens"], 10);
    }

    #[test]
    fn deleting_a_thread_cascades_to_its_messages() {
        let s = store();
        let t = s.create_thread(None).unwrap();
        s.add_message(&t.id, "user", "x", &serde_json::json!({})).unwrap();
        s.delete_thread(&t.id).unwrap();
        assert!(s.get_thread(&t.id).unwrap().is_none());
        assert!(s.list_messages(&t.id).unwrap().is_empty());
    }

    #[test]
    fn threads_list_most_recently_updated_first() {
        let s = store();
        let a = s.create_thread(None).unwrap();
        let b = s.create_thread(None).unwrap();
        // Touch `a` so it becomes the most recent.
        std::thread::sleep(std::time::Duration::from_millis(5));
        s.touch_thread(&a.id).unwrap();
        let listed = s.list_threads(10).unwrap();
        assert_eq!(listed[0].id, a.id);
        assert_eq!(listed[1].id, b.id);
    }

    #[test]
    fn renaming_a_thread_sticks() {
        let s = store();
        let t = s.create_thread(None).unwrap();
        s.rename_thread(&t.id, "Fix the login bug").unwrap();
        assert_eq!(s.get_thread(&t.id).unwrap().unwrap().title, "Fix the login bug");
    }

    #[test]
    fn a_corrupt_meta_blob_does_not_make_a_thread_unopenable() {
        let s = store();
        let t = s.create_thread(None).unwrap();
        s.add_message(&t.id, "user", "x", &serde_json::json!({})).unwrap();
        // Corrupt the row behind the store's back.
        s.conn
            .lock()
            .execute("UPDATE messages SET meta = 'not json'", [])
            .unwrap();
        let messages = s.list_messages(&t.id).unwrap();
        assert_eq!(messages.len(), 1);
        assert!(messages[0].meta.is_null());
    }

    #[test]
    fn remembering_a_project_twice_updates_rather_than_duplicates() {
        let s = store();
        let dir = tempfile::tempdir().unwrap();
        s.remember_project(dir.path()).unwrap();
        s.remember_project(dir.path()).unwrap();
        let projects = s.list_projects(10).unwrap();
        assert_eq!(projects.len(), 1);
        assert!(projects[0].exists);
        assert_eq!(projects[0].name, dir.path().file_name().unwrap().to_string_lossy());
    }

    #[test]
    fn a_project_whose_folder_vanished_is_flagged_not_dropped() {
        let s = store();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_path_buf();
        s.remember_project(&path).unwrap();
        drop(dir); // folder is gone

        let projects = s.list_projects(10).unwrap();
        assert_eq!(projects.len(), 1, "the entry must survive so the user can relocate it");
        assert!(!projects[0].exists);
    }

    #[test]
    fn forgetting_a_project_removes_it() {
        let s = store();
        let dir = tempfile::tempdir().unwrap();
        let p = s.remember_project(dir.path()).unwrap();
        s.forget_project(&p.path).unwrap();
        assert!(s.list_projects(10).unwrap().is_empty());
    }

    #[test]
    fn migrate_is_idempotent() {
        let s = store();
        s.migrate().unwrap();
        s.migrate().unwrap();
        assert!(s.list_threads(1).is_ok());
    }

    #[test]
    fn project_names_come_from_the_final_path_component() {
        assert_eq!(project_name(Path::new("/a/b/my-app")), "my-app");
        assert_eq!(project_name(Path::new("/")), "/");
    }
}
