# IT Factor Board

Snapshot date: 2026-07-26
Method version: `it-factor/editorial-v1.0.0`

## Current baseline

| Sport | Teams | Flags |
| --- | ---: | ---: |
| MLB | 30 | 84 |
| NFL | 32 | 76 |
| NBA | 30 | 77 |
| NHL | 32 | 82 |
| **Total** | **124** | **319** |

The snapshot cites 153 unique league, team, consensus, scouting, news, and
licensed-market sources. GemRate identity matching found 295 of the 319
players (278 exact and 17 normalized); 24 are explicitly marked
`not_observed`, never treated as zero sales.

## What the flag means

IT Factor is the hobby's narrative belief that a player has a credible path
to enduring superstar or face-of-franchise demand. It is deliberately not a
performance projection, probability of reaching a ceiling, card-price
forecast, or buy recommendation.

Version 1 separates two judgments:

- **IT Score (0–100):** the current strength and durability of the hobby
  narrative.
- **Classification confidence (0–100%):** how strong and current the evidence
  is for assigning that score and tier. It is not the player's success
  probability.

The score is an editorial synthesis of:

1. multi-source consensus, pedigree, and time in the public prospect/star
   conversation;
2. loud or singular tools that create a recognizable visual identity;
3. age-adjusted production that validates the ceiling story;
4. narrative language, visibility, franchise context, and marketability; and
5. completed-sales scale or acceleration in the licensed GemRate snapshot.

Sales evidence can confirm or challenge a classification, but it does not
automatically create IT. Missing GemRate identity is shown as not observed
rather than converted to zero.

## Tiers

| Tier | Score | Interpretation |
| --- | ---: | --- |
| Icon | 92–100 | Durable, cross-cycle hobby identity |
| High IT | 84–91 | Locked-in star or elite ceiling narrative |
| Emerging | 74–83 | Multi-signal narrative is forming |
| Watch | 60–73 | Early, local, or fragile story worth monitoring |

Each league curation must include between one and three flags for every team.
The generator rejects missing teams, extra teams, noncanonical team names,
duplicate player identities, scores outside their tier, missing research
sources, and entries without substantive rationales.

## Where the data lives

- `scripts/data/it-factor/baseball.ts`
- `scripts/data/it-factor/football.ts`
- `scripts/data/it-factor/basketball.ts`
- `scripts/data/it-factor/hockey.ts`
- `scripts/data/it-factor/teams.ts` — canonical team coverage
- `scripts/data/build-it-factor-board.ts` — validation and GemRate enrichment
- `src/data/it-factor-board.v1.json` — full generated research artifact
- `src/data/it-factor-badges.v1.json` — compact cross-board badge index

Both generated artifacts ship with the app. The compact badge index loads with
Build and Graduation; the full research artifact is lazy-loaded only for the
Decision Desk and IT Board. This avoids turning a curated editorial board into
a runtime API dependency without making every board parse the full research
payload.

The artifact records the licensed market snapshot's `rowsSha256`, and its test
rebuilds the board from the checked-in curations and market input. A refresh
therefore fails if coverage, identities, source references, tier ranges,
confidence, market values, or the generated artifact drift out of contract.
Every exact or uniquely normalized market match also retains the canonical
GemRate `sourceKey`; ambiguous and unobserved entries retain `null`. Product
intersections qualify on that key, never on a fresh fuzzy-name join.

## Decision Desk intersections

The Decision Desk at `/hobby?lens=desk` connects the existing models without
averaging their scores:

| Queue | Deterministic rule | Native order |
| --- | --- | --- |
| Durable franchise | Build-qualified + High/Icon IT | Build rank |
| Narrative with momentum | Breakout surfaced + High/Icon IT | Breakout rank |
| Narrative runway | IT-flagged + On Deck/Approaching | Graduation rank |
| Narrative under pressure | Exit eligible + High/Icon IT | Exit score |
| Early narrative | Rising IT + forming/thin market evidence | IT score |

An IT omission means unclassified, not low IT. `not_observed` market evidence
means unknown demand, not zero or weak demand. Each queue links back to the
source board so the underlying evidence and model-specific interpretation
remain visible.

The generated Decision Desk uses the complete four-sport market/IT snapshot
and the reproducible static NFL/NBA Graduation universe. Baseball Graduation
depends on the live prospect directory, so MLB path intersections remain on
the live Graduation Board rather than being guessed into the static artifact.
Hockey has no Graduation model.

## Refresh workflow

1. Review players whose `recheckTriggers` fired. Common triggers are a major
   ranking release, draft, debut, role change, award race, trade, injury,
   retirement announcement, or material hobby-sales inflection.
2. Verify the current team and status from a primary league/team source.
3. Advance `AS_OF`, `GENERATED_AT`, and `NEXT_REVIEW_BY` in
   `scripts/data/build-it-factor-board.ts`.
4. Update the relevant league curation, rationale, trajectory, confidence,
   source IDs, and review triggers. Add or update source records with their
   publication and access dates.
5. Run:

   ```sh
   npm run data:it-factor:build
   npm run typecheck
   npx vitest run --exclude 'football-oracle/**'
   npm run build
   ```

6. Review the generated coverage totals and spot-check the app at
   `/hobby?lens=it`.

Even if no event fires, perform a full quarterly sweep by
`snapshot.nextReviewBy`. Drafts, trade deadlines, flagship card releases,
major prospect-ranking updates, and season-ending awards justify an
out-of-cycle sweep.

## Editorial rules

- Preserve early narrative history; do not simply sort current statistics.
- Treat a strong season as validation unless several independent signals show
  that a new superstar narrative has genuinely formed.
- Reduce confidence when a roster move, role, health status, or signing is
  reported but not official. State the caveat in the rationale and trigger.
- Use `fragile` when the ceiling story remains visible but is losing
  consensus, opportunity, or market confirmation.
- Do not infer a player identity from an ambiguous market match.
- Keep deliberate exclusions in the research notes when a productive player
  lacks the hobby ceiling narrative. This is useful negative evidence for the
  next review.
- Ranking badges use a sport/name display lookup, but Decision Desk
  qualification uses the artifact's canonical market `sourceKey`. When an
  upstream display name changes, preserve the reviewed source-key bridge
  rather than guessing.
