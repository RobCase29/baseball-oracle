CREATE OR REPLACE VIEW app.mlb_statsapi_current_milb_roster_latest AS
WITH latest_fetch AS (
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
)
SELECT
  record.id AS raw_record_id,
  record.record_json ->> 'membershipKind' AS membership_kind,
  app.jsonb_number(record.record_json #> '{rosterEntry,person}', 'id')::bigint
    AS mlbam_id,
  CASE
    WHEN lower(coalesce(
      nullif(record.record_json #>> '{rosterEntry,person,primaryPosition,type}', ''),
      CASE
        WHEN record.record_json #>> '{rosterEntry,person,primaryPosition,abbreviation}' = 'P'
          THEN 'pitcher'
        ELSE ''
      END
    )) = 'pitcher' THEN 'Pitcher'
    ELSE 'Hitter'
  END AS player_type,
  nullif(record.record_json #>> '{rosterEntry,person,fullName}', '') AS display_name,
  app.jsonb_number(record.record_json #> '{rosterEntry,person}', 'currentAge')::smallint
    AS age,
  CASE
    WHEN record.record_json #>> '{rosterEntry,person,mlbDebutDate}'
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN (record.record_json #>> '{rosterEntry,person,mlbDebutDate}')::date
    ELSE NULL
  END AS mlb_debut_date,
  CASE jsonb_typeof(record.record_json #> '{rosterEntry,person,active}')
    WHEN 'boolean' THEN (record.record_json #>> '{rosterEntry,person,active}')::boolean
    ELSE NULL
  END AS active,
  nullif(record.record_json #>> '{rosterEntry,status,code}', '')
    AS roster_status_code,
  nullif(record.record_json #>> '{rosterEntry,status,description}', '')
    AS roster_status_description,
  CASE
    WHEN record.record_json #>> '{rosterEntry,status,description}' = 'Active' THEN 'active'
    WHEN record.record_json #>> '{rosterEntry,status,description}' = 'Rehab Assignment'
      THEN 'rehab'
    WHEN record.record_json #>> '{rosterEntry,status,description}' ILIKE 'Injured%'
      THEN 'injured'
    WHEN record.record_json #>> '{rosterEntry,status,description}' = 'Development List'
      THEN 'development'
    WHEN record.record_json #>> '{rosterEntry,status,description}' ILIKE '%Restricted%'
      THEN 'restricted'
    WHEN record.record_json #>> '{rosterEntry,status,description}' IN (
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
    nullif(record.record_json #>> '{rosterEntry,person,primaryPosition,abbreviation}', ''),
    nullif(record.record_json #>> '{rosterEntry,position,abbreviation}', '')
  ) AS position,
  nullif(record.record_json #>> '{rosterEntry,person,batSide,code}', '') AS bats,
  nullif(record.record_json #>> '{rosterEntry,person,pitchHand,code}', '') AS throws,
  app.jsonb_number(record.record_json -> 'organization', 'id')::integer
    AS organization_mlbam_id,
  nullif(record.record_json #>> '{organization,name}', '') AS organization_name,
  app.jsonb_number(record.record_json -> 'assignmentTeam', 'id')::integer
    AS current_team_mlbam_id,
  nullif(record.record_json #>> '{assignmentTeam,name}', '') AS current_team_name,
  CASE app.jsonb_number(record.record_json #> '{assignmentTeam,sport}', 'id')::integer
    WHEN 16 THEN 'Rk'
    WHEN 14 THEN 'A'
    WHEN 13 THEN 'A+'
    WHEN 12 THEN 'AA'
    WHEN 11 THEN 'AAA'
    ELSE NULL
  END AS current_level,
  CASE app.jsonb_number(record.record_json #> '{assignmentTeam,sport}', 'id')::integer
    WHEN 16 THEN 1
    WHEN 14 THEN 2
    WHEN 13 THEN 3
    WHEN 12 THEN 4
    WHEN 11 THEN 5
    ELSE 0
  END AS level_rank,
  app.jsonb_number(record.record_json #> '{assignmentTeam,sport}', 'id')::integer
    AS sport_id,
  nullif(record.record_json #>> '{assignmentTeam,league,name}', '')
    AS current_league_name,
  nullif(record.record_json #>> '{assignmentTeam,league,abbreviation}', '')
    AS current_league_abbreviation,
  CASE
    WHEN record.record_json #>> '{assignmentTeam,name}' ILIKE 'ACL %' THEN 'ACL'
    WHEN record.record_json #>> '{assignmentTeam,name}' ILIKE 'FCL %' THEN 'FCL'
    WHEN record.record_json #>> '{assignmentTeam,name}' ILIKE 'DSL %' THEN 'DSL'
    ELSE NULL
  END AS rookie_affiliate_family,
  app.jsonb_number(record.record_json, 'season')::integer AS season,
  latest_fetch.known_at,
  record.record_json #> '{rosterEntry,person,primaryPosition}' AS source_primary_position,
  record.record_json #> '{rosterEntry,status}' AS source_roster_status,
  record.record_json -> 'team' AS source_roster_team,
  record.record_json -> 'assignmentTeam' AS source_assignment_team,
  record.record_json -> 'rosterEntry' AS source_roster_entry
FROM raw.record AS record
JOIN latest_fetch ON latest_fetch.fetch_id = record.fetch_id
WHERE record.parser_schema_version = 'mlb-statsapi-milb-roster-census-v1'
  AND record.record_type = 'milb_roster_member'
  AND record.record_json ->> 'membershipKind' IN ('affiliate', 'parent_census')
  AND app.jsonb_number(record.record_json #> '{rosterEntry,person}', 'id') > 0
  AND app.jsonb_number(record.record_json -> 'organization', 'id') > 0
  AND app.jsonb_number(record.record_json -> 'team', 'id') > 0
  AND (
    record.record_json -> 'assignmentTeam' = 'null'::jsonb
    OR app.jsonb_number(record.record_json #> '{assignmentTeam,sport}', 'id')
      IN (11, 12, 13, 14, 16)
  );

CREATE INDEX IF NOT EXISTS record_mlb_statsapi_milb_roster_fetch_idx
  ON raw.record (fetch_id, record_type)
  WHERE parser_schema_version = 'mlb-statsapi-milb-roster-census-v1';

CREATE MATERIALIZED VIEW app.current_milb_roster_snapshot AS
WITH membership_summary AS (
  SELECT
    mlbam_id,
    count(*)::integer AS roster_membership_count,
    count(*) FILTER (WHERE membership_kind = 'affiliate')::integer
      AS affiliate_roster_membership_count,
    count(*) FILTER (WHERE membership_kind = 'parent_census')::integer
      AS parent_census_membership_count,
    count(DISTINCT player_type)::integer AS role_count,
    count(DISTINCT organization_mlbam_id)::integer AS organization_count,
    jsonb_agg(
      jsonb_build_object(
        'teamMlbamId', current_team_mlbam_id,
        'teamName', current_team_name,
        'organizationMlbamId', organization_mlbam_id,
        'organizationName', organization_name,
        'level', current_level,
        'sportId', sport_id,
        'statusCode', roster_status_code,
        'statusDescription', roster_status_description,
        'statusGroup', roster_status_group,
        'membershipKind', membership_kind
      )
      ORDER BY
        CASE membership_kind WHEN 'affiliate' THEN 1 ELSE 2 END,
        CASE roster_status_group
          WHEN 'rehab' THEN 1
          WHEN 'active' THEN 2
          WHEN 'development' THEN 3
          WHEN 'injured' THEN 4
          WHEN 'restricted' THEN 5
          WHEN 'inactive' THEN 6
          ELSE 7
        END,
        level_rank DESC,
        current_team_mlbam_id
    ) AS roster_memberships
  FROM app.mlb_statsapi_current_milb_roster_latest
  GROUP BY mlbam_id
),
representative AS (
  SELECT DISTINCT ON (mlbam_id)
    *
  FROM app.mlb_statsapi_current_milb_roster_latest
  ORDER BY
    mlbam_id,
    known_at DESC,
    CASE membership_kind WHEN 'affiliate' THEN 1 ELSE 2 END,
    CASE roster_status_group
      WHEN 'rehab' THEN 1
      WHEN 'active' THEN 2
      WHEN 'development' THEN 3
      WHEN 'injured' THEN 4
      WHEN 'restricted' THEN 5
      WHEN 'inactive' THEN 6
      ELSE 7
    END,
    level_rank DESC,
    current_team_mlbam_id
)
SELECT
  'mlb-statsapi-roster:' || representative.mlbam_id::text AS profile_id,
  representative.mlbam_id,
  representative.membership_kind,
  representative.player_type,
  representative.display_name,
  representative.age,
  representative.mlb_debut_date,
  representative.active,
  representative.roster_status_code,
  representative.roster_status_description,
  representative.roster_status_group,
  representative.position,
  representative.bats,
  representative.throws,
  representative.organization_mlbam_id,
  representative.organization_name,
  representative.current_team_mlbam_id,
  representative.current_team_name,
  representative.current_level,
  representative.sport_id,
  representative.current_league_name,
  representative.current_league_abbreviation,
  representative.rookie_affiliate_family,
  representative.season,
  representative.known_at,
  membership_summary.roster_membership_count,
  membership_summary.affiliate_roster_membership_count,
  membership_summary.parent_census_membership_count,
  membership_summary.role_count,
  membership_summary.organization_count,
  membership_summary.roster_memberships
FROM representative
JOIN membership_summary USING (mlbam_id);

CREATE UNIQUE INDEX current_milb_roster_profile_uidx
  ON app.current_milb_roster_snapshot (profile_id);

CREATE UNIQUE INDEX current_milb_roster_mlbam_uidx
  ON app.current_milb_roster_snapshot (mlbam_id);

CREATE INDEX current_milb_roster_org_level_idx
  ON app.current_milb_roster_snapshot (
    organization_mlbam_id,
    current_level,
    player_type
  );

CREATE INDEX current_milb_roster_status_idx
  ON app.current_milb_roster_snapshot (roster_status_group, current_level);

COMMENT ON VIEW app.mlb_statsapi_current_milb_roster_latest IS
  'Every valid exact-MLBAM membership from the latest atomic official affiliate plus parent-organization full-roster census. Invalid placeholders remain auditable in the immutable raw response bundle but are quarantined from this view.';

COMMENT ON MATERIALIZED VIEW app.current_milb_roster_snapshot IS
  'One deterministic current organization-controlled row per MLBAM player. Affiliate membership is preferred; parent-only players receive a current level only when their hydrated team maps to a discovered affiliate. All memberships and statuses remain in roster_memberships. Primary pitchers are Pitcher and all other primary positions, including two-way, are Hitter.';
