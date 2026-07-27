import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  IT_FACTOR_METHOD_VERSION,
  IT_FACTOR_SCHEMA_VERSION,
  IT_FACTOR_BADGE_SCHEMA_VERSION,
  IT_FACTOR_SPORTS,
  IT_FACTOR_STATUSES,
  IT_FACTOR_TIER_SCORE_RANGES,
  IT_FACTOR_TRAJECTORIES,
  isItFactorBoardResponse,
  normalizeItFactorName,
  type ItFactorBoardResponse,
  type ItFactorBadgeIndex,
  type ItFactorEntry,
  type ItFactorMarketEvidence,
  type ItFactorSource,
} from '../../src/domain/itFactor.js'
import { baseballItFactorCuration } from './it-factor/baseball.js'
import { basketballItFactorCuration } from './it-factor/basketball.js'
import { footballItFactorCuration } from './it-factor/football.js'
import { hockeyItFactorCuration } from './it-factor/hockey.js'
import { IT_FACTOR_EXPECTED_TEAMS } from './it-factor/teams.js'
import type {
  ItFactorCurationEntry,
  ItFactorLeagueCuration,
} from './it-factor/types.js'
import {
  buildHobbyDecisionDesk,
  HOBBY_DECISION_DESK_SCHEMA_VERSION,
  type HobbyDecisionDeskArtifact,
} from '../../src/domain/hobbyDecisionDesk.js'
import {
  buildHobbyMasterCatalog,
} from '../../api/_hobby-master-ranking.js'
import {
  buildBinderGraduationCatalog,
} from '../../api/_binder-graduation-index.js'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const marketInputPath = resolve(
  projectRoot,
  'api/_data/gemrate-hobby-sales.json',
)
const outputPath = resolve(
  projectRoot,
  'src/data/it-factor-board.v1.json',
)
const badgeOutputPath = resolve(
  projectRoot,
  'src/data/it-factor-badges.v1.json',
)
const decisionDeskOutputPath = resolve(
  projectRoot,
  'src/data/hobby-decision-desk.v1.json',
)

const AS_OF = '2026-07-26'
const GENERATED_AT = '2026-07-26T18:00:00.000Z'
const NEXT_REVIEW_BY = '2026-10-26'
const GEMRATE_SOURCE_ID = 'gemrate-hobby-2026-06'

export interface GemRateRow {
  domain: string
  subjectName: string
  sourceKey: string
  monthlySalesUsd: number[]
}

export interface GemRateSnapshot {
  dataThrough: string
  rowsSha256: string
  rows: GemRateRow[]
}

