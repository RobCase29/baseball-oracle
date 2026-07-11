import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const catalog = pgSchema('catalog')
const raw = pgSchema('raw')
const core = pgSchema('core')
const ml = pgSchema('ml')

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

export const sources = catalog.table('source', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  ownerUrl: text('owner_url'),
  status: text('status').notNull().default('active'),
  ...timestamps,
})

export const datasets = catalog.table(
  'dataset',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').notNull().references(() => sources.id),
    datasetKey: text('dataset_key').notNull(),
    description: text('description'),
    grain: text('grain').notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('dataset_source_key_uidx').on(table.sourceId, table.datasetKey),
  ],
)

export const permissionVersions = catalog.table(
  'permission_version',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetId: uuid('dataset_id').notNull().references(() => datasets.id),
    version: integer('version').notNull(),
    basis: text('basis').notNull(),
    automatedAccess: boolean('automated_access').notNull().default(false),
    rawStorage: boolean('raw_storage').notNull().default(false),
    modelTraining: boolean('model_training').notNull().default(false),
    derivedDisplay: boolean('derived_display').notNull().default(false),
    rawRedistribution: boolean('raw_redistribution').notNull().default(false),
    commercialUse: boolean('commercial_use').notNull().default(false),
    validFrom: timestamp('valid_from', { withTimezone: true }).notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    evidenceUri: text('evidence_uri'),
    evidenceSha256: text('evidence_sha256'),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('permission_dataset_version_uidx').on(table.datasetId, table.version),
    index('permission_dataset_valid_idx').on(table.datasetId, table.validFrom),
    check('permission_valid_window_chk', sql`${table.validTo} is null or ${table.validTo} > ${table.validFrom}`),
  ],
)

export const ingestionRuns = raw.table(
  'ingestion_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetId: uuid('dataset_id').notNull().references(() => datasets.id),
    permissionVersionId: uuid('permission_version_id').notNull().references(() => permissionVersions.id),
    idempotencyKey: text('idempotency_key').notNull(),
    mode: text('mode').notNull().default('incremental'),
    requestedAsOf: timestamp('requested_as_of', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: text('status').notNull(),
    codeCommit: text('code_commit'),
    parserVersion: text('parser_version').notNull(),
    parameters: jsonb('parameters').$type<Record<string, unknown>>().notNull().default({}),
    counts: jsonb('counts').$type<Record<string, unknown>>().notNull().default({}),
    error: jsonb('error').$type<Record<string, unknown>>(),
  },
  (table) => [
    uniqueIndex('ingestion_dataset_key_uidx').on(table.datasetId, table.idempotencyKey),
    index('ingestion_dataset_started_idx').on(table.datasetId, table.startedAt),
    index('ingestion_status_started_idx').on(table.status, table.startedAt),
    check('ingestion_status_chk', sql`${table.status} in ('running', 'succeeded', 'failed', 'skipped')`),
  ],
)

export const rawBlobs = raw.table(
  'blob',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sha256: text('sha256').notNull(),
    byteLength: integer('byte_length').notNull(),
    mediaType: text('media_type').notNull(),
    contentEncoding: text('content_encoding'),
    bodyText: text('body_text'),
    objectUri: text('object_uri'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('blob_sha256_uidx').on(table.sha256),
    check('blob_length_chk', sql`${table.byteLength} >= 0`),
    check(
      'blob_storage_chk',
      sql`((${table.bodyText} is not null)::integer + (${table.objectUri} is not null)::integer) = 1`,
    ),
  ],
)

export const fetches = raw.table(
  'fetch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id').notNull().references(() => ingestionRuns.id),
    blobId: uuid('blob_id').notNull().references(() => rawBlobs.id),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    sanitizedRequest: jsonb('sanitized_request').$type<Record<string, unknown>>().notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    statusCode: integer('status_code').notNull(),
    etag: text('etag'),
    lastModified: text('last_modified'),
    responseHeaders: jsonb('response_headers').$type<Record<string, string>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex('fetch_run_request_uidx').on(table.runId, table.requestFingerprint),
    index('fetch_fetched_brin_idx').using('brin', table.fetchedAt),
  ],
)

