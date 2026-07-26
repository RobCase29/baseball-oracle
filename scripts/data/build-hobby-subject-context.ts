import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import gemRateSnapshotJson from '../../api/_data/gemrate-hobby-sales.json' with { type: 'json' }
import { buildHobbyPlayerRankingCatalog } from '../../api/_hobby-player-rankings.js'

const SCHEMA_VERSION = 'hobby-subject-context.v1' as const
const defaultBaseballSource = resolve(
  '../Checklist.BackstopCards.com/public/rankings/player-rankings.json',
)
const defaultOutput = resolve('api/_data/hobby-subject-context.json')

type SourceId =
  | 'backstop_player_rankings'
  | 'keeptradecut'
  | 'hashtag_basketball'
  | 'pokeapi'

interface PersonContextRow {
  gemRateSourceKey: string
  kind: 'person'
  age: number
  ageAsOf: string
  sourceId: Exclude<SourceId, 'pokeapi'>
  identityStatus:
    | 'verified_player_bridge'
    | 'reviewed_player_bridge'
    | 'unique_player_bridge'
}

interface PokemonContextRow {
  gemRateSourceKey: string
  kind: 'pokemon_character'
  introducedYear: number
  introducedGeneration: number
  nationalDexNumber: number | null
  sourceId: 'pokeapi'
  identityStatus: 'canonical_species_match' | 'merged_species_label'
}

type ContextRow = PersonContextRow | PokemonContextRow

interface BaseballRankingRow {
  age?: unknown
  asOf?: unknown
  binderIndex?: unknown
  gemRateSales?: {
    name?: unknown
  } | null
}

interface BaseballRankingArtifact {
  schemaVersion?: unknown
  meta?: {
    generatedAt?: unknown
    binderIndexSnapshot?: {
      snapshotId?: unknown
      dataThrough?: unknown
    }
  }
  players?: unknown
}

interface PokeApiSpeciesIndex {
  count?: unknown
  results?: unknown
}

interface PokeApiSpecies {
  name?: unknown
  url?: unknown
}

interface CliOptions {
  baseballSource: string
  pokemonSource: string
  output: string
  generatedAt: string
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function parseArguments(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key?.startsWith('--') || !value) {
      throw new Error(
        'Expected --pokemon-source PATH [--baseball-source PATH] ' +
        '[--output PATH] [--generated-at ISO]',
      )
    }
    values.set(key, value)
  }
  const pokemonSource = values.get('--pokemon-source')
  if (!pokemonSource) throw new Error('--pokemon-source is required')
  const generatedAt = values.get('--generated-at') ?? new Date().toISOString()
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('--generated-at must be an ISO timestamp')
  }
  return {
    baseballSource: resolve(
      values.get('--baseball-source') ?? defaultBaseballSource,
    ),
    pokemonSource: resolve(pokemonSource),
    output: resolve(values.get('--output') ?? defaultOutput),
    generatedAt: new Date(generatedAt).toISOString(),
  }
}

function normalizedSpeciesName(value: string): string {
  return value
    .normalize('NFKD')
    .replaceAll(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .replaceAll(/[^a-z0-9]/gu, '')
}

function generationForDexNumber(
  nationalDexNumber: number,
): { generation: number; introducedYear: number } {
  const boundaries = [
    { maximum: 151, generation: 1, introducedYear: 1996 },
    { maximum: 251, generation: 2, introducedYear: 1999 },
    { maximum: 386, generation: 3, introducedYear: 2002 },
    { maximum: 493, generation: 4, introducedYear: 2006 },
    { maximum: 649, generation: 5, introducedYear: 2010 },
    { maximum: 721, generation: 6, introducedYear: 2013 },
    { maximum: 809, generation: 7, introducedYear: 2016 },
    { maximum: 905, generation: 8, introducedYear: 2019 },
    { maximum: 1025, generation: 9, introducedYear: 2022 },
  ] as const
  const match = boundaries.find(
    (boundary) => nationalDexNumber <= boundary.maximum,
  )
  if (!match || nationalDexNumber < 1) {
    throw new Error(`Unsupported National Pokédex number ${nationalDexNumber}`)
  }
  return match
}

function sourceKeySet(): Set<string> {
  const snapshot = gemRateSnapshotJson as {
    rows?: Array<{ sourceKey?: unknown }>
  }
  if (!Array.isArray(snapshot.rows)) {
    throw new Error('GemRate hobby snapshot rows are missing')
  }
  return new Set(snapshot.rows.map((row) => {
    if (typeof row.sourceKey !== 'string' || row.sourceKey.length === 0) {
      throw new Error('GemRate hobby snapshot contains an invalid source key')
    }
    return row.sourceKey
  }))
}

async function baseballRows(
  sourcePath: string,
  validSourceKeys: ReadonlySet<string>,
): Promise<{
  rows: PersonContextRow[]
  sourceSha256: string
  generatedAt: string
  snapshotId: string
}> {
  const body = await readFile(sourcePath, 'utf8')
  const artifact = JSON.parse(body) as BaseballRankingArtifact
  if (
    artifact.schemaVersion !== 'backstop-player-rankings.v1' ||
    !Array.isArray(artifact.players)
  ) {
    throw new Error('Baseball player rankings artifact is invalid')
  }
  const generatedAt = artifact.meta?.generatedAt
  const snapshotId = artifact.meta?.binderIndexSnapshot?.snapshotId
  if (
    typeof generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(generatedAt)) ||
    typeof snapshotId !== 'string'
  ) {
    throw new Error('Baseball player rankings provenance is invalid')
  }
  const rows = (artifact.players as BaseballRankingRow[]).flatMap((player) => {
    if (
      !player.binderIndex ||
      typeof player.age !== 'number' ||
      !Number.isFinite(player.age) ||
      player.age < 10 ||
      player.age > 100 ||
      typeof player.asOf !== 'string' ||
      !Number.isFinite(Date.parse(player.asOf)) ||
      typeof player.gemRateSales?.name !== 'string'
    ) {
      return []
    }
    const gemRateSourceKey =
      `athlete|baseball|${player.gemRateSales.name}`
    if (!validSourceKeys.has(gemRateSourceKey)) {
      throw new Error(
        `Baseball age bridge is missing GemRate subject ${gemRateSourceKey}`,
      )
    }
    return [{
      gemRateSourceKey,
      kind: 'person' as const,
      age: player.age,
      ageAsOf: new Date(player.asOf).toISOString(),
      sourceId: 'backstop_player_rankings' as const,
      identityStatus: 'verified_player_bridge' as const,
    }]
  })
  return {
    rows,
    sourceSha256: sha256(body),
    generatedAt,
    snapshotId,
  }
}

