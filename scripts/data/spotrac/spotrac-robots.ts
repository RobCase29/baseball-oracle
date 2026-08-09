export const SPOTRAC_ROBOTS_POLICY_PARSER_VERSION =
  'spotrac-robots-policy/v1' as const

export class SpotracRobotsPolicyError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SpotracRobotsPolicyError'
    this.code = code
  }
}

type RuleKind = 'allow' | 'disallow'

interface RobotsRule {
  kind: RuleKind
  sourcePattern: string
  specificity: number
  expression: RegExp
}

interface RobotsGroup {
  agents: string[]
  rules: Array<{
    kind: RuleKind
    pattern: string
  }>
  crawlDelaysMs: number[]
  errors: string[]
  hasRecords: boolean
}

export interface SpotracRobotsPolicy {
  parserVersion: typeof SPOTRAC_ROBOTS_POLICY_PARSER_VERSION
  userAgentProduct: string
  crawlDelayMs: number | null
  isAllowedPath: (pathAndQuery: string) => boolean
}

function policyError(code: string, message: string): never {
  throw new SpotracRobotsPolicyError(code, message)
}

function userAgentProduct(userAgent: string): string {
  const product = userAgent.trim().split(/[/\s]/u)[0] ?? ''
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/u.test(product)) {
    return policyError(
      'invalid_user_agent',
      'The Spotrac crawler user agent has no valid product token.',
    )
  }
  return product
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 31 || codePoint === 127
  })
}

function parseDelayMilliseconds(value: string): number | null {
  if (!/^\d+(?:\.\d+)?$/u.test(value)) return null
  const milliseconds = Math.ceil(Number(value) * 1_000)
  return Number.isSafeInteger(milliseconds) &&
    milliseconds >= 0 &&
    milliseconds <= 2_147_483_647
    ? milliseconds
    : null
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/gu, '\\$&')
}

function compileRule(
  kind: RuleKind,
  sourcePattern: string,
): RobotsRule {
  const anchoredAtEnd = sourcePattern.endsWith('$')
  const pattern = anchoredAtEnd
    ? sourcePattern.slice(0, -1)
    : sourcePattern
  const expressionBody = pattern
    .split('*')
    .map(escapeRegularExpression)
    .join('.*')
  const literalPattern = pattern.replaceAll('*', '')
  return {
    kind,
    sourcePattern,
    specificity: new TextEncoder().encode(literalPattern).byteLength,
    expression: new RegExp(
      `^${expressionBody}${anchoredAtEnd ? '$' : ''}`,
      'u',
    ),
  }
}

function isMatchingAgent(agent: string, product: string): boolean {
  const normalized = agent.toLocaleLowerCase('en-US')
  const normalizedProduct = product.toLocaleLowerCase('en-US')
  return (
    normalized === normalizedProduct ||
    normalized.startsWith(`${normalizedProduct}/`)
  )
}

function selectedGroups(
  groups: readonly RobotsGroup[],
  product: string,
): RobotsGroup[] {
  const exact = groups.filter((group) => group.agents.some(
    (agent) => isMatchingAgent(agent, product),
  ))
  if (exact.length > 0) return exact
  return groups.filter((group) => group.agents.includes('*'))
}

function assertRelevantGroups(
  groups: readonly RobotsGroup[],
): void {
  const errors = groups.flatMap((group) => group.errors)
  if (errors.length > 0) {
    policyError(
      'malformed_applicable_policy',
      `The applicable Spotrac robots policy is malformed: ${errors[0]}`,
    )
  }
}

function allowedBy(
  rules: readonly RobotsRule[],
  pathAndQuery: string,
): boolean {
  if (
    !pathAndQuery.startsWith('/') ||
    pathAndQuery.includes('#') ||
    hasControlCharacter(pathAndQuery)
  ) {
    return policyError(
      'invalid_target_path',
      'A robots target must be a normalized path and optional query.',
    )
  }
  const matches = rules.filter((rule) => rule.expression.test(pathAndQuery))
  if (matches.length === 0) return true
  matches.sort((left, right) => (
    right.specificity - left.specificity ||
    (left.kind === right.kind ? 0 : left.kind === 'allow' ? -1 : 1)
  ))
  return matches[0]!.kind === 'allow'
}

/**
 * Parses the subset of RFC 9309 needed to make a conservative access
 * decision, plus the widely deployed Crawl-delay extension. Any uncertainty
 * in the group applicable to this crawler is an error rather than an allow.
 */
export function parseSpotracRobotsPolicy(
  body: string,
  userAgent: string,
): SpotracRobotsPolicy {
  if (
    body.length < 1 ||
    body.length > 1024 * 1024 ||
    body.includes('\u0000') ||
    /<(?:!doctype|html|body)\b/iu.test(body)
  ) {
    return policyError(
      'invalid_policy_body',
      'The Spotrac robots response is empty, oversized, binary, or HTML.',
    )
  }

  const groups: RobotsGroup[] = []
  let current: RobotsGroup | null = null
  const lines = body.replace(/^\uFEFF/u, '').split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index]!
    const line = rawLine.split('#', 1)[0]!.trim()
    if (!line) continue
    const separator = line.indexOf(':')
    if (separator < 1) {
      return policyError(
        'malformed_policy',
        `Spotrac robots line ${index + 1} has no valid field separator.`,
      )
    }
    const field = line
      .slice(0, separator)
      .trim()
      .toLocaleLowerCase('en-US')
    const value = line.slice(separator + 1).trim()

    if (field === 'user-agent') {
      if (!value) {
        return policyError(
          'malformed_policy',
          `Spotrac robots line ${index + 1} has an empty user agent.`,
        )
      }
      if (!current || current.hasRecords) {
        current = {
          agents: [],
          rules: [],
          crawlDelaysMs: [],
          errors: [],
          hasRecords: false,
        }
        groups.push(current)
      }
      current.agents.push(value.toLocaleLowerCase('en-US'))
      continue
    }

    if (!current) continue
    current.hasRecords = true
    if (field === 'allow' || field === 'disallow') {
      if (!value) continue
      if (
        !value.startsWith('/') ||
        /\s/u.test(value) ||
        hasControlCharacter(value)
      ) {
        current.errors.push(
          `line ${index + 1} has an invalid ${field} path`,
        )
        continue
      }
      current.rules.push({
        kind: field,
        pattern: value,
      })
      continue
    }
    if (field === 'crawl-delay') {
      const milliseconds = parseDelayMilliseconds(value)
      if (milliseconds === null) {
        current.errors.push(
          `line ${index + 1} has an invalid crawl delay`,
        )
      } else {
        current.crawlDelaysMs.push(milliseconds)
      }
    }
  }

  const product = userAgentProduct(userAgent)
  const applicable = selectedGroups(groups, product)
  if (applicable.length === 0) {
    return policyError(
      'missing_applicable_policy',
      'Spotrac robots.txt has no group applicable to this crawler.',
    )
  }
  assertRelevantGroups(applicable)

  const rules = applicable.flatMap((group) => group.rules)
    .map((rule) => compileRule(rule.kind, rule.pattern))
  const delays = applicable.flatMap((group) => group.crawlDelaysMs)
  const crawlDelayMs = delays.length > 0 ? Math.max(...delays) : null

  return {
    parserVersion: SPOTRAC_ROBOTS_POLICY_PARSER_VERSION,
    userAgentProduct: product,
    crawlDelayMs,
    isAllowedPath: (pathAndQuery) => allowedBy(rules, pathAndQuery),
  }
}
