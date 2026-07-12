# Baseball-Reference MLB WAR Reference

This acquisition builds Baseball Oracle's authorized MLB value history and
Hall-of-Fame reference standards. It is a separate reference corpus: it does
not modify `data/source-lock.json` or invalidate manifests derived from that
lock.

The command is dry by default:

```bash
npm run backfill:mlb-war
```

A one-season executable pilot retrieves at most four uncached pages. That is
enough for 2025 batting, pitching, and both Hall-of-Fame registers; the ten JAWS
standards remain resumable checkpoints for the next invocation.

```bash
npm run backfill:mlb-war -- \
  --execute --start-season=2025 --end-season=2025 --max-pages=4
```

The historical through current-YTD acquisition is deliberately split into
bounded runs:

```bash
for run in {1..7}; do
  npm run backfill:mlb-war -- \
    --execute --start-season=1871 --end-season=2026 --max-pages=50 || break
done
```

There is one worker, live attempts are separated by at least 3.2 seconds, and
retryable failures use capped exponential backoff while honoring
`Retry-After`. The cache is content-verified on every reuse, so rerunning the
same command only requests unfinished pages. A project-global lock prevents
parallel crawler processes from multiplying the request rate.

## Source Contract

The annual source pages are the major-league value tables:

```text
/leagues/majors/{season}-value-batting.shtml#players_value_batting
/leagues/majors/{season}-value-pitching.shtml#players_value_pitching
```

They supply annual WAR, WAA, RAA, RAR, offense/defense components, PA/IP, age,
team, and position. The parser excludes `partial_table`, `norank`, and header
rows, then fails if more than one total row remains for a player and season.
Batting and pitching records are joined by Baseball-Reference ID, never name.

Pitching innings are not parsed as ordinary decimals. For example, `0.2`
means two outs, not one fifth of an inning. Outputs retain the provider display
in `p_ip`, store the exact integer in `p_ip_outs`, and provide `p_ip_decimal`
as `p_ip_outs / 3`. Hall-of-Fame career innings use the same three-field
contract.

Hall-of-Fame membership comes from:

```text
/awards/hof_batting.shtml#hof_batting
/awards/hof_pitching.shtml#hof_pitching
```

The batting parser excludes provider-classified `non_batter` rows and the
aggregate average. The pitching parser admits only provider-classified
`pitcher` rows. This keeps actual position-player and pitcher inductees while
still allowing a genuine two-role inductee to join across both registers.

Position standards come from `#jaws` on the C, 1B, 2B, 3B, SS, LF, CF, RF, P,
and RP leader pages. The parser selects exactly one `tr.norank` whose label is
`Avg of N HOFers at this position`; it records career WAR, peak-seven WAR,
JAWS, and the provider's S-JAWS or R-JAWS standard where applicable.

## Outputs And Lineage

Exact identity-encoded HTML and request receipts land under:

```text
data/raw/baseball-reference-mlb-war/requests/<request-fingerprint>/payload.html
data/raw/baseball-reference-mlb-war/requests/<request-fingerprint>/manifest.json
```

Every receipt pins the request identity, response headers, retrieval time,
byte length, SHA-256, parser version at acquisition, protocol-lock hash, and
permission-evidence hash. A structurally invalid HTTP 200 response is never
promoted into the immutable cache. Partial cache pairs fail closed.

Normalized page checkpoints and joined outputs are written to:

```text
data/processed/baseball-reference-mlb-war/pages/*.json
data/processed/baseball-reference-mlb-war/player_seasons.{json,csv}
data/processed/baseball-reference-mlb-war/hof_inductees.{json,csv}
data/processed/baseball-reference-mlb-war/jaws_standards.{json,csv}
data/processed/baseball-reference-mlb-war/manifest.json
```

The dataset manifest reports exact input/output hashes, coverage, mutable
seasons, semantic filters, and the independent protocol lineage. Once every
planned state unit succeeds, the script also writes the portable snapshot lock:

```text
data/reference-locks/baseball-reference-mlb-war.json
```

The committed protocol lock is
`data/reference-locks/baseball-reference-mlb-war-protocol-v1.json`. It pins the
project owner's research-source attestation and forces review if that evidence
changes. Raw provider pages remain private research inputs and are excluded
from redistribution.

## Effective Time

Seasons through 2025 are marked `complete`. The 2026 rows are explicitly
`in_season`, are mutable at the source, and carry `known_at` from their exact
request receipt. They are suitable for a current-YTD scoring universe, not
retrospective model training. Training builders must default to
`season <= 2025`; using 2026 requires an explicit scoring-only path.

These value pages establish season participation, not current 40-man or active
roster status. A roster feed must remain a separately timestamped source so it
cannot silently redefine the historical player-season population.

Run focused verification with:

```bash
npm run backfill:mlb-war:test
```
