// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { filtersFromUrl } from './boardFilters'

afterEach(() => window.history.replaceState({}, '', '/'))

describe('board URL filters', () => {
  it.each([
    ['?stage=RC&sort=nearTermImpact', 'RC', 'careerIndex'],
    ['?stage=RC&sort=not-a-sort', 'RC', 'careerIndex'],
    ['?stage=MLB&sort=arrival36', 'MLB', 'careerIndex'],
    ['?stage=Minors&sort=finalWar', 'Minors', 'prospectScore'],
  ] as const)('uses a valid stage-specific fallback for %s', (search, stage, sort) => {
    window.history.replaceState({}, '', `/${search}`)
    expect(filtersFromUrl()).toMatchObject({ stage, sort })
  })
})
