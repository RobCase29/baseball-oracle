-- A shared trigger function receives two different NEW row types. Accessing a
-- field that exists on only one row type can fail before CASE selects a branch,
-- so resolve the identifier through a JSON representation of the trigger row.
CREATE OR REPLACE FUNCTION raw.validate_archive_manifest_members()
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
    WHEN TG_TABLE_NAME = 'archive_manifest'
      THEN (to_jsonb(NEW) ->> 'id')::uuid
    ELSE (to_jsonb(NEW) ->> 'manifest_id')::uuid
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
