import postgres from 'postgres'

type SqlClient = ReturnType<typeof postgres>

export interface DatasetPermission {
  datasetId: string
  permissionVersionId: string
}

export interface RawLandingRecord {
  record: Record<string, unknown>
  recordType: string
  sourceRecordKey: string
  recordSha256: string
}

interface TextBlob {
  bodyText: string
  objectUri?: never
}

interface ObjectBlob {
  bodyText?: never
  objectUri: string
}

export interface RawLandingInput {
  signal?: AbortSignal
  sourceSlug: string
  datasetKey: string
  idempotencyKey: string
  mode?: string
  requestedAsOf?: Date | null
  parserVersion: string
  codeCommit?: string
  parameters: Record<string, unknown>
  counts: Record<string, unknown>
  fetchedAt: Date
  request: {
    sanitized: Record<string, unknown>
    fingerprint: string
  }
  response: {
    sha256: string
    byteLength: number
    mediaType: string
    contentEncoding?: string | null
    statusCode: number
    etag?: string | null
    lastModified?: string | null
    headers: Record<string, string>
  } & (TextBlob | ObjectBlob)
  records: RawLandingRecord[]
  batchSize?: number
}

export type RawLandingResult =
  | { status: 'duplicate' }
  | { status: 'in_progress' }
  | { status: 'stored'; runId: string; fetchId: string; blobId: string }

export async function lookupActivePermission(
  sql: SqlClient,
  sourceSlug: string,
  datasetKey: string,
): Promise<DatasetPermission> {
  const [permission] = await sql<
    { dataset_id: string; permission_version_id: string }[]
  >`
    SELECT
      dataset.id AS dataset_id,
      permission.id AS permission_version_id
    FROM catalog.dataset AS dataset
    JOIN catalog.source AS source ON source.id = dataset.source_id
    JOIN LATERAL (
      SELECT id
      FROM catalog.permission_version
      WHERE dataset_id = dataset.id
        AND automated_access = true
        AND raw_storage = true
        AND valid_from <= now()
        AND (valid_to IS NULL OR valid_to > now())
      ORDER BY version DESC
      LIMIT 1
    ) AS permission ON true
    WHERE source.slug = ${sourceSlug}
      AND dataset.dataset_key = ${datasetKey}
  `

  if (!permission) {
    throw new Error(
      `No active raw-storage permission is registered for ${sourceSlug}/${datasetKey}`,
    )
  }

  return {
    datasetId: permission.dataset_id,
    permissionVersionId: permission.permission_version_id,
  }
}

