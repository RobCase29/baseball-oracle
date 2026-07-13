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
combined AS (
  SELECT
    coalesce(batting.bbref_id, pitching.bbref_id) AS bbref_id,
    coalesce(batting.payload ->> 'player_name', pitching.payload ->> 'player_name')
      AS player_name,
    coalesce(
      app.jsonb_number(batting.payload, 'season'),
      app.jsonb_number(pitching.payload, 'season')
    )::integer AS season,
    CASE
      WHEN batting.bbref_id IS NOT NULL AND pitching.bbref_id IS NOT NULL THEN 'Two-way'
      WHEN pitching.bbref_id IS NOT NULL THEN 'Pitcher'
      ELSE 'Hitter'
    END AS observed_role,
    coalesce(batting.payload ->> 'team', pitching.payload ->> 'team') AS team,
    batting.payload ->> 'position' AS position,
    coalesce(
      app.jsonb_number(batting.payload, 'age'),
      app.jsonb_number(pitching.payload, 'age')
    )::smallint AS age,
    app.jsonb_number(batting.payload, 'b_pa') AS b_pa,
    app.jsonb_number(batting.payload, 'b_war') AS b_war,
    pitching.payload ->> 'p_ip' AS p_ip,
    app.jsonb_number(pitching.payload, 'p_ip_outs')::integer AS p_ip_outs,
    app.jsonb_number(pitching.payload, 'p_games')::integer AS p_games,
    app.jsonb_number(pitching.payload, 'p_games_started')::integer AS p_games_started,
    app.jsonb_number(pitching.payload, 'p_war') AS p_war,
    coalesce(app.jsonb_number(batting.payload, 'b_war'), 0)
      + coalesce(app.jsonb_number(pitching.payload, 'p_war'), 0) AS total_war,
    batting.fetched_at AS batting_fetched_at,
    pitching.fetched_at AS pitching_fetched_at,
    greatest(batting.fetched_at, pitching.fetched_at) AS known_at
  FROM batting
  FULL OUTER JOIN pitching USING (bbref_id)
  WHERE coalesce(batting.bbref_id, pitching.bbref_id) IS NOT NULL
)
SELECT
  combined.*,
  CASE
    WHEN count(*) OVER (PARTITION BY observed_role) = 1 THEN 100
    ELSE percent_rank() OVER (
      PARTITION BY observed_role
      ORDER BY total_war
    ) * 100
  END AS current_war_percentile
FROM combined;

CREATE UNIQUE INDEX current_mlb_value_snapshot_bbref_uidx
  ON app.current_mlb_value_snapshot (bbref_id);

CREATE INDEX current_mlb_value_snapshot_season_idx
  ON app.current_mlb_value_snapshot (season, total_war DESC);

COMMENT ON MATERIALIZED VIEW app.current_mlb_value_snapshot IS
  'Latest complete batting and pitching pair from authorized Baseball-Reference current-season value pages. Descriptive evidence only; not a model score.';
