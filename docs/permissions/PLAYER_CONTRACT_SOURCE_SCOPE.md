# Player contract source scope

The public Player Mobility Context may contain only normalized factual contract
and transaction fields from:

1. Official league or team publications;
2. Public Spotrac MLB, NFL, NBA, and NHL team contract-list and player pages
   retrieved under the user-provided project attestation recorded in
   [`SPOTRAC_ATTESTATION.md`](./SPOTRAC_ATTESTATION.md);
3. A provider feed whose written license permits automated retrieval, caching,
   normalization, and public in-app display; or
4. A manually reviewed source record whose terms permit this use.

The project treats the owner's 2026-07-26 Spotrac statement as authorization
for a bounded, rate-limited, cache-first adapter. That attestation is
user-provided project evidence, not independent verification of the underlying
authorization.

The adapter defaults to a non-mutating dry run. Automated retrieval or cache
updates require an explicit execute action. It may retrieve only public team
contract-list and player-page contract, team, option, free-agency, and
transaction facts required for Team Runway. It uses one worker and a minimum
five-second live-request interval. It must not bypass authentication, paywalls,
CAPTCHAs, robots controls, rate limits, or any other access control, and it must
fail closed when a page is blocked, unsupported, ambiguous, or structurally
invalid.

Raw cached Spotrac pages and raw licensed provider material must remain private
unless the applicable authorization explicitly permits redistribution. They
must not be published or redistributed as a raw bulk dataset. The public
artifact contains only the minimum normalized facts needed for Team Runway
display.

Every observed row must include:

- A reviewed GemRate source-key bridge;
- Stable source player and team identities;
- Source provider and parser identity;
- Source URL when permitted;
- Access and data-through dates;
- Neutral `contextOnly` and `directionalClaim: false` semantics.

The artifact must also retain one self-contained source-chain receipt shared
by its rows: parser and normalizer versions, permission and robots-policy
hashes, the source-only acquisition-manifest hash, and the canonical page URL
and content hash for every planned team page.

Absence is `unavailable`, never inferred free agency. Ambiguous identity is
withheld. Contract context cannot alter any native research model or rank.
