export const PLAYER_HANDLING_VERSION = 'player-handling/v1' as const

export type PlayerHandlingCode =
  | 'two_way_model_scope'
  | 'role_transition_model_scope'
  | 'hall_standard_model_scope'
  | 'debut_age_model_scope'
  | 'post_debut_minor_assignment'
  | 'rookie_model_pending'
  | 'rookie_prior_unmatched'
  | 'young_elite_model_scope'
  | 'stale_return_features'
  | 'current_opportunity_missing'
  | 'identity_link_missing'
  | 'forecast_not_available'
  | 'forecast_withheld_other'

export type PlayerHandlingCategory =
  | 'model_scope'
  | 'career_transition'
  | 'data_freshness'
  | 'identity'
  | 'coverage'

export interface PlayerHandlingNote {
  code: PlayerHandlingCode
  category: PlayerHandlingCategory
  label: string
  summary: string
  handling: string
  scoreTreatment: 'withheld' | 'pending' | 'unaffected'
}

export interface PlayerHandlingProfile {
  version: typeof PLAYER_HANDLING_VERSION
  status: 'standard' | 'special'
  primary: PlayerHandlingNote | null
  notes: PlayerHandlingNote[]
  unclassifiedWithheld: boolean
}

export interface PlayerHandlingInput {
  playerType: 'Hitter' | 'Pitcher' | 'Two-way'
  stage: 'pre_debut' | 'post_debut_minors' | 'recent_callup' | 'early_mlb' | 'established_mlb' | 'inactive'
  careerForecast: {
    publicationState?: 'observed' | 'research' | 'released' | 'withheld'
    warnings?: string[]
  } | null
  recentCallup?: {
    prospectPrior: unknown | null
  } | null
  externalIds?: Record<string, string | number | null>
}

const warningNotes: Record<string, PlayerHandlingNote> = {
  two_way_target_not_preregistered_forecast_withheld: {
    code: 'two_way_model_scope',
    category: 'model_scope',
    label: 'Two-way model pending',
    summary: 'A single-role career model would misstate this player\'s combined hitting and pitching value.',
    handling: 'Career Index and terminal rank are withheld while recorded hitting, pitching, and career WAR remain visible.',
    scoreTreatment: 'withheld',
  },
  partial_only_unvalidated_forecast_withheld: {
    code: 'rookie_model_pending',
    category: 'career_transition',
    label: 'Rookie model pending',
    summary: 'The player has reached MLB, but only partial first-season evidence is available.',
    handling: 'The frozen prospect prior stays in view and current MLB results are shown separately until a supported completed-season forecast is available.',
    scoreTreatment: 'pending',
  },
  broad_role_switch_target_not_supported_forecast_withheld: {
    code: 'role_transition_model_scope',
    category: 'model_scope',
    label: 'Role transition model pending',
    summary: 'This career includes a meaningful change between hitting and pitching roles.',
    handling: 'A single-role Hall benchmark is not substituted; the career score stays out of rankings while observed performance remains visible.',
    scoreTreatment: 'withheld',
  },
  synthetic_hall_standard_forecast_withheld: {
    code: 'hall_standard_model_scope',
    category: 'model_scope',
    label: 'Hall benchmark unavailable',
    summary: 'The player does not map to one of the exact position or pitching-role Hall benchmarks supported by this model.',
    handling: 'No synthetic benchmark is used, so terminal score and rank are withheld until the role is supported.',
    scoreTreatment: 'withheld',
  },
  bridge_debut_age_outside_supported_range_forecast_withheld: {
    code: 'debut_age_model_scope',
    category: 'model_scope',
    label: 'Career runway outside model range',
    summary: 'The projected MLB arrival age falls outside the debut-age range learned by the career bridge.',
    handling: 'Arrival evidence remains visible, but no unsupported career ceiling or Career Index is extrapolated.',
    scoreTreatment: 'withheld',
  },
  bridge_debut_age_cell_missing_forecast_withheld: {
    code: 'debut_age_model_scope',
    category: 'model_scope',
    label: 'Career runway not modeled',
    summary: 'The career bridge has no supported estimate for this role and projected arrival age.',
    handling: 'Arrival evidence remains visible, but the career ceiling and Career Index stay out of rankings.',
    scoreTreatment: 'withheld',
  },
  young_elite_distribution_gate_failed_forecast_withheld: {
    code: 'young_elite_model_scope',
    category: 'model_scope',
    label: 'Elite case outside release range',
    summary: 'This unusually young, high-performing case sits outside the model slice that cleared its release checks.',
    handling: 'The unsupported terminal score is withheld; recorded performance and historical pace remain visible.',
    scoreTreatment: 'withheld',
  },
  stale_return_feature_state_forecast_withheld: {
    code: 'stale_return_features',
    category: 'data_freshness',
    label: 'Return season needs a new baseline',
    summary: 'The latest completed-season model state predates a gap in MLB activity.',
    handling: 'Current results remain visible, but the career score waits for a fresh completed-season feature state.',
    scoreTreatment: 'pending',
  },
  current_opportunity_unobserved_forecast_withheld: {
    code: 'current_opportunity_missing',
    category: 'data_freshness',
    label: 'Current opportunity not observed',
    summary: 'The scoring snapshot does not contain a current MLB workload for this player.',
    handling: 'The terminal score is withheld until a current appearance or a newly completed-season state is observed.',
    scoreTreatment: 'pending',
  },
}