export const rawRecords = raw.table(
  'record',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fetchId: uuid('fetch_id').notNull().references(() => fetches.id),
    ordinal: integer('ordinal').notNull(),
    recordType: text('record_type').notNull(),
    sourceRecordKey: text('source_record_key').notNull(),
    recordSha256: text('record_sha256').notNull(),
    recordJson: jsonb('record_json').$type<Record<string, unknown>>().notNull(),
    parserSchemaVersion: text('parser_schema_version').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('record_fetch_ordinal_uidx').on(table.fetchId, table.ordinal),
    uniqueIndex('record_fetch_source_key_uidx').on(table.fetchId, table.recordType, table.sourceRecordKey),
    index('record_source_key_idx').on(table.recordType, table.sourceRecordKey),
    index('record_ingested_brin_idx').using('brin', table.ingestedAt),
    check('record_ordinal_chk', sql`${table.ordinal} >= 0`),
    check(
      'record_source_key_length_chk',
      sql`octet_length(${table.sourceRecordKey}) <= 512`,
    ),
  ],
)

export const players = core.table('player', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const externalNamespaces = core.table(
  'external_namespace',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceId: uuid('source_id').notNull().references(() => sources.id),
    namespaceKey: text('namespace_key').notNull(),
    description: text('description'),
  },
  (table) => [uniqueIndex('external_namespace_source_key_uidx').on(table.sourceId, table.namespaceKey)],
)

