# Data Sources and Licensing

Research current as of July 11, 2026.

This document identifies authoritative, public, and commercially licensable data
sources for MLB and Minor League Baseball. It covers player statistics,
transactions, biographical and draft data, signing bonuses, injuries, tracking
metrics, awards, and Hall of Fame outcomes.

The central rule is simple: a publicly reachable endpoint is not necessarily a
commercial data license. Before production ingestion, every source must be
cleared for bulk access, storage, machine-learning use, derived model outputs,
and display in a paid investment-oriented product.

## Source Matrix

### Open Sources

| Source | Coverage and access | Licensing and risk | Recommended use |
| --- | --- | --- | --- |
| [Chadwick Persons Register](https://github.com/chadwickbureau/register) | Nearly 500,000 identities, including names, birth and death dates, career spans, and cross-references for MLBAM, Retrosheet, Baseball-Reference, FanGraphs, NPB, and Wikidata. The public extract is updated roughly weekly. | Open Data Commons Attribution 1.0. The public extract trails Chadwick's paid data. Identity clusters can merge or split as records improve, so store the stable UUID and ingest identity changes explicitly. | Canonical player identity spine and cross-vendor ID mapping. |
| [Retrosheet](https://www.retrosheet.org/) | MLB play-by-play, game logs, rosters, and biographical records. AL and NL play-by-play is complete from 1910 through 2025. | Commercial products are expressly permitted, subject to the prominent attribution required in the [Retrosheet data-use notice](https://www.retrosheet.org/notice.txt). Retrosheet disclaims accuracy guarantees. Its historical transaction database stopped updating in 2021. | Historical event store, career reconstruction, and reproducible feature engineering. |
| [SABR Lahman Database](https://sabr.org/lahman-database/) | Annual MLB batting, pitching, fielding, postseason, biographical, award, award-voting, Hall of Fame-voting, and All-Star data from 1871 through 2025. | CC BY-SA 3.0 according to the official database README. Preserve attribution and isolate these tables so share-alike obligations can be reviewed. Salary data ends in 2016 and college tables end in 2014. | Historical outcomes, award and Hall of Fame labels, and long-horizon backtesting. |

### Project-Authorized Research Sources

The user has attested that this research project has permission to automate
retrieval, store source data, train internal models, and display derived research
outputs from the following sources. Each ingestion run pins that attestation as a
versioned permission record. Raw redistribution and commercial-product rights are
not inferred from the research permission.

| Source | Coverage and access | Project use | Important boundary |
| --- | --- | --- | --- |
| [FanGraphs](https://www.fangraphs.com/) | Prospect Board scouting grades, ranks, reports, and linked MiLB statistics, plus broader MLB/MiLB statistics. | Historical scouting priors, player evaluation context, and provider benchmarks. | Keep provider metrics and prose source-attributed; a historical season parameter on a live endpoint is not evidence of historical publication time. |
| [Sports Reference](https://www.baseball-reference.com/) | MLB and MiLB player histories, statistics, transactions, awards, and WAR. | Historical performance, career outcomes, reconciliation, and provider-specific value measures. | Preserve upstream/provider definitions and do not assume raw redistribution or commercial rights. |
| [Prospect Savant](https://prospectsavant.com/) | MiLB leader tables beginning in 2023 with Statcast-derived measurements, percentiles, expected statistics, and Prospect Savant composites. | A structured MiLB feature layer for available season/level/role partitions. | Namespace proprietary composites, preserve their formula/version uncertainty, and separately test their incremental value over component statistics. |

### Contract-First Sources

| Source | Coverage and access | Licensing and risk | Recommended use |
| --- | --- | --- | --- |
| [Sportradar MLB API](https://developer.sportradar.com/baseball/docs/mlb-ig-api-basics) | Official MLB schedules, play-by-play, statistics, rosters, injuries, transactions, draft fields, seasonal awards, and Statcast. Historical MLB API data begins in 2013; Statcast fields begin in 2020. Full team rosters include many minor leaguers, but the MLB API is not a complete MiLB game-stat feed. | Sportradar is MLB's exclusive official-data distributor through 2032. Trial access and published media terms do not automatically authorize commercial prediction or ML. Negotiate historical storage, model training, derived-score display, and investment-product use explicitly. | Production-grade official MLB and Statcast layer. |
| [Sports Info Solutions](https://www.sportsinfosolutions.com/baseball/) | MLB, MiLB, college, and international coverage; live and custom feeds; advanced injuries and injury probabilities; defense; baserunning; pitch charting; hit locations and timers; universal IDs; and "Synthetic Statcast" below MLB. | The consumer DataHub license is limited to private and editorial uses. A separate enterprise raw-data agreement is required for a commercial model. Confirm years, league-by-league completeness, latency, corrections, and rights to derived features. | Primary MiLB feature source and strongest candidate for question one. |
| [SportsDataIO MLB](https://sportsdata.io/mlb-api) | MLB play-by-play and pitch-by-pitch data, standard and advanced statistics, injuries, depth charts, career statistics, news, projections, and historical data. | Production requires a commercial agreement. Discovery Lab is personal and non-commercial. No complete affiliated-MiLB game-stat coverage was identified. | Lower-cost MLB alternative when official Statcast breadth is not required; insufficient by itself for prospect modeling. |
| [Stats Perform MLB API](https://developer.stats.com/docs/read/baseball/mlb) | Commercial MLB statistics, participant records, injuries, odds, win probability, and editorial images through authenticated endpoints. | No complete MiLB coverage was identified, and this is not MLB's exclusive official feed. Confirm source provenance, historical depth, data retention, redistribution, and ML rights in writing. | Secondary MLB vendor comparison or redundancy layer. |
| [Chadwick paid feeds](https://www.chadwick-bureau.com/) | Custom current and historical datasets spanning major, minor, international, collegiate, and summer-league baseball, plus richer daily identity linkage. | Scope, frequency, format, and downstream rights are negotiated. Historical MiLB data remains incomplete in some league-seasons, but Chadwick is the specialist provider used by Baseball-Reference. | Historical MiLB and international backfill, plus production identity resolution. |
| [TrackMan Baseball Data API](https://support.trackmanbaseball.com/hc/en-us/articles/5089419125403-Data-Data-API-Introduction) | Pitch, hit, and catcher-throw measurements; video; positioning; bat data; and biomechanical endpoints from Stadium V3 and Portable B1 systems. | The API is a paid add-on that exposes data belonging to the customer organization. It does not confer access to league-wide MiLB data. Clubs, facilities, or players must authorize access, storage, ML use, and downstream outputs. | Opt-in club or player partnerships and differentiated development data. |

### Public but Restricted Sources

These sources are valuable for manual research, schema exploration, and
non-commercial prototypes. They must not become production bulk feeds without
written authorization.

| Source | Coverage and access | Licensing and risk | Recommended use |
| --- | --- | --- | --- |
| [MLB Stats API](https://statsapi.mlb.com/api/v1/sports) | MLBAM player IDs, biographies, teams, rosters, schedules, statistics, transactions, draft records, and game feeds. Its sport taxonomy includes MLB, Triple-A, Double-A, High-A, Single-A, rookie, winter, independent, NPB, KBO, college, and high-school baseball, although endpoint and historical completeness varies. | The API's [copyright notice](https://gdx.mlb.com/components/copyright.txt) allows only individual, non-commercial, non-bulk use. MLB's [Terms of Use](https://www.mlb.com/official-information/terms-of-use) also prohibit automated collection. | Prototyping, manual reconciliation, and source validation only unless MLBAM grants production rights. |
| [Baseball Savant MLB Statcast](https://baseballsavant.mlb.com/statcast_search) | Pitch-level tracking; velocity, movement, and spin; batted-ball measurements; sprint and fielding metrics; expected statistics; and bat tracking. The [CSV schema](https://baseballsavant.mlb.com/csv-docs) is publicly documented. | CSV availability does not override MLB's non-commercial and no-automation terms. A wrapper such as `pybaseball` or `baseballr` does not alter the upstream license. | Research, metric discovery, and schema prototyping. |
| [Baseball Savant Minor League Statcast](https://baseballsavant.mlb.com/statcast-search-minors) | All Triple-A games beginning in 2023, Pacific Coast League games and Charlotte home games in 2022, and Florida State League games beginning in 2021. | The public data has a major selection gap: it does not cover Double-A, High-A, most Single-A, complex, or Dominican Summer League games. It is subject to the same MLB terms, and public minor-league defense omits metrics such as Outs Above Average. | High-value prototype features, never the sole source of minor-league tracking. |
| [MLB Draft Tracker](https://www.mlb.com/draft/tracker/2025), [MLB Pipeline](https://www.mlb.com/prospects/stats/top-prospects), and [MLB Transactions](https://www.mlb.com/transactions) | Draft pick, school, biographical details, handedness, rankings, pick value, reported signing bonus, prospect rankings, MLB/MiLB assignments, injured-list placements, and injury descriptions. | All are subject to MLB's terms. Draft Tracker states that signing bonuses are reported figures and are not announced or confirmed by clubs. The Injury Report is editorial; transactions are the more structured injury source. | Manual validation and prototype draft, scouting-prior, and injury features. |

### Reference and Label Sources

| Source | Coverage and access | Licensing and risk | Recommended use |
| --- | --- | --- | --- |
| [Spotrac](https://www.spotrac.com/service) | MLB contract, salary, and transaction context. | Terms prohibit systematic extraction, database compilation, automated gathering, and revenue-generating use without written permission. | Manual contract audit or a separately negotiated license. |
| [National Baseball Hall of Fame](https://baseballhall.org/hall-of-fame/hall-of-famers-by-election-method) and [BBWAA voter database](https://bbwaa.com/voter-database/) | Official inductees, election methods, annual Hall of Fame totals, and public award ballots. BBWAA's voter database includes annual award ballots since 2012 and Hall of Fame ballots since 2010. | No public bulk API or commercial data license was identified. | Authoritative validation for the newest labels; use Lahman for bulk historical ingestion. |
| MLB Health and Injury Tracking System, described in this [2026 review](https://journals.sagepub.com/doi/10.1177/23259671261419846) | Central professional-baseball electronic medical and injury records. | No public API or ordinary commercial license was identified. Any de-identified research access would require an MLB and medical-research partnership. Player re-identification must never be attempted. | Long-term research partnership, not an MVP data source. |

Baseball America and Baseball Prospectus also provide high-value prospect grades,
scouting reports, and projection benchmarks. No public API or production ML
license was identified for either. Treat them as manual reference sources unless
a written data agreement grants bulk ingestion, model training, and derived-output
rights.

## Recommended Production Stack

1. Use **Sports Info Solutions** for MiLB, college and international context,
   synthetic tracking, defense, and advanced injury features.
2. Use **Sportradar** for official MLB statistics, Statcast, live transactions,
   injuries, and awards.
3. Use **Chadwick paid feeds and the open Register** for identity resolution and
   historical minor-league backfill.
4. Use **Retrosheet and Lahman** for long-horizon MLB histories, award and Hall of
   Fame outcomes, and reproducible backtesting.
5. Consider **SportsDataIO** as a pragmatic MLB alternative if Sportradar pricing
   is prohibitive, while recognizing that it does not solve the core MiLB gap.

The largest unresolved coverage gap is full pitch- and batted-ball tracking for
Double-A, High-A, most Single-A, complex, and Dominican Summer League games. SIS,
direct TrackMan and club partnerships, or an MLB agreement are the realistic paths
to closing that gap.

## Evaluated Mirrors

| Mirror | Finding | Decision |
| --- | --- | --- |
| [Kaggle Baseball Databank](https://www.kaggle.com/datasets/open-source-sports/baseball-databank) | Historical MLB data through 2015, last updated about six years ago, with several source tables omitted. It identifies the upstream Lahman, Chadwick, and Retrosheet provenance. | Do not create a parallel ingestion path. Use the current official SABR Lahman release through 2025 and retain the Kaggle page only as discovery evidence. |

## Contract Requirements

Every production data agreement should explicitly authorize:

- Bulk API or file ingestion at the required frequency.
- Internal machine-learning training and feature engineering.
- Historical storage, snapshots, backups, and reproducible backtests.
- Creation and external display of derived confidence and career-arc scores.
- Use in a paid, investment-oriented decision-support product.
- Retention rules and permitted derived artifacts after contract termination.
- Cross-vendor ID matching and provenance records.
- Corrections, version history, service levels, and data-quality escalation.
- Use by contractors, cloud processors, and approved model providers.
- Clear treatment of raw-data redistribution versus non-reversible model outputs.

## Publicity, Marks, and Privacy

Data rights are separate from publicity and trademark rights. The
[MLB Players Association FAQ](https://www.mlbplayers.com/es/frequently-asked-questions)
states that MLB Players, Inc. controls group commercial licensing involving active
Major and Minor League players' names, likenesses, playing records, and
biographical data in specified circumstances. A platform displaying many active
players, especially with photos or promotional treatment, should obtain specialist
licensing advice and likely a group license.

MLB and club names, logos, uniforms, and other marks are controlled separately.
Retired-player and Hall of Famer imagery may require rights from alumni groups,
individual players, or estates. Biographical and health-related data about minor
leaguers, some of whom are under 18, requires additional privacy review.

## Operating Rules

- Maintain a source and license registry for every ingested field.
- Record effective dates, corrections, and vendor versions rather than silently
  overwriting history.
- Keep award and Hall of Fame outcomes in label-only tables to prevent temporal
  leakage into prospect-time features.
- Derive injured-list episodes from structured transactions; preserve editorial
  injury reports as unstructured evidence rather than authoritative medical facts.
- Do not treat wrappers, browser exports, or Kaggle mirrors as independent data
  licenses. Their upstream restrictions still apply.
- Obtain review from a sports and data-licensing attorney before commercial launch.