function footballBasketballRows(
  validSourceKeys: ReadonlySet<string>,
): {
  rows: PersonContextRow[]
  generatedAt: string
  snapshotIds: Record<'football' | 'basketball', string>
} {
  const catalog = buildHobbyPlayerRankingCatalog()
  const rows = catalog.items.flatMap((item): PersonContextRow[] => {
    if (item.age === null) return []
    if (!validSourceKeys.has(item.identity.gemRateSourceKey)) {
      throw new Error(
        `Player age bridge is missing GemRate subject ` +
        item.identity.gemRateSourceKey,
      )
    }
    const providerSource = item.sources.find(
      (source) => source.id !== 'gemrate',
    )
    if (!providerSource) {
      throw new Error(`Player age source is missing for ${item.name}`)
    }
    return [{
      gemRateSourceKey: item.identity.gemRateSourceKey,
      kind: 'person',
      age: item.age,
      ageAsOf: new Date(providerSource.asOf).toISOString(),
      sourceId: item.sport === 'football'
        ? 'keeptradecut'
        : 'hashtag_basketball',
      identityStatus:
        item.identity.status === 'unique_normalized_name'
          ? 'unique_player_bridge'
          : 'reviewed_player_bridge',
    }]
  })
  return {
    rows,
    generatedAt: catalog.snapshotGeneratedAt,
    snapshotIds: {
      football: catalog.snapshotIdBySport.football,
      basketball: catalog.snapshotIdBySport.basketball,
    },
  }
}

async function pokemonRows(
  sourcePath: string,
  validSourceKeys: ReadonlySet<string>,
): Promise<{
  rows: PokemonContextRow[]
  sourceSha256: string
  sourceCount: number
}> {
  const body = await readFile(sourcePath, 'utf8')
  const source = JSON.parse(body) as PokeApiSpeciesIndex
  if (!Array.isArray(source.results) || source.count !== 1025) {
    throw new Error('PokéAPI species index is invalid or no longer pinned')
  }
  const speciesByNormalizedName = new Map<string, number>()
  for (const entry of source.results as PokeApiSpecies[]) {
    if (typeof entry.name !== 'string' || typeof entry.url !== 'string') {
      throw new Error('PokéAPI species row is invalid')
    }
    const match = /\/pokemon-species\/(\d+)\/?$/u.exec(entry.url)
    if (!match) throw new Error(`PokéAPI species URL is invalid: ${entry.url}`)
    const nationalDexNumber = Number(match[1])
    const normalizedName = normalizedSpeciesName(entry.name)
    if (speciesByNormalizedName.has(normalizedName)) {
      throw new Error(`Duplicate normalized PokéAPI species ${entry.name}`)
    }
    speciesByNormalizedName.set(normalizedName, nationalDexNumber)
  }

  const snapshot = gemRateSnapshotJson as {
    rows?: Array<{
      sourceKey?: unknown
      subjectType?: unknown
      subjectName?: unknown
    }>
  }
  const pokemonSubjects = (snapshot.rows ?? []).filter(
    (row) => row.subjectType === 'pokemon_character',
  )
  const rows = pokemonSubjects.map((subject): PokemonContextRow => {
    if (
      typeof subject.sourceKey !== 'string' ||
      typeof subject.subjectName !== 'string' ||
      !validSourceKeys.has(subject.sourceKey)
    ) {
      throw new Error('GemRate Pokémon subject row is invalid')
    }
    if (normalizedSpeciesName(subject.subjectName) === 'nidoran') {
      return {
        gemRateSourceKey: subject.sourceKey,
        kind: 'pokemon_character',
        introducedYear: 1996,
        introducedGeneration: 1,
        nationalDexNumber: null,
        sourceId: 'pokeapi',
        identityStatus: 'merged_species_label',
      }
    }
    const nationalDexNumber = speciesByNormalizedName.get(
      normalizedSpeciesName(subject.subjectName),
    )
    if (nationalDexNumber === undefined) {
      throw new Error(
        `No canonical PokéAPI species match for ${subject.subjectName}`,
      )
    }
    const origin = generationForDexNumber(nationalDexNumber)
    return {
      gemRateSourceKey: subject.sourceKey,
      kind: 'pokemon_character',
      introducedYear: origin.introducedYear,
      introducedGeneration: origin.generation,
      nationalDexNumber,
      sourceId: 'pokeapi',
      identityStatus: 'canonical_species_match',
    }
  })
  return {
    rows,
    sourceSha256: sha256(body),
    sourceCount: source.results.length,
  }
}

