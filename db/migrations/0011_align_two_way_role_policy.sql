DROP MATERIALIZED VIEW app.current_mlb_value_snapshot;

CREATE MATERIALIZED VIEW app.current_mlb_value_snapshot AS
WITH latest_fetch AS (
  SELECT DISTINCT ON (
    (run.parameters ->> 'season')::integer,
    run.parameters ->> 'side'
  )
    source_fetch.id AS fetch_id,
    source_fetch.fetched_at,
    (run.parameters ->> 'season')::integer AS season,
    run.parameters ->> 'side' AS side
  FROM raw.ingestion_run AS run
  JOIN raw.fetch AS source_fetch ON source_fetch.run_id = run.id
  JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
  JOIN catalog.source AS source ON source.id = dataset.source_id
  WHERE source.slug = 'sports-reference'
    AND dataset.dataset_key = 'baseball-player-records'
    AND run.status = 'succeeded'
    AND run.parser_version = 'baseball-reference-current-value/v1'
    AND run.parameters ->> 'side' IN ('batting', 'pitching')
  ORDER BY
    (run.parameters ->> 'season')::integer,
    run.parameters ->> 'side',
    source_fetch.fetched_at DESC,
    run.finished_at DESC NULLS LAST,
    source_fetch.id DESC
),
paired_season AS (
  SELECT season
  FROM latest_fetch
  GROUP BY season
  HAVING count(DISTINCT side) = 2
  ORDER BY season DESC
  LIMIT 1
),
selected_fetch AS (
  SELECT latest_fetch.*
  FROM latest_fetch
  JOIN paired_season USING (season)
),
batting AS (
  SELECT
    record.record_json ->> 'bbref_id' AS bbref_id,
    record.record_json AS payload,
    selected_fetch.fetched_at
  FROM selected_fetch
  JOIN raw.record AS record ON record.fetch_id = selected_fetch.fetch_id
  WHERE selected_fetch.side = 'batting'
    AND record.record_type = 'current_value_batting'
),
pitching AS (
  SELECT
    record.record_json ->> 'bbref_id' AS bbref_id,
    record.record_json AS payload,
    selected_fetch.fetched_at
  FROM selected_fetch
  JOIN raw.record AS record ON record.fetch_id = selected_fetch.fetch_id
  WHERE selected_fetch.side = 'pitching'
    AND record.record_type = 'current_value_pitching'
),
components AS (
  SELECT
    coalesce(batting.bbref_id, pitching.bbref_id) AS bbref_id,
    coalesce(batting.payload ->> 'player_name', pitching.payload ->> 'player_name') AS player_name,
    coalesce(
      app.jsonb_number(batting.payload, 'season'),
      app.jsonb_number(pitching.payload, 'season')
    )::integer AS season,
    coalesce(batting.payload ->> 'team', pitching.payload ->> 'team') AS team,
    batting.payload ->> 'position' AS position,
    coalesce(
      app.jsonb_number(batting.payload, 'age'),
      app.jsonb_number(pitching.payload, 'age')
    )::smallint AS age,
    app.jsonb_number(batting.payload, 'mlbam_id')::bigint AS batting_mlbam_id,
    app.jsonb_number(pitching.payload, 'mlbam_id')::bigint AS pitching_mlbam_id,
    CASE
      WHEN app.jsonb_number(batting.payload, 'mlbam_id') IS NOT NULL
        AND app.jsonb_number(pitching.payload, 'mlbam_id') IS NOT NULL
        AND app.jsonb_number(batting.payload, 'mlbam_id')
          <> app.jsonb_number(pitching.payload, 'mlbam_id')
        THEN NULL
      ELSE coalesce(
        app.jsonb_number(batting.payload, 'mlbam_id'),
        app.jsonb_number(pitching.payload, 'mlbam_id')
      )::bigint
    END AS mlbam_id,
    app.jsonb_number(batting.payload, 'mlbam_id') IS NOT NULL
      AND app.jsonb_number(pitching.payload, 'mlbam_id') IS NOT NULL
      AND app.jsonb_number(batting.payload, 'mlbam_id')
        <> app.jsonb_number(pitching.payload, 'mlbam_id') AS identity_conflict,
    app.jsonb_number(batting.payload, 'b_pa') AS b_pa,
    app.jsonb_number(batting.payload, 'b_war') AS b_war,
    pitching.payload ->> 'p_ip' AS p_ip,
    app.jsonb_number(pitching.payload, 'p_ip_outs')::integer AS p_ip_outs,
    app.jsonb_number(pitching.payload, 'p_games')::integer AS p_games,
    app.jsonb_number(pitching.payload, 'p_games_started')::integer AS p_games_started,
    app.jsonb_number(pitching.payload, 'p_war') AS p_war,
    batting.bbref_id IS NOT NULL AS has_batting_row,
    pitching.bbref_id IS NOT NULL AS has_pitching_row,
    coalesce(app.jsonb_number(batting.payload, 'b_pa'), 0) >= 60 AS has_substantive_batting,
    coalesce(app.jsonb_number(pitching.payload, 'p_ip_outs'), 0) >= 60 AS has_substantive_pitching,
    coalesce(app.jsonb_number(batting.payload, 'b_war'), 0)
      + coalesce(app.jsonb_number(pitching.payload, 'p_war'), 0) AS total_war,
    batting.fetched_at AS batting_fetched_at,
    pitching.fetched_at AS pitching_fetched_at,
    greatest(batting.fetched_at, pitching.fetched_at) AS known_at
  FROM batting
  FULL OUTER JOIN pitching USING (bbref_id)
  WHERE coalesce(batting.bbref_id, pitching.bbref_id) IS NOT NULL
),
classified AS (
  SELECT
    components.*,
    CASE
      WHEN has_substantive_batting
        AND has_substantive_pitching
        AND least(
          coalesce(b_pa, 0) / 600.0,
          coalesce(p_ip_outs, 0) / 540.0
        ) >= 0.25 * greatest(
          coalesce(b_pa, 0) / 600.0,
          coalesce(p_ip_outs, 0) / 540.0
        )
        THEN 'Two-way'
      WHEN coalesce(p_ip_outs, 0) / 540.0 > coalesce(b_pa, 0) / 600.0
        THEN 'Pitcher'
      ELSE 'Hitter'
    END AS observed_role
  FROM components
),
ranked AS (
  SELECT
    classified.*,
    count(*) OVER (PARTITION BY observed_role) AS role_peer_count,
    percent_rank() OVER (
      PARTITION BY observed_role
      ORDER BY total_war
    ) * 100 AS raw_current_war_percentile
  FROM classified
)
SELECT
  ranked.*,
  CASE
    WHEN role_peer_count < 25 THEN NULL
    ELSE raw_current_war_percentile
  END AS current_war_percentile
FROM ranked;

CREATE UNIQUE INDEX current_mlb_value_snapshot_bbref_uidx
  ON app.current_mlb_value_snapshot (bbref_id);

CREATE INDEX current_mlb_value_snapshot_season_idx
  ON app.current_mlb_value_snapshot (season, total_war DESC);

COMMENT ON MATERIALIZED VIEW app.current_mlb_value_snapshot IS
  'Latest complete Baseball-Reference current-value pair. Exact MLBAM identity is published only when batting and pitching evidence agree. Two-way comparison requires at least 60 PA, 20 IP, and each workload to be at least 25% of the other; nominal cross-page appearances are retained as components but do not define role. Percentiles require at least 25 peers.';
