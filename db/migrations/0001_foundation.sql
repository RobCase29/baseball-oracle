CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS ml;
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS catalog.source (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  owner_url text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.dataset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES catalog.source(id),
  dataset_key text NOT NULL,
  description text,
  grain text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dataset_source_key_uq UNIQUE (source_id, dataset_key)
);

CREATE TABLE IF NOT EXISTS catalog.permission_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES catalog.dataset(id),
  version integer NOT NULL CHECK (version > 0),
  basis text NOT NULL,
  automated_access boolean NOT NULL DEFAULT false,
  raw_storage boolean NOT NULL DEFAULT false,
  model_training boolean NOT NULL DEFAULT false,
  derived_display boolean NOT NULL DEFAULT false,
  raw_redistribution boolean NOT NULL DEFAULT false,
  commercial_use boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL,
  valid_to timestamptz,
  evidence_uri text,
  evidence_sha256 text,
  approved_at timestamptz NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permission_dataset_version_uq UNIQUE (dataset_id, version),
  CONSTRAINT permission_valid_window_chk CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE INDEX IF NOT EXISTS permission_dataset_valid_idx
  ON catalog.permission_version(dataset_id, valid_from DESC);

CREATE TABLE IF NOT EXISTS raw.ingestion_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES catalog.dataset(id),
  permission_version_id uuid NOT NULL REFERENCES catalog.permission_version(id),
  idempotency_key text NOT NULL,
  mode text NOT NULL DEFAULT 'incremental',
  requested_as_of timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  code_commit text,
  parser_version text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  CONSTRAINT ingestion_dataset_key_uq UNIQUE (dataset_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ingestion_dataset_started_idx
  ON raw.ingestion_run(dataset_id, started_at DESC);
CREATE INDEX IF NOT EXISTS ingestion_status_started_idx
  ON raw.ingestion_run(status, started_at DESC);

CREATE TABLE IF NOT EXISTS raw.blob (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256 text NOT NULL UNIQUE CHECK (char_length(sha256) = 64),
  byte_length integer NOT NULL CHECK (byte_length >= 0),
  media_type text NOT NULL,
  content_encoding text,
  body_text text,
  object_uri text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blob_storage_chk CHECK (
    ((body_text IS NOT NULL)::integer + (object_uri IS NOT NULL)::integer) = 1
  )
);

CREATE TABLE IF NOT EXISTS raw.fetch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES raw.ingestion_run(id),
  blob_id uuid NOT NULL REFERENCES raw.blob(id),
  fetched_at timestamptz NOT NULL,
  sanitized_request jsonb NOT NULL,
  request_fingerprint text NOT NULL,
  status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  etag text,
  last_modified text,
  response_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT fetch_run_request_uq UNIQUE (run_id, request_fingerprint)
);

CREATE INDEX IF NOT EXISTS fetch_fetched_brin_idx ON raw.fetch USING brin(fetched_at);

CREATE TABLE IF NOT EXISTS raw.record (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fetch_id uuid NOT NULL REFERENCES raw.fetch(id),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  record_type text NOT NULL,
  source_record_key text NOT NULL,
  record_sha256 text NOT NULL CHECK (char_length(record_sha256) = 64),
  record_json jsonb NOT NULL,
  parser_schema_version text NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT record_fetch_ordinal_uq UNIQUE (fetch_id, ordinal),
  CONSTRAINT record_fetch_source_key_uq UNIQUE (fetch_id, record_type, source_record_key)
);

CREATE INDEX IF NOT EXISTS record_source_key_idx
  ON raw.record(record_type, source_record_key);
CREATE INDEX IF NOT EXISTS record_ingested_brin_idx
  ON raw.record USING brin(ingested_at);

CREATE TABLE IF NOT EXISTS core.player (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS core.external_namespace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES catalog.source(id),
  namespace_key text NOT NULL,
  description text,
  CONSTRAINT external_namespace_source_key_uq UNIQUE (source_id, namespace_key)
);

CREATE TABLE IF NOT EXISTS core.external_identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace_id uuid NOT NULL REFERENCES core.external_namespace(id),
  external_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_identity_namespace_key_uq UNIQUE (namespace_id, external_key)
);

