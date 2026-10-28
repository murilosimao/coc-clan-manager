-- Retroactive fill for wars nobody captured live. `clashspot` is read from the
-- Clash Spot war pages in a browser; `clashking` is ClashKing's stored copy.
ALTER TABLE cwl.war_archive DROP CONSTRAINT war_archive_source_check;
ALTER TABLE cwl.war_archive ADD CONSTRAINT war_archive_source_check
  CHECK (source IN ('clan','opponent','clashspot','clashking'));
