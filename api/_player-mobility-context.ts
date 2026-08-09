import { createHash } from 'node:crypto'
import mobilityJson from '../src/data/player-mobility-context.v1.json' with {
  type: 'json',
}
import {
  findPlayerMobilityContext,
  isPlayerMobilityArtifact,
  playerMobilityArtifactContentValue,
  unavailablePlayerMobilityContext,
  type PlayerMobilityArtifact,
  type PlayerMobilityContext,
} from '../src/domain/playerMobilityContext.js'

function contentHash(artifact: PlayerMobilityArtifact): string {
  return createHash('sha256')
    .update(playerMobilityArtifactContentValue(artifact))
    .digest('hex')
}

export function parsePlayerMobilityArtifact(
  value: unknown = mobilityJson,
): PlayerMobilityArtifact {
  if (!isPlayerMobilityArtifact(value)) {
    throw new Error('Player mobility context artifact is invalid')
  }
  if (contentHash(value) !== value.contentSha256) {
    throw new Error('Player mobility context integrity check failed')
  }
  return value
}

export const playerMobilityArtifact = parsePlayerMobilityArtifact()

export function playerMobilityContextForSubject(
  gemRateSourceKey: string,
  subjectType: 'athlete' | 'pokemon_character',
  identityStatus:
    | 'source_name_only'
    | 'ambiguous_normalized_name'
    | 'canonical_identity_missing',
  artifact: PlayerMobilityArtifact = playerMobilityArtifact,
): PlayerMobilityContext {
  if (subjectType !== 'athlete') {
    return unavailablePlayerMobilityContext(
      'not_applicable',
      'non_athlete_subject',
    )
  }
  if (identityStatus === 'ambiguous_normalized_name') {
    return unavailablePlayerMobilityContext(
      'withheld_identity',
      'ambiguous_subject_identity',
    )
  }
  const observed = findPlayerMobilityContext(
    artifact.rows,
    gemRateSourceKey,
  )
  if (observed) {
    return {
      availability: observed.availability,
      asOf: observed.asOf,
      league: observed.league,
      currentTeam: observed.currentTeam,
      teamTenureStart: observed.teamTenureStart,
      term: observed.term,
      nextDecision: observed.nextDecision,
      mobilityWindow: observed.mobilityWindow,
      reasonCodes: observed.reasonCodes,
      lastTeamChange: observed.lastTeamChange,
      provenance: observed.provenance,
      semantics: observed.semantics,
    }
  }
  return unavailablePlayerMobilityContext(
    'unavailable',
    'contract_source_not_observed',
  )
}