CREATE TABLE IF NOT EXISTS core.identity_assignment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_identity_id uuid NOT NULL REFERENCES core.external_identity(id),
  player_id uuid NOT NULL REFERENCES core.player(id),
  asserting_dataset_id uuid NOT NULL REFERENCES catalog.dataset(id),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  known_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  review_status text NOT NULL DEFAULT 'pending',
  method text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_record_id uuid REFERENCES raw.record(id),
  revision_no integer NOT NULL DEFAULT 1 CHECK (revision_no > 0),
  supersedes_id uuid UNIQUE REFERENCES core.identity_assignment(id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT identity_assignment_revision_uq UNIQUE (external_identity_id, revision_no),
  CONSTRAINT identity_assignment_window_chk CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX IF NOT EXISTS identity_assignment_lookup_idx
  ON core.identity_assignment(external_identity_id, known_at DESC, revision_no DESC);
CREATE INDEX IF NOT EXISTS identity_assignment_player_idx
  ON core.identity_assignment(player_id, known_at DESC);

CREATE TABLE IF NOT EXISTS core.player_bio_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES core.player(id),
  dataset_id uuid NOT NULL REFERENCES catalog.dataset(id),
  raw_record_id uuid REFERENCES raw.record(id),
  source_record_key text NOT NULL,
  display_name text,
  first_name text,
  last_name text,
  birth_date date,
  bats text,
  throws text,
  position text,
  known_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  revision_no integer NOT NULL DEFAULT 1 CHECK (revision_no > 0),
  content_sha256 text NOT NULL CHECK (char_length(content_sha256) = 64),
  CONSTRAINT bio_dataset_record_revision_uq UNIQUE (dataset_id, source_record_key, revision_no)
);

CREATE INDEX IF NOT EXISTS bio_player_known_idx
  ON core.player_bio_observation(player_id, known_at DESC);

CREATE TABLE IF NOT EXISTS core.observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  player_id uuid NOT NULL REFERENCES core.player(id),
  dataset_id uuid NOT NULL REFERENCES catalog.dataset(id),
  source_record_key text NOT NULL,
  raw_record_id uuid REFERENCES raw.record(id),
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  known_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  revision_no integer NOT NULL DEFAULT 1 CHECK (revision_no > 0),
  supersedes_id uuid UNIQUE REFERENCES core.observation(id) DEFERRABLE INITIALLY DEFERRED,
  is_retraction boolean NOT NULL DEFAULT false,
  content_sha256 text NOT NULL CHECK (char_length(content_sha256) = 64),
  CONSTRAINT observation_revision_uq UNIQUE (dataset_id, source_record_key, revision_no),
  CONSTRAINT observation_effective_window_chk CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT observation_known_chk CHECK (known_at IS NULL OR known_at <= ingested_at)
);

CREATE INDEX IF NOT EXISTS observation_player_known_idx
  ON core.observation(player_id, kind, known_at DESC, effective_from DESC)
  WHERE known_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS observation_revision_lookup_idx
  ON core.observation(dataset_id, source_record_key, known_at DESC, revision_no DESC);

CREATE TABLE IF NOT EXISTS core.scouting_publication (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES catalog.dataset(id),
  publication_key text NOT NULL,
  list_name text NOT NULL,
  edition text,
  published_at timestamptz,
  universe_description text,
  universe_size integer CHECK (universe_size IS NULL OR universe_size >= 0),
  raw_record_id uuid REFERENCES raw.record(id),
  CONSTRAINT scouting_publication_key_uq UNIQUE (dataset_id, publication_key)
);

CREATE TABLE IF NOT EXISTS core.scouting_observation (
  observation_id uuid PRIMARY KEY REFERENCES core.observation(id),
  publication_id uuid REFERENCES core.scouting_publication(id),
  rank integer CHECK (rank IS NULL OR rank > 0),
  rank_universe_size integer CHECK (rank_universe_size IS NULL OR rank_universe_size >= 0),
  projected_role text,
  position text,
  present_value_raw text,
  future_value_raw text,
  risk_raw text,
  eta_year integer CHECK (eta_year IS NULL OR eta_year BETWEEN 1900 AND 2200),
  grades jsonb NOT NULL DEFAULT '{}'::jsonb,
  tldr text,
  summary text
);

CREATE INDEX IF NOT EXISTS scouting_publication_rank_idx
  ON core.scouting_observation(publication_id, rank);

