CREATE MATERIALIZED VIEW app.player_directory_snapshot AS
SELECT *
FROM app.player_directory;

CREATE UNIQUE INDEX player_directory_snapshot_profile_uidx
  ON app.player_directory_snapshot (profile_id);

CREATE INDEX player_directory_snapshot_score_idx
  ON app.player_directory_snapshot (
    ps_score DESC NULLS LAST,
    display_name,
    profile_id
  );

CREATE INDEX player_directory_snapshot_percentile_idx
  ON app.player_directory_snapshot (
    ps_percentile DESC NULLS LAST,
    display_name,
    profile_id
  );

CREATE INDEX player_directory_snapshot_age_idx
  ON app.player_directory_snapshot (
    age ASC NULLS LAST,
    display_name,
    profile_id
  );

CREATE INDEX player_directory_snapshot_name_idx
  ON app.player_directory_snapshot (display_name, profile_id);

CREATE INDEX player_directory_snapshot_filter_idx
  ON app.player_directory_snapshot (player_type, level);

COMMENT ON MATERIALIZED VIEW app.player_directory_snapshot IS
  'Refreshable public-read snapshot of app.player_directory. Forecast fields are intentionally absent.';
