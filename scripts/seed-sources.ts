import postgres from 'postgres'
import { directDatabaseUrl } from '../db/client.js'

interface ResearchSourceSeed {
  slug: string
  name: string
  ownerUrl: string
  datasetKey: string
  description: string
  grain: string
  basis: string
  evidenceUri: string
  evidenceSha256?: string
  permissionVersion?: number
  rawRedistribution: boolean
  commercialUse: boolean
  notes: string
}

const sources: ResearchSourceSeed[] = [
  {
    slug: 'mlb-statsapi',
    name: 'MLB StatsAPI',
    ownerUrl: 'https://statsapi.mlb.com/',
    datasetKey: 'current-milb-season-stats',
    description: 'Official current-season affiliated Minor League Baseball traditional statistics and workload by level and player role.',
    grain: 'One exact-MLBAM player, role, season, and MiLB sport-level split per requested StatsAPI slice.',
    basis: 'MLB StatsAPI public endpoint subject to MLB terms of use',
    evidenceUri: 'https://www.mlb.com/official-information/terms-of-use',
    rawRedistribution: false,
    commercialUse: false,
    notes: 'Retain exact MLBAM identity and source provenance. Raw redistribution and commercial rights are not assumed; use is limited to internal research/modeling and derived display under the applicable MLB terms.',
  },
  {
    slug: 'mlb-statsapi',
    name: 'MLB StatsAPI',
    ownerUrl: 'https://statsapi.mlb.com/',
    datasetKey: 'current-milb-rosters',
    description: 'Official current affiliated Minor League Baseball full rosters, including players without current-season statistics and non-active roster statuses.',
    grain: 'One exact-MLBAM player membership per affiliated team in one atomic all-level full-roster census.',
    basis: 'MLB StatsAPI public endpoint subject to MLB terms of use',
    evidenceUri: 'https://www.mlb.com/official-information/terms-of-use',
    rawRedistribution: false,
    commercialUse: false,
    notes: 'Retain exact MLBAM identity, every raw roster status, team and parent-organization assignment, and atomic source-response provenance. Raw redistribution and commercial rights are not assumed; use is limited to internal research/modeling and derived display under the applicable MLB terms.',
  },
  {
    slug: 'fangraphs',
    name: 'FanGraphs',
    ownerUrl: 'https://www.fangraphs.com/',
    datasetKey: 'prospect-board',
    description: 'Prospect scouting snapshots and linked minor-league statistics.',
    grain: 'One scouting or statistical row per player, level, team, and requested board snapshot.',
    basis: 'User-attested research authorization',
    evidenceUri: 'https://github.com/RobCase29/baseball-oracle/blob/main/docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md',
    evidenceSha256: '259e254cbf7feac8c9d4f469410bd5eb2748169ee3ea4f7840265dcc12d6ba34',
    permissionVersion: 2,
    rawRedistribution: false,
    commercialUse: false,
    notes: 'User attested authorization for automated retrieval, research storage, internal modeling, and derived research output. Raw redistribution and commercial use are not assumed.',
  },
  {
    slug: 'prospect-savant',
    name: 'Prospect Savant',
    ownerUrl: 'https://prospectsavant.com/',
    datasetKey: 'minor-league-leaders',
    description: 'Season-level MiLB leader tables with Statcast-derived measurements, percentiles, and Prospect Savant composite metrics.',
    grain: 'One player, role, season, and level row per requested leaderboard slice.',
    basis: 'User-attested research authorization',
    evidenceUri: 'https://github.com/RobCase29/baseball-oracle/blob/main/docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md',
    evidenceSha256: '259e254cbf7feac8c9d4f469410bd5eb2748169ee3ea4f7840265dcc12d6ba34',
    permissionVersion: 2,
    rawRedistribution: false,
    commercialUse: false,
    notes: 'User attested authorization for automated retrieval, research storage, internal modeling, and derived research output. Preserve Prospect Savant provenance for provider-derived metrics. Raw redistribution and commercial use are not assumed.',
  },
  {
    slug: 'sports-reference',
    name: 'Sports Reference',
    ownerUrl: 'https://www.baseball-reference.com/',
    datasetKey: 'baseball-player-records',
    description: 'Historical professional baseball player records authorized for this research project.',
    grain: 'Source-defined player, season, game, or event record.',
    basis: 'User-attested research authorization',
    evidenceUri: 'https://github.com/RobCase29/baseball-oracle/blob/main/docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md',
    evidenceSha256: '259e254cbf7feac8c9d4f469410bd5eb2748169ee3ea4f7840265dcc12d6ba34',
    permissionVersion: 2,
    rawRedistribution: false,
    commercialUse: false,
    notes: 'User attested authorization for automated retrieval, research storage, internal modeling, and derived research output. Raw redistribution and commercial use are not assumed.',
  },
  {
    slug: 'sports-reference',
    name: 'Sports Reference',
    ownerUrl: 'https://www.baseball-reference.com/',
    datasetKey: 'baseball-exact-identity-pages',
    description: 'Canonical Baseball-Reference player pages retained as exact cross-provider identity evidence.',
    grain: 'One canonical player-page response and its explicit Sports Reference identity metadata.',
    basis: 'User-attested research authorization',
    evidenceUri: 'https://github.com/RobCase29/baseball-oracle/blob/main/docs/permissions/RESEARCH_SOURCE_ATTESTATIONS.md',
    evidenceSha256: '259e254cbf7feac8c9d4f469410bd5eb2748169ee3ea4f7840265dcc12d6ba34',
    permissionVersion: 2,
    rawRedistribution: false,
    commercialUse: false,
    notes: 'Auxiliary exact-ID evidence only. Identity resolution requires matching canonical URL, sr-bbref-id metadata, sr-chadwick-id metadata, and the pinned Chadwick key_person to MLBAM bridge. Name matching is prohibited.',
  },
  {
    slug: 'chadwick-register',
    name: 'Chadwick Baseball Register',
    ownerUrl: 'https://github.com/chadwickbureau/register',
    datasetKey: 'people-register',
    description: 'Professional baseball person identities and cross-source identifier mappings.',
    grain: 'One registered person with zero or more external identifier assertions.',
    basis: 'Open Data Commons Attribution License 1.0',
    evidenceUri: 'https://github.com/chadwickbureau/register/blob/7e23e7dfaff51b3ae72c16393703eda7e5ecad27/README.md#license',
    rawRedistribution: true,
    commercialUse: true,
    notes: 'Use requires attribution. Identity mappings are versioned assertions and may be corrected, merged, or split in later releases.',
  },
  {
    slug: 'retrosheet',
    name: 'Retrosheet',
    ownerUrl: 'https://www.retrosheet.org/',
    datasetKey: 'event-files',
    description: 'Historical MLB play-by-play, game logs, rosters, and supporting reference files.',
    grain: 'Source-defined event, game, roster, or reference record.',
    basis: 'Retrosheet data-use notice',
    evidenceUri: 'https://www.retrosheet.org/notice.txt',
    rawRedistribution: false,
    commercialUse: true,
    notes: 'Commercial use is permitted with prominent Retrosheet attribution. Raw redistribution is not inferred by this registry entry.',
  },
  {
    slug: 'sabr-lahman',
    name: 'SABR Lahman Database',
    ownerUrl: 'https://sabr.org/lahman-database/',
    datasetKey: 'lahman-database',
    description: 'MLB and Negro League season statistics, people, teams, awards, and Hall of Fame voting history.',
    grain: 'One source-defined person, player-season, team-season, award, appearance, or vote record.',
    basis: 'Creative Commons Attribution-ShareAlike 3.0',
    evidenceUri: 'https://sabr.org/lahman-database/',
    rawRedistribution: true,
    commercialUse: true,
    notes: 'Attribution and share-alike obligations must be preserved. This official current source supersedes stale third-party mirrors.',
  },
]

