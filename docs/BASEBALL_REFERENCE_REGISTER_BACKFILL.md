# Baseball-Reference Register Backfill

This backfill is the bounded, resumable acquisition path for the authorized
Baseball-Reference Register minor-league team-season pages. It is intentionally
dry by default. The first executable pilot is one 2017 team:

```bash
npm run backfill:sports-reference
npm run backfill:sports-reference -- --execute --season=2017 --max-teams=1
```

The first command only prints the plan. The second discovers the season's
affiliates and fetches at most one pending team. Re-running the same command
continues from the checkpoint; verified cached responses never generate a new
request. `--max-teams` must be between 1 and 250. There is one worker, every
live request is separated by at least 3.2 seconds, and retryable failures use
capped attempts with exponential backoff. A project-global acquisition lock
prevents two crawler processes from multiplying the request rate.

Do not start an unreviewed bulk run. Increase `--max-teams` only after checking
the pilot request manifests, parsed rows, source permission, and site health.

## Immutable Landing And Resume

Each exact, identity-encoded HTML response is stored atomically at:

```text
data/raw/baseball-reference-register/<season>/requests/<request-fingerprint>/payload.html
data/raw/baseball-reference-register/<season>/requests/<request-fingerprint>/manifest.json
```

The request manifest records the URL, descriptive user agent, retrieval time,
HTTP metadata, exact byte length, SHA-256, parser version, attempt count, and
the hash of the repository's permission evidence. The adjacent season
`state.json` is the resume checkpoint. Every invocation also writes a run
manifest under `data/manifests/runs/`, including coverage and output hashes.

The crawler sends `Accept-Encoding: identity` so stored bytes match the HTTP
representation being parsed. A cached payload must pass its recorded length
and digest before reuse. A partial cache is rejected instead of silently
repaired or overwritten. Redirects are not followed, endpoint identity must
remain exact, `Retry-After` is honored, and an HTTP-200 response is structurally
parsed before it can enter the immutable cache.

Parser v4 also fails closed when an affiliate count, team-organization
relationship, player row, or provider ID does not reconcile. Register player IDs
must match exactly across the link and `data-append-csv` representations and use
the provider-observed 11-12 character lowercase format. This includes the lone
11-character historical ID in the current Chadwick crosswalk. Cooperative
affiliates remain one team request with every organization relationship retained.

## Normalized Outputs

After every successful checkpoint, both JSON and CSV are rebuilt atomically in:

```text
data/processed/baseball-reference-register/<season>/teams.{json,csv}
data/processed/baseball-reference-register/<season>/team_organizations.{json,csv}
data/processed/baseball-reference-register/<season>/roster.{json,csv}
data/processed/baseball-reference-register/<season>/batting.{json,csv}
data/processed/baseball-reference-register/<season>/pitching.{json,csv}
data/processed/baseball-reference-register/<season>/fielding.{json,csv}
data/processed/baseball-reference-register/<season>/player_team_seasons.{json,csv}
data/processed/baseball-reference-register/<season>/quality.json
```

HTML is parsed as a DOM, including tables that Baseball-Reference places inside
HTML comments. `player_team_seasons` is unique by Register player ID and team
season. It retains roster dates and biography, infers role and primary fielding
position with an explicit method, and namespaces batting, pitching, and
fielding columns. Provider IDs remain `bbref_minors`; names are never identity
keys.

These files are staging inputs for `modeling/risk_set.py`, not a contract-roster
census. The adapter admits a season only after every team page reconciles, then
constructs an explicit `season_appearance` universe. It retains all team and
organization memberships, excludes rows with no game evidence, and crosswalks
only through the Baseball-Reference minor ID in Chadwick. The source quality
record remains `censusAttested=false` because no claim is made about injured,
reserved, or otherwise contracted players with zero appearances.

Current completed partitions:

| Season | Teams | Player-team rows | Unique players | Raw archive manifest |
| ---: | ---: | ---: | ---: | --- |
| 2010 | 228 | 10,811 | 7,779 | `f535646fa3029f67b60e1d0f917e733407618719bd7382817db5214346a34363` |
| 2017 | 232 | 12,170 | 8,346 | `ccd39a256d19e6fc0597cb220c497f127fdaf0ddda0600bef6d4abab8aa5ca54` |
| 2018 | 240 | 12,772 | 8,608 | `931bad5218f62b80d92d4c4a376eced68c5e6ae6256413377818027b62c7cc19` |
| 2019 | 244 | 13,133 | 8,816 | `f7f7bd909c0e7dc5a26926afb7092ecd9ab2a114bc4a4a2a34c380138130a3be` |
| 2020 | 0 | 0 | 0 | `107885d401f5f5a742dd245620457a0f366e96b629fedc3c9b75bb4877778049` |

The unique-player column describes the normalized source output before the
appearance adapter removes zero-game roster-only rows. The final model censuses
contain 7,777, 8,346, 8,607, and 8,816 players for 2010, 2017, 2018, and 2019.

Prepare an effective-time-safe research cohort for a completed nonzero season
with:

```bash
.venv/bin/python modeling/prepare_dataset.py \
  --output-dir data/processed/model-v1-bref-2017 \
  --bref-player-team-seasons data/processed/baseball-reference-register/2017/player_team_seasons.csv \
  --bref-quality data/processed/baseball-reference-register/2017/quality.json \
  --bref-teams data/processed/baseball-reference-register/2017/teams.csv \
  --bref-team-organizations data/processed/baseball-reference-register/2017/team_organizations.csv
```

Historical values reconstructed today do not prove what a researcher knew at
the original season end. The generated manifest therefore records
`knowledge_time_verified=false` and `strict_point_in_time_features=false` even
though every feature is bounded by the season's effective date.

The 2020 partition is structural: the affiliated season was canceled, so the
script writes zero-row outputs and a quality record without issuing network
requests:

```bash
npm run backfill:sports-reference -- --execute --season=2020 --max-teams=1
```

Run the focused verification with:

```bash
npm run backfill:sports-reference:test
```

## Promote A Completed Season

Raw season pages are promoted to the private content-addressed archive only
after a crawl run is complete:

```bash
npm run archive:sports-reference -- --season=2017
```

The archive command does not continue or mutate the crawl. It selects the
latest complete run manifest for the requested season and fails unless the run
contains one discovery response plus every unique team response, with no
failed teams. It then independently verifies every cache path, request
fingerprint, exact byte length, SHA-256, source URL, request manifest, and the
current permission-evidence hash before making an upload.

Payloads and the deterministic season manifest use private content-addressed
paths beneath:

```text
raw/v1/sports-reference/baseball-register/sha256/<prefix>/<sha256>
```

Resume checkpoints are isolated by season and source-run hash under the ignored
directory:

```text
data/manifests/archive/sports-reference-baseball-register/<season>/<run-sha256>.json
```

The checkpoint is written after each verified Blob receipt. A replay rechecks
all local inputs and skips receipts already present in a consistent checkpoint.
The final archived season manifest contains stable member paths and hashes,
coverage, permission lineage, and the exact source-run-manifest hash. Do not run
this promotion while a season crawl is still partial.

The committed season lock contains no private URL or credential. It records the
source-run digest, input count and bytes, coverage, and the season-manifest
pathname and digest needed for later restoration.
