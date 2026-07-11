CREATE TABLE ml.dataset_manifest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_key text NOT NULL,
  version integer NOT NULL CONSTRAINT dataset_manifest_version_chk CHECK (version > 0),
  dataset_kind text NOT NULL CONSTRAINT dataset_manifest_kind_chk CHECK (
    dataset_kind IN ('features', 'labels', 'training', 'evaluation', 'prediction')
  ),
  schema_version text NOT NULL,
  universe_definition_version text NOT NULL,
  code_commit text NOT NULL,
  as_of_start timestamptz,
  as_of_end timestamptz,
  source_lineage jsonb NOT NULL,
  quality_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_uri text NOT NULL,
  row_count bigint NOT NULL CONSTRAINT dataset_manifest_row_count_chk CHECK (row_count >= 0),
  content_sha256 text NOT NULL CONSTRAINT dataset_manifest_content_sha_chk
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text NOT NULL CONSTRAINT dataset_manifest_manifest_sha_chk
    CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dataset_manifest_key_version_uq UNIQUE (manifest_key, version),
  CONSTRAINT dataset_manifest_sha_uq UNIQUE (manifest_sha256),
  CONSTRAINT dataset_manifest_window_chk CHECK (
    as_of_end IS NULL OR as_of_start IS NULL OR as_of_end >= as_of_start
  )
);

CREATE INDEX dataset_manifest_kind_created_idx
  ON ml.dataset_manifest(dataset_kind, created_at DESC);

CREATE TABLE ml.feature_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_manifest_id uuid NOT NULL REFERENCES ml.dataset_manifest(id),
  player_id uuid NOT NULL REFERENCES core.player(id),
  as_of timestamptz NOT NULL,
  feature_set_key text NOT NULL,
  feature_set_version text NOT NULL,
  feature_set_hash text NOT NULL CONSTRAINT feature_snapshot_set_hash_chk
    CHECK (feature_set_hash ~ '^[0-9a-f]{64}$'),
  feature_sha256 text NOT NULL CONSTRAINT feature_snapshot_sha_chk
    CHECK (feature_sha256 ~ '^[0-9a-f]{64}$'),
  features jsonb NOT NULL,
  max_source_known_at timestamptz NOT NULL,
  completeness numeric(5,4) NOT NULL CONSTRAINT feature_snapshot_completeness_chk
    CHECK (completeness BETWEEN 0 AND 1),
  quality_status text NOT NULL CONSTRAINT feature_snapshot_quality_chk
    CHECK (quality_status IN ('passed', 'quarantined')),
  quality_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feature_snapshot_natural_uq UNIQUE (
    dataset_manifest_id,
    player_id,
    as_of,
    feature_set_key,
    feature_set_version
  ),
  CONSTRAINT feature_snapshot_known_at_chk CHECK (max_source_known_at <= as_of)
);

CREATE INDEX feature_snapshot_player_asof_idx
  ON ml.feature_snapshot(player_id, as_of DESC);
CREATE INDEX feature_snapshot_manifest_asof_idx
  ON ml.feature_snapshot(dataset_manifest_id, as_of);

CREATE TABLE ml.outcome_label (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_manifest_id uuid NOT NULL REFERENCES ml.dataset_manifest(id),
  feature_snapshot_id uuid NOT NULL REFERENCES ml.feature_snapshot(id),
  target_key text NOT NULL,
  target_version text NOT NULL,
  horizon_key text NOT NULL,
  horizon_months smallint,
  outcome_state text NOT NULL CONSTRAINT outcome_label_state_chk CHECK (
    outcome_state IN (
      'observed_event',
      'observed_non_event',
      'right_censored',
      'lost_to_coverage',
      'confirmed_terminal_exit'
    )
  ),
  numeric_value numeric(18,6),
  label_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_at timestamptz,
  censored_at timestamptz,
  followup_through timestamptz NOT NULL,
  label_available_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outcome_label_natural_uq UNIQUE (
    dataset_manifest_id,
    feature_snapshot_id,
    target_key,
    target_version,
    horizon_key
  ),
  CONSTRAINT outcome_label_horizon_chk CHECK (
    horizon_months IS NULL OR horizon_months > 0
  ),
  CONSTRAINT outcome_label_event_chk CHECK (
    (outcome_state = 'observed_event' AND event_at IS NOT NULL)
    OR (outcome_state <> 'observed_event' AND event_at IS NULL)
  ),
  CONSTRAINT outcome_label_censor_chk CHECK (
    (
      outcome_state IN ('right_censored', 'lost_to_coverage')
      AND censored_at IS NOT NULL
      AND numeric_value IS NULL
    )
    OR (
      outcome_state NOT IN ('right_censored', 'lost_to_coverage')
      AND censored_at IS NULL
    )
  ),
  CONSTRAINT outcome_label_followup_chk CHECK (
    (event_at IS NULL OR event_at <= followup_through)
    AND (censored_at IS NULL OR censored_at <= followup_through)
    AND label_available_at >= followup_through
  ),
  CONSTRAINT outcome_label_value_chk CHECK (
    outcome_state IN ('right_censored', 'lost_to_coverage')
    OR numeric_value IS NOT NULL
    OR label_payload <> '{}'::jsonb
  )
);

