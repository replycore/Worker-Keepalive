CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  interval INTEGER NOT NULL DEFAULT 5,
  notify_channels TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  last_check INTEGER NOT NULL DEFAULT 0,
  fail_streak INTEGER NOT NULL DEFAULT 0,
  fail_since INTEGER,
  owner TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  token TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  chat_id TEXT NOT NULL DEFAULT '',
  from_email TEXT NOT NULL DEFAULT '',
  to_email TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  secret TEXT NOT NULL DEFAULT '',
  headers TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  time INTEGER NOT NULL,
  task_name TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  trigger TEXT NOT NULL DEFAULT 'auto',
  owner TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  salt TEXT NOT NULL DEFAULT ''
);

-- 键值配置：Cloudflare API（cf_account_id / cf_api_token / cf_account_name）、
-- D1 额度告警（quota_alert_enabled / quota_alert_threshold / quota_alert_channels /
-- quota_alert_state / quota_alert_checked_day）
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);
