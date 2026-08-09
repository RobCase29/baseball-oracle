# Player Mobility Context v1

Player Mobility Context surfaces contract runway and team-change history as
neutral research evidence. It does not change Build, Breakout, Graduation, IT,
or Exit scores and it is not a buy/sell instruction.

## Product language

The user-facing label is **Team runway**. An observed record may say:

- `Contract term through 2032`
- `Contract term through 2029-30`
- `Team control through 2029`
- `Player decision after 2027`
- `Club option for 2028`
- `UFA after this season`

Contract length is not automatically positive or negative. A move can interrupt
collector continuity, expand collector reach, or do neither. Direction is
unknown until a destination and subsequent market evidence exist.

## Current implementation

The normalized artifact is
`src/data/player-mobility-context.v1.json`. It is keyed only by reviewed GemRate
source identity. Missing rows become `unavailable`, ambiguous identities become
`withheld_identity`, and non-athlete subjects become `not_applicable`.

The August 9, 2026 artifact contains 605 identity-reviewed current-player
matches:

- MLB: 386
- NFL: 85
- NBA: 76
- NHL: 58

Mookie Betts retains the initial official-source review as a supplemental
record: Boston to Los Angeles in February 2020, guaranteed contract term
through 2032, and 2033 UFA. The user-facing read is
`LAD · term 2032 · Long runway`. The 2020 move predates the app's current
18-month market history, so the product presents it as historical context and
makes no causal claim about current demand.

The coverage receipt reports 5,388 Spotrac source rows. A unique same-sport
name is only a candidate: publication also requires a verified/reviewed
current-player bridge, a reviewed name-and-team bridge from the IT Board, or
an existing independently reviewed supplement. This additional gate withheld
783 otherwise unique name matches and honored two explicit aggregate-identity
blocks. Historical homonyms such as Marcus Allen, A.J. Green, and Zach Thomas
therefore remain unavailable instead of receiving a current namesake's
contract.

Ambiguous identities, malformed chronology, already-expired terms, source
players absent from the hobby board, and unsupported identity links are
withheld rather than inferred. A team-list term ending in the current season
remains visible as a factual contract-list term, but the app says
`Decision not verified` and does not infer free agency or relocation.

## Source adapter boundary

The artifact remains provider-neutral. Spotrac public MLB, NFL, NBA, and NHL
team contract-list and player pages are an authorized input under the
user-provided project attestation in
[`permissions/SPOTRAC_ATTESTATION.md`](./permissions/SPOTRAC_ATTESTATION.md).
Official league and team releases and other separately authorized provider
feeds may remain supporting sources.

Spotrac retrieval runs through a bounded, single-worker, rate-limited,
cache-first adapter outside the deployed request path. It uses the allowed
`/{league}/contracts/_/team/{team}` route and waits at least five seconds
between live requests. The adapter defaults to a non-mutating dry run. A
network retrieval or cache update requires an explicit execute action;
ordinary builds and deployments consume reviewed cached snapshots and do not
silently fetch upstream pages.

The adapter may retrieve only public player contract, team, option,
free-agency, and transaction facts required for Team Runway. It never bypasses
authentication, paywalls, CAPTCHAs, robots controls, rate limits, or other
access controls. It fails closed on blocked responses, unsupported pages,
identity ambiguity, parser drift, and invalid chronology.

Every execute run now preflights and pins the applicable `robots.txt` policy
before any team page is read. The checked-in normalized artifact carries a
self-contained source-chain receipt: permission and robots hashes, parser and
normalizer versions, the acquisition-manifest SHA, and all 124 canonical team
page URL/content-hash pairs. Per-team and total row-count gates prevent a
partial or materially regressed page set from replacing a healthy snapshot.

Raw cached pages remain private and are not redistributed. The normalized
artifact must preserve:

- Stable provider player and team identities
- Reported contract end and maximum team control
- Guaranteed term where meaningful
- Options, opt-outs, and practical non-guarantee decisions
- Free-agent type
- Last team change
- Canonical source URL, provider, parser version, access time, and independent
  data-through date
- Reviewed source-to-GemRate identity provenance

Refresh contract facts weekly in season, daily during free agency/trade
windows, and after a verified roster transaction. Keep historical snapshots so
future work can test, rather than assume, the hobby effect of team changes.

Normalized contract facts remain neutral context. They do not add a mobility
score, directionally label a move, or alter Build, Breakout, Graduation, IT, or
Exit. Missing, blocked, stale, or ambiguous records fail closed to an explicit
unavailable or withheld state rather than being inferred as free agency.

## Validation

Run:

```sh
npm run data:player-mobility:check
```

The check validates identities, chronology, neutral semantics, counts, source
links, the artifact content hash, current permission evidence, and the pinned
acquisition manifest when its private audit copy is present.

Preview the acquisition plan without network or file changes:

```sh
npm run data:player-mobility:refresh
```

Run an explicitly authorized refresh:

```sh
npm run data:player-mobility:refresh -- --execute
```
