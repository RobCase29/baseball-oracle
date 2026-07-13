import { z } from 'zod'
import {
  fetchWithRetry,
  sha256,
  stableStringify,
  type SourceRecord,
} from './shared.js'

const sourceRecordSchema = z.record(z.string(), z.unknown())

export const prospectSavantEnvelopeSchema = z
  .object({ data: z.array(sourceRecordSchema) })
  .passthrough()

export const prospectSavantRoles = ['hitters', 'pitchers'] as const
export const prospectSavantLevels = ['Rk', 'A', 'A+', 'AA', 'AAA'] as const

export type ProspectSavantRole = (typeof prospectSavantRoles)[number]
export type ProspectSavantLevel = (typeof prospectSavantLevels)[number]
export type ProspectSavantEnvelope = z.infer<typeof prospectSavantEnvelopeSchema>

export interface ProspectSavantSlice {
  role: ProspectSavantRole
  level: ProspectSavantLevel
  season: number
  pitchQualifier: number
  minAge: number
  maxAge: number
}

export interface ProspectSavantSemanticQuality {
  observedRows: number
  minimumValidFraction: number
  requiredValidRows: number
  supportedIdentifierRows: number
  expectedCoreRows: number
  validRows: number
  roleCoreRule: 'hitter_batting_line' | 'pitcher_workload_and_rates'
}

export interface ParsedProspectSavantEnvelope {
  envelope: ProspectSavantEnvelope
  semanticQuality: ProspectSavantSemanticQuality
}

export const PROSPECT_SAVANT_PARSER_VERSION = 'prospect-savant-leaders-v1'
export const PROSPECT_SAVANT_MINIMUM_VALID_FRACTION = 0.95
export const PROSPECT_SAVANT_DEFAULT_API_BASE =
  'https://oriolebird.pythonanywhere.com/'

export const prospectSavantAuditedCoverage: Readonly<
  Record<number, readonly ProspectSavantLevel[]>
> = {
  2023: ['A', 'AAA'],
  2024: ['A', 'AAA'],
  2025: ['A', 'AAA'],
  2026: ['Rk', 'A', 'A+', 'AA', 'AAA'],
}

