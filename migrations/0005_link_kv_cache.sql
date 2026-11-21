-- NULL preserves the deployment's REDIRECT_CACHE_TTL. Zero opts out of KV.
-- This is separate from the existing browser/client cache_ttl field.
ALTER TABLE links ADD COLUMN kv_cache_ttl INTEGER DEFAULT NULL
 CHECK(kv_cache_ttl IS NULL OR (typeof(kv_cache_ttl)='integer' AND (kv_cache_ttl=0 OR kv_cache_ttl BETWEEN 60 AND 86400)));
DROP TRIGGER links_rule_revision;
CREATE TRIGGER links_rule_revision AFTER UPDATE OF
 domain_id,slug,target_url,title,description,redirect_code,query_mode,enabled,
 expires_at,cache_ttl,created_by,version,geo_rules,password_hash,max_redirects,
 response_mode,text_content,block_vpn,kv_cache_ttl ON links
BEGIN
 UPDATE links SET rule_revision=OLD.rule_revision+1 WHERE id=NEW.id;
END;