CREATE INDEX outcome_label_snapshot_target_idx
  ON ml.outcome_label(feature_snapshot_id, target_key, target_version);
CREATE INDEX outcome_label_manifest_state_idx
  ON ml.outcome_label(dataset_manifest_id, outcome_state);

CREATE TABLE ml.temporal_split_manifest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_manifest_id uuid NOT NULL REFERENCES ml.dataset_manifest(id),
  split_key text NOT NULL,
  version integer NOT NULL CONSTRAINT temporal_split_manifest_version_chk CHECK (version > 0),
  target_key text NOT NULL,
  target_version text NOT NULL,
  horizon_key text NOT NULL,
  strategy text NOT NULL CONSTRAINT temporal_split_manifest_strategy_chk CHECK (
    strategy IN ('rolling_origin', 'expanding_window', 'era_holdout', 'fixed_temporal')
  ),
  cluster_key text NOT NULL,
  definition jsonb NOT NULL,
  content_sha256 text NOT NULL CONSTRAINT temporal_split_manifest_sha_chk
    CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT temporal_split_manifest_key_version_uq UNIQUE (split_key, version),
  CONSTRAINT temporal_split_manifest_sha_uq UNIQUE (content_sha256),
  CONSTRAINT temporal_split_manifest_id_dataset_uq UNIQUE (id, dataset_manifest_id)
);

CREATE INDEX temporal_split_manifest_dataset_idx
  ON ml.temporal_split_manifest(dataset_manifest_id, created_at DESC);

CREATE TABLE ml.temporal_split_fold (
  split_manifest_id uuid NOT NULL REFERENCES ml.temporal_split_manifest(id),
  fold_no integer NOT NULL CONSTRAINT temporal_split_fold_number_chk CHECK (fold_no >= 0),
  training_start timestamptz,
  training_end timestamptz NOT NULL,
  training_label_cutoff timestamptz NOT NULL,
  calibration_start timestamptz,
  calibration_end timestamptz,
  calibration_label_cutoff timestamptz,
  evaluation_start timestamptz NOT NULL,
  evaluation_end timestamptz NOT NULL,
  evaluation_label_cutoff timestamptz NOT NULL,
  holdout_start timestamptz,
  holdout_end timestamptz,
  holdout_label_cutoff timestamptz,
  embargo_days integer NOT NULL DEFAULT 0
    CONSTRAINT temporal_split_fold_embargo_chk CHECK (embargo_days >= 0),
  PRIMARY KEY (split_manifest_id, fold_no),
  CONSTRAINT temporal_split_fold_training_chk CHECK (
    (training_start IS NULL OR training_start <= training_end)
    AND training_label_cutoff >= training_end
    AND training_label_cutoff <= evaluation_start
  ),
  CONSTRAINT temporal_split_fold_calibration_chk CHECK (
    (
      calibration_start IS NULL
      AND calibration_end IS NULL
      AND calibration_label_cutoff IS NULL
    )
    OR (
      calibration_start IS NOT NULL
      AND calibration_end IS NOT NULL
      AND calibration_label_cutoff IS NOT NULL
      AND calibration_start > training_end
      AND calibration_end >= calibration_start
      AND calibration_label_cutoff >= calibration_end
      AND calibration_label_cutoff <= evaluation_start
    )
  ),
  CONSTRAINT temporal_split_fold_evaluation_chk CHECK (
    evaluation_end >= evaluation_start
    AND evaluation_label_cutoff >= evaluation_end
    AND evaluation_start >= (
      COALESCE(calibration_end, training_end) + embargo_days * INTERVAL '1 day'
    )
  ),
  CONSTRAINT temporal_split_fold_holdout_chk CHECK (
    (
      holdout_start IS NULL
      AND holdout_end IS NULL
      AND holdout_label_cutoff IS NULL
    )
    OR (
      holdout_start IS NOT NULL
      AND holdout_end IS NOT NULL
      AND holdout_label_cutoff IS NOT NULL
      AND holdout_end >= holdout_start
      AND holdout_label_cutoff >= holdout_end
    )
  )
);

