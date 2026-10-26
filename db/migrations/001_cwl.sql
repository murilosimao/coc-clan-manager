CREATE SCHEMA IF NOT EXISTS cwl;
CREATE TABLE IF NOT EXISTS cwl.migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS cwl.rounds (
  id uuid PRIMARY KEY,
  clan_tag text NOT NULL,
  start_time text NOT NULL,
  season text NOT NULL CHECK (season ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  opponent_tag text NOT NULL,
  war_state text NOT NULL,
  end_at timestamptz NOT NULL,
  last_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clan_tag, start_time)
);
CREATE INDEX IF NOT EXISTS rounds_season ON cwl.rounds(clan_tag, season, start_time);
CREATE TABLE IF NOT EXISTS cwl.plans (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL UNIQUE REFERENCES cwl.rounds(id),
  current_revision integer NOT NULL CHECK (current_revision >= 1),
  retrospective boolean NOT NULL,
  initial_plan jsonb NOT NULL,
  score_snapshot jsonb NOT NULL,
  source_snapshot jsonb NOT NULL,
  config jsonb NOT NULL,
  planner_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cwl.revisions (
  plan_id uuid NOT NULL REFERENCES cwl.plans(id),
  revision integer NOT NULL CHECK (revision >= 1),
  state text NOT NULL CHECK (state IN ('draft','approved')),
  kind text NOT NULL CHECK (kind IN ('initial','leader_edit','approval')),
  assignments jsonb NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(plan_id, revision)
);
CREATE TABLE IF NOT EXISTS cwl.observations (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES cwl.rounds(id),
  content_hash text NOT NULL,
  snapshot jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(round_id, content_hash)
);
CREATE TABLE IF NOT EXISTS cwl.attacks (
  round_id uuid NOT NULL REFERENCES cwl.rounds(id),
  attack_order integer NOT NULL CHECK (attack_order > 0),
  attacker_tag text NOT NULL,
  defender_tag text NOT NULL,
  stars integer NOT NULL CHECK (stars BETWEEN 0 AND 3),
  destruction double precision NOT NULL CHECK (destruction BETWEEN 0 AND 100),
  duration_seconds integer CHECK (duration_seconds BETWEEN 0 AND 360),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  occurred_at timestamptz,
  attribution text NOT NULL CHECK (attribution IN ('known','ambiguous','unapproved','before_plan')),
  mission_revision integer,
  mission jsonb,
  PRIMARY KEY(round_id, attack_order),
  UNIQUE(round_id, attacker_tag)
);
CREATE TABLE IF NOT EXISTS cwl.reviews (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES cwl.rounds(id),
  attack_order integer NOT NULL,
  mission_revision integer NOT NULL,
  actor text NOT NULL,
  reason text NOT NULL CHECK (length(reason) >= 3),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(round_id, attack_order) REFERENCES cwl.attacks(round_id, attack_order)
);
CREATE OR REPLACE FUNCTION cwl.reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CWL history is append-only' USING ERRCODE = '55000'; END; $$;
CREATE OR REPLACE FUNCTION cwl.protect_plan_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.initial_plan IS DISTINCT FROM OLD.initial_plan OR NEW.score_snapshot IS DISTINCT FROM OLD.score_snapshot
    OR NEW.source_snapshot IS DISTINCT FROM OLD.source_snapshot OR NEW.config IS DISTINCT FROM OLD.config
    OR NEW.planner_version IS DISTINCT FROM OLD.planner_version OR NEW.retrospective IS DISTINCT FROM OLD.retrospective
    OR NEW.round_id IS DISTINCT FROM OLD.round_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Initial CWL plan is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS immutable_initial_plan ON cwl.plans;
CREATE TRIGGER immutable_initial_plan BEFORE UPDATE ON cwl.plans FOR EACH ROW EXECUTE FUNCTION cwl.protect_plan_snapshot();
DROP TRIGGER IF EXISTS immutable_revisions ON cwl.revisions;
CREATE TRIGGER immutable_revisions BEFORE UPDATE OR DELETE ON cwl.revisions FOR EACH ROW EXECUTE FUNCTION cwl.reject_history_change();
DROP TRIGGER IF EXISTS immutable_observations ON cwl.observations;
CREATE TRIGGER immutable_observations BEFORE UPDATE OR DELETE ON cwl.observations FOR EACH ROW EXECUTE FUNCTION cwl.reject_history_change();
DROP TRIGGER IF EXISTS immutable_reviews ON cwl.reviews;
CREATE TRIGGER immutable_reviews BEFORE UPDATE OR DELETE ON cwl.reviews FOR EACH ROW EXECUTE FUNCTION cwl.reject_history_change();