function assertUniqueRows(rows: readonly ContextRow[]): void {
  const sourceKeys = new Set<string>()
  for (const row of rows) {
    if (sourceKeys.has(row.gemRateSourceKey)) {
      throw new Error(`Duplicate subject context ${row.gemRateSourceKey}`)
    }
    sourceKeys.add(row.gemRateSourceKey)
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const validSourceKeys = sourceKeySet()
  const [baseball, pokemon] = await Promise.all([
    baseballRows(options.baseballSource, validSourceKeys),
    pokemonRows(options.pokemonSource, validSourceKeys),
  ])
  const otherSports = footballBasketballRows(validSourceKeys)
  const rows = [
    ...baseball.rows,
    ...otherSports.rows,
    ...pokemon.rows,
  ].toSorted((left, right) =>
    left.gemRateSourceKey.localeCompare(right.gemRateSourceKey, 'en-US'),
  )
  assertUniqueRows(rows)
  const personRows = rows.filter((row) => row.kind === 'person')
  const artifact = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: options.generatedAt,
    convention: {
      personAge:
        'source-reported age at ageAsOf; display metadata only and never scored',
      pokemonIntroduction:
        'original Japanese main-series generation release year; approximate character age, not first TCG card year',
    },
    sources: [
      {
        id: 'backstop_player_rankings',
        url: 'https://backstopcards.com/rankings/player-rankings.json',
        generatedAt: baseball.generatedAt,
        snapshotId: baseball.snapshotId,
        contentSha256: baseball.sourceSha256,
      },
      {
        id: 'hobby_player_rankings',
        generatedAt: otherSports.generatedAt,
        snapshotIds: otherSports.snapshotIds,
      },
      {
        id: 'pokeapi',
        url: 'https://pokeapi.co/api/v2/pokemon-species?limit=2000&offset=0',
        documentationUrl: 'https://pokeapi.co/docs/v2',
        repositoryUrl: 'https://github.com/PokeAPI/pokeapi',
        sourceCount: pokemon.sourceCount,
        contentSha256: pokemon.sourceSha256,
      },
      {
        id: 'pokemon_release_history',
        url: 'https://corporate.pokemon.com/en-us/about/',
        convention:
          'generation mapped to original Japanese main-series release year',
      },
    ],
    counts: {
      rows: rows.length,
      personAgeRows: personRows.length,
      baseballAgeRows: personRows.filter(
        (row) => row.gemRateSourceKey.startsWith('athlete|baseball|'),
      ).length,
      footballAgeRows: personRows.filter(
        (row) => row.gemRateSourceKey.startsWith('athlete|football|'),
      ).length,
      basketballAgeRows: personRows.filter(
        (row) => row.gemRateSourceKey.startsWith('athlete|basketball|'),
      ).length,
      pokemonIntroductionRows: pokemon.rows.length,
      pokemonCanonicalMatches: pokemon.rows.filter(
        (row) => row.identityStatus === 'canonical_species_match',
      ).length,
      pokemonMergedLabels: pokemon.rows.filter(
        (row) => row.identityStatus === 'merged_species_label',
      ).length,
    },
    rows,
    contentSha256: sha256(JSON.stringify(rows)),
  }
  await writeFile(options.output, `${JSON.stringify(artifact)}\n`)
  process.stdout.write(
    `Wrote ${rows.length} subject contexts to ${options.output}\n`,
  )
}

await main()