const gemRateSource: ItFactorSource = {
  id: GEMRATE_SOURCE_ID,
  label: 'GemRate Athlete completed-sales trends through June 2026',
  publisher: 'GemRate',
  url: 'https://www.gemrate.com/sales-trends',
  publishedAt: '2026-07-12',
  accessedAt: '2026-07-24',
  kind: 'hobby_market',
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function rounded(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function marketEvidence(
  percentile: number,
  recentSix: number,
  priorSix: number,
): ItFactorMarketEvidence {
  if (percentile >= 75) return 'confirmed'
  if (
    recentSix >= 10_000 &&
    (
      priorSix === 0
        ? recentSix > 0
        : recentSix / priorSix >= 1.35
    )
  ) {
    return 'forming'
  }
  return 'thin'
}

function enrichMarket(
  entry: ItFactorCurationEntry,
  snapshot: GemRateSnapshot,
): ItFactorEntry['market'] {
  const sportRows = snapshot.rows.filter((row) => row.domain === entry.sport)
  const normalizedName = normalizeItFactorName(entry.playerName)
  const exactMatches = sportRows.filter(
    (row) => row.subjectName === entry.playerName,
  )
  const normalizedMatches = sportRows.filter(
    (row) => normalizeItFactorName(row.subjectName) === normalizedName,
  )
  const selected = exactMatches.length === 1
    ? exactMatches[0]
    : normalizedMatches.length === 1
      ? normalizedMatches[0]
      : null
  const identityStatus = exactMatches.length === 1
    ? 'exact'
    : normalizedMatches.length === 1
      ? 'normalized'
      : normalizedMatches.length > 1
        ? 'ambiguous'
        : 'not_found'
  if (!selected) {
    return {
      evidence: 'not_observed',
      sourceKey: null,
      sourceName: null,
      identityStatus,
      trailingTwelveMonthSalesUsd: null,
      recentSixMonthSalesUsd: null,
      priorSixMonthSalesUsd: null,
      sportRank: null,
      sportPercentile: null,
    }
  }
  const trailingTwelve = sum(selected.monthlySalesUsd.slice(-12))
  const recentSix = sum(selected.monthlySalesUsd.slice(-6))
  const priorSix = sum(selected.monthlySalesUsd.slice(-12, -6))
  const rowsByIdentity = new Map<string, GemRateRow[]>()
  for (const row of sportRows) {
    const key = normalizeItFactorName(row.subjectName)
    const identityRows = rowsByIdentity.get(key) ?? []
    identityRows.push(row)
    rowsByIdentity.set(key, identityRows)
  }
  const sortedSportRows = [...rowsByIdentity.entries()]
    .map(([identity, identityRows]) => {
      const representative = identityRows.toSorted((left, right) => (
        sum(right.monthlySalesUsd.slice(-12)) -
          sum(left.monthlySalesUsd.slice(-12)) ||
        left.subjectName.localeCompare(right.subjectName, 'en-US')
      ))[0]
      const row = identity === normalizedName ? selected : representative
      return {
        identity,
        row,
        trailingTwelve: sum(row.monthlySalesUsd.slice(-12)),
      }
    })
    .toSorted((left, right) => (
      right.trailingTwelve - left.trailingTwelve ||
      left.row.subjectName.localeCompare(right.row.subjectName, 'en-US')
    ))
  const sportRank = sortedSportRows.findIndex(
    (candidate) => candidate.identity === normalizedName,
  ) + 1
  const sportPercentile = sortedSportRows.length <= 1
    ? 100
    : rounded(
        100 * (sortedSportRows.length - sportRank) /
          (sortedSportRows.length - 1),
      )
  return {
    evidence: marketEvidence(
      sportPercentile,
      recentSix,
      priorSix,
    ),
    sourceKey: selected.sourceKey,
    sourceName: selected.subjectName,
    identityStatus,
    trailingTwelveMonthSalesUsd: trailingTwelve,
    recentSixMonthSalesUsd: recentSix,
    priorSixMonthSalesUsd: priorSix,
    sportRank,
    sportPercentile,
  }
}

function validateSources(sources: readonly ItFactorSource[]): void {
  const ids = new Set<string>()
  const urls = new Map<string, string>()
  for (const source of sources) {
    if (ids.has(source.id)) throw new Error(`Duplicate source id: ${source.id}`)
    const existingId = urls.get(source.url)
    if (existingId && existingId !== source.id) {
      throw new Error(
        `Source URL ${source.url} uses both ${existingId} and ${source.id}`,
      )
    }
    ids.add(source.id)
    urls.set(source.url, source.id)
  }
}

function validateMarketSnapshot(snapshot: GemRateSnapshot): void {
  if (
    typeof snapshot.dataThrough !== 'string' ||
    !snapshot.dataThrough ||
    typeof snapshot.rowsSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/u.test(snapshot.rowsSha256) ||
    !Array.isArray(snapshot.rows)
  ) {
    throw new Error('GemRate snapshot metadata is invalid')
  }
  for (const row of snapshot.rows) {
    if (
      !row ||
      typeof row.domain !== 'string' ||
      !row.domain ||
      typeof row.subjectName !== 'string' ||
      !row.subjectName ||
      typeof row.sourceKey !== 'string' ||
      !row.sourceKey ||
      !Array.isArray(row.monthlySalesUsd) ||
      row.monthlySalesUsd.length < 12 ||
      row.monthlySalesUsd.some((value) => (
        !Number.isFinite(value) || value < 0
      ))
    ) {
      throw new Error(
        `GemRate row is invalid: ${row?.subjectName ?? 'unknown subject'}`,
      )
    }
  }
}

function validateEntries(
  entries: readonly ItFactorCurationEntry[],
  sources: readonly ItFactorSource[],
): void {
  const sourceIds = new Set(sources.map((source) => source.id))
  const entryIds = new Set<string>()
  const playerKeys = new Set<string>()
  for (const entry of entries) {
    if (entryIds.has(entry.id)) throw new Error(`Duplicate entry id: ${entry.id}`)
    entryIds.add(entry.id)
    const playerKey = `${entry.sport}:${normalizeItFactorName(entry.playerName)}`
    if (playerKeys.has(playerKey)) {
      throw new Error(`Duplicate sport/player identity: ${playerKey}`)
    }
    playerKeys.add(playerKey)
    const range = IT_FACTOR_TIER_SCORE_RANGES[entry.tier]
    if (entry.score < range.minimum || entry.score > range.maximum) {
      throw new Error(
        `${entry.playerName} score ${entry.score} is outside ${entry.tier}`,
      )
    }
    if (entry.confidence < 50 || entry.confidence > 100) {
      throw new Error(`${entry.playerName} confidence is outside 50–100`)
    }
    if (!Number.isFinite(entry.score) || !Number.isFinite(entry.confidence)) {
      throw new Error(`${entry.playerName} has a non-finite score`)
    }
    if (!IT_FACTOR_STATUSES.includes(entry.status)) {
      throw new Error(`${entry.playerName} has an invalid status`)
    }
    if (!IT_FACTOR_TRAJECTORIES.includes(entry.trajectory)) {
      throw new Error(`${entry.playerName} has an invalid trajectory`)
    }
    if (entry.rationale.length < 45) {
      throw new Error(`${entry.playerName} needs a substantive rationale`)
    }
    if (
      entry.signals.length < 2 ||
      entry.signals.length > 6 ||
      entry.signals.some((signal) => !signal.trim())
    ) {
      throw new Error(`${entry.playerName} needs 2–6 signal labels`)
    }
    if (
      entry.recheckTriggers &&
      (
        entry.recheckTriggers.length < 1 ||
        entry.recheckTriggers.length > 4 ||
        entry.recheckTriggers.some((trigger) => !trigger.trim())
      )
    ) {
      throw new Error(`${entry.playerName} needs 1–4 recheck triggers`)
    }
    if (entry.sourceIds.length < 1) {
      throw new Error(`${entry.playerName} needs at least one research source`)
    }
    for (const sourceId of entry.sourceIds) {
      if (!sourceIds.has(sourceId)) {
        throw new Error(`${entry.playerName} references unknown ${sourceId}`)
      }
    }
  }
  for (const sport of IT_FACTOR_SPORTS) {
    const sportEntries = entries.filter((entry) => entry.sport === sport)
    for (const team of IT_FACTOR_EXPECTED_TEAMS[sport]) {
      const teamEntries = sportEntries.filter(
        (entry) => entry.teamCode === team.code,
      )
      if (teamEntries.length < 1 || teamEntries.length > 3) {
        throw new Error(
          `${sport} ${team.code} has ${teamEntries.length} entries; expected 1–3`,
        )
      }
      if (teamEntries.some((entry) => entry.teamName !== team.name)) {
        throw new Error(`${sport} ${team.code} has a noncanonical team name`)
      }
    }
    const expectedCodes = new Set(
      IT_FACTOR_EXPECTED_TEAMS[sport].map((team) => team.code),
    )
    const unexpected = sportEntries.find(
      (entry) => !expectedCodes.has(entry.teamCode),
    )
    if (unexpected) {
      throw new Error(
        `${sport} entry ${unexpected.playerName} has unknown team ` +
        unexpected.teamCode,
      )
    }
  }
}

function defaultRecheckTriggers(
  entry: ItFactorCurationEntry,
): string[] {
  if (entry.status === 'prospect') {
    return [
      'Next major prospect ranking, draft, promotion, or debut milestone.',
      'Material change in early-card sales velocity.',
    ]
  }
  if (entry.status === 'rookie') {
    return [
      'Rookie-season role change, award race, or first sustained slump.',
      'Material change in early-card sales velocity.',
    ]
  }
  if (entry.status === 'young_star') {
    return [
      'All-Star, award, injury, extension, or team-context inflection.',
      'Material change in hobby-sales scale or momentum.',
    ]
  }
  return [
    'Award, milestone, injury, retirement, or team-context inflection.',
    'Material change in cross-cycle hobby demand.',
  ]
}

export function buildItFactorBoard(
  curations: readonly ItFactorLeagueCuration[],
  marketSnapshot: GemRateSnapshot,
): ItFactorBoardResponse {
  validateMarketSnapshot(marketSnapshot)
  const sources = [
    gemRateSource,
    ...curations.flatMap((curation) => curation.sources),
  ]
  const curatedEntries = curations.flatMap((curation) => curation.entries)
  validateSources(sources)
  validateEntries(curatedEntries, sources)
  const sportOrder = new Map(
    IT_FACTOR_SPORTS.map((sport, index) => [sport, index]),
  )
  const entries: ItFactorEntry[] = curatedEntries
    .map((entry) => ({
      id: entry.id,
      player: {
        name: entry.playerName,
        normalizedName: normalizeItFactorName(entry.playerName),
        position: entry.position,
        status: entry.status,
      },
      sport: entry.sport,
      league: entry.league,
      team: {
        code: entry.teamCode,
        name: entry.teamName,
      },
      score: entry.score,
      tier: entry.tier,
      confidence: entry.confidence,
      trajectory: entry.trajectory,
      rationale: entry.rationale,
      signals: entry.signals,
      recheckTriggers:
        entry.recheckTriggers ?? defaultRecheckTriggers(entry),
      sourceIds: [...new Set([GEMRATE_SOURCE_ID, ...entry.sourceIds])],
      market: enrichMarket(entry, marketSnapshot),
      lastReviewedAt: AS_OF,
    }))
    .toSorted((left, right) => (
      (sportOrder.get(left.sport) ?? 99) -
        (sportOrder.get(right.sport) ?? 99) ||
      left.team.name.localeCompare(right.team.name, 'en-US') ||
      right.score - left.score ||
      left.player.name.localeCompare(right.player.name, 'en-US')
    ))
  const bySport = Object.fromEntries(
    IT_FACTOR_SPORTS.map((sport) => {
      const sportEntries = entries.filter((entry) => entry.sport === sport)
      return [
        sport,
        {
          teamCount: new Set(
            sportEntries.map((entry) => entry.team.code),
          ).size,
          entryCount: sportEntries.length,
        },
      ]
    }),
  ) as ItFactorBoardResponse['coverage']['bySport']
  const board: ItFactorBoardResponse = {
    schemaVersion: IT_FACTOR_SCHEMA_VERSION,
    methodVersion: IT_FACTOR_METHOD_VERSION,
    snapshot: {
      asOf: AS_OF,
      generatedAt: GENERATED_AT,
      marketDataThrough: marketSnapshot.dataThrough,
      marketRowsSha256: marketSnapshot.rowsSha256,
      nextReviewBy: NEXT_REVIEW_BY,
      status: 'current',
    },
    rubric: {
      definition:
        'The hobby narrative that a player has a credible path to enduring superstar or face-of-franchise demand.',
      scoreInterpretation:
        'A directional editorial synthesis of consensus/pedigree, loud tools, narrative heat, hobby confirmation, and marketability. It is not a probability, player projection, card-price forecast, or recommendation.',
      confidenceInterpretation:
        'Confidence measures the evidence behind the IT classification, not the chance that the player reaches the ceiling embedded in the story.',
      tierThresholds: {
        icon: '92–100 · durable, cross-cycle hobby identity',
        high: '84–91 · locked-in star or elite ceiling narrative',
        emerging: '74–83 · multi-signal narrative forming',
        watch: '60–73 · early or fragile story worth monitoring',
      },
      scoreInputs: [
        'multi-source consensus and pedigree',
        'loud, visible tools or singular play style',
        'age-adjusted production that validates the ceiling story',
        'hobby completed-sales scale and acceleration',
        'marketability, franchise context, and narrative language',
      ],
    },
    sources,
    entries,
    coverage: {
      teamCount: new Set(
        entries.map((entry) => `${entry.sport}:${entry.team.code}`),
      ).size,
      entryCount: entries.length,
      bySport,
    },
  }
  if (!isItFactorBoardResponse(board)) {
    throw new Error('Generated IT Factor board failed its runtime contract')
  }
  return board
}

async function main(): Promise<void> {
  const raw = await readFile(marketInputPath, 'utf8')
  const marketSnapshot = JSON.parse(raw) as GemRateSnapshot
  const board = buildItFactorBoard(
    [
      baseballItFactorCuration,
      footballItFactorCuration,
      basketballItFactorCuration,
      hockeyItFactorCuration,
    ],
    marketSnapshot,
  )
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(board, null, 2)}\n`, 'utf8')
  const badgeIndex: ItFactorBadgeIndex = {
    schemaVersion: IT_FACTOR_BADGE_SCHEMA_VERSION,
    snapshotAsOf: board.snapshot.asOf,
    entries: board.entries.map((entry) => ({
      id: entry.id,
      sport: entry.sport,
      player: {
        name: entry.player.name,
        normalizedName: entry.player.normalizedName,
      },
      score: entry.score,
      tier: entry.tier,
      confidence: entry.confidence,
    })),
  }
  await writeFile(
    badgeOutputPath,
    `${JSON.stringify(badgeIndex, null, 2)}\n`,
    'utf8',
  )
  const generatedAt = new Date(GENERATED_AT)
  const masterCatalog = buildHobbyMasterCatalog(
    marketSnapshot,
    generatedAt,
  )
  const graduationCatalog = buildBinderGraduationCatalog(
    generatedAt,
    undefined,
    masterCatalog,
  )
  const decisionDeskArtifact: HobbyDecisionDeskArtifact = {
    schemaVersion: HOBBY_DECISION_DESK_SCHEMA_VERSION,
    snapshot: {
      generatedAt: GENERATED_AT,
      marketDataThrough: marketSnapshot.dataThrough,
      marketRowsSha256: marketSnapshot.rowsSha256,
      itReviewedAsOf: AS_OF,
      itNextReviewBy: NEXT_REVIEW_BY,
      pathDataThrough: masterCatalog.snapshot.dataThrough,
    },
    coverage: {
      marketSports: ['baseball', 'football', 'basketball', 'hockey'],
      pathSports: ['football', 'basketball'],
      limitations: [
        'Decision Desk path intersections use the static NFL and NBA graduation universe.',
        'Baseball Graduation remains live-directory-derived and is available on the source board.',
        'Hockey has no Graduation model; its Market and IT intersections remain available.',
      ],
    },
    desk: buildHobbyDecisionDesk({
      itEntries: board.entries,
      buildItems: masterCatalog.items.filter(
        (item) => item.assessment.buildQualification.eligible,
      ),
      breakoutItems: masterCatalog.items.filter(
        (item) => item.assessment.breakoutSignal?.surfaced,
      ),
      exitItems: masterCatalog.items,
      graduationItems: graduationCatalog.items,
    }),
  }
  await writeFile(
    decisionDeskOutputPath,
    `${JSON.stringify(decisionDeskArtifact, null, 2)}\n`,
    'utf8',
  )
  console.log(
    `Wrote ${board.coverage.entryCount} IT flags across ` +
    `${board.coverage.teamCount} teams plus the Decision Desk artifacts`,
  )
}

const invokedPath = process.argv[1]
if (
  invokedPath &&
  import.meta.url === pathToFileURL(resolve(invokedPath)).href
) {
  await main()
}