export const externalIdentities = core.table(
  'external_identity',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    namespaceId: uuid('namespace_id').notNull().references(() => externalNamespaces.id),
    externalKey: text('external_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('external_identity_namespace_key_uidx').on(table.namespaceId, table.externalKey)],
)

export const identityAssignments = core.table(
  'identity_assignment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    externalIdentityId: uuid('external_identity_id').notNull().references(() => externalIdentities.id),
    playerId: uuid('player_id').notNull().references(() => players.id),
    assertingDatasetId: uuid('asserting_dataset_id').notNull().references(() => datasets.id),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    knownAt: timestamp('known_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    confidence: numeric('confidence', { precision: 5, scale: 4 }).notNull(),
    reviewStatus: text('review_status').notNull().default('pending'),
    method: text('method').notNull(),
    evidence: jsonb('evidence').$type<Record<string, unknown>>().notNull().default({}),
    rawRecordId: uuid('raw_record_id').references(() => rawRecords.id),
    revisionNo: integer('revision_no').notNull().default(1),
    supersedesId: uuid('supersedes_id'),
  },
  (table) => [
    uniqueIndex('identity_assignment_revision_uidx').on(table.externalIdentityId, table.revisionNo),
    uniqueIndex('identity_assignment_supersedes_uidx').on(table.supersedesId),
    index('identity_assignment_lookup_idx').on(table.externalIdentityId, table.knownAt, table.revisionNo),
    index('identity_assignment_player_idx').on(table.playerId, table.knownAt),
    check('identity_assignment_confidence_chk', sql`${table.confidence} between 0 and 1`),
    check('identity_assignment_window_chk', sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`),
  ],
)

export const playerBioObservations = core.table(
  'player_bio_observation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id').notNull().references(() => players.id),
    datasetId: uuid('dataset_id').notNull().references(() => datasets.id),
    rawRecordId: uuid('raw_record_id').references(() => rawRecords.id),
    sourceRecordKey: text('source_record_key').notNull(),
    displayName: text('display_name'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    birthDate: date('birth_date'),
    bats: text('bats'),
    throws: text('throws'),
    position: text('position'),
    knownAt: timestamp('known_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    revisionNo: integer('revision_no').notNull().default(1),
    contentSha256: text('content_sha256').notNull(),
  },
  (table) => [
    uniqueIndex('bio_dataset_record_revision_uidx').on(table.datasetId, table.sourceRecordKey, table.revisionNo),
    index('bio_player_known_idx').on(table.playerId, table.knownAt),
  ],
)

export const observations = core.table(
  'observation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    playerId: uuid('player_id').notNull().references(() => players.id),
    datasetId: uuid('dataset_id').notNull().references(() => datasets.id),
    sourceRecordKey: text('source_record_key').notNull(),
    rawRecordId: uuid('raw_record_id').references(() => rawRecords.id),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    knownAt: timestamp('known_at', { withTimezone: true }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
    revisionNo: integer('revision_no').notNull().default(1),
    supersedesId: uuid('supersedes_id'),
    isRetraction: boolean('is_retraction').notNull().default(false),
    contentSha256: text('content_sha256').notNull(),
  },
  (table) => [
    uniqueIndex('observation_revision_uidx').on(table.datasetId, table.sourceRecordKey, table.revisionNo),
    uniqueIndex('observation_supersedes_uidx').on(table.supersedesId),
    index('observation_player_known_idx').on(table.playerId, table.kind, table.knownAt),
    check('observation_effective_window_chk', sql`${table.effectiveTo} is null or ${table.effectiveTo} > ${table.effectiveFrom}`),
    check('observation_known_chk', sql`${table.knownAt} is null or ${table.knownAt} <= ${table.ingestedAt}`),
  ],
)

export const scoutingPublications = core.table(
  'scouting_publication',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetId: uuid('dataset_id').notNull().references(() => datasets.id),
    publicationKey: text('publication_key').notNull(),
    listName: text('list_name').notNull(),
    edition: text('edition'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    universeDescription: text('universe_description'),
    universeSize: integer('universe_size'),
    rawRecordId: uuid('raw_record_id').references(() => rawRecords.id),
  },
  (table) => [uniqueIndex('scouting_publication_key_uidx').on(table.datasetId, table.publicationKey)],
)

export const scoutingObservations = core.table(
  'scouting_observation',
  {
    observationId: uuid('observation_id').primaryKey().references(() => observations.id),
    publicationId: uuid('publication_id').references(() => scoutingPublications.id),
    rank: integer('rank'),
    rankUniverseSize: integer('rank_universe_size'),
    projectedRole: text('projected_role'),
    position: text('position'),
    presentValueRaw: text('present_value_raw'),
    futureValueRaw: text('future_value_raw'),
    riskRaw: text('risk_raw'),
    etaYear: integer('eta_year'),
    grades: jsonb('grades').$type<Record<string, { present?: string; future?: string }>>().notNull().default({}),
    tldr: text('tldr'),
    summary: text('summary'),
  },
  (table) => [
    index('scouting_publication_rank_idx').on(table.publicationId, table.rank),
    check('scouting_eta_chk', sql`${table.etaYear} is null or ${table.etaYear} between 1900 and 2200`),
  ],
)

export const statObservations = core.table(
  'stat_observation',
  {
    observationId: uuid('observation_id').primaryKey().references(() => observations.id),
    providerNamespace: text('provider_namespace').notNull(),
    role: text('role').notNull(),
    season: integer('season').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    level: text('level'),
    teamKey: text('team_key'),
    splitKey: jsonb('split_key').$type<Record<string, unknown>>().notNull().default({}),
    countingStats: jsonb('counting_stats').$type<Record<string, number | null>>().notNull().default({}),
    rateStats: jsonb('rate_stats').$type<Record<string, number | null>>().notNull().default({}),
    valueStats: jsonb('value_stats').$type<Record<string, number | null>>().notNull().default({}),
  },
  (table) => [
    index('stat_season_level_idx').on(table.season, table.level),
    check('stat_season_chk', sql`${table.season} between 1800 and 2200`),
  ],
)

export const datasetManifests = ml.table(
  'dataset_manifest',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    manifestKey: text('manifest_key').notNull(),
    version: integer('version').notNull(),
    datasetKind: text('dataset_kind').notNull(),
    schemaVersion: text('schema_version').notNull(),
    universeDefinitionVersion: text('universe_definition_version').notNull(),
    codeCommit: text('code_commit').notNull(),
    asOfStart: timestamp('as_of_start', { withTimezone: true }),
    asOfEnd: timestamp('as_of_end', { withTimezone: true }),
    sourceLineage: jsonb('source_lineage').$type<Record<string, unknown>>().notNull(),
    qualityReport: jsonb('quality_report').$type<Record<string, unknown>>().notNull().default({}),
    storageUri: text('storage_uri').notNull(),
    rowCount: bigint('row_count', { mode: 'bigint' }).notNull(),
    contentSha256: text('content_sha256').notNull(),
    manifestSha256: text('manifest_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('dataset_manifest_key_version_uq').on(table.manifestKey, table.version),
    unique('dataset_manifest_sha_uq').on(table.manifestSha256),
    index('dataset_manifest_kind_created_idx').on(table.datasetKind, table.createdAt.desc()),
    check('dataset_manifest_version_chk', sql`${table.version} > 0`),
    check(
      'dataset_manifest_kind_chk',
      sql`${table.datasetKind} in ('features', 'labels', 'training', 'evaluation', 'prediction')`,
    ),
    check('dataset_manifest_row_count_chk', sql`${table.rowCount} >= 0`),
    check('dataset_manifest_content_sha_chk', sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check('dataset_manifest_manifest_sha_chk', sql`${table.manifestSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      'dataset_manifest_window_chk',
      sql`${table.asOfEnd} is null or ${table.asOfStart} is null or ${table.asOfEnd} >= ${table.asOfStart}`,
    ),
  ],
)

export const featureSnapshots = ml.table(
  'feature_snapshot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetManifestId: uuid('dataset_manifest_id').notNull().references(() => datasetManifests.id),
    playerId: uuid('player_id').notNull().references(() => players.id),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    featureSetKey: text('feature_set_key').notNull(),
    featureSetVersion: text('feature_set_version').notNull(),
    featureSetHash: text('feature_set_hash').notNull(),
    featureSha256: text('feature_sha256').notNull(),
    features: jsonb('features').$type<Record<string, unknown>>().notNull(),
    maxSourceKnownAt: timestamp('max_source_known_at', { withTimezone: true }).notNull(),
    completeness: numeric('completeness', { precision: 5, scale: 4 }).notNull(),
    qualityStatus: text('quality_status').notNull(),
    qualityReport: jsonb('quality_report').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('feature_snapshot_natural_uq').on(
      table.datasetManifestId,
      table.playerId,
      table.asOf,
      table.featureSetKey,
      table.featureSetVersion,
    ),
    index('feature_snapshot_player_asof_idx').on(table.playerId, table.asOf.desc()),
    index('feature_snapshot_manifest_asof_idx').on(table.datasetManifestId, table.asOf),
    check('feature_snapshot_set_hash_chk', sql`${table.featureSetHash} ~ '^[0-9a-f]{64}$'`),
    check('feature_snapshot_sha_chk', sql`${table.featureSha256} ~ '^[0-9a-f]{64}$'`),
    check('feature_snapshot_known_at_chk', sql`${table.maxSourceKnownAt} <= ${table.asOf}`),
    check('feature_snapshot_completeness_chk', sql`${table.completeness} between 0 and 1`),
    check('feature_snapshot_quality_chk', sql`${table.qualityStatus} in ('passed', 'quarantined')`),
  ],
)

export const outcomeLabels = ml.table(
  'outcome_label',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetManifestId: uuid('dataset_manifest_id').notNull().references(() => datasetManifests.id),
    featureSnapshotId: uuid('feature_snapshot_id').notNull().references(() => featureSnapshots.id),
    targetKey: text('target_key').notNull(),
    targetVersion: text('target_version').notNull(),
    horizonKey: text('horizon_key').notNull(),
    horizonMonths: smallint('horizon_months'),
    outcomeState: text('outcome_state').notNull(),
    numericValue: numeric('numeric_value', { precision: 18, scale: 6 }),
    labelPayload: jsonb('label_payload').$type<Record<string, unknown>>().notNull().default({}),
    eventAt: timestamp('event_at', { withTimezone: true }),
    censoredAt: timestamp('censored_at', { withTimezone: true }),
    followupThrough: timestamp('followup_through', { withTimezone: true }).notNull(),
    labelAvailableAt: timestamp('label_available_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('outcome_label_natural_uq').on(
      table.datasetManifestId,
      table.featureSnapshotId,
      table.targetKey,
      table.targetVersion,
      table.horizonKey,
    ),
    index('outcome_label_snapshot_target_idx').on(
      table.featureSnapshotId,
      table.targetKey,
      table.targetVersion,
    ),
    index('outcome_label_manifest_state_idx').on(table.datasetManifestId, table.outcomeState),
    check('outcome_label_horizon_chk', sql`${table.horizonMonths} is null or ${table.horizonMonths} > 0`),
    check(
      'outcome_label_state_chk',
      sql`${table.outcomeState} in ('observed_event', 'observed_non_event', 'right_censored', 'lost_to_coverage', 'confirmed_terminal_exit')`,
    ),
    check(
      'outcome_label_event_chk',
      sql`(${table.outcomeState} = 'observed_event' and ${table.eventAt} is not null) or (${table.outcomeState} <> 'observed_event' and ${table.eventAt} is null)`,
    ),
    check(
      'outcome_label_censor_chk',
      sql`(${table.outcomeState} in ('right_censored', 'lost_to_coverage') and ${table.censoredAt} is not null and ${table.numericValue} is null) or (${table.outcomeState} not in ('right_censored', 'lost_to_coverage') and ${table.censoredAt} is null)`,
    ),
    check(
      'outcome_label_followup_chk',
      sql`(${table.eventAt} is null or ${table.eventAt} <= ${table.followupThrough}) and (${table.censoredAt} is null or ${table.censoredAt} <= ${table.followupThrough}) and ${table.labelAvailableAt} >= ${table.followupThrough}`,
    ),
    check(
      'outcome_label_value_chk',
      sql`${table.outcomeState} in ('right_censored', 'lost_to_coverage') or ${table.numericValue} is not null or ${table.labelPayload} <> '{}'::jsonb`,
    ),
  ],
)

