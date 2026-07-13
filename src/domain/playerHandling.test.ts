import { describe, expect, it } from 'vitest'
import { classifyPlayerHandling, PLAYER_HANDLING_VERSION } from './playerHandling'

describe('player handling', () => {
  it('gives a two-way player an explicit model-scope treatment', () => {
    const handling = classifyPlayerHandling({
      playerType: 'Two-way',
      stage: 'established_mlb',
      careerForecast: {
        publicationState: 'withheld',
        warnings: ['two_way_target_not_preregistered_forecast_withheld'],
      },
      externalIds: { mlbam: '660271' },
    })

    expect(handling).toMatchObject({
      version: PLAYER_HANDLING_VERSION,
      status: 'special',
      unclassifiedWithheld: false,
      primary: {
        code: 'two_way_model_scope',
        scoreTreatment: 'withheld',
      },
    })
  })

  it('fails closed when a withheld guard has no registered treatment', () => {
    const handling = classifyPlayerHandling({
      playerType: 'Hitter',
      stage: 'early_mlb',
      careerForecast: {
        publicationState: 'withheld',
        warnings: ['new_guard_not_yet_registered'],
      },
    })

    expect(handling.primary?.code).toBe('forecast_withheld_other')
    expect(handling.unclassifiedWithheld).toBe(true)
  })

  it.each([
    ['broad_role_switch_target_not_supported_forecast_withheld', 'role_transition_model_scope'],
    ['synthetic_hall_standard_forecast_withheld', 'hall_standard_model_scope'],
    ['bridge_debut_age_outside_supported_range_forecast_withheld', 'debut_age_model_scope'],
    ['bridge_debut_age_cell_missing_forecast_withheld', 'debut_age_model_scope'],
  ] as const)('registers the %s model guard', (warning, expectedCode) => {
    const handling = classifyPlayerHandling({
      playerType: 'Hitter',
      stage: warning.startsWith('bridge_') ? 'pre_debut' : 'established_mlb',
      careerForecast: { publicationState: 'withheld', warnings: [warning] },
    })

    expect(handling.primary?.code).toBe(expectedCode)
    expect(handling.unclassifiedWithheld).toBe(false)
  })

  it('keeps identity and rookie-prior gaps separate without fuzzy merging', () => {
    const handling = classifyPlayerHandling({
      playerType: 'Hitter',
      stage: 'recent_callup',
      careerForecast: null,
      recentCallup: { prospectPrior: null },
      externalIds: { mlbam: null, bbref: 'example01' },
    })

    expect(handling.notes.map((note) => note.code)).toEqual([
      'rookie_prior_unmatched',
      'identity_link_missing',
      'forecast_not_available',
    ])
  })

  it('keeps an MLB-experienced minor assignment out of prospect scoring', () => {
    const handling = classifyPlayerHandling({
      playerType: 'Pitcher',
      stage: 'post_debut_minors',
      careerForecast: null,
      externalIds: { mlbam: '123' },
    })

    expect(handling.primary).toMatchObject({
      code: 'post_debut_minor_assignment',
      scoreTreatment: 'pending',
    })
  })

  it('leaves supported standard records unflagged', () => {
    const handling = classifyPlayerHandling({
      playerType: 'Pitcher',
      stage: 'established_mlb',
      careerForecast: { publicationState: 'research', warnings: [] },
      externalIds: { mlbam: '123' },
    })

    expect(handling).toMatchObject({ status: 'standard', primary: null, notes: [] })
  })
})