export async function persistRawLanding(
  sql: SqlClient,
  input: RawLandingInput,
): Promise<RawLandingResult> {
  input.signal?.throwIfAborted()
  const permission = await lookupActivePermission(sql, input.sourceSlug, input.datasetKey)
  input.signal?.throwIfAborted()
  const batchSize = input.batchSize ?? 200
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error('Raw record batch size must be a positive integer')
  }

  const insertedRun = await sql<{ id: string }[]>`
    INSERT INTO raw.ingestion_run AS target (
      dataset_id,
      permission_version_id,
      idempotency_key,
      mode,
      requested_as_of,
      status,
      code_commit,
      parser_version,
      parameters
    ) VALUES (
      ${permission.datasetId},
      ${permission.permissionVersionId},
      ${input.idempotencyKey},
      ${input.mode ?? 'incremental'},
      ${input.requestedAsOf ?? null},
      'running',
      ${input.codeCommit ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local'},
      ${input.parserVersion},
      ${sql.json(input.parameters as postgres.JSONValue)}
    )
    ON CONFLICT (dataset_id, idempotency_key) DO UPDATE SET
      permission_version_id = EXCLUDED.permission_version_id,
      mode = EXCLUDED.mode,
      requested_as_of = EXCLUDED.requested_as_of,
      started_at = now(),
      finished_at = NULL,
      status = 'running',
      code_commit = EXCLUDED.code_commit,
      parser_version = EXCLUDED.parser_version,
      parameters = EXCLUDED.parameters,
      counts = '{}'::jsonb,
      error = NULL
    WHERE target.status = 'failed'
       OR (
         target.status = 'running'
         AND target.started_at < now() - interval '1 hour'
       )
    RETURNING id
  `
  input.signal?.throwIfAborted()

  if (insertedRun.length === 0) {
    const [existing] = await sql<{ status: string }[]>`
      SELECT status
      FROM raw.ingestion_run
      WHERE dataset_id = ${permission.datasetId}
        AND idempotency_key = ${input.idempotencyKey}
    `

    if (existing?.status === 'succeeded') return { status: 'duplicate' }
    if (existing?.status === 'running') return { status: 'in_progress' }
    throw new Error('Raw ingestion run could not be claimed')
  }

  const runId = insertedRun[0].id

  try {
    return await sql.begin(async (transaction) => {
      input.signal?.throwIfAborted()
      const insertedBlobs = await transaction<{ id: string }[]>`
        INSERT INTO raw.blob (
          sha256,
          byte_length,
          media_type,
          content_encoding,
          body_text,
          object_uri
        ) VALUES (
          ${input.response.sha256},
          ${input.response.byteLength},
          ${input.response.mediaType},
          ${input.response.contentEncoding ?? null},
          ${input.response.bodyText ?? null},
          ${input.response.objectUri ?? null}
        )
        ON CONFLICT (sha256) DO NOTHING
        RETURNING id
      `

      const [existingBlob] = insertedBlobs.length
        ? insertedBlobs
        : await transaction<{ id: string }[]>`
            SELECT id
            FROM raw.blob
            WHERE sha256 = ${input.response.sha256}
            LIMIT 1
          `
      input.signal?.throwIfAborted()

      if (!existingBlob) {
        throw new Error('Raw blob could not be inserted or resolved by content hash')
      }

      const [fetchRecord] = await transaction<{ id: string }[]>`
        INSERT INTO raw.fetch (
          run_id,
          blob_id,
          fetched_at,
          sanitized_request,
          request_fingerprint,
          status_code,
          etag,
          last_modified,
          response_headers
        ) VALUES (
          ${runId},
          ${existingBlob.id},
          ${input.fetchedAt},
          ${transaction.json(input.request.sanitized as postgres.JSONValue)},
          ${input.request.fingerprint},
          ${input.response.statusCode},
          ${input.response.etag ?? null},
          ${input.response.lastModified ?? null},
          ${transaction.json(input.response.headers as postgres.JSONValue)}
        )
        RETURNING id
      `
      input.signal?.throwIfAborted()

      for (let offset = 0; offset < input.records.length; offset += batchSize) {
        input.signal?.throwIfAborted()
        const batch = input.records.slice(offset, offset + batchSize).map((item, index) => ({
          fetch_id: fetchRecord.id,
          ordinal: offset + index,
          record_type: item.recordType,
          source_record_key: item.sourceRecordKey,
          record_sha256: item.recordSha256,
          record_json: transaction.json(item.record as postgres.JSONValue),
          parser_schema_version: input.parserVersion,
        }))

        await transaction`
          INSERT INTO raw.record ${transaction(
            batch,
            'fetch_id',
            'ordinal',
            'record_type',
            'source_record_key',
            'record_sha256',
            'record_json',
            'parser_schema_version',
          )}
        `
      }

      input.signal?.throwIfAborted()
      await transaction`
        UPDATE raw.ingestion_run
        SET
          status = 'succeeded',
          finished_at = now(),
          counts = ${transaction.json(input.counts as postgres.JSONValue)}
        WHERE id = ${runId}
      `
      input.signal?.throwIfAborted()

      return {
        status: 'stored' as const,
        runId,
        fetchId: fetchRecord.id,
        blobId: existingBlob.id,
      }
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown ingestion error'
    await sql`
      UPDATE raw.ingestion_run
      SET status = 'failed', finished_at = now(), error = ${sql.json({ message })}
      WHERE id = ${runId}
    `.catch(() => undefined)
    throw error
  }
}