CREATE TABLE ml.temporal_split_assignment (
  split_manifest_id uuid NOT NULL,
  fold_no integer NOT NULL,
  feature_snapshot_id uuid NOT NULL REFERENCES ml.feature_snapshot(id),
  outcome_label_id uuid NOT NULL REFERENCES ml.outcome_label(id),
  partition text NOT NULL CONSTRAINT temporal_split_assignment_partition_chk CHECK (
    partition IN ('train', 'calibration', 'evaluation', 'holdout')
  ),
  cluster_id text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (split_manifest_id, fold_no, feature_snapshot_id),
  CONSTRAINT temporal_split_assignment_fold_fk FOREIGN KEY (split_manifest_id, fold_no)
    REFERENCES ml.temporal_split_fold(split_manifest_id, fold_no)
);

CREATE INDEX temporal_split_assignment_partition_idx
  ON ml.temporal_split_assignment(split_manifest_id, fold_no, partition);
CREATE INDEX temporal_split_assignment_cluster_idx
  ON ml.temporal_split_assignment(split_manifest_id, fold_no, cluster_id);
CREATE INDEX temporal_split_assignment_label_idx
  ON ml.temporal_split_assignment(outcome_label_id);

CREATE TABLE ml.training_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_key text NOT NULL,
  attempt integer NOT NULL CONSTRAINT training_run_attempt_chk CHECK (attempt > 0),
  model_key text NOT NULL,
  target_key text NOT NULL,
  target_version text NOT NULL,
  horizon_key text NOT NULL,
  dataset_manifest_id uuid NOT NULL REFERENCES ml.dataset_manifest(id),
  split_manifest_id uuid NOT NULL,
  feature_set_hash text NOT NULL CONSTRAINT training_run_feature_hash_chk
    CHECK (feature_set_hash ~ '^[0-9a-f]{64}$'),
  code_commit text NOT NULL,
  environment_sha256 text NOT NULL CONSTRAINT training_run_environment_sha_chk
    CHECK (environment_sha256 ~ '^[0-9a-f]{64}$'),
  config_sha256 text NOT NULL CONSTRAINT training_run_config_sha_chk
    CHECK (config_sha256 ~ '^[0-9a-f]{64}$'),
  config jsonb NOT NULL,
  random_seed integer NOT NULL,
  status text NOT NULL CONSTRAINT training_run_status_chk
    CHECK (status IN ('succeeded', 'failed', 'cancelled')),
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_run_key_attempt_uq UNIQUE (run_key, attempt),
  CONSTRAINT training_run_split_dataset_fk FOREIGN KEY (split_manifest_id, dataset_manifest_id)
    REFERENCES ml.temporal_split_manifest(id, dataset_manifest_id),
  CONSTRAINT training_run_window_chk CHECK (finished_at >= started_at),
  CONSTRAINT training_run_error_chk CHECK (status <> 'succeeded' OR error IS NULL)
);

CREATE INDEX training_run_model_finished_idx
  ON ml.training_run(model_key, target_key, finished_at DESC);
CREATE INDEX training_run_manifest_idx
  ON ml.training_run(dataset_manifest_id, split_manifest_id);

