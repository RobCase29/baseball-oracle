# Dynasty Scores API v1

## Endpoint

```http
GET /api/v1/dynasty-scores?ids=<comma-separated player identifiers>
```

The endpoint returns the external dynasty-consensus signal displayed by Baseball
Oracle. It is a comparison signal, not an Oracle model input or probability.
The machine-readable contract is `/schemas/dynasty-scores.v1.schema.json`.

## Identity

Use MLBAM IDs whenever possible. Canonical Oracle player IDs are also accepted.
The endpoint accepts 1-100 unique identifiers and performs exact identity joins;
it never guesses by player name.

## Important Fields

- `dynastyScore.value`: consensus value on a 10-10,000 scale.
- `dynastyScore.signalStatus`: `ranked` or `default_floor`.
- `dynastyScore.overallRank`: rank across the complete consensus universe.
- `dynastyScore.prospectRank`: rank within the prospect universe.
- `dynastyScore.movement.rank30d`: signed 30-day rank change; positive is rising.
- `dynastyScore.attention`: current interest, when available.
- `snapshot.id`: deterministic cache and reconciliation identifier.
- `observation.dataUpdatedAt`: when the observation was last updated.

Unavailable values are `null`, never zero.

## Authentication

Baseball Oracle is deployment-protected. Interactive users authenticate through
Vercel. Server-to-server consumers send the project's Vercel protection bypass
secret in `x-vercel-protection-bypass`. Keep the secret server-side.

## Compatibility

`/api/v1/community-signals` remains a compatibility alias and returns the same
source-neutral `dynasty-scores.v1` contract. New integrations should use
`/api/v1/dynasty-scores`.
