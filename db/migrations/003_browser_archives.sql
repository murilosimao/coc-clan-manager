CREATE TABLE cwl.plan_archives (
  plan_id uuid PRIMARY KEY REFERENCES cwl.plans(id),
  format text NOT NULL CHECK (format='cwl-gzip-v1'),
  payload bytea NOT NULL CHECK(octet_length(payload)>0 AND octet_length(payload)<=4194304),
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  submitted_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER immutable_plan_archive BEFORE UPDATE OR DELETE ON cwl.plan_archives
  FOR EACH ROW EXECUTE FUNCTION cwl.reject_history_change();