CREATE TABLE ml.training_artifact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  training_run_id uuid NOT NULL REFERENCES ml.training_run(id),
  artifact_key text NOT NULL,
  version integer NOT NULL CONSTRAINT training_artifact_version_chk CHECK (version > 0),
  artifact_kind text NOT NULL CONSTRAINT training_artifact_kind_chk CHECK (
    artifact_kind IN (
      'model',
      'calibrator',
      'metrics',
      'environment',
      'feature_importance',
      'validation_report',
      'log'
    )
  ),
  storage_uri text NOT NULL,
  media_type text NOT NULL,
  sha256 text NOT NULL CONSTRAINT training_artifact_sha_chk
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_length bigint NOT NULL CONSTRAINT training_artifact_length_chk CHECK (byte_length >= 0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT training_artifact_key_version_uq UNIQUE (
    training_run_id,
    artifact_key,
    version
  )
);

CREATE INDEX training_artifact_run_kind_idx
  ON ml.training_artifact(training_run_id, artifact_kind);

ALTER TABLE ml.model_release
  ADD COLUMN training_run_id uuid REFERENCES ml.training_run(id);

CREATE INDEX model_release_training_run_idx
  ON ml.model_release(training_run_id);

ALTER TABLE ml.prediction_snapshot
  ADD COLUMN feature_snapshot_id uuid REFERENCES ml.feature_snapshot(id);

CREATE INDEX prediction_feature_snapshot_idx
  ON ml.prediction_snapshot(feature_snapshot_id);

CREATE OR REPLACE FUNCTION ml.validate_outcome_label()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  snapshot_as_of timestamptz;
  horizon_end timestamptz;
BEGIN
  SELECT feature_snapshot.as_of
  INTO snapshot_as_of
  FROM ml.feature_snapshot AS feature_snapshot
  WHERE feature_snapshot.id = NEW.feature_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feature snapshot % does not exist', NEW.feature_snapshot_id;
  END IF;

  IF NEW.followup_through < snapshot_as_of THEN
    RAISE EXCEPTION 'outcome follow-up % precedes feature snapshot as_of %',
      NEW.followup_through, snapshot_as_of;
  END IF;

  IF NEW.event_at IS NOT NULL AND NEW.event_at < snapshot_as_of THEN
    RAISE EXCEPTION 'outcome event % precedes feature snapshot as_of %',
      NEW.event_at, snapshot_as_of;
  END IF;

  IF NEW.censored_at IS NOT NULL AND NEW.censored_at < snapshot_as_of THEN
    RAISE EXCEPTION 'outcome censor time % precedes feature snapshot as_of %',
      NEW.censored_at, snapshot_as_of;
  END IF;

  IF NEW.outcome_state IN ('right_censored', 'lost_to_coverage')
    AND NEW.censored_at IS DISTINCT FROM NEW.followup_through THEN
    RAISE EXCEPTION 'censored outcome must end follow-up at censored_at';
  END IF;

  IF NEW.horizon_months IS NOT NULL THEN
    horizon_end := snapshot_as_of + make_interval(months => NEW.horizon_months::integer);

    IF NEW.outcome_state = 'observed_event' AND NEW.event_at > horizon_end THEN
      RAISE EXCEPTION 'outcome event % is after horizon end %', NEW.event_at, horizon_end;
    END IF;

    IF NEW.outcome_state = 'observed_non_event' AND NEW.followup_through < horizon_end THEN
      RAISE EXCEPTION 'non-event follow-up % does not mature through horizon end %',
        NEW.followup_through, horizon_end;
    END IF;

    IF NEW.outcome_state IN ('right_censored', 'lost_to_coverage')
      AND NEW.censored_at >= horizon_end THEN
      RAISE EXCEPTION 'censor time % reaches horizon end %; store a matured non-event instead',
        NEW.censored_at, horizon_end;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ml.validate_temporal_split_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  feature_as_of timestamptz;
  label_feature_snapshot_id uuid;
  label_target_key text;
  label_target_version text;
  label_horizon_key text;
  label_available_at timestamptz;
  split_target_key text;
  split_target_version text;
  split_horizon_key text;
  fold_record ml.temporal_split_fold%ROWTYPE;
  partition_start timestamptz;
  partition_end timestamptz;
  partition_label_cutoff timestamptz;
