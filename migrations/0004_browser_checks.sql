-- Additive upgrade: existing links do not block suspected VPN visitors.
ALTER TABLE links ADD COLUMN block_vpn INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(block_vpn)='integer' AND block_vpn IN (0,1));
-- A direct SQL policy change must invalidate browser/password cookies and KV.
DROP TRIGGER links_rule_revision;
CREATE TRIGGER links_rule_revision AFTER UPDATE OF
 domain_id,slug,target_url,title,description,redirect_code,query_mode,enabled,
 expires_at,cache_ttl,created_by,version,geo_rules,password_hash,max_redirects,
 response_mode,text_content,block_vpn ON links
BEGIN
 UPDATE links SET rule_revision=OLD.rule_revision+1 WHERE id=NEW.id;
END;
