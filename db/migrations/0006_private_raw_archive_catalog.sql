-- Private object-store copies are cataloged separately from raw.blob. This lets
-- an archived object coexist with an existing body_text blob of the same digest.
CREATE TABLE raw.archive_object (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 text NOT NULL CONSTRAINT archive_object_sha_chk
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_length bigint NOT NULL CONSTRAINT archive_object_length_chk
    CHECK (byte_length >= 0),
  media_type text NOT NULL CONSTRAINT archive_object_media_type_chk
    CHECK (media_type <> ''),
  content_encoding text,
  storage_provider text NOT NULL CONSTRAINT archive_object_provider_chk
    CHECK (storage_provider = 'vercel_blob'),
  access_scope text NOT NULL CONSTRAINT archive_object_access_chk
    CHECK (access_scope = 'private'),
  pathname text NOT NULL,
  object_uri text NOT NULL CONSTRAINT archive_object_private_uri_chk
    CHECK (
      object_uri ~ '^https://[^/]+[.]private[.]blob[.]vercel-storage[.]com/'
    ),
  etag text,
  archived_at timestamptz NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT archive_object_path_uq UNIQUE (pathname),
  CONSTRAINT archive_object_uri_uq UNIQUE (object_uri),
  CONSTRAINT archive_object_path_chk CHECK (
    pathname ~ '^raw/v1/[a-z0-9][a-z0-9._-]{0,63}/[a-z0-9][a-z0-9._-]{0,63}/sha256/[0-9a-f]{2}/[0-9a-f]{64}$'
    AND split_part(pathname, '/', 6) = left(sha256, 2)
    AND split_part(pathname, '/', 7) = sha256
  )
);

CREATE INDEX archive_object_archived_idx
  ON raw.archive_object(archived_at DESC);
CREATE INDEX archive_object_sha_idx
  ON raw.archive_object(sha256);

CREATE TABLE raw.archive_manifest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_object_id uuid NOT NULL REFERENCES raw.archive_object(id),
  manifest_sha256 text NOT NULL CONSTRAINT archive_manifest_sha_chk
    CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  schema_version text NOT NULL CONSTRAINT archive_manifest_schema_chk
    CHECK (schema_version = 'locked-corpus-archive/v1'),
  status text NOT NULL CONSTRAINT archive_manifest_status_chk
    CHECK (status = 'complete'),
  source_lock_sha256 text NOT NULL CONSTRAINT archive_manifest_source_lock_sha_chk
    CHECK (source_lock_sha256 ~ '^[0-9a-f]{64}$'),
  acquisition_manifest_path text NOT NULL,
  acquisition_manifest_sha256 text NOT NULL
    CONSTRAINT archive_manifest_acquisition_sha_chk
    CHECK (acquisition_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  checkpoint_path text NOT NULL,
  checkpoint_sha256 text NOT NULL CONSTRAINT archive_manifest_checkpoint_sha_chk
    CHECK (checkpoint_sha256 ~ '^[0-9a-f]{64}$'),
  member_count integer NOT NULL CONSTRAINT archive_manifest_member_count_chk
    CHECK (member_count > 0),
  -- Sum of object bytes across logical memberships; shared objects count once
  -- for each resource identity that references them.
  member_bytes bigint NOT NULL CONSTRAINT archive_manifest_member_bytes_chk
    CHECK (member_bytes >= 0),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  registered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT archive_manifest_object_uq UNIQUE (archive_object_id),
  CONSTRAINT archive_manifest_sha_uq UNIQUE (manifest_sha256),
  CONSTRAINT archive_manifest_window_chk CHECK (completed_at >= started_at)
);

CREATE INDEX archive_manifest_completed_idx
  ON raw.archive_manifest(completed_at DESC);
CREATE INDEX archive_manifest_source_lock_idx
  ON raw.archive_manifest(source_lock_sha256, acquisition_manifest_sha256);

CREATE TABLE raw.archive_manifest_member (
  manifest_id uuid NOT NULL REFERENCES raw.archive_manifest(id),
  ordinal integer NOT NULL CONSTRAINT archive_manifest_member_ordinal_chk
    CHECK (ordinal >= 0),
  archive_object_id uuid NOT NULL REFERENCES raw.archive_object(id),
  member_role text NOT NULL CONSTRAINT archive_manifest_member_role_chk
    CHECK (
      member_role IN (
        'raw_payload',
        'source_lock',
        'acquisition_manifest',
        'permission_evidence'
      )
    ),
  source_slug text NOT NULL,
  dataset_key text NOT NULL,
  resource_key text NOT NULL CONSTRAINT archive_manifest_member_resource_key_chk
    CHECK (resource_key <> '' AND octet_length(resource_key) <= 1024),
  source_uri text CONSTRAINT archive_manifest_member_source_uri_chk
    CHECK (source_uri IS NULL OR source_uri ~ '^https://'),
  storage_status text NOT NULL CONSTRAINT archive_manifest_member_storage_status_chk
    CHECK (storage_status IN ('created', 'already-exists')),
  archived_at timestamptz NOT NULL,
  PRIMARY KEY (manifest_id, ordinal),
  CONSTRAINT archive_manifest_member_resource_uq UNIQUE (
    manifest_id,
    source_slug,
    dataset_key,
    resource_key
  ),
  CONSTRAINT archive_manifest_member_source_slug_chk CHECK (
    source_slug ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  ),
  CONSTRAINT archive_manifest_member_dataset_key_chk CHECK (
    dataset_key ~ '^[a-z0-9][a-z0-9._-]{0,63}$'
  )
);

