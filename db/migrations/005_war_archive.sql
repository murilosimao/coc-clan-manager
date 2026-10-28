-- Own capture of the official current war for managed clans. The API only
-- exposes members and attacks while a war is current; ClashKing stopped
-- archiving after 20/10/2026, so a missed war cannot be recovered later.
-- Regular and friendly wars only; CWL rounds keep their own tables.
CREATE TABLE cwl.war_archive (
  clan_tag text NOT NULL CHECK (clan_tag ~ '^[0289PYLQGRJCUV]{3,15}$'),
  preparation_start timestamptz NOT NULL,
  opponent_tag text NOT NULL CHECK (opponent_tag ~ '^[0289PYLQGRJCUV]{3,15}$' AND opponent_tag <> clan_tag),
  war_type text NOT NULL CHECK (war_type IN ('random','friendly')),
  state text NOT NULL CHECK (state IN ('preparation','inWar','warEnded')),
  final boolean NOT NULL DEFAULT false CHECK (NOT final OR state = 'warEnded'),
  start_time timestamptz NOT NULL CHECK (start_time > preparation_start),
  end_time timestamptz NOT NULL CHECK (end_time > start_time),
  team_size smallint NOT NULL CHECK (team_size BETWEEN 1 AND 50),
  attacks_per_member smallint NOT NULL CHECK (attacks_per_member BETWEEN 1 AND 2),
  attacks_used smallint NOT NULL CHECK (attacks_used BETWEEN 0 AND 200),
  source text NOT NULL CHECK (source IN ('clan','opponent')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object' AND octet_length(payload::text) <= 262144),
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  observed_at timestamptz NOT NULL,
  PRIMARY KEY (clan_tag, preparation_start)
);
CREATE INDEX war_archive_recent ON cwl.war_archive (clan_tag, end_time DESC);

-- Snapshots only move forward until the final capture; final rows and the
-- identity of a war are immutable, and nothing is deleted by the runtime.
CREATE OR REPLACE FUNCTION cwl.protect_war_capture() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.final THEN
    RAISE EXCEPTION 'Final war capture is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.clan_tag IS DISTINCT FROM OLD.clan_tag OR NEW.preparation_start IS DISTINCT FROM OLD.preparation_start
    OR NEW.opponent_tag IS DISTINCT FROM OLD.opponent_tag OR NEW.war_type IS DISTINCT FROM OLD.war_type
    OR NEW.team_size IS DISTINCT FROM OLD.team_size OR NEW.first_observed_at IS DISTINCT FROM OLD.first_observed_at
    OR NEW.attacks_used < OLD.attacks_used OR NEW.observed_at < OLD.observed_at THEN
    RAISE EXCEPTION 'War capture can only move forward' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER protect_war_capture BEFORE UPDATE OR DELETE ON cwl.war_archive
  FOR EACH ROW EXECUTE FUNCTION cwl.protect_war_capture();
ALTER TABLE cwl.war_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cwl.war_archive FROM PUBLIC;
