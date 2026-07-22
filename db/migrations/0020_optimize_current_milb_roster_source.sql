CREATE OR REPLACE VIEW app.mlb_statsapi_current_milb_roster_latest AS
WITH latest_fetch AS MATERIALIZED (
  SELECT
    source_fetch.id AS fetch_id,
    source_fetch.fetched_at AS known_at
  FROM raw.ingestion_run AS run
  JOIN raw.fetch AS source_fetch ON source_fetch.run_id = run.id
  JOIN catalog.dataset AS dataset ON dataset.id = run.dataset_id
  JOIN catalog.source AS source ON source.id = dataset.source_id
  WHERE source.slug = 'mlb-statsapi'
    AND dataset.dataset_key = 'current-milb-rosters'
    AND run.status = 'succeeded'
    AND run.parser_version = 'mlb-statsapi-milb-roster-census-v1'
  ORDER BY
    source_fetch.fetched_at DESC,
    run.finished_at DESC NULLS LAST,
    source_fetch.id DESC
  LIMIT 1
),
parsed_record AS MATERIALIZED (
  SELECT
    record.id AS raw_record_id,
    record.record_json,
    latest_fetch.known_at,
    record.record_json ->> 'membershipKind' AS membership_kind,
    record.record_json #>> '{rosterEntry,person,id}' AS mlbam_id_text,
    record.record_json #>> '{rosterEntry,person,currentAge}' AS age_text,
    record.record_json #>> '{organization,id}' AS organization_id_text,
    record.record_json #>> '{team,id}' AS roster_team_id_text,
    record.record_json #>> '{assignmentTeam,id}' AS assignment_team_id_text,
    record.record_json #>> '{assignmentTeam,sport,id}' AS sport_id_text,
    record.record_json ->> 'season' AS season_text
  FROM raw.record AS record
  JOIN latest_fetch ON latest_fetch.fetch_id = record.fetch_id
  WHERE record.parser_schema_version = 'mlb-statsapi-milb-roster-census-v1'
    AND record.record_type = 'milb_roster_member'
),
source_record AS MATERIALIZED (
  SELECT
    parsed_record.*,
    CASE WHEN mlbam_id_text ~ '^[0-9]+$' THEN mlbam_id_text::bigint END AS mlbam_id,
    CASE WHEN age_text ~ '^[0-9]+$' THEN age_text::smallint END AS age,
    CASE WHEN organization_id_text ~ '^[0-9]+$'
      THEN organization_id_text::integer END AS organization_mlbam_id,
    CASE WHEN roster_team_id_text ~ '^[0-9]+$'
      THEN roster_team_id_text::integer END AS roster_team_mlbam_id,
    CASE WHEN assignment_team_id_text ~ '^[0-9]+$'
      THEN assignment_team_id_text::integer END AS current_team_mlbam_id,
    CASE WHEN sport_id_text ~ '^[0-9]+$' THEN sport_id_text::integer END AS sport_id,
    CASE WHEN season_text ~ '^[0-9]+$' THEN season_text::integer END AS season
  FROM parsed_record
)
SELECT
  source_record.raw_record_id,
  source_record.membership_kind,
  source_record.mlbam_id,
  CASE
    WHEN lower(coalesce(
      nullif(source_record.record_json #>> '{rosterEntry,person,primaryPosition,type}', ''),
      CASE
        WHEN source_record.record_json #>> '{rosterEntry,person,primaryPosition,abbreviation}' = 'P'
          THEN 'pitcher'
        ELSE ''
      END
    )) = 'pitcher' THEN 'Pitcher'
    ELSE 'Hitter'
  END AS player_type,
  nullif(source_record.record_json #>> '{rosterEntry,person,fullName}', '') AS display_name,
  source_record.age,
  CASE
    WHEN source_record.record_json #>> '{rosterEntry,person,mlbDebutDate}'
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN (source_record.record_json #>> '{rosterEntry,person,mlbDebutDate}')::date
    ELSE NULL
  END AS mlb_debut_date,
  CASE jsonb_typeof(source_record.record_json #> '{rosterEntry,person,active}')
    WHEN 'boolean' THEN (source_record.record_json #>> '{rosterEntry,person,active}')::boolean
    ELSE NULL
  END AS active,
  nullif(source_record.record_json #>> '{rosterEntry,status,code}', '')
    AS roster_status_code,
  nullif(source_record.record_json #>> '{rosterEntry,status,description}', '')
    AS roster_status_description,
  CASE
    WHEN source_record.record_json #>> '{rosterEntry,status,description}' = 'Active' THEN 'active'
    WHEN source_record.record_json #>> '{rosterEntry,status,description}' = 'Rehab Assignment'
      THEN 'rehab'
    WHEN source_record.record_json #>> '{rosterEntry,status,description}' ILIKE 'Injured%'
      THEN 'injured'
    WHEN source_record.record_json #>> '{rosterEntry,status,description}' = 'Development List'
      THEN 'development'
    WHEN source_record.record_json #>> '{rosterEntry,status,description}' ILIKE '%Restricted%'
      THEN 'restricted'
    WHEN source_record.record_json #>> '{rosterEntry,status,description}' IN (
      'Administrative Leave',
      'Military Leave',
      'Not Yet Reported',
      'Reserve List (Minors)',
      'Suspended # days',
      'Temporary Inactive List'
    ) THEN 'inactive'
    ELSE 'other'
  END AS roster_status_group,
  coalesce(
    nullif(source_record.record_json #>> '{rosterEntry,person,primaryPosition,abbreviation}', ''),
    nullif(source_record.record_json #>> '{rosterEntry,position,abbreviation}', '')
  ) AS position,
  nullif(source_record.record_json #>> '{rosterEntry,person,batSide,code}', '') AS bats,
  nullif(source_record.record_json #>> '{rosterEntry,person,pitchHand,code}', '') AS throws,
  source_record.organization_mlbam_id,
  nullif(source_record.record_json #>> '{organization,name}', '') AS organization_name,
  source_record.current_team_mlbam_id,
  nullif(source_record.record_json #>> '{assignmentTeam,name}', '') AS current_team_name,
  CASE source_record.sport_id
    WHEN 16 THEN 'Rk'
    WHEN 14 THEN 'A'
    WHEN 13 THEN 'A+'
    WHEN 12 THEN 'AA'
    WHEN 11 THEN 'AAA'
    ELSE NULL
  END AS current_level,
  CASE source_record.sport_id
    WHEN 16 THEN 1
    WHEN 14 THEN 2
    WHEN 13 THEN 3
    WHEN 12 THEN 4
    WHEN 11 THEN 5
    ELSE 0
  END AS level_rank,
  source_record.sport_id,
  nullif(source_record.record_json #>> '{assignmentTeam,league,name}', '')
    AS current_league_name,
  nullif(source_record.record_json #>> '{assignmentTeam,league,abbreviation}', '')
    AS current_league_abbreviation,
  CASE
    WHEN source_record.record_json #>> '{assignmentTeam,name}' ILIKE 'ACL %' THEN 'ACL'
    WHEN source_record.record_json #>> '{assignmentTeam,name}' ILIKE 'FCL %' THEN 'FCL'
    WHEN source_record.record_json #>> '{assignmentTeam,name}' ILIKE 'DSL %' THEN 'DSL'
    ELSE NULL
  END AS rookie_affiliate_family,
  source_record.season,
  source_record.known_at,
  source_record.record_json #> '{rosterEntry,person,primaryPosition}' AS source_primary_position,
  source_record.record_json #> '{rosterEntry,status}' AS source_roster_status,
  source_record.record_json -> 'team' AS source_roster_team,
  source_record.record_json -> 'assignmentTeam' AS source_assignment_team,
  source_record.record_json -> 'rosterEntry' AS source_roster_entry
FROM source_record
WHERE source_record.membership_kind IN ('affiliate', 'parent_census')
  AND source_record.mlbam_id > 0
  AND source_record.organization_mlbam_id > 0
  AND source_record.roster_team_mlbam_id > 0
  AND (
    source_record.record_json -> 'assignmentTeam' = 'null'::jsonb
    OR source_record.sport_id IN (11, 12, 13, 14, 16)
  );

COMMENT ON VIEW app.mlb_statsapi_current_milb_roster_latest IS
  'Every valid exact-MLBAM membership from the latest atomic official affiliate plus parent-organization full-roster census. Numeric JSON fields are parsed once in materialized CTE stages so scheduled snapshot publication remains bounded. Invalid placeholders remain auditable in the immutable raw response bundle but are quarantined from this view.';
