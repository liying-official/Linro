-- Additive migration. Existing links stay unprotected, unmetered and use their
-- original destination. Never rerun manually: use Wrangler D1 migrations.
ALTER TABLE links ADD COLUMN geo_rules TEXT NOT NULL DEFAULT '[]'
 CHECK(json_valid(geo_rules) AND json_type(geo_rules)='array' AND length(geo_rules)<=65536);
ALTER TABLE links ADD COLUMN password_hash TEXT DEFAULT NULL
 CHECK(password_hash IS NULL OR (typeof(password_hash)='text' AND length(password_hash)<=256));
ALTER TABLE links ADD COLUMN max_redirects INTEGER DEFAULT NULL
 CHECK(max_redirects IS NULL OR (typeof(max_redirects)='integer' AND max_redirects BETWEEN 1 AND 1000000000));
ALTER TABLE links ADD COLUMN redirect_count INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(redirect_count)='integer' AND redirect_count BETWEEN 0 AND 9007199254740991);
ALTER TABLE links ADD COLUMN rule_revision INTEGER NOT NULL DEFAULT 1
 CHECK(typeof(rule_revision)='integer' AND rule_revision>0);
-- KV is not an authority. This independent revision also invalidates snapshots
-- after direct SQL edits that forget to increment the public optimistic version.
-- Counter increments do NOT change it and therefore do not invalidate the cache.
CREATE TRIGGER links_rule_revision AFTER UPDATE OF
 domain_id,slug,target_url,title,description,redirect_code,query_mode,enabled,
 expires_at,cache_ttl,created_by,version,geo_rules,password_hash,max_redirects ON links
BEGIN
 UPDATE links SET rule_revision=OLD.rule_revision+1 WHERE id=NEW.id;
END;
