import { createHash } from 'node:crypto'
import subjectContextJson from './_data/hobby-subject-context.json' with { type: 'json' }
import type {
  HobbySubjectContextEvidence,
  HobbySubjectContextSource,
} from '../src/domain/hobbyMasterRanking.js'

const SUBJECT_CONTEXT_SCHEMA_VERSION = 'hobby-subject-context.v1' as const

interface SubjectContextBaseRow {
  gemRateSourceKey: string
  sourceId: Exclude<HobbySubjectContextSource, 'career_oracle' | null>
  identityStatus: Exclude<HobbySubjectContextEvidence, 'unavailable'>
}

export interface PersonSubjectContextRow extends SubjectContextBaseRow {
  kind: 'person'
  age: number
  ageAsOf: string
  sourceId:
    | 'backstop_player_rankings'
    | 'keeptradecut'
    | 'hashtag_basketball'
  identityStatus:
    | 'verified_player_bridge'
    | 'reviewed_player_bridge'
    | 'unique_player_bridge'
}

export interface PokemonSubjectContextRow extends SubjectContextBaseRow {
  kind: 'pokemon_character'
  introducedYear: number
  introducedGeneration: number
  nationalDexNumber: number | null
  sourceId: 'pokeapi'
  identityStatus: 'canonical_species_match' | 'merged_species_label'
}

export type HobbySubjectContextRow =
  | PersonSubjectContextRow
  | PokemonSubjectContextRow

interface HobbySubjectContextArtifact {
  schemaVersion: typeof SUBJECT_CONTEXT_SCHEMA_VERSION
  generatedAt: string
  counts: {
    rows: number
    personAgeRows: number
    pokemonIntroductionRows: number
  }
  rows: HobbySubjectContextRow[]
  contentSha256: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validIso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Number.isFinite(new Date(value).valueOf())
  )
}

function validPersonRow(
  value: Record<string, unknown>,
): boolean {
  return (
    value.kind === 'person' &&
    typeof value.age === 'number' &&
    Number.isFinite(value.age) &&
    value.age >= 10 &&
    value.age <= 100 &&
    validIso(value.ageAsOf) &&
    (
      value.sourceId === 'backstop_player_rankings' ||
      value.sourceId === 'keeptradecut' ||
      value.sourceId === 'hashtag_basketball'
    ) &&
    (
      value.identityStatus === 'verified_player_bridge' ||
      value.identityStatus === 'reviewed_player_bridge' ||
      value.identityStatus === 'unique_player_bridge'
    )
  )
}

function validPokemonRow(
  value: Record<string, unknown>,
): boolean {
  return (
    value.kind === 'pokemon_character' &&
    Number.isSafeInteger(value.introducedYear) &&
    (value.introducedYear as number) >= 1996 &&
    (value.introducedYear as number) <= 2026 &&
    Number.isSafeInteger(value.introducedGeneration) &&
    (value.introducedGeneration as number) >= 1 &&
    (value.introducedGeneration as number) <= 9 &&
    (
      value.nationalDexNumber === null ||
      (
        Number.isSafeInteger(value.nationalDexNumber) &&
        (value.nationalDexNumber as number) >= 1 &&
        (value.nationalDexNumber as number) <= 1025
      )
    ) &&
    value.sourceId === 'pokeapi' &&
    (
      value.identityStatus === 'canonical_species_match' ||
      value.identityStatus === 'merged_species_label'
    )
  )
}

export function parseHobbySubjectContextArtifact(
  value: unknown = subjectContextJson,
): HobbySubjectContextArtifact {
  if (
    !isRecord(value) ||
    value.schemaVersion !== SUBJECT_CONTEXT_SCHEMA_VERSION ||
    !validIso(value.generatedAt) ||
    !isRecord(value.counts) ||
    !Array.isArray(value.rows) ||
    typeof value.contentSha256 !== 'string'
  ) {
    throw new Error('Hobby subject context artifact is invalid')
  }
  const rows: HobbySubjectContextRow[] = []
  const sourceKeys = new Set<string>()
  for (const candidate of value.rows) {
    if (
      !isRecord(candidate) ||
      typeof candidate.gemRateSourceKey !== 'string' ||
      candidate.gemRateSourceKey.length === 0 ||
      sourceKeys.has(candidate.gemRateSourceKey) ||
      (!validPersonRow(candidate) && !validPokemonRow(candidate))
    ) {
      throw new Error('Hobby subject context row is invalid or duplicated')
    }
    sourceKeys.add(candidate.gemRateSourceKey)
    rows.push(candidate as unknown as HobbySubjectContextRow)
  }
  const personAgeRows = rows.filter((row) => row.kind === 'person').length
  const pokemonIntroductionRows =
    rows.length - personAgeRows
  if (
    value.counts.rows !== rows.length ||
    value.counts.personAgeRows !== personAgeRows ||
    value.counts.pokemonIntroductionRows !== pokemonIntroductionRows ||
    createHash('sha256').update(JSON.stringify(rows)).digest('hex') !==
      value.contentSha256
  ) {
    throw new Error('Hobby subject context artifact integrity check failed')
  }
  return {
    schemaVersion: SUBJECT_CONTEXT_SCHEMA_VERSION,
    generatedAt: value.generatedAt,
    counts: {
      rows: value.counts.rows,
      personAgeRows: value.counts.personAgeRows,
      pokemonIntroductionRows: value.counts.pokemonIntroductionRows,
    },
    rows,
    contentSha256: value.contentSha256,
  }
}

export function hobbySubjectContextBySourceKey(
  value: unknown = subjectContextJson,
): ReadonlyMap<string, HobbySubjectContextRow> {
  const artifact = parseHobbySubjectContextArtifact(value)
  return new Map(artifact.rows.map((row) => [row.gemRateSourceKey, row]))
}