export const temporalSplitManifests = ml.table(
  'temporal_split_manifest',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    datasetManifestId: uuid('dataset_manifest_id').notNull().references(() => datasetManifests.id),
    splitKey: text('split_key').notNull(),
    version: integer('version').notNull(),
    targetKey: text('target_key').notNull(),
    targetVersion: text('target_version').notNull(),
    horizonKey: text('horizon_key').notNull(),
    strategy: text('strategy').notNull(),
    clusterKey: text('cluster_key').notNull(),
    definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
    contentSha256: text('content_sha256').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('temporal_split_manifest_key_version_uq').on(table.splitKey, table.version),
    unique('temporal_split_manifest_sha_uq').on(table.contentSha256),
    unique('temporal_split_manifest_id_dataset_uq').on(table.id, table.datasetManifestId),
    index('temporal_split_manifest_dataset_idx').on(
      table.datasetManifestId,
      table.createdAt.desc(),
    ),
    check('temporal_split_manifest_version_chk', sql`${table.version} > 0`),
    check(
      'temporal_split_manifest_strategy_chk',
      sql`${table.strategy} in ('rolling_origin', 'expanding_window', 'era_holdout', 'fixed_temporal')`,
    ),
    check('temporal_split_manifest_sha_chk', sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`),
  ],
)

export const temporalSplitFolds = ml.table(
  'temporal_split_fold',
  {
    splitManifestId: uuid('split_manifest_id').notNull().references(() => temporalSplitManifests.id),
    foldNo: integer('fold_no').notNull(),
    trainingStart: timestamp('training_start', { withTimezone: true }),
    trainingEnd: timestamp('training_end', { withTimezone: true }).notNull(),
    trainingLabelCutoff: timestamp('training_label_cutoff', { withTimezone: true }).notNull(),
    calibrationStart: timestamp('calibration_start', { withTimezone: true }),
    calibrationEnd: timestamp('calibration_end', { withTimezone: true }),
    calibrationLabelCutoff: timestamp('calibration_label_cutoff', { withTimezone: true }),
    evaluationStart: timestamp('evaluation_start', { withTimezone: true }).notNull(),
    evaluationEnd: timestamp('evaluation_end', { withTimezone: true }).notNull(),
    evaluationLabelCutoff: timestamp('evaluation_label_cutoff', { withTimezone: true }).notNull(),
    holdoutStart: timestamp('holdout_start', { withTimezone: true }),
    holdoutEnd: timestamp('holdout_end', { withTimezone: true }),
    holdoutLabelCutoff: timestamp('holdout_label_cutoff', { withTimezone: true }),
    embargoDays: integer('embargo_days').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.splitManifestId, table.foldNo] }),
    check('temporal_split_fold_number_chk', sql`${table.foldNo} >= 0`),
    check('temporal_split_fold_embargo_chk', sql`${table.embargoDays} >= 0`),
    check(
      'temporal_split_fold_training_chk',
      sql`(${table.trainingStart} is null or ${table.trainingStart} <= ${table.trainingEnd}) and ${table.trainingLabelCutoff} >= ${table.trainingEnd} and ${table.trainingLabelCutoff} <= ${table.evaluationStart}`,
    ),
    check(
      'temporal_split_fold_calibration_chk',
      sql`(${table.calibrationStart} is null and ${table.calibrationEnd} is null and ${table.calibrationLabelCutoff} is null) or (${table.calibrationStart} is not null and ${table.calibrationEnd} is not null and ${table.calibrationLabelCutoff} is not null and ${table.calibrationStart} > ${table.trainingEnd} and ${table.calibrationEnd} >= ${table.calibrationStart} and ${table.calibrationLabelCutoff} >= ${table.calibrationEnd} and ${table.calibrationLabelCutoff} <= ${table.evaluationStart})`,
    ),
    check(
      'temporal_split_fold_evaluation_chk',
      sql`${table.evaluationEnd} >= ${table.evaluationStart} and ${table.evaluationLabelCutoff} >= ${table.evaluationEnd} and ${table.evaluationStart} >= (coalesce(${table.calibrationEnd}, ${table.trainingEnd}) + ${table.embargoDays} * interval '1 day')`,
    ),
    check(
      'temporal_split_fold_holdout_chk',
      sql`(${table.holdoutStart} is null and ${table.holdoutEnd} is null and ${table.holdoutLabelCutoff} is null) or (${table.holdoutStart} is not null and ${table.holdoutEnd} is not null and ${table.holdoutLabelCutoff} is not null and ${table.holdoutEnd} >= ${table.holdoutStart} and ${table.holdoutLabelCutoff} >= ${table.holdoutEnd})`,
    ),
  ],
)

export const temporalSplitAssignments = ml.table(
  'temporal_split_assignment',
  {
    splitManifestId: uuid('split_manifest_id').notNull(),
    foldNo: integer('fold_no').notNull(),
    featureSnapshotId: uuid('feature_snapshot_id').notNull().references(() => featureSnapshots.id),
    outcomeLabelId: uuid('outcome_label_id').notNull().references(() => outcomeLabels.id),
    partition: text('partition').notNull(),
    clusterId: text('cluster_id').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.splitManifestId, table.foldNo, table.featureSnapshotId] }),
    foreignKey({
      columns: [table.splitManifestId, table.foldNo],
      foreignColumns: [temporalSplitFolds.splitManifestId, temporalSplitFolds.foldNo],
      name: 'temporal_split_assignment_fold_fk',
    }),
    index('temporal_split_assignment_partition_idx').on(
      table.splitManifestId,
      table.foldNo,
      table.partition,
    ),
    index('temporal_split_assignment_cluster_idx').on(
      table.splitManifestId,
      table.foldNo,
      table.clusterId,
    ),
    index('temporal_split_assignment_label_idx').on(table.outcomeLabelId),
    check(
      'temporal_split_assignment_partition_chk',
      sql`${table.partition} in ('train', 'calibration', 'evaluation', 'holdout')`,
    ),
  ],
)

export const trainingRuns = ml.table(
  'training_run',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runKey: text('run_key').notNull(),
    attempt: integer('attempt').notNull(),
    modelKey: text('model_key').notNull(),
    targetKey: text('target_key').notNull(),
    targetVersion: text('target_version').notNull(),
    horizonKey: text('horizon_key').notNull(),
    datasetManifestId: uuid('dataset_manifest_id').notNull().references(() => datasetManifests.id),
    splitManifestId: uuid('split_manifest_id').notNull(),
    featureSetHash: text('feature_set_hash').notNull(),
    codeCommit: text('code_commit').notNull(),
    environmentSha256: text('environment_sha256').notNull(),
    configSha256: text('config_sha256').notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().notNull(),
    randomSeed: integer('random_seed').notNull(),
    status: text('status').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
    metrics: jsonb('metrics').$type<Record<string, unknown>>().notNull().default({}),
    qualityReport: jsonb('quality_report').$type<Record<string, unknown>>().notNull().default({}),
    error: jsonb('error').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('training_run_key_attempt_uq').on(table.runKey, table.attempt),
    foreignKey({
      columns: [table.splitManifestId, table.datasetManifestId],
      foreignColumns: [temporalSplitManifests.id, temporalSplitManifests.datasetManifestId],
      name: 'training_run_split_dataset_fk',
    }),
    index('training_run_model_finished_idx').on(
      table.modelKey,
      table.targetKey,
      table.finishedAt.desc(),
    ),
    index('training_run_manifest_idx').on(table.datasetManifestId, table.splitManifestId),
    check('training_run_attempt_chk', sql`${table.attempt} > 0`),
    check('training_run_feature_hash_chk', sql`${table.featureSetHash} ~ '^[0-9a-f]{64}$'`),
    check('training_run_environment_sha_chk', sql`${table.environmentSha256} ~ '^[0-9a-f]{64}$'`),
    check('training_run_config_sha_chk', sql`${table.configSha256} ~ '^[0-9a-f]{64}$'`),
    check('training_run_status_chk', sql`${table.status} in ('succeeded', 'failed', 'cancelled')`),
    check('training_run_window_chk', sql`${table.finishedAt} >= ${table.startedAt}`),
    check('training_run_error_chk', sql`${table.status} <> 'succeeded' or ${table.error} is null`),
  ],
)

export const trainingArtifacts = ml.table(
  'training_artifact',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trainingRunId: uuid('training_run_id').notNull().references(() => trainingRuns.id),
    artifactKey: text('artifact_key').notNull(),
    version: integer('version').notNull(),
    artifactKind: text('artifact_kind').notNull(),
    storageUri: text('storage_uri').notNull(),
    mediaType: text('media_type').notNull(),
    sha256: text('sha256').notNull(),
    byteLength: bigint('byte_length', { mode: 'bigint' }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('training_artifact_key_version_uq').on(
      table.trainingRunId,
      table.artifactKey,
      table.version,
    ),
    index('training_artifact_run_kind_idx').on(table.trainingRunId, table.artifactKind),
    check('training_artifact_version_chk', sql`${table.version} > 0`),
    check(
      'training_artifact_kind_chk',
      sql`${table.artifactKind} in ('model', 'calibrator', 'metrics', 'environment', 'feature_importance', 'validation_report', 'log')`,
    ),
    check('training_artifact_sha_chk', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
    check('training_artifact_length_chk', sql`${table.byteLength} >= 0`),
  ],
)

export const modelReleases = ml.table(
  'model_release',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    modelKey: text('model_key').notNull(),
    version: text('version').notNull(),
    targetKey: text('target_key').notNull(),
    trainedAt: timestamp('trained_at', { withTimezone: true }).notNull(),
    trainingCutoff: timestamp('training_cutoff', { withTimezone: true }).notNull(),
    codeCommit: text('code_commit').notNull(),
    featureSetHash: text('feature_set_hash').notNull(),
    validationMetrics: jsonb('validation_metrics').$type<Record<string, unknown>>().notNull(),
    status: text('status').notNull().default('candidate'),
    trainingRunId: uuid('training_run_id').references(() => trainingRuns.id),
  },
  (table) => [
    unique('model_release_key_version_uq').on(table.modelKey, table.version),
    index('model_release_training_run_idx').on(table.trainingRunId),
  ],
)

export const predictionBatches = ml.table(
  'prediction_batch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    bundleVersion: text('bundle_version').notNull(),
    status: text('status').notNull().default('building'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    validationReport: jsonb('validation_report').$type<Record<string, unknown>>(),
  },
  (table) => [
    unique('prediction_batch_asof_bundle_uq').on(table.asOf, table.bundleVersion),
    check('prediction_batch_status_chk', sql`${table.status} in ('building', 'validated', 'published', 'rejected')`),
    check(
      'prediction_batch_publication_chk',
      sql`(${table.status} = 'published') = (${table.publishedAt} is not null)`,
    ),
  ],
)

export const predictionSnapshots = ml.table(
  'prediction_snapshot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id').notNull().references(() => predictionBatches.id),
    playerId: uuid('player_id').notNull().references(() => players.id),
    arrivalModelReleaseId: uuid('arrival_model_release_id').references(() => modelReleases.id),
    careerModelReleaseId: uuid('career_model_release_id').references(() => modelReleases.id),
    featureSnapshotId: uuid('feature_snapshot_id').references(() => featureSnapshots.id),
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    dataQualityGrade: text('data_quality_grade').notNull(),
    completeness: numeric('completeness', { precision: 5, scale: 4 }).notNull(),
    outOfDistributionScore: numeric('out_of_distribution_score', { precision: 7, scale: 4 }),
    explanation: jsonb('explanation').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('prediction_batch_player_uq').on(table.batchId, table.playerId),
    index('prediction_player_asof_idx').on(table.playerId, table.asOf.desc()),
    index('prediction_feature_snapshot_idx').on(table.featureSnapshotId),
    check('prediction_completeness_chk', sql`${table.completeness} between 0 and 1`),
  ],
)

export const arrivalProbabilities = ml.table(
  'arrival_probability',
  {
    snapshotId: uuid('snapshot_id').notNull().references(() => predictionSnapshots.id),
    horizonMonths: smallint('horizon_months').notNull(),
    probability: numeric('probability', { precision: 6, scale: 5 }).notNull(),
    calibrationLow: numeric('calibration_low', { precision: 6, scale: 5 }),
    calibrationHigh: numeric('calibration_high', { precision: 6, scale: 5 }),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.horizonMonths] }),
    check('arrival_horizon_chk', sql`${table.horizonMonths} > 0`),
    check('arrival_probability_chk', sql`${table.probability} between 0 and 1`),
    check('arrival_calibration_chk', sql`(${table.calibrationLow} is null and ${table.calibrationHigh} is null) or (${table.calibrationLow} between 0 and 1 and ${table.calibrationHigh} between 0 and 1 and ${table.calibrationLow} <= ${table.probability} and ${table.probability} <= ${table.calibrationHigh})`),
  ],
)

export const careerArcPoints = ml.table(
  'career_arc_point',
  {
    snapshotId: uuid('snapshot_id').notNull().references(() => predictionSnapshots.id),
    metricKey: text('metric_key').notNull().default('career_war'),
    age: smallint('age').notNull(),
    p10: numeric('p10', { precision: 8, scale: 3 }).notNull(),
    p25: numeric('p25', { precision: 8, scale: 3 }).notNull(),
    p50: numeric('p50', { precision: 8, scale: 3 }).notNull(),
    p75: numeric('p75', { precision: 8, scale: 3 }).notNull(),
    p90: numeric('p90', { precision: 8, scale: 3 }).notNull(),
    conditionalOnDebut: boolean('conditional_on_debut').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.metricKey, table.age] }),
    check('career_age_chk', sql`${table.age} between 14 and 60`),
    check('career_quantiles_chk', sql`${table.p10} <= ${table.p25} and ${table.p25} <= ${table.p50} and ${table.p50} <= ${table.p75} and ${table.p75} <= ${table.p90}`),
  ],
)

export const milestoneProbabilities = ml.table(
  'milestone_probability',
  {
    snapshotId: uuid('snapshot_id').notNull().references(() => predictionSnapshots.id),
    milestoneKey: text('milestone_key').notNull(),
    probability: numeric('probability', { precision: 6, scale: 5 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.milestoneKey] }),
    check('milestone_probability_chk', sql`${table.probability} between 0 and 1`),
  ],
)