CREATE TABLE IF NOT EXISTS core.stat_observation (
  observation_id uuid PRIMARY KEY REFERENCES core.observation(id),
  provider_namespace text NOT NULL,
  role text NOT NULL,
  season integer NOT NULL CHECK (season BETWEEN 1800 AND 2200),
  period_start date,
  period_end date,
  level text,
  team_key text,
  split_key jsonb NOT NULL DEFAULT '{}'::jsonb,
  counting_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  value_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT stat_period_chk CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS stat_season_level_idx
  ON core.stat_observation(season, level);

CREATE TABLE IF NOT EXISTS ml.model_release (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key text NOT NULL,
  version text NOT NULL,
  target_key text NOT NULL,
  trained_at timestamptz NOT NULL,
  training_cutoff timestamptz NOT NULL,
  code_commit text NOT NULL,
  feature_set_hash text NOT NULL,
  validation_metrics jsonb NOT NULL,
  status text NOT NULL DEFAULT 'candidate',
  CONSTRAINT model_release_key_version_uq UNIQUE (model_key, version)
);

CREATE TABLE IF NOT EXISTS ml.prediction_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of timestamptz NOT NULL,
  bundle_version text NOT NULL,
  status text NOT NULL DEFAULT 'building' CHECK (status IN ('building', 'validated', 'published', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  validation_report jsonb,
  CONSTRAINT prediction_batch_asof_bundle_uq UNIQUE (as_of, bundle_version),
  CONSTRAINT prediction_batch_publication_chk CHECK ((status = 'published') = (published_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS ml.prediction_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES ml.prediction_batch(id),
  player_id uuid NOT NULL REFERENCES core.player(id),
  arrival_model_release_id uuid REFERENCES ml.model_release(id),
  career_model_release_id uuid REFERENCES ml.model_release(id),
  as_of timestamptz NOT NULL,
  data_quality_grade text NOT NULL,
  completeness numeric(5,4) NOT NULL CHECK (completeness BETWEEN 0 AND 1),
  out_of_distribution_score numeric(7,4),
  explanation jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prediction_batch_player_uq UNIQUE (batch_id, player_id)
);

CREATE INDEX IF NOT EXISTS prediction_player_asof_idx
  ON ml.prediction_snapshot(player_id, as_of DESC);

CREATE TABLE IF NOT EXISTS ml.arrival_probability (
  snapshot_id uuid NOT NULL REFERENCES ml.prediction_snapshot(id),
  horizon_months smallint NOT NULL CHECK (horizon_months > 0),
  probability numeric(6,5) NOT NULL CHECK (probability BETWEEN 0 AND 1),
  calibration_low numeric(6,5),
  calibration_high numeric(6,5),
  PRIMARY KEY (snapshot_id, horizon_months),
  CONSTRAINT arrival_calibration_chk CHECK (
    (calibration_low IS NULL AND calibration_high IS NULL)
    OR (
      calibration_low BETWEEN 0 AND 1
      AND calibration_high BETWEEN 0 AND 1
      AND calibration_low <= probability
      AND probability <= calibration_high
    )
  )
);

CREATE TABLE IF NOT EXISTS ml.career_arc_point (
  snapshot_id uuid NOT NULL REFERENCES ml.prediction_snapshot(id),
  metric_key text NOT NULL DEFAULT 'career_war',
  age smallint NOT NULL CHECK (age BETWEEN 14 AND 60),
  p10 numeric(8,3) NOT NULL,
  p25 numeric(8,3) NOT NULL,
  p50 numeric(8,3) NOT NULL,
  p75 numeric(8,3) NOT NULL,
  p90 numeric(8,3) NOT NULL,
  conditional_on_debut boolean NOT NULL DEFAULT false,
  PRIMARY KEY (snapshot_id, metric_key, age),
  CONSTRAINT career_quantiles_chk CHECK (p10 <= p25 AND p25 <= p50 AND p50 <= p75 AND p75 <= p90)
);

CREATE TABLE IF NOT EXISTS ml.milestone_probability (
  snapshot_id uuid NOT NULL REFERENCES ml.prediction_snapshot(id),
  milestone_key text NOT NULL,
  probability numeric(6,5) NOT NULL CHECK (probability BETWEEN 0 AND 1),
  PRIMARY KEY (snapshot_id, milestone_key)
);

CREATE OR REPLACE VIEW app.latest_prediction_snapshot AS
SELECT DISTINCT ON (snapshot.player_id)
  snapshot.id,
  snapshot.player_id,
  snapshot.batch_id,
  snapshot.as_of,
  snapshot.data_quality_grade,
  snapshot.completeness,
  snapshot.out_of_distribution_score,
  snapshot.explanation,
  batch.bundle_version,
  batch.published_at
FROM ml.prediction_snapshot AS snapshot
JOIN ml.prediction_batch AS batch ON batch.id = snapshot.batch_id
WHERE batch.status = 'published'
ORDER BY snapshot.player_id, snapshot.as_of DESC, batch.published_at DESC;

COMMENT ON SCHEMA raw IS 'Append-only source evidence. Corrections create new runs and records.';
COMMENT ON COLUMN core.observation.known_at IS 'Earliest evidenced timestamp when this fact was available to the research system.';
COMMENT ON COLUMN ml.prediction_snapshot.as_of IS 'Point-in-time cutoff. Every model input must have known_at <= as_of.';
