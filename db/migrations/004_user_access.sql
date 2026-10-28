-- Auth identities remain in Supabase Auth. This directory contains only app access.
CREATE TABLE cwl.accounts (
  user_id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE cwl.memberships (
  user_id uuid NOT NULL REFERENCES cwl.accounts(user_id),
  clan_tag text NOT NULL CHECK (clan_tag ~ '^[0289PYLQGRJCUV]{3,15}$'),
  role text NOT NULL CHECK (role IN ('leader','coLeader')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,clan_tag)
);
CREATE TABLE cwl.access_events (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL,
  user_id uuid NOT NULL,
  clan_tag text NOT NULL,
  action text NOT NULL CHECK (action IN ('grant','revoke')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cwl.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cwl.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE cwl.access_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cwl.accounts,cwl.memberships,cwl.access_events FROM PUBLIC;
