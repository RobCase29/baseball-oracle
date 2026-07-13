CREATE MATERIALIZED VIEW app.fangraphs_current_scouting_snapshot AS
WITH eligible_fetch AS (
  SELECT
    source_fetch.id AS fetch_id,
    source_fetch.fetched_at AS known_at,
    run.finished_at,
    (run.parameters ->> 'season')::integer AS report_season,
    run.parameters ->> 'statsRole' AS stats_side
  FROM raw.ingestion_run AS run
  JOIN raw.fetch AS source_fetch ON source_fetch.run_id = run.id
  JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
  JOIN catalog.source AS source ON source.id = dataset.source_id
  WHERE source.slug = 'fangraphs'
    AND dataset.dataset_key = 'prospect-board'
    AND run.status = 'succeeded'
    AND run.parser_version = 'fangraphs-prospect-board-v2'
    AND run.parameters ->> 'refreshScope' = 'current_prospect_board'
    AND run.parameters ->> 'statsRole' IN ('bat', 'pit')
    AND run.parameters ->> 'season' ~ '^[0-9]{4}$'
),
complete_season AS (
  SELECT report_season
  FROM eligible_fetch
  GROUP BY report_season
  HAVING count(DISTINCT stats_side) = 2
  ORDER BY report_season DESC
  LIMIT 1
),
latest_fetch AS (
  SELECT DISTINCT ON (eligible_fetch.stats_side)
    eligible_fetch.fetch_id,
    eligible_fetch.known_at,
    eligible_fetch.report_season,
    eligible_fetch.stats_side
  FROM eligible_fetch
  JOIN complete_season USING (report_season)
  ORDER BY
    eligible_fetch.stats_side,
    eligible_fetch.known_at DESC,
    eligible_fetch.finished_at DESC NULLS LAST,
    eligible_fetch.fetch_id DESC
),
scouting AS (
  SELECT
    latest_fetch.stats_side,
    latest_fetch.report_season,
    latest_fetch.known_at,
    raw_record.id AS scouting_raw_record_id,
    coalesce(
      nullif(raw_record.record_json ->> 'UPID', ''),
      nullif(raw_record.record_json ->> 'PlayerId', '')
    ) AS fangraphs_id,
    coalesce(
      nullif(raw_record.record_json ->> 'minorMasterId', ''),
      nullif(raw_record.record_json ->> 'minormasterid', '')
    ) AS minor_master_id,
    raw_record.record_json AS scouting_payload
  FROM latest_fetch
  JOIN raw.record AS raw_record ON raw_record.fetch_id = latest_fetch.fetch_id
  WHERE raw_record.record_type = 'scout'
    AND raw_record.parser_schema_version = 'fangraphs-prospect-board-v2'
),
identified_scouting AS (
  SELECT *
  FROM scouting
  WHERE fangraphs_id IS NOT NULL
    AND minor_master_id IS NOT NULL
),
statistics AS (
  SELECT
    latest_fetch.stats_side,
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
    raw_record.record_json AS statistics_payload
  FROM latest_fetch
  JOIN raw.record AS raw_record ON raw_record.fetch_id = latest_fetch.fetch_id
  WHERE raw_record.record_type = 'stats'
    AND raw_record.parser_schema_version = 'fangraphs-prospect-board-v2'
),
joined AS (
  SELECT
    identified_scouting.*,
    statistics.mlbam_id,
    statistics.statistics_payload
  FROM identified_scouting
  LEFT JOIN statistics USING (stats_side, fangraphs_id, minor_master_id)
)
SELECT
  joined.mlbam_id,
  joined.fangraphs_id,
  joined.minor_master_id,
  CASE joined.stats_side WHEN 'bat' THEN 'Hitter' ELSE 'Pitcher' END
    AS source_role,
  coalesce(
    nullif(joined.scouting_payload ->> 'playerName', ''),
    nullif(
      concat_ws(
        ' ',
        nullif(joined.scouting_payload ->> 'FirstName', ''),
        nullif(joined.scouting_payload ->> 'LastName', '')
      ),
      ''
    )
  ) AS player_name,
  nullif(joined.scouting_payload ->> 'Team', '') AS organization_code,
  nullif(joined.scouting_payload ->> 'Position', '') AS position,
  joined.report_season,
  app.jsonb_number(joined.scouting_payload, 'Org_Rank')::integer AS org_rank,
  app.jsonb_number(joined.scouting_payload, 'Ovr_Rank')::integer AS overall_rank,
  coalesce(
    nullif(joined.scouting_payload ->> 'FV_Current', ''),
    nullif(joined.scouting_payload ->> 'cFV', '')
  ) AS future_value,
  app.jsonb_number(joined.scouting_payload, 'ETA_Current')::integer AS eta,
  app.jsonb_number(joined.scouting_payload, 'pHit')::smallint AS present_hit,
  app.jsonb_number(joined.scouting_payload, 'fHit')::smallint AS future_hit,
  app.jsonb_number(joined.scouting_payload, 'pGame')::smallint AS present_game_power,
  app.jsonb_number(joined.scouting_payload, 'fGame')::smallint AS future_game_power,
  app.jsonb_number(joined.scouting_payload, 'pRaw')::smallint AS present_raw_power,
  app.jsonb_number(joined.scouting_payload, 'fRaw')::smallint AS future_raw_power,
  app.jsonb_number(joined.scouting_payload, 'pSpd')::smallint AS present_speed,
  app.jsonb_number(joined.scouting_payload, 'fSpd')::smallint AS future_speed,
  app.jsonb_number(joined.scouting_payload, 'pFld')::smallint AS present_fielding,
  app.jsonb_number(joined.scouting_payload, 'fFld')::smallint AS future_fielding,
  app.jsonb_number(joined.scouting_payload, 'pArm')::smallint AS present_arm,
  app.jsonb_number(joined.scouting_payload, 'fArm')::smallint AS future_arm,
  app.jsonb_number(joined.scouting_payload, 'pFB')::smallint AS present_fastball,
  app.jsonb_number(joined.scouting_payload, 'fFB')::smallint AS future_fastball,
  app.jsonb_number(joined.scouting_payload, 'pSL')::smallint AS present_slider,
  app.jsonb_number(joined.scouting_payload, 'fSL')::smallint AS future_slider,
  app.jsonb_number(joined.scouting_payload, 'pCB')::smallint AS present_curveball,
  app.jsonb_number(joined.scouting_payload, 'fCB')::smallint AS future_curveball,
  app.jsonb_number(joined.scouting_payload, 'pCH')::smallint AS present_changeup,
  app.jsonb_number(joined.scouting_payload, 'fCH')::smallint AS future_changeup,
  app.jsonb_number(joined.scouting_payload, 'pSPL')::smallint AS present_splitter,
  app.jsonb_number(joined.scouting_payload, 'fSPL')::smallint AS future_splitter,
  app.jsonb_number(joined.scouting_payload, 'pCT')::smallint AS present_cutter,
  app.jsonb_number(joined.scouting_payload, 'fCT')::smallint AS future_cutter,
  app.jsonb_number(joined.scouting_payload, 'pCMD')::smallint AS present_command,
  app.jsonb_number(joined.scouting_payload, 'fCMD')::smallint AS future_command,
  app.jsonb_number(joined.scouting_payload, 'Bat_Ctrl')::smallint AS bat_control,
  app.jsonb_number(joined.scouting_payload, 'Pitch_Sel')::smallint AS pitch_selection,
  nullif(joined.statistics_payload ->> 'level', '') AS stats_level,
  app.jsonb_number(joined.statistics_payload, 'PA') AS stats_pa,
  app.jsonb_number(joined.statistics_payload, 'IP') AS stats_ip,
  joined.known_at
FROM joined;

CREATE UNIQUE INDEX fangraphs_current_scouting_role_upid_uidx
  ON app.fangraphs_current_scouting_snapshot (source_role, fangraphs_id);

CREATE UNIQUE INDEX fangraphs_current_scouting_role_minor_uidx
  ON app.fangraphs_current_scouting_snapshot (source_role, minor_master_id);

CREATE UNIQUE INDEX fangraphs_current_scouting_role_mlbam_uidx
  ON app.fangraphs_current_scouting_snapshot (source_role, mlbam_id)
  WHERE mlbam_id IS NOT NULL;

CREATE INDEX fangraphs_current_scouting_mlbam_idx
  ON app.fangraphs_current_scouting_snapshot (mlbam_id)
  WHERE mlbam_id IS NOT NULL;

CREATE INDEX fangraphs_current_scouting_minor_idx
  ON app.fangraphs_current_scouting_snapshot (minor_master_id);

COMMENT ON MATERIALIZED VIEW app.fangraphs_current_scouting_snapshot IS
  'Latest validated current-season FanGraphs scouting record per exact player-role UPID and MinorMaster identity. MLBAM is joined only when the same response carries an exact UPID+MinorMaster pair; names are display fields and never identity keys.';
