PRAGMA foreign_keys = ON;
CREATE TABLE domains (
 id TEXT PRIMARY KEY NOT NULL,
 hostname TEXT NOT NULL UNIQUE COLLATE BINARY,
 name TEXT NOT NULL DEFAULT '',
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
 default_redirect_code INTEGER NOT NULL DEFAULT 301 CHECK(default_redirect_code IN(301,302,307,308)),
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);
CREATE TABLE users (
 id TEXT PRIMARY KEY NOT NULL,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL DEFAULT '',
 role TEXT NOT NULL CHECK(role IN('owner','admin','editor','viewer')),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
 access_sub TEXT UNIQUE,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0)
);
CREATE TABLE links (
 id TEXT PRIMARY KEY NOT NULL,
 domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE RESTRICT,
 slug TEXT NOT NULL COLLATE BINARY CHECK(length(slug) BETWEEN 1 AND 64),
 target_url TEXT NOT NULL CHECK(length(target_url) BETWEEN 1 AND 4096),
 title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
 redirect_code INTEGER NOT NULL DEFAULT 301 CHECK(redirect_code IN(301,302,307,308)),
 query_mode TEXT NOT NULL DEFAULT 'discard' CHECK(query_mode IN('discard','replace','merge')),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
 expires_at INTEGER,
 cache_ttl INTEGER NOT NULL DEFAULT 0 CHECK(cache_ttl BETWEEN 0 AND 3600),
 created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 UNIQUE(domain_id,slug)
);
CREATE INDEX idx_links_created ON links(created_at DESC,id DESC);
CREATE INDEX idx_links_domain_created ON links(domain_id,created_at DESC,id DESC);
CREATE INDEX idx_links_expires ON links(expires_at) WHERE expires_at IS NOT NULL;
CREATE TABLE api_tokens (
 id TEXT PRIMARY KEY NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
 prefix TEXT NOT NULL, scopes TEXT NOT NULL,
 expires_at INTEGER NOT NULL, revoked_at INTEGER,
 created_at INTEGER NOT NULL
);
CREATE INDEX idx_tokens_user ON api_tokens(user_id,created_at DESC);
CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO settings VALUES('site_name','cf-links',0);
CREATE TABLE audit_logs (
 id TEXT PRIMARY KEY NOT NULL, user_id TEXT,
 actor_email TEXT NOT NULL,
 action TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
 details TEXT NOT NULL DEFAULT '{}', request_id TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_logs(created_at DESC,id DESC);
CREATE TABLE daily_stats (
 link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
 date TEXT NOT NULL,
 clicks REAL NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(link_id,date)
);
CREATE INDEX idx_daily_stats_date ON daily_stats(date);
-- The guard runs inside SQLite, so concurrent administrator requests cannot remove
-- the last enabled owner by racing a SELECT/count check in application code.
CREATE TRIGGER keep_last_owner_update BEFORE UPDATE OF role,enabled ON users
WHEN OLD.role='owner' AND OLD.enabled=1 AND (NEW.role<>'owner' OR NEW.enabled<>1)
 AND (SELECT COUNT(*) FROM users WHERE role='owner' AND enabled=1)<=1
BEGIN SELECT RAISE(ABORT,'last_enabled_owner'); END;
CREATE TRIGGER keep_last_owner_delete BEFORE DELETE ON users
WHEN OLD.role='owner' AND OLD.enabled=1
 AND (SELECT COUNT(*) FROM users WHERE role='owner' AND enabled=1)<=1
BEGIN SELECT RAISE(ABORT,'last_enabled_owner'); END;
