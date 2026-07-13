CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE ops.refresh_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key text NOT NULL,
  trigger_kind text NOT NULL,
  season integer CHECK (season IS NULL OR season BETWEEN 1871 AND 2200),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'skipped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  code_commit text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  CONSTRAINT refresh_run_window_chk CHECK (
    finished_at IS NULL OR finished_at >= started_at
  ),
  CONSTRAINT refresh_run_completion_chk CHECK (
    (status = 'running' AND finished_at IS NULL)
    OR (status <> 'running' AND finished_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX refresh_run_one_running_job_uidx
  ON ops.refresh_run (job_key)
  WHERE status = 'running';

CREATE INDEX refresh_run_job_started_idx
  ON ops.refresh_run (job_key, started_at DESC);

COMMENT ON TABLE ops.refresh_run IS
  'Mutable operational receipts for scheduled refresh attempts. Source evidence remains immutable in raw.ingestion_run and raw.fetch.';
