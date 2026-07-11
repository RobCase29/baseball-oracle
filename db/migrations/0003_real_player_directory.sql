CREATE OR REPLACE FUNCTION app.jsonb_number(payload jsonb, field_name text)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(payload -> field_name) = 'number'
      THEN (payload ->> field_name)::double precision
    WHEN jsonb_typeof(payload -> field_name) = 'string'
      AND payload ->> field_name ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$'
      THEN (payload ->> field_name)::double precision
    ELSE NULL
  END
$$;

CREATE OR REPLACE VIEW app.prospect_savant_latest_level AS
WITH latest_fetch AS (
  SELECT DISTINCT ON (
    run.parameters #>> '{slice,role}',
    run.parameters #>> '{slice,season}',
    run.parameters #>> '{slice,level}',
    run.parameters #>> '{slice,pitchQualifier}',
    run.parameters #>> '{slice,minAge}',
    run.parameters #>> '{slice,maxAge}'
  )
    source_fetch.id AS fetch_id,
    source_fetch.fetched_at,
    run.parameters #>> '{slice,role}' AS source_role,
    (run.parameters #>> '{slice,season}')::integer AS season,
    run.parameters #>> '{slice,level}' AS level
  FROM raw.ingestion_run AS run
  JOIN raw.fetch AS source_fetch ON source_fetch.run_id = run.id
  JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
  JOIN catalog.source AS source ON source.id = dataset.source_id
  WHERE source.slug = 'prospect-savant'
    AND dataset.dataset_key = 'minor-league-leaders'
    AND run.status = 'succeeded'
    AND run.parser_version = 'prospect-savant-leaders-v1'
    AND run.parameters #>> '{slice,pitchQualifier}' = '1'
    AND run.parameters #>> '{slice,minAge}' = '16'
    AND run.parameters #>> '{slice,maxAge}' = '40'
  ORDER BY
    run.parameters #>> '{slice,role}',
    run.parameters #>> '{slice,season}',
    run.parameters #>> '{slice,level}',
    run.parameters #>> '{slice,pitchQualifier}',
    run.parameters #>> '{slice,minAge}',
    run.parameters #>> '{slice,maxAge}',
    source_fetch.fetched_at DESC,
    source_fetch.id DESC
),
candidates AS (
  SELECT
    record.id AS raw_record_id,
    latest_fetch.fetched_at AS known_at,
    identity.source_identity_key,
    app.jsonb_number(record.record_json, 'id')::bigint AS prospect_savant_id,
    latest_fetch.source_role,
    latest_fetch.season,
    latest_fetch.level,
    concat_ws(
      ':',
      coalesce(nullif(record.record_json ->> 'aball_src', ''), 'none'),
      coalesce(nullif(record.record_json ->> 'rk_src', ''), 'none')
    ) AS source_variant,
    record.record_json AS payload,
    (
      (nullif(record.record_json ->> 'name', '') IS NOT NULL)::integer * 8
      + (coalesce(record.record_json ->> 'player_info', '') NOT IN ('', '{}', '0'))::integer * 4
      + (coalesce(record.record_json ->> 'MLB_AbbName', '') NOT IN ('', '0'))::integer * 2
      + (nullif(record.record_json ->> 'Position', '') IS NOT NULL)::integer
    ) AS profile_quality,
    CASE
      WHEN latest_fetch.level = 'AAA' THEN true
      WHEN latest_fetch.level = 'A' AND latest_fetch.season <= 2025 THEN true
      WHEN record.record_json ->> 'aball_src' = 'fsl' THEN true
      WHEN record.record_json ->> 'rk_src' = 'cpx' THEN true
      ELSE false
    END AS has_statcast,
    (
      app.jsonb_number(record.record_json, 'pa') IS NOT NULL
      OR app.jsonb_number(record.record_json, 'ip') IS NOT NULL
    ) AS has_traditional,
    CASE
      WHEN record.record_json ->> 'aball_src' = 'agg' THEN 2
      WHEN app.jsonb_number(record.record_json, 'pa') IS NOT NULL
        OR app.jsonb_number(record.record_json, 'ip') IS NOT NULL THEN 1
      ELSE 0
    END AS traditional_priority,
    greatest(
      coalesce(app.jsonb_number(record.record_json, 'pa'), 0),
      coalesce(app.jsonb_number(record.record_json, 'pitches'), 0),
      coalesce(app.jsonb_number(record.record_json, 'total_pitches'), 0)
    ) AS activity_volume
  FROM raw.record AS record
  JOIN latest_fetch ON latest_fetch.fetch_id = record.fetch_id
  CROSS JOIN LATERAL (
    VALUES (
      coalesce(
        'minor:' || nullif(nullif(record.record_json ->> 'MinorMasterId', ''), '0'),
        'mlbam:' || nullif(app.jsonb_number(record.record_json, 'MLBAMId')::bigint, 0)::text,
        'id:' || nullif(app.jsonb_number(record.record_json, 'id')::bigint, 0)::text,
        'path:' || nullif(record.record_json ->> 'UPURL', '')
      )
    )
  ) AS identity(source_identity_key)
  WHERE record.record_type = 'leaders_' || latest_fetch.source_role
    AND record.parser_schema_version = 'prospect-savant-leaders-v1'
    AND identity.source_identity_key IS NOT NULL
),
latest_variant AS (
  SELECT *
  FROM (
    SELECT
      candidates.*,
      row_number() OVER (
        PARTITION BY
          source_identity_key,
          source_role,
          season,
          level,
          source_variant
        ORDER BY known_at DESC, raw_record_id DESC
      ) AS revision_rank
    FROM candidates
  ) AS ranked
  WHERE revision_rank = 1
)
SELECT
  source_identity_key,
  max(prospect_savant_id) AS prospect_savant_id,
  source_role,
  season,
  level,
  max(known_at) AS known_at,
  (
    jsonb_agg(
      payload
      ORDER BY profile_quality DESC, has_statcast DESC,
        activity_volume DESC, known_at DESC
    ) -> 0
  ) AS profile_payload,
  (
    jsonb_agg(payload ORDER BY activity_volume DESC, known_at DESC)
      FILTER (WHERE has_statcast)
  ) -> 0 AS statcast_payload,
  (
    jsonb_agg(
      payload
      ORDER BY traditional_priority DESC, activity_volume DESC, known_at DESC
    )
      FILTER (WHERE has_traditional)
  ) -> 0 AS traditional_payload,
  (
    jsonb_agg(
      payload
      ORDER BY has_statcast DESC, profile_quality DESC,
        activity_volume DESC, known_at DESC
    ) -> 0
  ) AS provider_payload,
  array_agg(DISTINCT source_variant ORDER BY source_variant) AS source_variants,
  array_agg(DISTINCT payload ->> 'MLB_AbbName')
    FILTER (
      WHERE coalesce(payload ->> 'MLB_AbbName', '') NOT IN ('', '0')
    ) AS organization_candidates,
  bool_or(has_statcast) AS has_statcast,
  bool_or(has_traditional) AS has_traditional,
  count(*) > 1 AS has_complementary_rows,
  bool_or(
    app.jsonb_number(payload, 'season')::integer IS DISTINCT FROM season
    OR payload ->> 'level' IS DISTINCT FROM level
  ) AS cohort_mismatch
FROM latest_variant
GROUP BY source_identity_key, source_role, season, level;

CREATE OR REPLACE VIEW app.player_directory AS
WITH complete_season AS (
  SELECT season
  FROM app.prospect_savant_latest_level
  GROUP BY season
  HAVING count(DISTINCT source_role || ':' || level) = 10
  ORDER BY season DESC
  LIMIT 1
),
current_level AS (
  SELECT
    latest.*,
    CASE latest.level
      WHEN 'AAA' THEN 5
      WHEN 'AA' THEN 4
      WHEN 'A+' THEN 3
      WHEN 'A' THEN 2
      WHEN 'Rk' THEN 1
      ELSE 0
    END AS level_rank
  FROM app.prospect_savant_latest_level AS latest
  JOIN complete_season USING (season)
),
coverage AS (
  SELECT
    source_identity_key,
    source_role,
    array_agg(level ORDER BY level_rank DESC) AS levels_observed,
    bool_or(has_statcast) AS has_statcast_any_level,
    bool_or(has_traditional) AS has_traditional_any_level,
    bool_or(has_complementary_rows) AS has_complementary_rows,
    bool_or(cohort_mismatch) AS cohort_mismatch,
    max(known_at) AS latest_known_at
  FROM current_level
  GROUP BY source_identity_key, source_role
),
representative AS (
  SELECT DISTINCT ON (source_identity_key, source_role) *
  FROM current_level
  ORDER BY source_identity_key, source_role, level_rank DESC, known_at DESC
)
SELECT
  'prospect-savant:' || representative.source_identity_key || ':'
    || representative.source_role AS profile_id,
  coalesce(
    app.jsonb_number(representative.profile_payload, 'id')::bigint::text,
    representative.source_identity_key
  ) AS source_player_id,
  CASE representative.source_role
    WHEN 'hitters' THEN 'Hitter'
    ELSE 'Pitcher'
  END AS player_type,
  nullif(representative.profile_payload ->> 'name', '') AS display_name,
  nullif(representative.profile_payload ->> 'MLB_AbbName', '0') AS organization_code,
  nullif(representative.profile_payload ->> 'MLB_FullName', '0') AS organization_name,
  nullif(representative.profile_payload ->> 'Position', '') AS position,
  app.jsonb_number(representative.profile_payload, 'age')::smallint AS age,
  representative.level,
  coverage.levels_observed,
  representative.season,
  nullif(representative.profile_payload ->> 'Bats', '') AS bats,
  nullif(representative.profile_payload ->> 'Throws', '') AS throws,
  nullif(app.jsonb_number(representative.profile_payload, 'MLBAMId')::bigint, 0)
    AS mlbam_id,
  nullif(representative.profile_payload ->> 'MinorMasterId', '') AS minor_master_id,
  nullif(representative.profile_payload ->> 'UPURL', '') AS fangraphs_path,
  representative.known_at AS known_at,
  coverage.latest_known_at,
  representative.has_statcast,
  representative.has_traditional,
  coverage.has_statcast_any_level,
  coverage.has_traditional_any_level,
  coverage.has_complementary_rows,
  coverage.cohort_mismatch,
  representative.source_variants,
  representative.organization_candidates,
  cardinality(representative.organization_candidates) > 1 AS organization_conflict,
  app.jsonb_number(representative.provider_payload, 'pscore') AS ps_score,
  app.jsonb_number(representative.provider_payload, 'score_p') * 100 AS ps_percentile,
  nullif(representative.provider_payload ->> 'fv', '0') AS fangraphs_fv,
  coalesce(
    app.jsonb_number(representative.traditional_payload, 'pa'),
    app.jsonb_number(representative.provider_payload, 'pa')
  ) AS pa,
  coalesce(
    app.jsonb_number(representative.traditional_payload, 'ip'),
    app.jsonb_number(representative.provider_payload, 'ip')
  ) AS ip,
  coalesce(
    app.jsonb_number(representative.statcast_payload, 'pitches'),
    app.jsonb_number(representative.provider_payload, 'pitches')
  ) AS pitches,
  coalesce(app.jsonb_number(representative.traditional_payload, 'ba'), app.jsonb_number(representative.provider_payload, 'ba')) AS ba,
  coalesce(app.jsonb_number(representative.traditional_payload, 'obp'), app.jsonb_number(representative.provider_payload, 'obp')) AS obp,
  coalesce(app.jsonb_number(representative.traditional_payload, 'slg'), app.jsonb_number(representative.provider_payload, 'slg')) AS slg,
  coalesce(app.jsonb_number(representative.traditional_payload, 'iso'), app.jsonb_number(representative.provider_payload, 'iso')) AS iso,
  coalesce(app.jsonb_number(representative.provider_payload, 'woba'), app.jsonb_number(representative.traditional_payload, 'woba')) AS woba,
  app.jsonb_number(representative.statcast_payload, 'xwoba') AS xwoba,
  app.jsonb_number(representative.statcast_payload, 'ev') AS ev,
  app.jsonb_number(representative.statcast_payload, 'ev90') AS ev90,
  app.jsonb_number(representative.statcast_payload, 'maxev') AS max_ev,
  app.jsonb_number(representative.statcast_payload, 'hhrate') AS hard_hit_rate,
  app.jsonb_number(representative.statcast_payload, 'barrelbbe') AS barrel_rate,
  coalesce(app.jsonb_number(representative.statcast_payload, 'chaserate'), app.jsonb_number(representative.provider_payload, 'chaserate')) AS chase_rate,
  coalesce(app.jsonb_number(representative.statcast_payload, 'whiffrate'), app.jsonb_number(representative.provider_payload, 'whiffrate')) AS whiff_rate,
  coalesce(app.jsonb_number(representative.statcast_payload, 'zcontact'), app.jsonb_number(representative.provider_payload, 'zcontact')) AS zone_contact_rate,
  coalesce(app.jsonb_number(representative.statcast_payload, 'swstr'), app.jsonb_number(representative.provider_payload, 'swstr')) AS swinging_strike_rate,
  coalesce(app.jsonb_number(representative.traditional_payload, 'krate'), app.jsonb_number(representative.provider_payload, 'krate')) AS strikeout_rate,
  coalesce(app.jsonb_number(representative.traditional_payload, 'bbrate'), app.jsonb_number(representative.provider_payload, 'bbrate')) AS walk_rate,
  coalesce(app.jsonb_number(representative.traditional_payload, 'kbb_rate'), app.jsonb_number(representative.provider_payload, 'kbb_rate')) AS k_minus_bb_rate,
  app.jsonb_number(representative.statcast_payload, 'velocity') AS velocity,
  app.jsonb_number(representative.statcast_payload, 'max_velo') AS max_velocity,
  app.jsonb_number(representative.statcast_payload, 'spin_rate') AS spin_rate,
  app.jsonb_number(representative.provider_payload, 'woba_p') * 100 AS woba_percentile,
  app.jsonb_number(representative.provider_payload, 'xwoba_p') * 100 AS xwoba_percentile,
  app.jsonb_number(representative.provider_payload, 'ev_p') * 100 AS ev_percentile,
  app.jsonb_number(representative.provider_payload, 'ev90_p') * 100 AS ev90_percentile,
  app.jsonb_number(representative.provider_payload, 'maxev_p') * 100 AS max_ev_percentile,
  app.jsonb_number(representative.provider_payload, 'hhrate_p') * 100 AS hard_hit_percentile,
  app.jsonb_number(representative.provider_payload, 'barrelbbe_p') * 100 AS barrel_percentile,
  app.jsonb_number(representative.provider_payload, 'chaserate_p') * 100 AS chase_percentile,
  app.jsonb_number(representative.provider_payload, 'whiffrate_p') * 100 AS whiff_percentile,
  app.jsonb_number(representative.provider_payload, 'zcontact_p') * 100 AS zone_contact_percentile,
  app.jsonb_number(representative.provider_payload, 'swstr_p') * 100 AS swinging_strike_percentile,
  app.jsonb_number(representative.provider_payload, 'krate_p') * 100 AS strikeout_percentile,
  app.jsonb_number(representative.provider_payload, 'bbrate_p') * 100 AS walk_percentile,
  app.jsonb_number(representative.provider_payload, 'kbb_p') * 100 AS k_minus_bb_percentile,
  app.jsonb_number(representative.provider_payload, 'velo_p') * 100 AS velocity_percentile,
  app.jsonb_number(representative.provider_payload, 'age_p') * 100 AS age_percentile
FROM representative
JOIN coverage USING (source_identity_key, source_role)
WHERE nullif(representative.profile_payload ->> 'name', '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS record_ps_lookup_idx
  ON raw.record (
    record_type,
    (record_json ->> 'id'),
    (record_json ->> 'season'),
    (record_json ->> 'level'),
    fetch_id
  )
  WHERE parser_schema_version = 'prospect-savant-leaders-v1';

CREATE INDEX IF NOT EXISTS fetch_run_fetched_idx
  ON raw.fetch (run_id, fetched_at DESC, id);

CREATE INDEX IF NOT EXISTS record_ps_fetch_idx
  ON raw.record (fetch_id, record_type)
  WHERE parser_schema_version = 'prospect-savant-leaders-v1';

COMMENT ON VIEW app.player_directory IS
  'Allowlisted latest complete-season Prospect Savant player-role profiles at each player''s highest observed level. Source observations only; no current assignment or Oracle forecast is implied.';
