import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  parsePlayerMobilityArtifact,
  playerMobilityArtifact,
  playerMobilityContextForSubject,
} from './_player-mobility-context.js'
import type {
  PlayerMobilityArtifact,
} from '../src/domain/playerMobilityContext.js'
import {
  playerMobilityArtifactContentValue,
} from '../src/domain/playerMobilityContext.js'

function rehash(artifact: PlayerMobilityArtifact): PlayerMobilityArtifact {
  return {
    ...artifact,
    contentSha256: createHash('sha256')
      .update(playerMobilityArtifactContentValue(artifact))
      .digest('hex'),
  }
}

describe('player mobility context artifact', () => {
  it('publishes Mookie Betts as long factual team runway', () => {
    const mookie = playerMobilityContextForSubject(
      'athlete|baseball|Mookie Betts',
      'athlete',
      'source_name_only',
    )

    expect(mookie).toMatchObject({
      availability: 'observed',
      currentTeam: {
        code: 'LAD',
        name: 'Los Angeles Dodgers',
      },
      term: {
        status: 'under_contract',
        remainingSeasonsIncludingCurrent: 7,
        reportedThrough: {
          seasonEndYear: 2032,
        },
      },
      mobilityWindow: 'three_plus_seasons',
      lastTeamChange: {
        effectiveAt: '2020-02-10',
        kind: 'trade',
        fromTeam: { code: 'BOS' },
        toTeam: { code: 'LAD' },
      },
      semantics: {
        contextOnly: true,
        directionalClaim: false,
      },
    })
    expect(mookie).not.toHaveProperty('riskScore')
    expect(mookie).not.toHaveProperty('gemRateSourceKey')
    expect(mookie).not.toHaveProperty('playerName')
    expect(mookie).not.toHaveProperty('sourceIds')
  })

  it('distinguishes unavailable, withheld, and not-applicable states', () => {
    expect(playerMobilityContextForSubject(
      'athlete|baseball|Player Outside Contract Coverage',
      'athlete',
      'source_name_only',
    ).availability).toBe('unavailable')
    expect(playerMobilityContextForSubject(
      'athlete|baseball|Ambiguous Player',
      'athlete',
      'ambiguous_normalized_name',
    ).availability).toBe('withheld_identity')
    expect(playerMobilityContextForSubject(
      'pokemon_character|pokemon|Pikachu',
      'pokemon_character',
      'source_name_only',
    ).availability).toBe('not_applicable')
  })

  it('rejects duplicate identities and content drift', () => {
    const duplicate = structuredClone(playerMobilityArtifact)
    duplicate.rows.push(structuredClone(duplicate.rows[0]!))
    duplicate.coverage.observedRows += 1
    duplicate.coverage.byLeague.MLB += 1
    expect(() => parsePlayerMobilityArtifact(rehash(duplicate))).toThrow(
      'artifact is invalid',
    )

    const drifted = structuredClone(playerMobilityArtifact)
    drifted.rows[0]!.currentTeam!.name = 'Changed without rehash'
    expect(() => parsePlayerMobilityArtifact(drifted)).toThrow(
      'integrity check failed',
    )
  })
})