BEGIN
  SELECT feature_snapshot.as_of
  INTO feature_as_of
  FROM ml.feature_snapshot AS feature_snapshot
  WHERE feature_snapshot.id = NEW.feature_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feature snapshot % does not exist', NEW.feature_snapshot_id;
  END IF;

  SELECT
    outcome_label.feature_snapshot_id,
    outcome_label.target_key,
    outcome_label.target_version,
    outcome_label.horizon_key,
    outcome_label.label_available_at
  INTO
    label_feature_snapshot_id,
    label_target_key,
    label_target_version,
    label_horizon_key,
    label_available_at
  FROM ml.outcome_label AS outcome_label
  WHERE outcome_label.id = NEW.outcome_label_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'outcome label % does not exist', NEW.outcome_label_id;
  END IF;

  IF label_feature_snapshot_id <> NEW.feature_snapshot_id THEN
    RAISE EXCEPTION 'outcome label % belongs to feature snapshot %, not %',
      NEW.outcome_label_id, label_feature_snapshot_id, NEW.feature_snapshot_id;
  END IF;

  SELECT *
  INTO fold_record
  FROM ml.temporal_split_fold AS split_fold
  WHERE split_fold.split_manifest_id = NEW.split_manifest_id
    AND split_fold.fold_no = NEW.fold_no;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'temporal split fold %/% does not exist',
      NEW.split_manifest_id, NEW.fold_no;
  END IF;

  SELECT
    split_manifest.target_key,
    split_manifest.target_version,
    split_manifest.horizon_key
  INTO split_target_key, split_target_version, split_horizon_key
  FROM ml.temporal_split_manifest AS split_manifest
  WHERE split_manifest.id = NEW.split_manifest_id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM ml.training_run AS training_run
    WHERE training_run.split_manifest_id = NEW.split_manifest_id
  ) THEN
    RAISE EXCEPTION 'temporal split % is sealed by a training run', NEW.split_manifest_id;
  END IF;

  IF (label_target_key, label_target_version, label_horizon_key)
    IS DISTINCT FROM (split_target_key, split_target_version, split_horizon_key) THEN
    RAISE EXCEPTION 'outcome label target %/%/% does not match split target %/%/%',
      label_target_key,
      label_target_version,
      label_horizon_key,
      split_target_key,
      split_target_version,
      split_horizon_key;
  END IF;

  CASE NEW.partition
    WHEN 'train' THEN
      partition_start := fold_record.training_start;
      partition_end := fold_record.training_end;
      partition_label_cutoff := fold_record.training_label_cutoff;
    WHEN 'calibration' THEN
      partition_start := fold_record.calibration_start;
      partition_end := fold_record.calibration_end;
      partition_label_cutoff := fold_record.calibration_label_cutoff;
    WHEN 'evaluation' THEN
      partition_start := fold_record.evaluation_start;
      partition_end := fold_record.evaluation_end;
      partition_label_cutoff := fold_record.evaluation_label_cutoff;
    WHEN 'holdout' THEN
      partition_start := fold_record.holdout_start;
      partition_end := fold_record.holdout_end;
      partition_label_cutoff := fold_record.holdout_label_cutoff;
    ELSE
      RAISE EXCEPTION 'unsupported temporal split partition %', NEW.partition;
  END CASE;

  IF partition_end IS NULL OR partition_label_cutoff IS NULL THEN
    RAISE EXCEPTION 'partition % has no configured time window or label cutoff', NEW.partition;
  END IF;

  IF (partition_start IS NOT NULL AND feature_as_of < partition_start)
    OR feature_as_of > partition_end THEN
    RAISE EXCEPTION 'feature snapshot as_of % is outside % partition window [% - %]',
      feature_as_of, NEW.partition, partition_start, partition_end;
  END IF;

  IF label_available_at > partition_label_cutoff THEN
    RAISE EXCEPTION 'outcome label available at % is after % partition cutoff %',
      label_available_at, NEW.partition, partition_label_cutoff;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ml.validate_temporal_split_fold()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM 1
  FROM ml.temporal_split_manifest AS split_manifest
  WHERE split_manifest.id = NEW.split_manifest_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'temporal split manifest % does not exist', NEW.split_manifest_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ml.training_run AS training_run
    WHERE training_run.split_manifest_id = NEW.split_manifest_id
  ) THEN
    RAISE EXCEPTION 'temporal split % is sealed by a training run', NEW.split_manifest_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ml.validate_training_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  split_dataset_manifest_id uuid;
  split_target_key text;
  split_target_version text;
  split_horizon_key text;
