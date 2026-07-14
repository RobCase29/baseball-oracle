// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { filtersFromUrl } from './boardFilters'

afterEach(() => window.history.replaceState({}, '', '/'))

describe('board URL filters', () => {
  it.each([
    ['?stage=RC&sort=nearTermImpact', 'RC', 'stageStanding'],
    ['?stage=RC&sort=not-a-sort', 'RC', 'stageStanding'],
    ['?stage=MLB&sort=arrival36', 'MLB', 'stageStanding'],
    ['?stage=Minors&sort=finalWar', 'Minors', 'prospectScore'],
  ] as const)('uses a valid stage-specific fallback for %s', (search, stage, sort) => {
    window.history.replaceState({}, '', `/${search}`)
    expect(filtersFromUrl()).toMatchObject({ stage, sort })
  })

  it.each([
    ['?stage=All', 'All', 'name'],
    ['?stage=Minors', 'Minors', 'prospectScore'],
    ['?stage=RC', 'RC', 'stageStanding'],
    ['?stage=MLB', 'MLB', 'stageStanding'],
  ] as const)('defaults %s to its stage-defining order', (search, stage, sort) => {
    window.history.replaceState({}, '', `/${search}`)
    expect(filtersFromUrl()).toMatchObject({ stage, sort })
  })

  it.each([
    ['Minors', 'stageStanding', 'prospectScore'],
    ['Minors', 'alphaOpportunity', 'prospectScore'],
    ['RC', 'alphaOpportunity', 'stageStanding'],
    ['MLB', 'alphaOpportunity', 'stageStanding'],
  ] as const)('canonicalizes the legacy %s %s rank alias', (stage, sort, canonicalSort) => {
    window.history.replaceState({}, '', `/?stage=${stage}&sort=${sort}`)
    expect(filtersFromUrl()).toMatchObject({ stage, sort: canonicalSort })
  })

  it('preserves explicit Career Outlook links', () => {
    window.history.replaceState({}, '', '/?stage=RC&sort=careerIndex')
    expect(filtersFromUrl()).toMatchObject({ stage: 'RC', sort: 'careerIndex' })

    window.history.replaceState({}, '', '/?stage=MLB&sort=careerIndex')
    expect(filtersFromUrl()).toMatchObject({ stage: 'MLB', sort: 'careerIndex' })
  })
})
