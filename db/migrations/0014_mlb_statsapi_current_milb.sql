CREATE OR REPLACE VIEW app.mlb_statsapi_milb_latest_level AS
WITH latest_fetch AS (
  SELECT DISTINCT ON (
    run.parameters #>> '{slice,role}',
    run.parameters #>> '{slice,season}',
    run.parameters #>> '{slice,level}',
    run.parameters #>> '{slice,sportId}'
  )
    source_fetch.id AS fetch_id,
    source_fetch.fetched_at AS known_at,
    run.parameters #>> '{slice,role}' AS source_role,
    (run.parameters #>> '{slice,season}')::integer AS season,
    run.parameters #>> '{slice,level}' AS level,
    (run.parameters #>> '{slice,sportId}')::integer AS sport_id
  FROM raw.ingestion_run AS run
  JOIN raw.fetch AS source_fetch ON source_fetch.run_id = run.id
  JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
  JOIN catalog.source AS source ON source.id = dataset.source_id
  WHERE source.slug = 'mlb-statsapi'
    AND dataset.dataset_key = 'current-milb-season-stats'
    AND run.status = 'succeeded'
    AND run.parser_version = 'mlb-statsapi-milb-season-v1'
    AND run.parameters #>> '{slice,role}' IN ('hitter', 'pitcher')
    AND run.parameters #>> '{slice,level}' IN ('Rk', 'A', 'A+', 'AA', 'AAA')
    AND run.parameters #>> '{slice,season}' ~ '^[0-9]{4}$'
    AND run.parameters #>> '{slice,sportId}' ~ '^[0-9]+$'
  ORDER BY
    run.parameters #>> '{slice,role}',
    run.parameters #>> '{slice,season}',
    run.parameters #>> '{slice,level}',
    run.parameters #>> '{slice,sportId}',
    source_fetch.fetched_at DESC,
    source_fetch.id DESC
)
SELECT
  record.id AS raw_record_id,
  app.jsonb_number(record.record_json -> 'player', 'id')::bigint AS mlbam_id,
  latest_fetch.source_role,
  latest_fetch.season,
  latest_fetch.level,
  CASE latest_fetch.level
    WHEN 'AAA' THEN 5
    WHEN 'AA' THEN 4
    WHEN 'A+' THEN 3
    WHEN 'A' THEN 2
    WHEN 'Rk' THEN 1
    ELSE 0
  END AS level_rank,
  latest_fetch.sport_id,
  latest_fetch.known_at,
  nullif(record.record_json #>> '{player,fullName}', '') AS display_name,
  coalesce(
    app.jsonb_number(record.record_json -> 'player', 'currentAge'),
    app.jsonb_number(record.record_json -> 'stat', 'age')
  )::smallint AS age,
  CASE jsonb_typeof(record.record_json #> '{player,active}')
    WHEN 'boolean' THEN (record.record_json #>> '{player,active}')::boolean
    ELSE NULL
  END AS active,
  coalesce(
    nullif(record.record_json #>> '{position,abbreviation}', ''),
    nullif(record.record_json #>> '{player,primaryPosition,abbreviation}', '')
  ) AS position,
  nullif(record.record_json #>> '{player,batSide,code}', '') AS bats,
  nullif(record.record_json #>> '{player,pitchHand,code}', '') AS throws,
  app.jsonb_number(record.record_json -> 'team', 'id')::integer AS team_id,
  nullif(record.record_json #>> '{team,name}', '') AS team_name,
  app.jsonb_number(record.record_json -> 'team', 'parentOrgId')::integer
    AS team_parent_org_id,
  nullif(record.record_json #>> '{team,parentOrgName}', '') AS team_parent_org_name,
  app.jsonb_number(record.record_json #> '{player,currentTeam}', 'id')::integer
    AS current_team_id,
  nullif(record.record_json #>> '{player,currentTeam,name}', '') AS current_team_name,
  app.jsonb_number(record.record_json #> '{player,currentTeam}', 'parentOrgId')::integer
    AS current_team_parent_org_id,
  app.jsonb_number(record.record_json -> 'stat', 'gamesPlayed') AS games_played,
  app.jsonb_number(record.record_json -> 'stat', 'gamesStarted') AS games_started,
  app.jsonb_number(record.record_json -> 'stat', 'plateAppearances') AS plate_appearances,
  app.jsonb_number(record.record_json -> 'stat', 'atBats') AS at_bats,
  app.jsonb_number(record.record_json -> 'stat', 'runs') AS runs,
  app.jsonb_number(record.record_json -> 'stat', 'hits') AS hits,
  app.jsonb_number(record.record_json -> 'stat', 'doubles') AS doubles,
  app.jsonb_number(record.record_json -> 'stat', 'triples') AS triples,
  app.jsonb_number(record.record_json -> 'stat', 'homeRuns') AS home_runs,
  app.jsonb_number(record.record_json -> 'stat', 'rbi') AS rbi,
  app.jsonb_number(record.record_json -> 'stat', 'totalBases') AS total_bases,
  app.jsonb_number(record.record_json -> 'stat', 'baseOnBalls') AS walks,
  app.jsonb_number(record.record_json -> 'stat', 'intentionalWalks') AS intentional_walks,
  app.jsonb_number(record.record_json -> 'stat', 'strikeOuts') AS strikeouts,
  app.jsonb_number(record.record_json -> 'stat', 'hitByPitch') AS hit_by_pitch,
  app.jsonb_number(record.record_json -> 'stat', 'stolenBases') AS stolen_bases,
  app.jsonb_number(record.record_json -> 'stat', 'caughtStealing') AS caught_stealing,
  app.jsonb_number(record.record_json -> 'stat', 'sacFlies') AS sacrifice_flies,
  app.jsonb_number(record.record_json -> 'stat', 'sacBunts') AS sacrifice_bunts,
  app.jsonb_number(record.record_json -> 'stat', 'outs') AS outs,
  app.jsonb_number(record.record_json -> 'stat', 'battersFaced') AS batters_faced,
  app.jsonb_number(record.record_json -> 'stat', 'numberOfPitches') AS pitches,
  app.jsonb_number(record.record_json -> 'stat', 'strikes') AS strikes,
  app.jsonb_number(record.record_json -> 'stat', 'earnedRuns') AS earned_runs,
  app.jsonb_number(record.record_json -> 'stat', 'hitBatsmen') AS hit_batsmen,
  app.jsonb_number(record.record_json -> 'stat', 'wins') AS wins,
  app.jsonb_number(record.record_json -> 'stat', 'losses') AS losses,
  app.jsonb_number(record.record_json -> 'stat', 'saves') AS saves,
  app.jsonb_number(record.record_json -> 'stat', 'holds') AS holds,
  record.record_json -> 'stat' AS source_stat
FROM raw.record AS record
JOIN latest_fetch ON latest_fetch.fetch_id = record.fetch_id
WHERE record.parser_schema_version = 'mlb-statsapi-milb-season-v1'
  AND record.record_type = 'milb_season_' || latest_fetch.source_role
  AND app.jsonb_number(record.record_json -> 'player', 'id') > 0
  AND app.jsonb_number(record.record_json -> 'sport', 'id') = latest_fetch.sport_id
  AND app.jsonb_number(record.record_json, 'season') = latest_fetch.season;

CREATE INDEX IF NOT EXISTS record_mlb_statsapi_milb_fetch_idx
  ON raw.record (fetch_id, record_type)
  WHERE parser_schema_version = 'mlb-statsapi-milb-season-v1';

CREATE MATERIALIZED VIEW app.current_milb_traditional_snapshot AS
WITH selected_cohort AS (
  SELECT DISTINCT ON (level)
    level,
    season
  FROM app.mlb_statsapi_milb_latest_level
  GROUP BY level, season
  HAVING count(DISTINCT source_role) = 2
  ORDER BY level, season DESC
),
current_level_rows AS (
  SELECT latest.*
  FROM app.mlb_statsapi_milb_latest_level AS latest
  JOIN selected_cohort USING (level, season)
),
summary AS (
  SELECT
    mlbam_id,
    source_role,
    min(known_at) AS earliest_known_at,
    max(known_at) AS known_at,
    array_agg(level ORDER BY level_rank DESC, season DESC) AS levels_observed,
    array_agg(season ORDER BY level_rank DESC, season DESC) AS level_seasons,
    array_agg(DISTINCT season ORDER BY season DESC) AS seasons_observed,
    jsonb_agg(
      jsonb_build_object(
        'season', season,
        'level', level,
        'sportId', sport_id,
        'teamId', team_id,
        'teamName', team_name,
        'knownAt', known_at,
        'stat', source_stat
      )
      ORDER BY level_rank DESC, season DESC
    ) AS level_splits,
    sum(coalesce(games_played, 0)) AS games_played,
    sum(coalesce(games_started, 0)) AS games_started,
    sum(coalesce(plate_appearances, 0)) AS plate_appearances,
    sum(coalesce(at_bats, 0)) AS at_bats,
    sum(coalesce(runs, 0)) AS runs,
    sum(coalesce(hits, 0)) AS hits,
    sum(coalesce(doubles, 0)) AS doubles,
    sum(coalesce(triples, 0)) AS triples,
    sum(coalesce(home_runs, 0)) AS home_runs,
    sum(coalesce(rbi, 0)) AS rbi,
    sum(coalesce(total_bases, 0)) AS total_bases,
    sum(coalesce(walks, 0)) AS walks,
    sum(coalesce(intentional_walks, 0)) AS intentional_walks,
    sum(coalesce(strikeouts, 0)) AS strikeouts,
    sum(coalesce(hit_by_pitch, 0)) AS hit_by_pitch,
    sum(coalesce(stolen_bases, 0)) AS stolen_bases,
    sum(coalesce(caught_stealing, 0)) AS caught_stealing,
    sum(coalesce(sacrifice_flies, 0)) AS sacrifice_flies,
    sum(coalesce(sacrifice_bunts, 0)) AS sacrifice_bunts,
    sum(coalesce(outs, 0)) AS outs,
    sum(coalesce(batters_faced, 0)) AS batters_faced,
    sum(coalesce(pitches, 0)) AS pitches,
    sum(coalesce(strikes, 0)) AS strikes,
    sum(coalesce(earned_runs, 0)) AS earned_runs,
    sum(coalesce(hit_batsmen, 0)) AS hit_batsmen,
    sum(coalesce(wins, 0)) AS wins,
    sum(coalesce(losses, 0)) AS losses,
    sum(coalesce(saves, 0)) AS saves,
    sum(coalesce(holds, 0)) AS holds
  FROM current_level_rows
  GROUP BY mlbam_id, source_role
),
representative AS (
  SELECT DISTINCT ON (mlbam_id, source_role)
    *
  FROM current_level_rows
  ORDER BY mlbam_id, source_role, level_rank DESC, season DESC, known_at DESC
),
latest_identity AS (
  SELECT DISTINCT ON (mlbam_id, source_role)
    mlbam_id,
    source_role,
    display_name,
    age,
    active,
    position,
    bats,
    throws,
    current_team_id,
    current_team_name,
    current_team_parent_org_id
  FROM current_level_rows
  ORDER BY mlbam_id, source_role, known_at DESC, level_rank DESC
),
current_assignment AS (
  SELECT DISTINCT ON (mlbam_id, source_role)
    mlbam_id,
    source_role,
    level AS current_level,
    season AS current_level_season
  FROM current_level_rows
  WHERE current_team_id = team_id
  ORDER BY mlbam_id, source_role, known_at DESC, level_rank DESC
)
SELECT
  'mlb-statsapi:' || summary.mlbam_id::text || ':' || summary.source_role AS profile_id,
  'MLB StatsAPI'::text AS source_name,
  'current-milb-season-stats'::text AS dataset_key,
  summary.mlbam_id,
  CASE summary.source_role WHEN 'hitter' THEN 'Hitter' ELSE 'Pitcher' END AS player_type,
  latest_identity.display_name,
  latest_identity.age,
  latest_identity.active,
  latest_identity.position,
  latest_identity.bats,
  latest_identity.throws,
  representative.level AS highest_observed_level,
  representative.season AS highest_observed_level_season,
  representative.team_id AS highest_observed_team_id,
  representative.team_name AS highest_observed_team_name,
  representative.team_parent_org_id AS highest_observed_organization_mlbam_id,
  representative.team_parent_org_name AS highest_observed_organization_name,
  current_assignment.current_level,
  current_assignment.current_level_season,
  latest_identity.current_team_id,
  latest_identity.current_team_name,
  coalesce(
    latest_identity.current_team_parent_org_id,
    representative.team_parent_org_id
  ) AS organization_mlbam_id,
  CASE
    WHEN latest_identity.current_team_parent_org_id IS NULL
      OR latest_identity.current_team_parent_org_id = representative.team_parent_org_id
      THEN representative.team_parent_org_name
    ELSE NULL
  END AS organization_name,
  summary.levels_observed,
  summary.level_seasons,
  summary.seasons_observed,
  summary.level_splits,
  summary.earliest_known_at,
  summary.known_at,
  summary.games_played::integer AS games_played,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.plate_appearances::integer ELSE NULL END AS pa,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.at_bats::integer ELSE NULL END AS ab,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.runs::integer ELSE NULL END AS runs,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.hits::integer ELSE NULL END AS hits,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.doubles::integer ELSE NULL END AS doubles,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.triples::integer ELSE NULL END AS triples,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.home_runs::integer ELSE NULL END AS home_runs,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.rbi::integer ELSE NULL END AS rbi,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.walks::integer ELSE NULL END AS walks,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.intentional_walks::integer ELSE NULL END AS intentional_walks,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.strikeouts::integer ELSE NULL END AS strikeouts,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.hit_by_pitch::integer ELSE NULL END AS hit_by_pitch,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.stolen_bases::integer ELSE NULL END AS stolen_bases,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.caught_stealing::integer ELSE NULL END AS caught_stealing,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.hits / nullif(summary.at_bats, 0) ELSE NULL END AS ba,
  CASE WHEN summary.source_role = 'hitter'
    THEN (summary.hits + summary.walks + summary.hit_by_pitch)
      / nullif(
        summary.at_bats + summary.walks + summary.hit_by_pitch + summary.sacrifice_flies,
        0
      )
    ELSE NULL END AS obp,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.total_bases / nullif(summary.at_bats, 0) ELSE NULL END AS slg,
  CASE WHEN summary.source_role = 'hitter'
    THEN (
      (summary.hits + summary.walks + summary.hit_by_pitch)
        / nullif(
          summary.at_bats + summary.walks + summary.hit_by_pitch + summary.sacrifice_flies,
          0
        )
      + summary.total_bases / nullif(summary.at_bats, 0)
    )
    ELSE NULL END AS ops,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.strikeouts / nullif(summary.plate_appearances, 0) ELSE NULL END
    AS strikeout_rate,
  CASE WHEN summary.source_role = 'hitter'
    THEN summary.walks / nullif(summary.plate_appearances, 0) ELSE NULL END AS walk_rate,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.games_started::integer ELSE NULL END AS games_started,
  CASE WHEN summary.source_role = 'pitcher'
    THEN round((summary.outs / 3.0)::numeric, 2)::double precision ELSE NULL END AS ip,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.outs::integer ELSE NULL END AS outs,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.batters_faced::integer ELSE NULL END AS batters_faced,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.pitches::integer ELSE NULL END AS pitches,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.strikes::integer ELSE NULL END AS strikes,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.hits::integer ELSE NULL END AS hits_allowed,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.walks::integer ELSE NULL END AS walks_allowed,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.strikeouts::integer ELSE NULL END AS pitching_strikeouts,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.home_runs::integer ELSE NULL END AS home_runs_allowed,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.earned_runs::integer ELSE NULL END AS earned_runs,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.hit_batsmen::integer ELSE NULL END AS hit_batsmen,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.wins::integer ELSE NULL END AS wins,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.losses::integer ELSE NULL END AS losses,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.saves::integer ELSE NULL END AS saves,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.holds::integer ELSE NULL END AS holds,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.earned_runs * 27.0 / nullif(summary.outs, 0) ELSE NULL END AS era,
  CASE WHEN summary.source_role = 'pitcher'
    THEN (summary.walks + summary.hits) * 3.0 / nullif(summary.outs, 0) ELSE NULL END
    AS whip,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.strikeouts / nullif(summary.batters_faced, 0) ELSE NULL END
    AS pitching_strikeout_rate,
  CASE WHEN summary.source_role = 'pitcher'
    THEN summary.walks / nullif(summary.batters_faced, 0) ELSE NULL END
    AS pitching_walk_rate,
  CASE WHEN summary.source_role = 'pitcher'
    THEN (summary.strikeouts - summary.walks) / nullif(summary.batters_faced, 0)
    ELSE NULL END AS k_minus_bb_rate
FROM summary
JOIN representative USING (mlbam_id, source_role)
JOIN latest_identity USING (mlbam_id, source_role)
LEFT JOIN current_assignment USING (mlbam_id, source_role);

CREATE UNIQUE INDEX current_milb_traditional_profile_uidx
  ON app.current_milb_traditional_snapshot (profile_id);

CREATE INDEX current_milb_traditional_mlbam_idx
  ON app.current_milb_traditional_snapshot (mlbam_id, player_type);

CREATE INDEX current_milb_traditional_level_idx
  ON app.current_milb_traditional_snapshot (highest_observed_level, player_type);

COMMENT ON VIEW app.mlb_statsapi_milb_latest_level IS
  'Latest successfully landed official MLB StatsAPI MiLB season split per level and role. Identity is exact MLBAM only.';

COMMENT ON MATERIALIZED VIEW app.current_milb_traditional_snapshot IS
  'Current official MiLB traditional-stat backstop aggregated across observed levels by exact MLBAM and role. current_level is populated only when the hydrated current team matches an observed MiLB split; highest_observed_level is not claimed as a current assignment.';
