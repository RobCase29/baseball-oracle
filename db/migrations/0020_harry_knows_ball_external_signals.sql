CREATE TABLE core.hkb_exact_identity (
  hkb_player_id text PRIMARY KEY,
  mlbam_id bigint NOT NULL UNIQUE,
  player_name text NOT NULL,
  source_url text NOT NULL,
  response_sha256 text NOT NULL,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  raw_record_id uuid NOT NULL REFERENCES raw.record(id),
  observation_count integer NOT NULL DEFAULT 1,
  identity_policy text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hkb_exact_identity_hkb_id_chk
    CHECK (hkb_player_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  CONSTRAINT hkb_exact_identity_mlbam_chk CHECK (mlbam_id > 0),
  CONSTRAINT hkb_exact_identity_name_chk CHECK (btrim(player_name) <> ''),
  CONSTRAINT hkb_exact_identity_source_url_chk
    CHECK (source_url ~ '^https://harryknowsball\.com/player/'),
  CONSTRAINT hkb_exact_identity_hash_chk
    CHECK (response_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT hkb_exact_identity_window_chk
    CHECK (last_observed_at >= first_observed_at),
  CONSTRAINT hkb_exact_identity_observations_chk
    CHECK (observation_count > 0),
  CONSTRAINT hkb_exact_identity_policy_chk
    CHECK (
      identity_policy =
        'exact_hkb_player_page_published_mlbam_no_name_matching'
    )
);

CREATE INDEX hkb_exact_identity_mlbam_idx
  ON core.hkb_exact_identity (mlbam_id);

CREATE TABLE core.hkb_identity_backfill_attempt (
  hkb_player_id text PRIMARY KEY,
  attempt_count integer NOT NULL,
  status text NOT NULL,
  failure_kind text NOT NULL,
  last_error text NOT NULL,
  last_attempted_at timestamptz NOT NULL,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hkb_identity_backfill_attempt_hkb_id_chk
    CHECK (hkb_player_id ~ '^[A-Za-z0-9_-]{4,64}$'),
  CONSTRAINT hkb_identity_backfill_attempt_count_chk
    CHECK (attempt_count > 0),
  CONSTRAINT hkb_identity_backfill_attempt_status_chk
    CHECK (status IN ('retryable', 'quarantined')),
  CONSTRAINT hkb_identity_backfill_attempt_failure_kind_chk
    CHECK (
      failure_kind IN (
        'transient',
        'mlbam_collision',
        'identity_changed',
        'provider_id_mismatch',
        'provider_evidence_mismatch'
      )
    ),
  CONSTRAINT hkb_identity_backfill_attempt_error_chk
    CHECK (btrim(last_error) <> ''),
  CONSTRAINT hkb_identity_backfill_attempt_schedule_chk
    CHECK (
      (status = 'retryable' AND next_attempt_at IS NOT NULL)
      OR (status = 'quarantined' AND next_attempt_at IS NULL)
    )
);

CREATE INDEX hkb_identity_backfill_attempt_retry_idx
  ON core.hkb_identity_backfill_attempt (
    next_attempt_at,
    last_attempted_at,
    hkb_player_id
  )
  WHERE status = 'retryable';

CREATE OR REPLACE FUNCTION core.observe_hkb_exact_identity(
  p_hkb_player_id text,
  p_mlbam_id bigint,
  p_player_name text,
  p_source_url text,
  p_observed_at timestamptz,
  p_response_sha256 text,
  p_raw_record_id uuid
)
RETURNS core.hkb_exact_identity
LANGUAGE plpgsql
AS $$
DECLARE
  evidence record;
  observed core.hkb_exact_identity%ROWTYPE;
  conflicting_hkb_player_id text;
BEGIN
  SELECT
    source.slug AS source_slug,
    dataset.dataset_key,
    source_fetch.fetched_at,
    raw_blob.sha256 AS blob_sha256,
    raw_record.record_type,
    raw_record.record_json
  INTO evidence
  FROM raw.record AS raw_record
  JOIN raw.fetch AS source_fetch ON source_fetch.id = raw_record.fetch_id
  JOIN raw.blob AS raw_blob ON raw_blob.id = source_fetch.blob_id
  JOIN raw.ingestion_run AS ingestion ON ingestion.id = source_fetch.run_id
  JOIN catalog.dataset AS dataset ON dataset.id = ingestion.dataset_id
  JOIN catalog.source AS source ON source.id = dataset.source_id
  WHERE raw_record.id = p_raw_record_id;

  IF NOT FOUND
    OR evidence.source_slug <> 'harry-knows-ball'
    OR evidence.dataset_key <> 'player-identity-pages'
    OR evidence.record_type <> 'hkb_exact_player_identity'
    OR evidence.blob_sha256 <> p_response_sha256
    OR evidence.fetched_at IS DISTINCT FROM p_observed_at
    OR evidence.record_json ->> 'hkbPlayerId' IS DISTINCT FROM p_hkb_player_id
    OR app.jsonb_number(evidence.record_json, 'mlbamId')::bigint
      IS DISTINCT FROM p_mlbam_id
    OR evidence.record_json ->> 'playerName' IS DISTINCT FROM p_player_name
    OR evidence.record_json ->> 'sourceUrl' IS DISTINCT FROM p_source_url
    OR (evidence.record_json ->> 'observedAt')::timestamptz
      IS DISTINCT FROM p_observed_at
    OR evidence.record_json ->> 'responseSha256'
      IS DISTINCT FROM p_response_sha256
    OR evidence.record_json ->> 'evidenceMethod'
      IS DISTINCT FROM 'hkb_player_page_published_mlbam'
    OR evidence.record_json ->> 'identityPolicy'
      IS DISTINCT FROM
        'exact_hkb_player_page_published_mlbam_no_name_matching'
  THEN
    RAISE EXCEPTION
      'HarryKnowsBall exact identity evidence does not match its raw record'
      USING ERRCODE = 'P2003';
  END IF;

  SELECT hkb_player_id
  INTO conflicting_hkb_player_id
  FROM core.hkb_exact_identity
  WHERE mlbam_id = p_mlbam_id
    AND hkb_player_id <> p_hkb_player_id;

  IF FOUND THEN
    RAISE EXCEPTION
      'MLBAM identity % is already assigned to HarryKnowsBall player %',
      p_mlbam_id,
      conflicting_hkb_player_id
      USING ERRCODE = 'P2001';
  END IF;

  INSERT INTO core.hkb_exact_identity AS target (
    hkb_player_id,
    mlbam_id,
    player_name,
    source_url,
    response_sha256,
    first_observed_at,
    last_observed_at,
    raw_record_id,
    identity_policy
  ) VALUES (
    p_hkb_player_id,
    p_mlbam_id,
    p_player_name,
    p_source_url,
    p_response_sha256,
    p_observed_at,
    p_observed_at,
    p_raw_record_id,
    'exact_hkb_player_page_published_mlbam_no_name_matching'
  )
  ON CONFLICT (hkb_player_id) DO UPDATE SET
    player_name = CASE
      WHEN EXCLUDED.last_observed_at >= target.last_observed_at
        THEN EXCLUDED.player_name
      ELSE target.player_name
    END,
    source_url = CASE
      WHEN EXCLUDED.last_observed_at >= target.last_observed_at
        THEN EXCLUDED.source_url
      ELSE target.source_url
    END,
    response_sha256 = CASE
      WHEN EXCLUDED.last_observed_at >= target.last_observed_at
        THEN EXCLUDED.response_sha256
      ELSE target.response_sha256
    END,
    first_observed_at = least(
      target.first_observed_at,
      EXCLUDED.first_observed_at
    ),
    last_observed_at = greatest(
      target.last_observed_at,
      EXCLUDED.last_observed_at
    ),
    raw_record_id = CASE
      WHEN EXCLUDED.last_observed_at >= target.last_observed_at
        THEN EXCLUDED.raw_record_id
      ELSE target.raw_record_id
    END,
    observation_count = target.observation_count + CASE
      WHEN target.raw_record_id = EXCLUDED.raw_record_id THEN 0
      ELSE 1
    END,
    updated_at = now()
  WHERE target.mlbam_id = EXCLUDED.mlbam_id
  RETURNING * INTO observed;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'HarryKnowsBall player % changed MLBAM identity from % to %',
      p_hkb_player_id,
      (
        SELECT mlbam_id
        FROM core.hkb_exact_identity
        WHERE hkb_player_id = p_hkb_player_id
      ),
      p_mlbam_id
      USING ERRCODE = 'P2002';
  END IF;

  DELETE FROM core.hkb_identity_backfill_attempt
  WHERE hkb_player_id = p_hkb_player_id;

  RETURN observed;
END;
$$;

CREATE VIEW app.hkb_complete_capture AS
SELECT
  ingestion.parameters ->> 'captureId' AS capture_id,
  min(source_fetch.fetched_at) AS capture_started_at,
  max(source_fetch.fetched_at) AS captured_at,
  max(
    (ingestion.parameters ->> 'sourceUpdatedAt')::timestamptz
  ) FILTER (
    WHERE ingestion.parameters ->> 'endpoint' = 'rankings'
  ) AS source_updated_at,
  count(DISTINCT ingestion.parameters ->> 'endpoint')::integer
    AS endpoint_count
FROM raw.ingestion_run AS ingestion
JOIN raw.fetch AS source_fetch ON source_fetch.run_id = ingestion.id
JOIN catalog.dataset AS dataset ON dataset.id = ingestion.dataset_id
JOIN catalog.source AS source ON source.id = dataset.source_id
WHERE source.slug = 'harry-knows-ball'
  AND dataset.dataset_key = 'dynasty-rankings'
  AND ingestion.status = 'succeeded'
  AND ingestion.parser_version = 'harry-knows-ball-dynasty-v1'
  AND ingestion.parameters ->> 'captureId' ~ '^[0-9a-f]{64}$'
  AND ingestion.parameters ->> 'endpoint' IN (
    'rankings',
    'top_viewed_players',
    'top_viewed_prospects'
  )
GROUP BY ingestion.parameters ->> 'captureId'
HAVING count(DISTINCT ingestion.parameters ->> 'endpoint') = 3;

CREATE VIEW app.hkb_dynasty_snapshot_history AS
WITH ranking_fetch AS (
  SELECT
    complete.capture_id,
    complete.captured_at,
    complete.source_updated_at,
    source_fetch.id AS fetch_id,
    coalesce(
      (ingestion.counts ->> 'sourceAssets')::integer,
      (ingestion.counts ->> 'players')::integer
    ) AS overall_universe,
    (ingestion.counts ->> 'prospects')::integer AS prospect_universe
  FROM app.hkb_complete_capture AS complete
  JOIN raw.ingestion_run AS ingestion
    ON ingestion.parameters ->> 'captureId' = complete.capture_id
    AND ingestion.parameters ->> 'endpoint' = 'rankings'
    AND ingestion.status = 'succeeded'
    AND ingestion.parser_version = 'harry-knows-ball-dynasty-v1'
  JOIN raw.fetch AS source_fetch ON source_fetch.run_id = ingestion.id
),
ranking AS (
  SELECT
    ranking_fetch.capture_id,
    ranking_fetch.captured_at,
    ranking_fetch.source_updated_at,
    ranking_fetch.overall_universe,
    ranking_fetch.prospect_universe,
    record.record_json ->> 'id' AS hkb_player_id,
    record.record_json ->> 'name' AS player_name,
    app.jsonb_number(record.record_json, 'rank')::integer AS overall_rank,
    app.jsonb_number(record.record_json, 'prospectRank')::integer
      AS prospect_rank,
    app.jsonb_number(record.record_json, 'value')::integer AS dynasty_value,
    app.jsonb_number(record.record_json, 'rankChange7Days')::integer
      AS rank_change_7d,
    app.jsonb_number(record.record_json, 'rankChange30Days')::integer
      AS rank_change_30d,
    app.jsonb_number(record.record_json, 'valueChange7Days')::integer
      AS value_change_7d,
    app.jsonb_number(record.record_json, 'valueChange30Days')::integer
      AS value_change_30d,
    record.record_json -> 'rankHistory30Days' AS rank_history_30d,
    record.record_json -> 'valueHistory30Days' AS value_history_30d,
    CASE jsonb_typeof(record.record_json -> 'active')
      WHEN 'boolean' THEN (record.record_json ->> 'active')::boolean
      ELSE NULL
    END AS active,
    CASE jsonb_typeof(record.record_json -> 'prospect')
      WHEN 'boolean' THEN (record.record_json ->> 'prospect')::boolean
      ELSE NULL
    END AS hkb_prospect
  FROM ranking_fetch
  JOIN raw.record AS record ON record.fetch_id = ranking_fetch.fetch_id
  WHERE record.parser_schema_version = 'harry-knows-ball-dynasty-v1'
    AND record.record_type = 'hkb_dynasty_player'
),
attention AS (
  SELECT
    complete.capture_id,
    ingestion.parameters ->> 'endpoint' AS endpoint,
    record.record_json #>> '{player,id}' AS hkb_player_id,
    app.jsonb_number(record.record_json, 'viewCount')::integer AS view_count,
    row_number() OVER (
      PARTITION BY
        complete.capture_id,
        ingestion.parameters ->> 'endpoint'
      ORDER BY
        app.jsonb_number(record.record_json, 'viewCount') DESC,
        record.ordinal,
        record.record_json #>> '{player,id}'
    )::integer AS attention_rank
  FROM app.hkb_complete_capture AS complete
  JOIN raw.ingestion_run AS ingestion
    ON ingestion.parameters ->> 'captureId' = complete.capture_id
    AND ingestion.parameters ->> 'endpoint' IN (
      'top_viewed_players',
      'top_viewed_prospects'
    )
    AND ingestion.status = 'succeeded'
    AND ingestion.parser_version = 'harry-knows-ball-dynasty-v1'
  JOIN raw.fetch AS source_fetch ON source_fetch.run_id = ingestion.id
  JOIN raw.record AS record ON record.fetch_id = source_fetch.id
  WHERE record.parser_schema_version = 'harry-knows-ball-dynasty-v1'
    AND record.record_type IN (
      'hkb_top_viewed_player',
      'hkb_top_viewed_prospect'
    )
),
overall_attention AS (
  SELECT capture_id, hkb_player_id, view_count, attention_rank
  FROM attention
  WHERE endpoint = 'top_viewed_players'
),
prospect_attention AS (
  SELECT capture_id, hkb_player_id, view_count, attention_rank
  FROM attention
  WHERE endpoint = 'top_viewed_prospects'
)
SELECT
  ranking.capture_id,
  ranking.hkb_player_id,
  ranking.player_name,
  ranking.overall_rank,
  ranking.overall_universe,
  ranking.prospect_rank,
  ranking.prospect_universe,
  ranking.dynasty_value,
  ranking.rank_change_7d,
  ranking.rank_change_30d,
  ranking.value_change_7d,
  ranking.value_change_30d,
  ranking.rank_history_30d,
  ranking.value_history_30d,
  overall_attention.view_count AS attention_count_30d,
  overall_attention.attention_rank AS attention_rank_30d,
  prospect_attention.view_count AS prospect_attention_count_30d,
  prospect_attention.attention_rank AS prospect_attention_rank_30d,
  ranking.source_updated_at,
  ranking.captured_at,
  'https://harryknowsball.com/rankings'::text AS source_url,
  ranking.active,
  ranking.hkb_prospect
FROM ranking
LEFT JOIN overall_attention
  USING (capture_id, hkb_player_id)
LEFT JOIN prospect_attention
  USING (capture_id, hkb_player_id);

CREATE MATERIALIZED VIEW app.hkb_current_comparison_signal AS
WITH latest_capture AS (
  SELECT capture_id
  FROM app.hkb_complete_capture
  ORDER BY
    source_updated_at DESC NULLS LAST,
    captured_at DESC,
    capture_id DESC
  LIMIT 1
)
SELECT
  CASE
    WHEN identity.mlbam_id IS NOT NULL
      THEN 'mlbam:' || identity.mlbam_id::text
    ELSE NULL
  END AS oracle_player_id,
  identity.mlbam_id,
  snapshot.hkb_player_id,
  snapshot.player_name,
  snapshot.overall_rank,
  snapshot.overall_universe,
  snapshot.prospect_rank,
  snapshot.prospect_universe,
  snapshot.dynasty_value,
  snapshot.rank_change_7d,
  snapshot.rank_change_30d,
  snapshot.value_change_7d,
  snapshot.value_change_30d,
  snapshot.rank_history_30d,
  snapshot.value_history_30d,
  snapshot.attention_count_30d,
  snapshot.attention_rank_30d,
  snapshot.prospect_attention_count_30d,
  snapshot.prospect_attention_rank_30d,
  snapshot.source_updated_at,
  snapshot.captured_at,
  snapshot.source_url,
  snapshot.active,
  snapshot.hkb_prospect
FROM app.hkb_dynasty_snapshot_history AS snapshot
JOIN latest_capture USING (capture_id)
LEFT JOIN core.hkb_exact_identity AS identity
  USING (hkb_player_id);

CREATE UNIQUE INDEX hkb_current_comparison_signal_hkb_uidx
  ON app.hkb_current_comparison_signal (hkb_player_id);

CREATE UNIQUE INDEX hkb_current_comparison_signal_mlbam_uidx
  ON app.hkb_current_comparison_signal (mlbam_id)
  WHERE mlbam_id IS NOT NULL;

CREATE INDEX hkb_current_comparison_signal_overall_rank_idx
  ON app.hkb_current_comparison_signal (overall_rank, hkb_player_id);

CREATE INDEX hkb_current_comparison_signal_prospect_rank_idx
  ON app.hkb_current_comparison_signal (prospect_rank, hkb_player_id)
  WHERE prospect_rank IS NOT NULL;

CREATE VIEW app.hkb_identity_backfill_queue AS
WITH latest_capture AS (
  SELECT capture_id
  FROM app.hkb_complete_capture
  ORDER BY
    source_updated_at DESC NULLS LAST,
    captured_at DESC,
    capture_id DESC
  LIMIT 1
)
SELECT
  snapshot.hkb_player_id,
  snapshot.player_name,
  snapshot.overall_rank,
  snapshot.prospect_rank,
  snapshot.active,
  snapshot.hkb_prospect,
  backfill.attempt_count AS identity_attempt_count,
  backfill.last_attempted_at AS identity_last_attempted_at,
  backfill.next_attempt_at AS identity_next_attempt_at,
  'https://harryknowsball.com/player/' || snapshot.hkb_player_id
    AS exact_identity_url,
  snapshot.captured_at
FROM app.hkb_dynasty_snapshot_history AS snapshot
JOIN latest_capture USING (capture_id)
LEFT JOIN core.hkb_exact_identity AS identity
  USING (hkb_player_id)
LEFT JOIN core.hkb_identity_backfill_attempt AS backfill
  USING (hkb_player_id)
WHERE identity.hkb_player_id IS NULL
  AND (
    backfill.hkb_player_id IS NULL
    OR (
      backfill.status = 'retryable'
      AND backfill.next_attempt_at <= now()
    )
  )
ORDER BY
  backfill.last_attempted_at ASC NULLS FIRST,
  snapshot.active DESC NULLS LAST,
  snapshot.prospect_rank ASC NULLS LAST,
  snapshot.overall_rank ASC,
  snapshot.hkb_player_id;

COMMENT ON TABLE core.hkb_exact_identity IS
  'Fail-closed HarryKnowsBall-to-MLBAM crosswalk observed only from the provider-published mlbId on a player page. Names are diagnostic and never identity keys.';

COMMENT ON TABLE core.hkb_identity_backfill_attempt IS
  'Persistent retry and quarantine state for exact HarryKnowsBall identity evidence. New players are attempted before retries; permanent identity conflicts are quarantined until explicitly reviewed or successfully resolved.';

COMMENT ON VIEW app.hkb_complete_capture IS
  'Atomic HarryKnowsBall capture manifest. A capture is eligible only after rankings and both most-viewed responses have all landed successfully under the same content-derived capture ID.';

COMMENT ON VIEW app.hkb_dynasty_snapshot_history IS
  'Immutable point-in-time HarryKnowsBall dynasty market snapshots projected from retained raw responses. This external crowd signal is not an Oracle model input.';

COMMENT ON MATERIALIZED VIEW app.hkb_current_comparison_signal IS
  'Latest complete HarryKnowsBall Dynasty Score comparison signal. Exact MLBAM identity is nullable until published player-page evidence is captured; name matching is prohibited.';

COMMENT ON VIEW app.hkb_identity_backfill_queue IS
  'Deterministic exact-identity crawl queue. The opaque HKB ID URL redirects to a canonical player page that publishes MLBAM; displayed names are audit context only.';
