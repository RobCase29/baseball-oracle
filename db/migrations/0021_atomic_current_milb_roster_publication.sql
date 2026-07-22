CREATE VIEW app.current_milb_roster_computed AS
WITH roster_source AS MATERIALIZED (
  SELECT *
  FROM app.mlb_statsapi_current_milb_roster_latest
),
membership_summary AS (
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
  FROM roster_source
  GROUP BY mlbam_id
),
representative AS (
  SELECT DISTINCT ON (mlbam_id)
    *
  FROM roster_source
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

COMMENT ON VIEW app.current_milb_roster_computed IS
  'A single-pass computation of the newest official MiLB roster census. Scheduled publication stages and audits this result before atomically replacing the served table.';

ALTER MATERIALIZED VIEW app.current_milb_roster_snapshot
  RENAME TO current_milb_roster_snapshot_legacy;

CREATE TABLE app.current_milb_roster_snapshot AS
SELECT *
FROM app.current_milb_roster_snapshot_legacy;

DROP MATERIALIZED VIEW app.current_milb_roster_snapshot_legacy;

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

COMMENT ON TABLE app.current_milb_roster_snapshot IS
  'One validated, atomically published current organization-controlled row per MLBAM player. The prior version remains readable until the staged replacement commits.';
