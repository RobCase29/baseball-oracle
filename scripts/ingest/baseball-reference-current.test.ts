import { describe, expect, it } from 'vitest'
import { requireChadwickKeyMlbamLookup } from '../../api/_chadwick-key-mlbam.js'
import { requireMlbIdentityCrosswalk } from '../../api/_mlb-identity-crosswalk.js'
import type { ValueSeasonRow } from '../backfill/baseball-reference-mlb-war.js'
import {
  BASEBALL_REFERENCE_CURRENT_FETCH_ATTEMPTS,
  BASEBALL_REFERENCE_EXACT_IDENTITY_FETCH_ATTEMPTS,
  BASEBALL_REFERENCE_EXACT_IDENTITY_MAX_FETCHES,
  BASEBALL_REFERENCE_EXACT_IDENTITY_MAX_RESPONSE_BYTES,
  BASEBALL_REFERENCE_EXACT_IDENTITY_POST_CORE_BUDGET_MS,
  BASEBALL_REFERENCE_EXACT_IDENTITY_START_CUTOFF_MS,
  CurrentMlbIdentityResolver,
  assertExactIdentityPageByteLength,
  baseballReferenceCurrentValueUrl,
  baseballReferencePlayerUrl,
  currentValueSourceRecordKey,
  exactPageFirstMlbSeason,
  exactIdentityPostCoreBudgetMs,
  exactIdentityRawEvidenceFromRow,
  parseExactPlayerPageMetadata,
  readExactIdentityPageText,
  resolutionFromOverlay,
} from './baseball-reference-current.js'
import {
  assertBaseballReferenceCurrentCardinality,
  BASEBALL_REFERENCE_CURRENT_MINIMUM_ROWS,
} from './current-refresh-quality.js'

