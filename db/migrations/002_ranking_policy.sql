CREATE TABLE cwl.ranking_policies (
  clan_tag text NOT NULL,
  season text NOT NULL CHECK (season ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  policy jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clan_tag, season)
);
CREATE TRIGGER immutable_ranking_policy BEFORE UPDATE OR DELETE ON cwl.ranking_policies
  FOR EACH ROW EXECUTE FUNCTION cwl.reject_history_change();
