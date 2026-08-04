CREATE TABLE secret_value (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encrypted_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE source
  ALTER COLUMN credential_ref TYPE UUID USING credential_ref::uuid;

ALTER TABLE source
  ADD CONSTRAINT source_credential_ref_fk
  FOREIGN KEY (credential_ref)
  REFERENCES secret_value(id)
  ON DELETE RESTRICT;