const warningPriority: PlayerHandlingCode[] = [
  'two_way_model_scope',
  'role_transition_model_scope',
  'hall_standard_model_scope',
  'debut_age_model_scope',
  'post_debut_minor_assignment',
  'young_elite_model_scope',
  'rookie_model_pending',
  'stale_return_features',
  'current_opportunity_missing',
  'rookie_prior_unmatched',
  'identity_link_missing',
  'forecast_not_available',
  'forecast_withheld_other',
]

function hasMissingMlbam(externalIds: PlayerHandlingInput['externalIds']): boolean {
  if (!externalIds) return false
  const declaresMlbam = Object.hasOwn(externalIds, 'mlbam') || Object.hasOwn(externalIds, 'mlbamId')
  if (!declaresMlbam) return false
  const value = externalIds.mlbam ?? externalIds.mlbamId
  return value === null || value === undefined || value === ''
}

function uniqueNotes(notes: PlayerHandlingNote[]): PlayerHandlingNote[] {
  const byCode = new Map<PlayerHandlingCode, PlayerHandlingNote>()
  for (const note of notes) byCode.set(note.code, note)
  return [...byCode.values()].toSorted(
    (left, right) => warningPriority.indexOf(left.code) - warningPriority.indexOf(right.code),
  )
}

export function classifyPlayerHandling(input: PlayerHandlingInput): PlayerHandlingProfile {
  const notes: PlayerHandlingNote[] = []
  const forecast = input.careerForecast
  const warnings = forecast?.warnings ?? []

  for (const warning of warnings) {
    const note = warningNotes[warning]
    if (note) notes.push(note)
  }

  if (input.stage === 'post_debut_minors') {
    notes.push({
      code: 'post_debut_minor_assignment',
      category: 'career_transition',
      label: 'MLB experience, now in minors',
      summary: 'This player has verified MLB experience and is currently represented by a minor-league assignment.',
      handling: 'The player remains searchable in the full directory but is excluded from both pre-debut prospect rankings and the active-MLB board.',
      scoreTreatment: 'pending',
    })
  }

  if (
    input.playerType === 'Two-way' &&
    !notes.some((note) => note.code === 'two_way_model_scope')
  ) {
    notes.push(warningNotes.two_way_target_not_preregistered_forecast_withheld)
  }

  if (input.stage === 'recent_callup' && input.recentCallup?.prospectPrior === null) {
    notes.push({
      code: 'rookie_prior_unmatched',
      category: 'career_transition',
      label: 'Prospect prior not linked',
      summary: 'The MLB record could not be joined exactly to a frozen pre-debut forecast.',
      handling: 'Current MLB evidence is retained, but no prospect score is substituted or joined by name alone.',
      scoreTreatment: 'pending',
    })
  }

  if (hasMissingMlbam(input.externalIds)) {
    notes.push({
      code: 'identity_link_missing',
      category: 'identity',
      label: 'Identity link incomplete',
      summary: 'An exact MLB Advanced Media identifier is not available for this player record.',
      handling: 'The record stays separate across sources until an exact identifier can be verified; fuzzy identity merges are not published.',
      scoreTreatment: 'unaffected',
    })
  }

  let unclassifiedWithheld = false
  if (forecast?.publicationState === 'withheld' && notes.length === 0) {
    unclassifiedWithheld = true
    notes.push({
      code: 'forecast_withheld_other',
      category: 'coverage',
      label: 'Forecast under review',
      summary: 'The career forecast is withheld by a model guard that does not yet have a specific product treatment.',
      handling: 'Observed evidence remains visible and the missing score is kept out of rankings.',
      scoreTreatment: 'withheld',
    })
  } else if (
    forecast === null &&
    input.stage !== 'pre_debut' &&
    input.stage !== 'post_debut_minors' &&
    input.stage !== 'inactive'
  ) {
    notes.push({
      code: 'forecast_not_available',
      category: 'coverage',
      label: 'Career forecast not available',
      summary: 'No supported career-model record is linked to this active MLB player.',
      handling: 'Observed statistics remain visible and the player is excluded from score-based ranking until a forecast is published.',
      scoreTreatment: 'pending',
    })
  }

  const ordered = uniqueNotes(notes)
  return {
    version: PLAYER_HANDLING_VERSION,
    status: ordered.length > 0 ? 'special' : 'standard',
    primary: ordered[0] ?? null,
    notes: ordered,
    unclassifiedWithheld,
  }
}
