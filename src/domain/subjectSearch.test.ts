import { describe, expect, it } from 'vitest'
import {
  normalizeSubjectSearchText,
  subjectSearchRelevance,
} from './subjectSearch'

describe('subject search', () => {
  it('normalizes punctuation, accents, and whitespace', () => {
    expect(normalizeSubjectSearchText('  C.J.   Stroud  ')).toBe('c j stroud')
    expect(normalizeSubjectSearchText('Ronald Acuña Jr.')).toBe(
      'ronald acuna jr',
    )
  })

  it('matches natural mobile queries without fuzzy identity guesses', () => {
    expect(subjectSearchRelevance('C.J. Stroud', 'CJ Stroud')).toBe(4)
    expect(subjectSearchRelevance('Michael Jordan', 'mich jord')).toBe(3)
    expect(subjectSearchRelevance('Ronald Acuña Jr.', 'acuna')).toBe(2)
    expect(subjectSearchRelevance('Tom Brady', 'Tim Brady')).toBeNull()
  })

  it('prioritizes exact and leading name matches', () => {
    expect(subjectSearchRelevance('Michael Jordan', 'Michael Jordan')).toBe(0)
    expect(subjectSearchRelevance('Michael Jordan', 'Michael')).toBe(1)
    expect(subjectSearchRelevance('DeAndre Jordan', 'Jordan')).toBe(2)
  })
})
