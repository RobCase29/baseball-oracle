CREATE MATERIALIZED VIEW app.fangraphs_current_candidate_census AS
WITH current_snapshot AS (
  SELECT *
  FROM app.fangraphs_current_scouting_snapshot
),
historical_exact_observation AS (
  SELECT
    CASE run.parameters ->> 'statsRole'
      WHEN 'bat' THEN 'Hitter'
      WHEN 'pit' THEN 'Pitcher'
    END AS source_role,
    coalesce(
      nullif(raw_record.record_json ->> 'UPID', ''),
      nullif(raw_record.record_json ->> 'playerids', '')
    ) AS fangraphs_id,
    coalesce(
      nullif(raw_record.record_json ->> 'minormasterid', ''),
      nullif(raw_record.record_json ->> 'minorMasterId', '')
    ) AS minor_master_id,
    nullif(app.jsonb_number(raw_record.record_json, 'xMLBAMID')::bigint, 0)
      AS mlbam_id,
    app.jsonb_number(raw_record.record_json, 'Season')::integer AS stats_season,
    nullif(raw_record.record_json ->> 'level', '') AS stats_level,
    app.jsonb_number(raw_record.record_json, 'PA') AS stats_pa,
    app.jsonb_number(raw_record.record_json, 'IP') AS stats_ip,
    nullif(raw_record.record_json ->> 'UPURL', '') AS fangraphs_path,
    app.jsonb_number(raw_record.record_json, 'Age') AS stats_age,
    source_fetch.fetched_at AS identity_known_at,
    raw_record.id AS raw_record_id
  FROM raw.ingestion_run AS run
  JOIN raw.fetch AS source_fetch ON source_fetch.run_id = run.id
  JOIN raw.record AS raw_record ON raw_record.fetch_id = source_fetch.id
  JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
  JOIN catalog.source AS source ON source.id = dataset.source_id
  WHERE source.slug = 'fangraphs'
    AND dataset.dataset_key = 'prospect-board'
    AND run.status = 'succeeded'
    AND run.parser_version = 'fangraphs-prospect-board-v2'
    AND run.parameters ->> 'refreshScope' = 'current_prospect_board'
    AND run.parameters ->> 'statsRole' IN ('bat', 'pit')
    AND raw_record.record_type = 'stats'
    AND raw_record.parser_schema_version = 'fangraphs-prospect-board-v2'
),
validated_historical_observation AS (
  SELECT historical.*
  FROM historical_exact_observation AS historical
  WHERE historical.source_role IS NOT NULL
    AND historical.fangraphs_id IS NOT NULL
    AND historical.minor_master_id IS NOT NULL
    AND historical.mlbam_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM current_snapshot AS current_row
      WHERE current_row.source_role = historical.source_role
        AND current_row.fangraphs_id = historical.fangraphs_id
        AND current_row.minor_master_id = historical.minor_master_id
        AND current_row.known_at = historical.identity_known_at
    )
),
historical_person_tuple AS (
  SELECT
    fangraphs_id,
    minor_master_id,
    count(DISTINCT mlbam_id)::integer AS historical_mlbam_candidate_count,
    min(mlbam_id) AS historical_candidate_mlbam_id,
    count(*)::integer AS historical_identity_observations,
    max(identity_known_at) AS historical_identity_known_at
  FROM validated_historical_observation
  GROUP BY fangraphs_id, minor_master_id
),
latest_historical_observation AS (
  SELECT DISTINCT ON (
    source_role,
    fangraphs_id,
    minor_master_id,
    mlbam_id
  )
    source_role,
    fangraphs_id,
    minor_master_id,
    mlbam_id,
    stats_season AS historical_stats_season,
    stats_level AS historical_stats_level,
    stats_pa AS historical_stats_pa,
    stats_ip AS historical_stats_ip,
    fangraphs_path AS historical_fangraphs_path,
    stats_age AS historical_stats_age
  FROM validated_historical_observation
  ORDER BY
    source_role,
    fangraphs_id,
    minor_master_id,
    mlbam_id,
    identity_known_at DESC,
    raw_record_id DESC
),
current_person_tuple AS (
  SELECT
    fangraphs_id,
    minor_master_id,
    count(DISTINCT mlbam_id)::integer AS current_mlbam_candidate_count,
    min(mlbam_id) AS current_candidate_mlbam_id
  FROM current_snapshot
  GROUP BY fangraphs_id, minor_master_id
),
resolution_input AS (
  SELECT
    current_row.*,
    current_person.current_mlbam_candidate_count,
    current_person.current_candidate_mlbam_id,
    coalesce(historical_person.historical_mlbam_candidate_count, 0)
      AS historical_mlbam_candidate_count,
    historical_person.historical_candidate_mlbam_id,
    coalesce(historical_person.historical_identity_observations, 0)
      AS historical_identity_observations,
    historical_person.historical_identity_known_at,
    latest_history.historical_stats_season,
    latest_history.historical_stats_level,
    latest_history.historical_stats_pa,
    latest_history.historical_stats_ip,
    latest_history.historical_fangraphs_path,
    latest_history.historical_stats_age,
    CASE
      WHEN current_person.current_mlbam_candidate_count = 1
        AND current_row.mlbam_id IS NOT NULL
        THEN current_row.mlbam_id
      WHEN current_person.current_mlbam_candidate_count = 0
        AND historical_person.historical_mlbam_candidate_count = 1
        THEN historical_person.historical_candidate_mlbam_id
      ELSE NULL
    END AS candidate_mlbam_id
  FROM current_snapshot AS current_row
  JOIN current_person_tuple AS current_person
    USING (fangraphs_id, minor_master_id)
  LEFT JOIN historical_person_tuple AS historical_person
    USING (fangraphs_id, minor_master_id)
  LEFT JOIN latest_historical_observation AS latest_history
    ON latest_history.source_role = current_row.source_role
    AND latest_history.fangraphs_id = current_row.fangraphs_id
    AND latest_history.minor_master_id = current_row.minor_master_id
    AND latest_history.mlbam_id = historical_person.historical_candidate_mlbam_id
    AND historical_person.historical_mlbam_candidate_count = 1
),
candidate_mlbam_multiplicity AS (
  SELECT
    candidate_mlbam_id,
    count(DISTINCT (fangraphs_id, minor_master_id))::integer
      AS candidate_mlbam_person_tuples
  FROM resolution_input
  WHERE candidate_mlbam_id IS NOT NULL
  GROUP BY candidate_mlbam_id
),
classified AS (
  SELECT
    resolution_input.*,
    coalesce(candidate_multiplicity.candidate_mlbam_person_tuples, 0)
      AS candidate_mlbam_person_tuples,
    CASE
      WHEN resolution_input.current_mlbam_candidate_count > 1
        THEN 'current_tuple_conflict'
      WHEN resolution_input.historical_mlbam_candidate_count > 1
        THEN 'historical_tuple_conflict'
      WHEN resolution_input.current_mlbam_candidate_count = 1
        AND resolution_input.historical_mlbam_candidate_count = 1
        AND resolution_input.current_candidate_mlbam_id
          IS DISTINCT FROM resolution_input.historical_candidate_mlbam_id
        THEN 'current_history_conflict'
      WHEN candidate_multiplicity.candidate_mlbam_person_tuples > 1
        THEN 'historical_census_conflict'
      WHEN resolution_input.mlbam_id IS NOT NULL
        AND resolution_input.current_mlbam_candidate_count = 1
        THEN 'current_exact'
      WHEN resolution_input.mlbam_id IS NULL
        AND resolution_input.current_mlbam_candidate_count = 0
        AND resolution_input.historical_mlbam_candidate_count = 1
        THEN 'historical_exact'
      ELSE 'unresolved'
    END AS mlbam_resolution_status
  FROM resolution_input
  LEFT JOIN candidate_mlbam_multiplicity AS candidate_multiplicity
    USING (candidate_mlbam_id)
)
SELECT
  classified.*,
  CASE classified.mlbam_resolution_status
    WHEN 'current_exact' THEN classified.mlbam_id
    WHEN 'historical_exact' THEN classified.historical_candidate_mlbam_id
    ELSE NULL
  END AS resolved_mlbam_id,
  classified.mlbam_resolution_status IN (
    'current_tuple_conflict',
    'historical_tuple_conflict',
    'current_history_conflict',
    'historical_census_conflict'
  ) AS mlbam_resolution_conflict
FROM classified;

CREATE UNIQUE INDEX fangraphs_current_candidate_role_upid_uidx
  ON app.fangraphs_current_candidate_census (source_role, fangraphs_id);

CREATE UNIQUE INDEX fangraphs_current_candidate_role_minor_uidx
  ON app.fangraphs_current_candidate_census (source_role, minor_master_id);

CREATE UNIQUE INDEX fangraphs_current_candidate_role_mlbam_uidx
  ON app.fangraphs_current_candidate_census (source_role, resolved_mlbam_id)
  WHERE resolved_mlbam_id IS NOT NULL;

CREATE INDEX fangraphs_current_candidate_resolution_idx
  ON app.fangraphs_current_candidate_census (mlbam_resolution_status);

COMMENT ON MATERIALIZED VIEW app.fangraphs_current_candidate_census IS
  'Current FanGraphs scouting census with fail-closed MLBAM resolution. Current and prior validated identities are aggregated across roles for the exact UPID and MinorMaster person tuple. Role remains a statistics dimension only. Conflicting current roles, historical observations, current-versus-history identities, or current-census person tuples retain a null resolved MLBAM. Names are never identity keys.';