CREATE INDEX archive_manifest_member_object_idx
  ON raw.archive_manifest_member(archive_object_id);
CREATE INDEX archive_manifest_member_logical_idx
  ON raw.archive_manifest_member(source_slug, dataset_key, resource_key);

CREATE FUNCTION raw.reject_archive_catalog_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'content-addressed archive catalog rows are immutable: %.%',
    TG_TABLE_SCHEMA,
    TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER archive_object_immutable_trg
  BEFORE UPDATE OR DELETE ON raw.archive_object
  FOR EACH ROW EXECUTE FUNCTION raw.reject_archive_catalog_mutation();
CREATE TRIGGER archive_manifest_immutable_trg
  BEFORE UPDATE OR DELETE ON raw.archive_manifest
  FOR EACH ROW EXECUTE FUNCTION raw.reject_archive_catalog_mutation();
CREATE TRIGGER archive_manifest_member_immutable_trg
  BEFORE UPDATE OR DELETE ON raw.archive_manifest_member
  FOR EACH ROW EXECUTE FUNCTION raw.reject_archive_catalog_mutation();

CREATE FUNCTION raw.validate_archive_manifest_members()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_manifest_id uuid;
  manifest_row raw.archive_manifest%ROWTYPE;
  manifest_object_sha text;
  actual_count bigint;
  actual_bytes numeric;
  minimum_ordinal integer;
  maximum_ordinal integer;
BEGIN
  target_manifest_id := CASE
    WHEN TG_TABLE_NAME = 'archive_manifest' THEN NEW.id
    ELSE NEW.manifest_id
  END;

  SELECT *
  INTO manifest_row
  FROM raw.archive_manifest
  WHERE id = target_manifest_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT sha256
  INTO manifest_object_sha
  FROM raw.archive_object
  WHERE id = manifest_row.archive_object_id;

  IF manifest_object_sha IS DISTINCT FROM manifest_row.manifest_sha256 THEN
    RAISE EXCEPTION 'archive manifest object digest does not match manifest_sha256';
  END IF;

  SELECT count(*), COALESCE(sum(object_row.byte_length), 0), min(member.ordinal), max(member.ordinal)
  INTO actual_count, actual_bytes, minimum_ordinal, maximum_ordinal
  FROM raw.archive_manifest_member AS member
  JOIN raw.archive_object AS object_row ON object_row.id = member.archive_object_id
  WHERE member.manifest_id = target_manifest_id;

  IF actual_count <> manifest_row.member_count
    OR actual_bytes <> manifest_row.member_bytes
    OR minimum_ordinal <> 0
    OR maximum_ordinal <> manifest_row.member_count - 1 THEN
    RAISE EXCEPTION 'archive manifest member count, bytes, or ordinals do not reconcile';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM raw.archive_manifest_member
    WHERE manifest_id = target_manifest_id
      AND archive_object_id = manifest_row.archive_object_id
  ) THEN
    RAISE EXCEPTION 'archive manifest object cannot also be a manifest member';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM raw.archive_manifest_member AS member
    JOIN raw.archive_object AS object_row ON object_row.id = member.archive_object_id
    WHERE member.manifest_id = target_manifest_id
      AND member.member_role = 'source_lock'
      AND object_row.sha256 = manifest_row.source_lock_sha256
  ) THEN
    RAISE EXCEPTION 'archive manifest has no matching source-lock member';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM raw.archive_manifest_member AS member
    JOIN raw.archive_object AS object_row ON object_row.id = member.archive_object_id
    WHERE member.manifest_id = target_manifest_id
      AND member.member_role = 'acquisition_manifest'
      AND object_row.sha256 = manifest_row.acquisition_manifest_sha256
  ) THEN
    RAISE EXCEPTION 'archive manifest has no matching acquisition-manifest member';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER archive_manifest_validate_trg
  AFTER INSERT ON raw.archive_manifest
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION raw.validate_archive_manifest_members();
CREATE CONSTRAINT TRIGGER archive_manifest_member_validate_trg
  AFTER INSERT ON raw.archive_manifest_member
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION raw.validate_archive_manifest_members();
