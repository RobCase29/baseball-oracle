CREATE OR REPLACE VIEW app.player_directory AS
WITH selected_cohort AS (
  SELECT DISTINCT ON (level)
    level,
    season
  FROM app.prospect_savant_latest_level
  GROUP BY level, season
  HAVING count(DISTINCT source_role) FILTER (
    WHERE source_role IN ('hitters', 'pitchers')
  ) = 2
  ORDER BY level, season DESC
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
  JOIN selected_cohort USING (level, season)
  WHERE latest.source_role IN ('hitters', 'pitchers')
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

REFRESH MATERIALIZED VIEW app.player_directory_snapshot;

COMMENT ON VIEW app.player_directory IS
  'Allowlisted latest valid Prospect Savant paired hitter/pitcher cohort per level, with each profile preserving its representative source season. Source observations only; no current assignment or Oracle forecast is implied.';