describe('current Baseball-Reference ingestion contract', () => {
  it('uses one bounded retry for transient current-page failures', () => {
    expect(BASEBALL_REFERENCE_CURRENT_FETCH_ATTEMPTS).toBe(2)
    expect(BASEBALL_REFERENCE_EXACT_IDENTITY_FETCH_ATTEMPTS).toBe(2)
    expect(BASEBALL_REFERENCE_EXACT_IDENTITY_MAX_FETCHES).toBe(6)
  })

  it('rejects oversized exact player pages before metadata parsing or storage', () => {
    expect(() => assertExactIdentityPageByteLength(
      BASEBALL_REFERENCE_EXACT_IDENTITY_MAX_RESPONSE_BYTES,
    )).not.toThrow()
    expect(() => assertExactIdentityPageByteLength(
      BASEBALL_REFERENCE_EXACT_IDENTITY_MAX_RESPONSE_BYTES + 1,
    )).toThrow(/exceeds/iu)
  })

  it('rejects an oversized declared player page before reading its stream', async () => {
    const response = new Response('small', {
      headers: {
        'content-length': String(
          BASEBALL_REFERENCE_EXACT_IDENTITY_MAX_RESPONSE_BYTES + 1,
        ),
      },
    })

    await expect(readExactIdentityPageText(response)).rejects.toThrow(/exceeds/iu)
    expect(response.bodyUsed).toBe(false)
  })

  it('reserves post-landing time for snapshot publication', () => {
    expect(exactIdentityPostCoreBudgetMs(
      BASEBALL_REFERENCE_EXACT_IDENTITY_START_CUTOFF_MS - 1,
    )).toBe(BASEBALL_REFERENCE_EXACT_IDENTITY_POST_CORE_BUDGET_MS)
    expect(exactIdentityPostCoreBudgetMs(
      BASEBALL_REFERENCE_EXACT_IDENTITY_START_CUTOFF_MS,
    )).toBe(0)
    expect(
      BASEBALL_REFERENCE_EXACT_IDENTITY_START_CUTOFF_MS +
        BASEBALL_REFERENCE_EXACT_IDENTITY_POST_CORE_BUDGET_MS,
    ).toBe(48_000)
  })

  it('accepts only exact canonical BRef and Chadwick metadata on player pages', () => {
    const url = baseballReferencePlayerUrl('laralu01')
    const html = `
      <html><head>
        <link rel="canonical" href="${url}">
        <meta name="sr-bbref-id" content="laralu01">
        <meta name="sr-chadwick-id" content="5401e885">
        <meta property="og:image" content="https://example.test/ffffffff_mlbam.jpg">
      </head></html>
    `

    expect(parseExactPlayerPageMetadata(html, 'laralu01')).toEqual({
      canonicalUrl: url,
      bbrefId: 'laralu01',
      chadwickKey: '5401e885',
    })
  })

  it('does not infer an identity from image paths when explicit metadata is absent', () => {
    const url = baseballReferencePlayerUrl('laralu01')
    const html = `
      <html><head>
        <link rel="canonical" href="${url}">
        <meta name="sr-bbref-id" content="laralu01">
        <meta property="og:image" content="https://example.test/5401e885_mlbam.jpg">
      </head></html>
    `

    expect(parseExactPlayerPageMetadata(html, 'laralu01').chadwickKey).toBeNull()
  })

  it('fails closed on canonical or explicit BRef metadata mismatches', () => {
    expect(() => parseExactPlayerPageMetadata(`
      <link rel="canonical" href="https://www.baseball-reference.com/players/l/otherlu01.shtml">
      <meta name="sr-bbref-id" content="laralu01">
    `, 'laralu01')).toThrow(/canonical URL mismatch/iu)

    expect(() => parseExactPlayerPageMetadata(`
      <link rel="canonical" href="https://www.baseball-reference.com/players/l/laralu01.shtml">
      <meta name="sr-bbref-id" content="otherlu01">
    `, 'laralu01')).toThrow(/sr-bbref-id metadata mismatch/iu)
  })

  it('caches an unknown exact BRef resolution across batting and pitching', async () => {
    let calls = 0
    const resolver = new CurrentMlbIdentityResolver(
      requireMlbIdentityCrosswalk(),
      requireChadwickKeyMlbamLookup(),
      async () => {
        calls += 1
        return {
          mlbamId: null,
          status: 'unresolved',
          evidence: null,
          unresolvedReason: 'exact_page_evidence_unavailable',
          needsCurrentValueOverlay: false,
        }
      },
    )

    const first = await resolver.resolve('futurezz99', 2026, null as never)
    const second = await resolver.resolve('futurezz99', 2026, null as never)
    expect(first).toEqual(second)
    expect(calls).toBe(1)
  })

  it('preserves a static MLBAM-only veteran debut season and rejects BRef conflicts', () => {
    const crosswalk = requireMlbIdentityCrosswalk()

    expect(exactPageFirstMlbSeason(
      crosswalk,
      'exactnew01',
      115_541,
      2026,
    )).toBe(1901)
    expect(exactPageFirstMlbSeason(
      crosswalk,
      'wrongbb01',
      660_271,
      2026,
    )).toBeNull()
  })

  it('revalidates durable overlays against pinned Chadwick and static IDs', () => {
    const crosswalk = requireMlbIdentityCrosswalk()
    const chadwickLookup = requireChadwickKeyMlbamLookup()
    const base = {
      bbref_id: 'laralu01',
      chadwick_key: '5401e885',
      mlbam_id: '800325',
      first_mlb_season: 2026,
      evidence_method: 'bref_page_meta_pinned_chadwick' as const,
      source_url: baseballReferencePlayerUrl('laralu01'),
      retrieved_at: new Date('2026-07-13T12:00:00.000Z'),
      response_sha256: 'a'.repeat(64),
      raw_record_id: '00000000-0000-0000-0000-000000000001',
    }

    expect(resolutionFromOverlay(base, crosswalk, chadwickLookup)).toMatchObject({
      status: 'resolved_overlay',
      mlbamId: 800_325,
    })
    expect(resolutionFromOverlay(
      { ...base, chadwick_key: 'ffffffff' },
      crosswalk,
      chadwickLookup,
    )).toMatchObject({
      status: 'unresolved',
      unresolvedReason: 'durable_overlay_pinned_chadwick_conflict',
    })
    expect(resolutionFromOverlay(
      { ...base, bbref_id: 'wrongbb01' },
      crosswalk,
      chadwickLookup,
    )).toMatchObject({
      status: 'unresolved',
      unresolvedReason: 'durable_overlay_static_mlbam_conflict',
    })
  })

  it('reuses persisted raw evidence time on an identical-page retry', () => {
    const persistedAt = '2026-07-13T12:00:00.000Z'
    const evidence = exactIdentityRawEvidenceFromRow({
      id: '00000000-0000-0000-0000-000000000001',
      fetched_at: persistedAt,
      response_sha256: 'a'.repeat(64),
    })

    expect(evidence).toEqual({
      rawRecordId: '00000000-0000-0000-0000-000000000001',
      retrievedAt: new Date(persistedAt),
      responseSha256: 'a'.repeat(64),
    })
    expect(evidence.retrievedAt.toISOString()).not.toBe(
      '2026-07-14T12:00:00.000Z',
    )
  })

  it('builds the allowlisted current value page URLs', () => {
    expect(baseballReferenceCurrentValueUrl(2026, 'batting')).toBe(
      'https://www.baseball-reference.com/leagues/majors/2026-value-batting.shtml',
    )
    expect(baseballReferenceCurrentValueUrl(2026, 'pitching')).toBe(
      'https://www.baseball-reference.com/leagues/majors/2026-value-pitching.shtml',
    )
  })

  it('binds a raw row identity to player, season, and side', () => {
    const row = {
      bbref_id: 'judgeaa01',
      season: 2026,
      side: 'batting',
    } as ValueSeasonRow
    expect(currentValueSourceRecordKey(row)).toBe(
      'judgeaa01|season:2026|side:batting',
    )
  })

  it('rejects a structurally valid but implausibly small current page', () => {
    expect(() =>
      assertBaseballReferenceCurrentCardinality(
        BASEBALL_REFERENCE_CURRENT_MINIMUM_ROWS - 1,
        2026,
        'batting',
        null,
      ),
    ).toThrow(`requires at least ${BASEBALL_REFERENCE_CURRENT_MINIMUM_ROWS}`)
  })

  it('requires at least 60 percent of the previous matching page', () => {
    expect(() =>
      assertBaseballReferenceCurrentCardinality(419, 2026, 'pitching', 700),
    ).toThrow('requires at least 420 after 700 rows previously')

    expect(
      assertBaseballReferenceCurrentCardinality(420, 2026, 'pitching', 700),
    ).toMatchObject({
      previousRetentionMinimumRows: 420,
      requiredRows: 420,
    })
  })
})