async function seedSources() {
  const sql = postgres(directDatabaseUrl(), {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    connect_timeout: 15,
  })

  try {
    await sql.begin(async (transaction) => {
      for (const sourceSeed of sources) {
        const [source] = await transaction<{ id: string }[]>`
          INSERT INTO catalog.source (slug, name, owner_url)
          VALUES (${sourceSeed.slug}, ${sourceSeed.name}, ${sourceSeed.ownerUrl})
          ON CONFLICT (slug) DO UPDATE SET
            name = EXCLUDED.name,
            owner_url = EXCLUDED.owner_url,
            updated_at = now()
          RETURNING id
        `

        const [dataset] = await transaction<{ id: string }[]>`
          INSERT INTO catalog.dataset (source_id, dataset_key, description, grain)
          VALUES (
            ${source.id},
            ${sourceSeed.datasetKey},
            ${sourceSeed.description},
            ${sourceSeed.grain}
          )
          ON CONFLICT (source_id, dataset_key) DO UPDATE SET
            description = EXCLUDED.description,
            grain = EXCLUDED.grain,
            updated_at = now()
          RETURNING id
        `

        await transaction`
          INSERT INTO catalog.permission_version (
            dataset_id,
            version,
            basis,
            automated_access,
            raw_storage,
            model_training,
            derived_display,
            raw_redistribution,
            commercial_use,
            valid_from,
            approved_at,
            evidence_uri,
            evidence_sha256,
            notes
          ) VALUES (
            ${dataset.id},
            ${sourceSeed.permissionVersion ?? 1},
            ${sourceSeed.basis},
            true,
            true,
            true,
            true,
            ${sourceSeed.rawRedistribution},
            ${sourceSeed.commercialUse},
            '2026-07-11T00:00:00Z'::timestamptz,
            '2026-07-11T00:00:00Z'::timestamptz,
            ${sourceSeed.evidenceUri},
            ${sourceSeed.evidenceSha256 ?? null},
            ${sourceSeed.notes}
          )
          ON CONFLICT (dataset_id, version) DO NOTHING
        `
      }
    })

    process.stdout.write(`Seeded ${sources.length} catalog datasets and permission records\n`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

seedSources().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown source seed error'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
