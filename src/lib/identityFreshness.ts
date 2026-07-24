import type { PlayersResponseMeta } from '../domain/forecast'

type IdentityMeta = PlayersResponseMeta['identity']

function hasFailures(value: number | undefined): boolean {
  return typeof value === 'number' && value > 0
}

export function identityCoverageNeedsRefresh(identity: IdentityMeta): boolean {
  return identity?.identityCrosswalkStatus === 'invalid' ||
    hasFailures(identity?.unmatchedCurrentBbrefIds) ||
    hasFailures(identity?.conflictingCurrentMlbIds) ||
    hasFailures(identity?.identityOverlayConflicts)
}
