import { describe, expect, it } from 'vitest'
import type { PlayersResponseMeta } from '../domain/forecast'
import { identityCoverageNeedsRefresh } from './identityFreshness'

type IdentityMeta = PlayersResponseMeta['identity']

function identity(overrides: Partial<NonNullable<IdentityMeta>> = {}): NonNullable<IdentityMeta> {
  return {
    minorRoleRows: 1,
    canonicalMinorPlayers: 1,
    duplicateMinorRoleRowsRemoved: 0,
    crossStageDuplicatesRemoved: 0,
    minorPlayersMissingMlbam: 0,
    mlbPlayersMissingMlbam: 0,
    identityCrosswalkStatus: 'current',
    unmatchedCurrentBbrefIds: 0,
    conflictingCurrentMlbIds: 0,
    identityOverlayConflicts: 0,
    ...overrides,
  }
}

describe('identityCoverageNeedsRefresh', () => {
  it('does not treat an old pinned artifact as broken live identity coverage', () => {
    expect(identityCoverageNeedsRefresh(identity({
      identityCrosswalkStatus: 'stale',
      identityCrosswalkAgeHours: 262.5,
    }))).toBe(false)
  })

  it.each([
    { identityCrosswalkStatus: 'invalid' as const },
    { unmatchedCurrentBbrefIds: 1 },
    { conflictingCurrentMlbIds: 1 },
    { identityOverlayConflicts: 1 },
  ])('requires a refresh for invalid or conflicting exact-ID evidence', (failure) => {
    expect(identityCoverageNeedsRefresh(identity(failure))).toBe(true)
  })
})