export const prospectSavantCohortDependentMetrics = [
  'score_p',
  'p_agg',
  'power_agg',
  'd_agg',
] as const

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (!nonEmptyString(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function positiveIdentifier(value: unknown): boolean {
  const number = finiteNumber(value)
  if (number !== null) return number !== 0
  return nonEmptyString(value) && value !== '0'
}

function hasSupportedIdentifier(record: SourceRecord): boolean {
  return (
    positiveIdentifier(record.id) ||
    positiveIdentifier(record.MinorMasterId) ||
    positiveIdentifier(record.MLBAMId) ||
    nonEmptyString(record.UPURL)
  )
}

function hasExpectedCohortFields(
  record: SourceRecord,
  slice: ProspectSavantSlice,
): boolean {
  return (
    nonEmptyString(record.name) &&
    finiteNumber(record.age) !== null &&
    finiteNumber(record.season) === slice.season &&
    record.level === slice.level
  )
}

function hasExpectedRoleCore(
  record: SourceRecord,
  slice: ProspectSavantSlice,
): boolean {
  if (!hasExpectedCohortFields(record, slice)) return false

  if (slice.role === 'hitters') {
    return ['pa', 'ba', 'obp', 'slg'].every(
      (field) => finiteNumber(record[field]) !== null,
    )
  }

  return (
    finiteNumber(record.ip) !== null &&
    (finiteNumber(record.pitches) !== null ||
      finiteNumber(record.total_pitches) !== null) &&
    finiteNumber(record.krate) !== null &&
    finiteNumber(record.bbrate) !== null
  )
}

export function assertProspectSavantSemantics(
  records: readonly SourceRecord[],
  slice: ProspectSavantSlice,
): ProspectSavantSemanticQuality {
  const supportedIdentifierRows = records.filter(hasSupportedIdentifier).length
  const expectedCoreRows = records.filter((record) =>
    hasExpectedRoleCore(record, slice),
  ).length
  const validRows = records.filter(
    (record) =>
      hasSupportedIdentifier(record) && hasExpectedRoleCore(record, slice),
  ).length
  const requiredValidRows = Math.max(
    1,
    Math.ceil(records.length * PROSPECT_SAVANT_MINIMUM_VALID_FRACTION),
  )
  const quality: ProspectSavantSemanticQuality = {
    observedRows: records.length,
    minimumValidFraction: PROSPECT_SAVANT_MINIMUM_VALID_FRACTION,
    requiredValidRows,
    supportedIdentifierRows,
    expectedCoreRows,
    validRows,
    roleCoreRule:
      slice.role === 'hitters'
        ? 'hitter_batting_line'
        : 'pitcher_workload_and_rates',
  }

  if (validRows < requiredValidRows) {
    throw new Error(
      `Prospect Savant ${slice.season} ${slice.level} ${slice.role} failed ` +
        `the schema gate: ${validRows} of ${records.length} rows have a supported ` +
        `player identifier and expected role fields; requires at least ` +
        `${requiredValidRows} (identifiers ${supportedIdentifierRows}, role fields ` +
        `${expectedCoreRows})`,
    )
  }

  return quality
}

export function validateProspectSavantSlice(
  slice: ProspectSavantSlice,
): ProspectSavantSlice {
  if (!prospectSavantRoles.includes(slice.role)) {
    throw new Error(`Unsupported Prospect Savant role: ${slice.role}`)
  }
  if (!prospectSavantLevels.includes(slice.level)) {
    throw new Error(`Unsupported Prospect Savant level: ${slice.level}`)
  }
  if (!Number.isInteger(slice.season) || slice.season < 1871 || slice.season > 2100) {
    throw new Error('Prospect Savant season must be a plausible integer year')
  }
  if (!Number.isInteger(slice.pitchQualifier) || slice.pitchQualifier < 1) {
    throw new Error('Prospect Savant pitch qualifier must be a positive integer')
  }
  if (!Number.isInteger(slice.minAge) || !Number.isInteger(slice.maxAge)) {
    throw new Error('Prospect Savant age bounds must be integers')
  }
  if (slice.minAge < 0 || slice.maxAge > 100 || slice.minAge > slice.maxAge) {
    throw new Error('Prospect Savant age bounds are invalid')
  }
  return slice
}

export function buildProspectSavantLeadersUrl(
  slice: ProspectSavantSlice,
  apiBase = PROSPECT_SAVANT_DEFAULT_API_BASE,
): string {
  validateProspectSavantSlice(slice)
  const base = new URL(apiBase)
  const path = [
    'leaders',
    slice.role,
    slice.level,
    slice.season,
    slice.pitchQualifier,
    slice.minAge,
    slice.maxAge,
  ]
    .map((part) => encodeURIComponent(String(part)))
    .join('/')

  return new URL(path, base.href.endsWith('/') ? base : `${base.href}/`).toString()
}

export function parseProspectSavantEnvelope(
  body: string,
  slice: ProspectSavantSlice,
): ParsedProspectSavantEnvelope {
  validateProspectSavantSlice(slice)
  const envelope = prospectSavantEnvelopeSchema.parse(JSON.parse(body))
  return {
    envelope,
    semanticQuality: assertProspectSavantSemantics(envelope.data, slice),
  }
}

function identifier(record: SourceRecord): string {
  for (const key of ['id', 'MinorMasterId', 'MLBAMId', 'UPURL']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return `${key}:${value.trim()}`
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
      return `${key}:${value}`
    }
  }
  return `hash:${sha256(stableStringify(record)).slice(0, 24)}`
}

export function prospectSavantSourceRecordKey(
  record: SourceRecord,
  slice: ProspectSavantSlice,
): string {
  validateProspectSavantSlice(slice)
  return [
    identifier(record),
    `role:${slice.role}`,
    `season:${slice.season}`,
    `level:${slice.level}`,
    `qualifier:${slice.pitchQualifier}`,
    `ages:${slice.minAge}-${slice.maxAge}`,
  ].join('|')
}

export function buildProspectSavantHistoricalSlices(options: {
  roles?: readonly ProspectSavantRole[]
  seasons?: readonly number[]
  levels?: readonly ProspectSavantLevel[]
  pitchQualifier?: number
  minAge?: number
  maxAge?: number
} = {}): ProspectSavantSlice[] {
  const roles = options.roles ?? prospectSavantRoles
  const seasonFilter = options.seasons ? new Set(options.seasons) : null
  const levelFilter = options.levels ? new Set(options.levels) : null
  const slices: ProspectSavantSlice[] = []

  for (const [seasonText, coveredLevels] of Object.entries(
    prospectSavantAuditedCoverage,
  )) {
    const season = Number(seasonText)
    if (seasonFilter && !seasonFilter.has(season)) continue

    for (const level of coveredLevels) {
      if (levelFilter && !levelFilter.has(level)) continue
      for (const role of roles) {
        slices.push(
          validateProspectSavantSlice({
            role,
            level,
            season,
            pitchQualifier: options.pitchQualifier ?? 1,
            minAge: options.minAge ?? 16,
            maxAge: options.maxAge ?? 40,
          }),
        )
      }
    }
  }

  return slices
}

export function buildProspectSavantCurrentSlices(season: number): ProspectSavantSlice[] {
  return prospectSavantLevels.flatMap((level) =>
    prospectSavantRoles.map((role) =>
      validateProspectSavantSlice({
        role,
        level,
        season,
        pitchQualifier: 1,
        minAge: 16,
        maxAge: 40,
      }),
    ),
  )
}

export async function fetchProspectSavantLeaders(url: string): Promise<Response> {
  return fetchWithRetry(url, {
    sourceName: 'Prospect Savant',
    headers: {
      Accept: 'application/json',
      'User-Agent':
        'BaseballOracleResearch/0.1 (+https://github.com/RobCase29/baseball-oracle)',
    },
    timeoutMs: 60_000,
  })
}
