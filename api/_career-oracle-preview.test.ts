import { describe, expect, it } from 'vitest'
import { loadCareerOraclePreview, parseCareerOraclePreview } from './_career-oracle-preview.js'

const quantiles = { p10: 2, p25: 8, p50: 20, p75: 38, p90: 62 }

function previewFixture() {
  return {
    schemaVersion: 'career-oracle-preview/v1',
    asOf: '2026-07-12T00:00:00.000Z',
    modelVersion: 'career-oracle-v1',
    targetVersion: 'hof-caliber-jaws-v1',
    dataVersion: 'data-v1',
    providerVersion: 'bref-2026-07-12',
    releaseEligible: false,
    prospectForecasts: {
      '765432:hitter': {
        canonicalId: 'mlbam:765432:hitter',
        playerType: 'hitter',
        stage: 'pre_debut',
        publicationState: 'research',
        rank: 42,
        hofCaliberProbability: 0.02,
        finalCareerWar: quantiles,
        peakSevenWar: { p10: 1, p25: 5, p50: 14, p75: 25, p90: 39 },
        finalJaws: { p10: 1, p25: 4, p50: 11, p75: 20, p90: 31 },
        scenarioSupportExtensionJaws: 2.4,
        arrivalProbability36: 0.55,
        confidence: { score: 0.5, state: 'moderate' },
        decomposition: {
          arrivalProbability: 0.7,
          conditionalHofCaliberProbability: 0.03,
        },
        standardReference: {
          key: 'CF',
          careerWar: 71.6,
          peakSevenWar: 44.7,
          jaws: 58,
          derivedFallback: false,
        },
        lineage: {
          arrivalAsOf: '2025-12-31T00:00:00.000Z',
          bridgeVersion: 'bridge-v1',
          targetVersion: 'hof-caliber-jaws-v1',
          ignoredNestedValue: { unsafe: true },
        },
      },
    },
    players: [
      {
        playerId: 'canonical-1',
        name: 'Actual Player',
        playerType: 'hitter',
        stage: 'pre_debut',
        age: 21,
        organization: 'Example Club',
        level: 'AA',
        publicationState: 'research',
        rank: 1,
        forecast: {
          hofCaliberProbability: 0.08,
          finalCareerWar: quantiles,
          peakSevenWar: { p10: 1, p25: 5, p50: 14, p75: 25, p90: 39 },
          finalJaws: { p10: 1, p25: 4, p50: 10, p75: 18, p90: 29 },
          arrivalProbability36: 0.61,
          confidence: { score: 0.82, state: 'high', intervalWidth: 60 },
          decomposition: {
            arrivalProbability: 0.75,
            hofCaliberGivenMlbProbability: 0.11,
            noMlbProbability: 0.25,
          },
          arc: [{ age: 21, actual: null, ...quantiles }],
          warnings: ['Research only.'],
          relativeSignal: {
            version: 'relative-standing-v1',
            kind: 'hall_track',
            status: 'research',
            currentPeer: null,
            historicalPace: {
              percentile: 99.2,
              cohortSize: 850,
              playerValue: 5.1,
              metric: 'career_war_to_date',
              reliability: 'high',
              featureSeason: 2025,
              featureAge: 22,
              cohort: {
                scope: 'historical_point_in_time',
                label: 'Age 22 · first-season hitters',
                role: 'hitter',
                stageBand: 'first',
                seasonNumberMin: 1,
                seasonNumberMax: 1,
                ageMin: 22,
                ageMax: 22,
                ageWindow: 0,
                resolvedOnly: true,
              },
            },
            warnings: ['completed_season_historical_pace_only'],
          },
        },
      },
    ],
  }
}

