-- API destinations are persisted as WHATWG HTTP(S) hrefs: ASCII hostname,
-- normalized port, no credentials. Keep the legacy URLs and rule revisions.
CREATE TABLE link_destination_hosts (
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE ON UPDATE CASCADE,
  position INTEGER NOT NULL,
  hostname TEXT NOT NULL,
  PRIMARY KEY(link_id,position)
) WITHOUT ROWID;
CREATE INDEX idx_link_destination_hostname ON link_destination_hosts(hostname);

-- Position -1 is the default target. The other positions are geo array indexes.
-- This expression mirrors canonicalHost on serialized URL.hostname, including
-- exactly one trailing dot. A bracketed IPv6 literal keeps its brackets.
CREATE VIEW parsed_link_destinations AS
WITH urls(link_id,position,url) AS (
  SELECT id,-1,target_url FROM links WHERE response_mode='redirect'
  UNION ALL
  SELECT l.id,r.key,json_extract(r.value,'$.target_url')
  FROM links AS l,json_each(l.geo_rules) AS r
  WHERE l.response_mode='redirect' AND r.type='object'
), tails AS (
  SELECT link_id,position,replace(replace(substr(url,instr(url,'://')+3),'?','/'),'#','/') AS tail
  FROM urls WHERE lower(substr(url,1,instr(url,'://')-1)) IN ('http','https')
), authorities AS (
  SELECT link_id,position,substr(tail,1,instr(tail||'/','/')-1) AS authority FROM tails
), hosts AS (
  SELECT link_id,position,lower(CASE WHEN substr(authority,1,1)='['
    THEN substr(authority,1,instr(authority,']'))
    ELSE substr(authority,1,instr(authority||':',':')-1) END) AS host FROM authorities
)
SELECT link_id,position,
  CASE WHEN substr(host,-1)='.' THEN substr(host,1,length(host)-1) ELSE host END AS hostname
FROM hosts;

INSERT INTO link_destination_hosts(link_id,position,hostname)
SELECT link_id,position,hostname FROM parsed_link_destinations;

CREATE TRIGGER index_link_destinations_insert AFTER INSERT ON links
WHEN NEW.response_mode='redirect'
BEGIN
  INSERT INTO link_destination_hosts(link_id,position,hostname)
  SELECT link_id,position,hostname FROM parsed_link_destinations WHERE link_id=NEW.id;
END;
CREATE TRIGGER index_link_destinations_update AFTER UPDATE OF target_url,geo_rules,response_mode ON links
WHEN OLD.target_url<>NEW.target_url OR OLD.geo_rules<>NEW.geo_rules OR OLD.response_mode<>NEW.response_mode
BEGIN
  DELETE FROM link_destination_hosts WHERE link_id=NEW.id;
  INSERT INTO link_destination_hosts(link_id,position,hostname)
  SELECT link_id,position,hostname FROM parsed_link_destinations WHERE link_id=NEW.id;
END;

-- A guard within the same D1 batch as create, update, or import. An abort
-- rolls back every write and audit in that batch. The view stores no rows.
CREATE VIEW check_link_destinations(hostname) AS SELECT hostname FROM domains WHERE 0;
CREATE TRIGGER reject_managed_link_destination INSTEAD OF INSERT ON check_link_destinations
WHEN EXISTS(SELECT 1 FROM domains WHERE hostname=NEW.hostname)
BEGIN
  SELECT RAISE(ABORT,'managed_link_destination');
END;

-- The composite index also serves queries that only constrain the date.
CREATE INDEX idx_daily_stats_date_link ON daily_stats(date DESC,link_id ASC);
DROP INDEX idx_daily_stats_date;