BEGIN
  SELECT
    split_manifest.dataset_manifest_id,
    split_manifest.target_key,
    split_manifest.target_version,
    split_manifest.horizon_key
  INTO
    split_dataset_manifest_id,
    split_target_key,
    split_target_version,
    split_horizon_key
  FROM ml.temporal_split_manifest AS split_manifest
  WHERE split_manifest.id = NEW.split_manifest_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'temporal split manifest % does not exist', NEW.split_manifest_id;
  END IF;

  IF split_dataset_manifest_id <> NEW.dataset_manifest_id THEN
    RAISE EXCEPTION 'training dataset manifest % does not match split dataset manifest %',
      NEW.dataset_manifest_id, split_dataset_manifest_id;
  END IF;

  IF (NEW.target_key, NEW.target_version, NEW.horizon_key)
    IS DISTINCT FROM (split_target_key, split_target_version, split_horizon_key) THEN
    RAISE EXCEPTION 'training target %/%/% does not match split target %/%/%',
      NEW.target_key,
      NEW.target_version,
      NEW.horizon_key,
      split_target_key,
      split_target_version,
      split_horizon_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM ml.temporal_split_assignment AS assignment
    WHERE assignment.split_manifest_id = NEW.split_manifest_id
      AND assignment.partition = 'train'
  ) THEN
    RAISE EXCEPTION 'training split % has no training assignments', NEW.split_manifest_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM ml.temporal_split_assignment AS assignment
    JOIN ml.feature_snapshot AS feature_snapshot
      ON feature_snapshot.id = assignment.feature_snapshot_id
    WHERE assignment.split_manifest_id = NEW.split_manifest_id
      AND feature_snapshot.feature_set_hash <> NEW.feature_set_hash
  ) THEN
    RAISE EXCEPTION 'training feature-set hash does not match every assigned feature snapshot';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ml.validate_model_release_training_run()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  run_record ml.training_run%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.training_run_id IS NOT NULL
      AND NEW.training_run_id IS DISTINCT FROM OLD.training_run_id THEN
      RAISE EXCEPTION 'model release training_run_id is immutable once assigned';
    END IF;
  END IF;

  IF NEW.training_run_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO run_record
  FROM ml.training_run AS training_run
  WHERE training_run.id = NEW.training_run_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'training run % does not exist', NEW.training_run_id;
  END IF;

  IF run_record.status <> 'succeeded' THEN
    RAISE EXCEPTION 'model release requires a succeeded training run, got %', run_record.status;
  END IF;

  IF (NEW.model_key, NEW.target_key, NEW.feature_set_hash, NEW.code_commit)
    IS DISTINCT FROM (
      run_record.model_key,
      run_record.target_key,
      run_record.feature_set_hash,
      run_record.code_commit
    ) THEN
    RAISE EXCEPTION 'model release identity does not match training run %', NEW.training_run_id;
  END IF;

  IF NEW.trained_at < run_record.finished_at THEN
    RAISE EXCEPTION 'model release trained_at % precedes training completion %',
      NEW.trained_at, run_record.finished_at;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ml.validate_prediction_feature_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  feature_player_id uuid;
  feature_as_of timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.feature_snapshot_id IS NOT NULL
      AND NEW.feature_snapshot_id IS DISTINCT FROM OLD.feature_snapshot_id THEN
      RAISE EXCEPTION 'prediction feature_snapshot_id is immutable once assigned';
    END IF;
  END IF;

  IF NEW.feature_snapshot_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT feature_snapshot.player_id, feature_snapshot.as_of
  INTO feature_player_id, feature_as_of
  FROM ml.feature_snapshot AS feature_snapshot
  WHERE feature_snapshot.id = NEW.feature_snapshot_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feature snapshot % does not exist', NEW.feature_snapshot_id;
  END IF;

  IF feature_player_id <> NEW.player_id THEN
    RAISE EXCEPTION 'prediction player % does not match feature snapshot player %',
      NEW.player_id, feature_player_id;
  END IF;

  IF feature_as_of > NEW.as_of THEN
    RAISE EXCEPTION 'feature snapshot as_of % is after prediction as_of %',
      feature_as_of, NEW.as_of;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION ml.reject_immutable_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is immutable; append a new version instead', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER outcome_label_validate
  BEFORE INSERT OR UPDATE ON ml.outcome_label
  FOR EACH ROW EXECUTE FUNCTION ml.validate_outcome_label();