describe('Career Oracle preview loader', () => {
  it('normalizes the transitional players alias and nested forecast', () => {
    const parsed = parseCareerOraclePreview(previewFixture())

    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]?.id).toBe('canonical-1')
    expect(parsed.items[0]?.playerType).toBe('Hitter')
    expect(parsed.items[0]?.careerForecast.hofCaliberProbability).toBe(0.08)
    expect(parsed.items[0]?.careerForecast.finalCareerWar?.p90).toBe(62)
    expect(parsed.items[0]?.careerForecast.finalJaws?.p50).toBe(10)
    expect(parsed.items[0]?.careerForecast.confidenceScore).toBe(0.82)
    expect(parsed.items[0]?.careerForecast.releaseEligible).toBe(false)
    expect(parsed.items[0]?.careerForecast.relativeSignal?.historicalPace).toMatchObject({
      percentile: 99.2,
      cohortSize: 850,
      playerValue: 5.1,
    })
  })

  it('strictly parses keyed prospect forecasts and Python field aliases', () => {
    const parsed = parseCareerOraclePreview(previewFixture())
    const prospect = parsed.prospectForecasts['765432:hitter']

    expect(prospect?.canonicalPlayerId).toBe('mlbam:765432:hitter')
    expect(prospect?.playerType).toBe('Hitter')
    expect(prospect?.careerForecast.decomposition.hofCaliberGivenMlbProbability).toBe(0.03)
    expect(prospect?.careerForecast.scenarioSupportExtensionJaws).toBe(2.4)
    expect(prospect?.careerForecast.hofStandard).toMatchObject({
      label: 'CF',
      roleOrPosition: 'CF',
      fallbackUsed: false,
    })
    expect(prospect?.careerForecast.lineage.bridgeVersion).toBe('bridge-v1')
    expect(prospect?.careerForecast.asOf).toBe('2025-12-31T00:00:00.000Z')
    expect(prospect?.careerForecast.lineage).not.toHaveProperty('ignoredNestedValue')
  })

  it('also accepts top-level items with forecast fields inline', () => {
    const fixture = previewFixture()
    const [player] = fixture.players
    const inline = { ...player, ...player.forecast }
    delete (inline as { forecast?: unknown }).forecast

    const parsed = parseCareerOraclePreview({
      ...fixture,
      players: undefined,
      items: [inline],
    })

    expect(parsed.items[0]?.careerForecast.arrivalProbability36).toBe(0.61)
    expect(parsed.items[0]?.careerForecast.arc[0]?.p50).toBe(20)
  })

  it('rejects percentage-scaled probabilities and unordered quantiles', () => {
    const percentageFixture = previewFixture()
    percentageFixture.players[0]!.forecast.hofCaliberProbability = 8
    expect(() => parseCareerOraclePreview(percentageFixture)).toThrow(/between 0 and 1/u)

    const unorderedFixture = previewFixture()
    unorderedFixture.players[0]!.forecast.finalCareerWar = {
      p10: 2,
      p25: 8,
      p50: 20,
      p75: 19,
      p90: 62,
    }
    expect(() => parseCareerOraclePreview(unorderedFixture)).toThrow(/must be monotone/u)

    const prospectPercentageFixture = previewFixture()
    prospectPercentageFixture.prospectForecasts['765432:hitter'].arrivalProbability36 = 55
    expect(() => parseCareerOraclePreview(prospectPercentageFixture)).toThrow(/between 0 and 1/u)

    const prospectQuantileFixture = previewFixture()
    prospectQuantileFixture.prospectForecasts['765432:hitter'].finalJaws.p75 = 9
    expect(() => parseCareerOraclePreview(prospectQuantileFixture)).toThrow(/must be monotone/u)

    const invalidExtensionFixture = previewFixture()
    invalidExtensionFixture.prospectForecasts['765432:hitter'].scenarioSupportExtensionJaws = Number.NaN
    expect(() => parseCareerOraclePreview(invalidExtensionFixture)).toThrow(/finite number/u)

    const invalidRelativeFixture = previewFixture()
    invalidRelativeFixture.players[0]!.forecast.relativeSignal.historicalPace.percentile = 101
    expect(() => parseCareerOraclePreview(invalidRelativeFixture)).toThrow(/between 0 and 100/u)
  })

  it('rejects prospect keys whose role disagrees with the forecast', () => {
    const fixture = previewFixture()
    fixture.prospectForecasts['765432:hitter'].playerType = 'pitcher'
    expect(() => parseCareerOraclePreview(fixture)).toThrow(/does not match its key/u)
  })

  it('returns null when the optional static artifact does not exist', () => {
    expect(loadCareerOraclePreview('/definitely/not/a/career-preview.json')).toBeNull()
  })
})
