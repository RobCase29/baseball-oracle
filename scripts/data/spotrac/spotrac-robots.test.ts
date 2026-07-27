import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  SPOTRAC_ROBOTS_POLICY_PARSER_VERSION,
  parseSpotracRobotsPolicy,
} from './spotrac-robots.js'

const userAgent =
  'BaseballOracleTeamRunway/1.0 (+authorized research; contact project owner)'

async function fixture(): Promise<string> {
  return readFile(
    new URL('./fixtures/robots-team-pages.txt', import.meta.url),
    'utf8',
  )
}

describe('Spotrac robots policy parser', () => {
  it('allows team routes, blocks sort routes, and carries crawl delay', async () => {
    const policy = parseSpotracRobotsPolicy(await fixture(), userAgent)

    expect(policy.parserVersion).toBe(
      SPOTRAC_ROBOTS_POLICY_PARSER_VERSION,
    )
    expect(policy.userAgentProduct).toBe('BaseballOracleTeamRunway')
    expect(policy.crawlDelayMs).toBe(7_000)
    expect(policy.isAllowedPath('/mlb/contracts/_/team/lad')).toBe(true)
    expect(policy.isAllowedPath('/nfl/contracts/_/team/kc')).toBe(true)
    expect(policy.isAllowedPath('/nba/contracts/_/sort/value')).toBe(false)
  })

  it('prefers a specific crawler group and combines duplicate groups', () => {
    const policy = parseSpotracRobotsPolicy(`
User-agent: *
Disallow: /
Crawl-delay: 2

User-agent: BaseballOracleTeamRunway
Disallow: /private/
Crawl-delay: 6

User-agent: BaseballOracleTeamRunway
Allow: /private/approved$
Crawl-delay: 8
`, userAgent)

    expect(policy.crawlDelayMs).toBe(8_000)
    expect(policy.isAllowedPath('/public')).toBe(true)
    expect(policy.isAllowedPath('/private/card')).toBe(false)
    expect(policy.isAllowedPath('/private/approved')).toBe(true)
    expect(policy.isAllowedPath('/private/approved/more')).toBe(false)
  })

  it('fails closed on a malformed applicable policy', () => {
    expect(() => parseSpotracRobotsPolicy(`
User-agent: *
Allow: /mlb/contracts/_/team/
Crawl-delay: eventually
`, userAgent)).toThrowError(expect.objectContaining({
      name: 'SpotracRobotsPolicyError',
      code: 'malformed_applicable_policy',
    }))
  })

  it('fails closed when no user-agent group applies', () => {
    expect(() => parseSpotracRobotsPolicy(`
User-agent: OtherCrawler
Allow: /
`, userAgent)).toThrowError(expect.objectContaining({
      code: 'missing_applicable_policy',
    }))
  })

  it('rejects malformed syntax and HTML masquerading as robots.txt', () => {
    expect(() => parseSpotracRobotsPolicy(
      'User-agent: *\nthis is not a directive\n',
      userAgent,
    )).toThrowError(expect.objectContaining({
      code: 'malformed_policy',
    }))
    expect(() => parseSpotracRobotsPolicy(
      '<!doctype html><html><body>blocked</body></html>',
      userAgent,
    )).toThrowError(expect.objectContaining({
      code: 'invalid_policy_body',
    }))
  })
})
