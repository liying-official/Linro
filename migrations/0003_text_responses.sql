-- Additive upgrade from 0001 + 0002. Existing links remain redirects.
ALTER TABLE links ADD COLUMN response_mode TEXT NOT NULL DEFAULT 'redirect'
 CHECK(response_mode IN ('redirect','text'));
ALTER TABLE links ADD COLUMN text_content TEXT NOT NULL DEFAULT ''
 CHECK(typeof(text_content)='text' AND length(text_content)<=16384);
-- Extend (do not duplicate) the revision trigger: old KV/cookies must not be
-- reusable after an output-mode/content change, including direct SQL writes.
DROP TRIGGER links_rule_revision;
CREATE TRIGGER links_rule_revision AFTER UPDATE OF
 domain_id,slug,target_url,title,description,redirect_code,query_mode,enabled,
 expires_at,cache_ttl,created_by,version,geo_rules,password_hash,max_redirects,
 response_mode,text_content ON links
BEGIN
 UPDATE links SET rule_revision=OLD.rule_revision+1 WHERE id=NEW.id;
END;
