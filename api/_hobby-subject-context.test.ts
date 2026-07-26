import { describe, expect, it } from 'vitest'
import {
  hobbySubjectContextBySourceKey,
  parseHobbySubjectContextArtifact,
} from './_hobby-subject-context.js'

describe('hobby subject context artifact', () => {
  it('locks verified person ages and Pokémon introduction context', () => {
    const artifact = parseHobbySubjectContextArtifact()
    const contexts = hobbySubjectContextBySourceKey()
    expect(artifact.counts).toMatchObject({
      rows: 2295,
      personAgeRows: 1273,
      pokemonIntroductionRows: 1022,
    })
    expect(contexts.get('athlete|baseball|Mike Trout')).toMatchObject({
      kind: 'person',
      age: 34,
      sourceId: 'backstop_player_rankings',
      identityStatus: 'verified_player_bridge',
    })
    expect(contexts.get('pokemon_character|pokemon|Pikachu')).toEqual({
      gemRateSourceKey: 'pokemon_character|pokemon|Pikachu',
      kind: 'pokemon_character',
      introducedYear: 1996,
      introducedGeneration: 1,
      nationalDexNumber: 25,
      sourceId: 'pokeapi',
      identityStatus: 'canonical_species_match',
    })
  })
})
