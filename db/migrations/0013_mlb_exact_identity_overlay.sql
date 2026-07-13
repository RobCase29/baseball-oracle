CREATE TABLE core.mlb_exact_identity_overlay (
  bbref_id text PRIMARY KEY,
  chadwick_key text NOT NULL UNIQUE,
  mlbam_id bigint NOT NULL UNIQUE,
  first_mlb_season smallint NOT NULL,
  evidence_method text NOT NULL,
  source_url text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  response_sha256 text NOT NULL,
  identity_policy text NOT NULL,
  raw_record_id uuid NOT NULL UNIQUE REFERENCES raw.record(id),
  observation_count integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mlb_exact_identity_overlay_bbref_chk
    CHECK (bbref_id ~ '^[a-z0-9_''\.]+$'),
  CONSTRAINT mlb_exact_identity_overlay_chadwick_chk
    CHECK (chadwick_key ~ '^[0-9a-f]{8}$'),
  CONSTRAINT mlb_exact_identity_overlay_mlbam_chk
    CHECK (mlbam_id > 0),
  CONSTRAINT mlb_exact_identity_overlay_season_chk
    CHECK (first_mlb_season BETWEEN 1871 AND 2200),
  CONSTRAINT mlb_exact_identity_overlay_method_chk
    CHECK (evidence_method IN (
      'bref_page_meta_pinned_chadwick',
      'committed_crosswalk_current_value'
    )),
  CONSTRAINT mlb_exact_identity_overlay_hash_chk
    CHECK (response_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT mlb_exact_identity_overlay_policy_chk
    CHECK (identity_policy = 'exact_cross_provider_ids_no_name_matching'),
  CONSTRAINT mlb_exact_identity_overlay_observations_chk
    CHECK (observation_count > 0)
);

CREATE INDEX mlb_exact_identity_overlay_season_idx
  ON core.mlb_exact_identity_overlay (first_mlb_season, mlbam_id);

CREATE OR REPLACE FUNCTION core.observe_mlb_exact_identity_overlay(
  p_bbref_id text,
  p_chadwick_key text,
  p_mlbam_id bigint,
  p_first_mlb_season integer,
  p_evidence_method text,
  p_source_url text,
  p_retrieved_at timestamptz,
  p_response_sha256 text,
  p_identity_policy text,
  p_raw_record_id uuid
)
RETURNS core.mlb_exact_identity_overlay
LANGUAGE plpgsql
AS $$
DECLARE
  evidence_record record;
  observed core.mlb_exact_identity_overlay%ROWTYPE;
  expected_current_url text;
BEGIN
  SELECT
    source.slug AS source_slug,
    dataset.dataset_key,
    ingestion.parameters,
    source_fetch.fetched_at,
    raw_record.record_type,
    raw_record.record_json,
    raw_blob.sha256 AS blob_sha256
  INTO evidence_record
  FROM raw.record AS raw_record
  JOIN raw.fetch AS source_fetch ON source_fetch.id = raw_record.fetch_id
  JOIN raw.blob AS raw_blob ON raw_blob.id = source_fetch.blob_id
  JOIN raw.ingestion_run AS ingestion ON ingestion.id = source_fetch.run_id
  JOIN catalog.dataset AS dataset ON dataset.id = ingestion.dataset_id
  JOIN catalog.source AS source ON source.id = dataset.source_id
  WHERE raw_record.id = p_raw_record_id;

  IF NOT FOUND
    OR evidence_record.source_slug <> 'sports-reference'
    OR evidence_record.blob_sha256 <> p_response_sha256
    OR evidence_record.fetched_at IS DISTINCT FROM p_retrieved_at
    OR evidence_record.record_json ->> 'bbref_id' IS DISTINCT FROM p_bbref_id
    OR app.jsonb_number(evidence_record.record_json, 'mlbam_id')::bigint
      IS DISTINCT FROM p_mlbam_id
  THEN
    RAISE EXCEPTION 'MLB exact identity evidence does not match its raw record';
  END IF;

  IF p_evidence_method = 'bref_page_meta_pinned_chadwick' THEN
    IF evidence_record.dataset_key <> 'baseball-exact-identity-pages'
      OR evidence_record.record_type <> 'baseball_reference_exact_identity'
      OR evidence_record.record_json ->> 'chadwick_key'
        IS DISTINCT FROM p_chadwick_key
      OR evidence_record.record_json ->> 'first_mlb_season'
        IS DISTINCT FROM p_first_mlb_season::text
      OR evidence_record.record_json ->> 'source_url'
        IS DISTINCT FROM p_source_url
      OR evidence_record.record_json ->> 'evidence_method'
        IS DISTINCT FROM p_evidence_method
      OR evidence_record.record_json ->> 'identity_policy'
        IS DISTINCT FROM p_identity_policy
      OR (evidence_record.record_json ->> 'retrieved_at')::timestamptz
        IS DISTINCT FROM p_retrieved_at
      OR evidence_record.record_json ->> 'response_sha256'
        IS DISTINCT FROM p_response_sha256
    THEN
      RAISE EXCEPTION 'Baseball-Reference page metadata evidence is inconsistent';
    END IF;
  ELSIF p_evidence_method = 'committed_crosswalk_current_value' THEN
    expected_current_url := format(
      'https://www.baseball-reference.com/leagues/majors/%s-value-%s.shtml',
      evidence_record.record_json ->> 'season',
      evidence_record.record_json ->> 'side'
    );
    IF evidence_record.dataset_key <> 'baseball-player-records'
      OR evidence_record.record_type NOT IN (
        'current_value_batting',
        'current_value_pitching'
      )
      OR evidence_record.record_json ->> 'season'
        IS DISTINCT FROM p_first_mlb_season::text
      OR evidence_record.record_json #>> '{mlbam_identity_evidence,chadwickKey}'
        IS DISTINCT FROM p_chadwick_key
      OR evidence_record.record_json ->> 'mlbam_identity_overlay_method'
        IS DISTINCT FROM p_evidence_method
      OR evidence_record.record_json ->> 'mlbam_identity_overlay_policy'
        IS DISTINCT FROM p_identity_policy
      OR (evidence_record.record_json ->> 'mlbam_identity_retrieved_at')::timestamptz
        IS DISTINCT FROM p_retrieved_at
      OR p_source_url <> expected_current_url
    THEN
      RAISE EXCEPTION 'Committed crosswalk/current-value evidence is inconsistent';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unsupported MLB exact identity evidence method: %', p_evidence_method;
  END IF;

  INSERT INTO core.mlb_exact_identity_overlay AS target (
    bbref_id,
    chadwick_key,
    mlbam_id,
    first_mlb_season,
    evidence_method,
    source_url,
    retrieved_at,
    response_sha256,
    identity_policy,
    raw_record_id
  ) VALUES (
    p_bbref_id,
    p_chadwick_key,
    p_mlbam_id,
    p_first_mlb_season,
    p_evidence_method,
    p_source_url,
    p_retrieved_at,
    p_response_sha256,
    p_identity_policy,
    p_raw_record_id
  )
  ON CONFLICT (bbref_id) DO UPDATE SET
    first_mlb_season = least(target.first_mlb_season, EXCLUDED.first_mlb_season),
    evidence_method = CASE
      WHEN EXCLUDED.first_mlb_season < target.first_mlb_season
        OR (
          EXCLUDED.first_mlb_season = target.first_mlb_season
          AND EXCLUDED.retrieved_at >= target.retrieved_at
        )
        THEN EXCLUDED.evidence_method
      ELSE target.evidence_method
    END,
    source_url = CASE
      WHEN EXCLUDED.first_mlb_season < target.first_mlb_season
        OR (
          EXCLUDED.first_mlb_season = target.first_mlb_season
          AND EXCLUDED.retrieved_at >= target.retrieved_at
        )
        THEN EXCLUDED.source_url
      ELSE target.source_url
    END,
    retrieved_at = CASE
      WHEN EXCLUDED.first_mlb_season < target.first_mlb_season
        OR (
          EXCLUDED.first_mlb_season = target.first_mlb_season
          AND EXCLUDED.retrieved_at >= target.retrieved_at
        )
        THEN EXCLUDED.retrieved_at
      ELSE target.retrieved_at
    END,
    response_sha256 = CASE
      WHEN EXCLUDED.first_mlb_season < target.first_mlb_season
        OR (
          EXCLUDED.first_mlb_season = target.first_mlb_season
          AND EXCLUDED.retrieved_at >= target.retrieved_at
        )
        THEN EXCLUDED.response_sha256
      ELSE target.response_sha256
    END,
    raw_record_id = CASE
      WHEN EXCLUDED.first_mlb_season < target.first_mlb_season
        OR (
          EXCLUDED.first_mlb_season = target.first_mlb_season
          AND EXCLUDED.retrieved_at >= target.retrieved_at
        )
        THEN EXCLUDED.raw_record_id
      ELSE target.raw_record_id
    END,
    observation_count = target.observation_count + 1,
    updated_at = now()
  WHERE target.chadwick_key = EXCLUDED.chadwick_key
    AND target.mlbam_id = EXCLUDED.mlbam_id
    AND target.identity_policy = EXCLUDED.identity_policy
  RETURNING * INTO observed;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conflicting exact identity observation for BRef %', p_bbref_id;
  END IF;
  RETURN observed;
END;
$$;

COMMENT ON TABLE core.mlb_exact_identity_overlay IS
  'Durable no-name-match BRef/Chadwick/MLBAM overlay. Re-observation may update evidence only when all three provider identifiers remain identical; conflicts fail closed.';

COMMENT ON FUNCTION core.observe_mlb_exact_identity_overlay IS
  'Validates raw evidence and records only exact, identity-stable MLB cross-provider observations.';