CREATE TRIGGER temporal_split_fold_validate
  BEFORE INSERT ON ml.temporal_split_fold
  FOR EACH ROW EXECUTE FUNCTION ml.validate_temporal_split_fold();
CREATE TRIGGER temporal_split_assignment_validate
  BEFORE INSERT OR UPDATE ON ml.temporal_split_assignment
  FOR EACH ROW EXECUTE FUNCTION ml.validate_temporal_split_assignment();
CREATE TRIGGER training_run_validate
  BEFORE INSERT OR UPDATE ON ml.training_run
  FOR EACH ROW EXECUTE FUNCTION ml.validate_training_run();
CREATE TRIGGER model_release_training_run_validate
  BEFORE INSERT OR UPDATE ON ml.model_release
  FOR EACH ROW EXECUTE FUNCTION ml.validate_model_release_training_run();
CREATE TRIGGER prediction_feature_snapshot_validate
  BEFORE INSERT OR UPDATE ON ml.prediction_snapshot
  FOR EACH ROW EXECUTE FUNCTION ml.validate_prediction_feature_snapshot();

CREATE TRIGGER dataset_manifest_immutable
  BEFORE UPDATE OR DELETE ON ml.dataset_manifest
  FOR EACH ROW EXECUTE FUNCTION ml.reject_immutable_change();
CREATE TRIGGER feature_snapshot_immutable
  BEFORE UPDATE OR DELETE ON ml.feature_snapshot
  FOR EACH ROW EXECUTE FUNCTION ml.reject_immutable_change();
CREATE TRIGGER outcome_label_immutable
  BEFORE UPDATE OR DELETE ON ml.outcome_label
  FOR EACH ROW EXECUTE FUNCTION ml.reject_immutable_change();
CREATE TRIGGER temporal_split_manifest_immutable
  BEFORE UPDATE OR DELETE ON ml.temporal_split_manifest
  FOR EACH ROW EXECUTE FUNCTION ml.reject_immutable_change();
CREATE TRIGGER temporal_split_fold_immutable
  BEFORE UPDATE OR DELETE ON ml.temporal_split_fold
  FOR EACH ROW EXECUTE FUNCTION ml.reject_immutable_change();
CREATE TRIGGER temporal_split_assignment_immutable
  BEFORE UPDATE OR DELETE ON ml.temporal_split_assignment
  FOR EACH ROW EXECUTE FUNCTION ml.reject_immutable_change();
CREATE TRIGGER training_run_immutable
  BEFORE UPDATE OR DELETE ON ml.training_run
  FOR EACH ROW EXECUTE FUNCTION ml.reject_immutable_change();
CREATE TRIGGER training_artifact_immutable
  BEFORE UPDATE OR DELETE ON ml.training_artifact
  FOR EACH ROW EXECUTE FUNCTION ml.reject_immutable_change();

COMMENT ON TABLE ml.dataset_manifest IS
  'Immutable content-addressed dataset release. Corrections append a new manifest version.';
COMMENT ON COLUMN ml.feature_snapshot.max_source_known_at IS
  'Latest known_at among all source facts used; constrained to be no later than as_of.';
COMMENT ON TABLE ml.outcome_label IS
  'Versioned point-in-time outcomes with explicit censoring, coverage loss, and terminal exit states.';
COMMENT ON TABLE ml.temporal_split_manifest IS
  'Immutable target-and-horizon-specific temporal split definition.';
COMMENT ON COLUMN ml.temporal_split_fold.training_label_cutoff IS
  'Latest label_available_at allowed for training assignments in this fold.';
COMMENT ON COLUMN ml.temporal_split_assignment.outcome_label_id IS
  'Exact target-and-horizon label used for this feature snapshot and fold.';
COMMENT ON TABLE ml.training_run IS
  'Immutable completed training attempt. Insert a new attempt rather than updating a prior run.';
