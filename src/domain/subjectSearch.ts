export function normalizeSubjectSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .replace(/&/gu, ' and ')
    .replace(/[’'`]/gu, '')
    .replace(/[^a-zA-Z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('en-US')
}

export function subjectSearchRelevance(
  candidate: string,
  query: string,
): number | null {
  const normalizedQuery = normalizeSubjectSearchText(query)
  if (!normalizedQuery) return 0

  const normalizedCandidate = normalizeSubjectSearchText(candidate)
  if (normalizedCandidate === normalizedQuery) return 0
  if (normalizedCandidate.startsWith(normalizedQuery)) return 1
  if (normalizedCandidate.includes(normalizedQuery)) return 2

  const candidateTokens = normalizedCandidate.split(' ')
  const queryTokens = normalizedQuery.split(' ')
  if (
    queryTokens.every((queryToken) => (
      candidateTokens.some((candidateToken) => (
        candidateToken.startsWith(queryToken)
      ))
    ))
  ) {
    return 3
  }

  const compactCandidate = normalizedCandidate.replaceAll(' ', '')
  const compactQuery = normalizedQuery.replaceAll(' ', '')
  return compactCandidate.includes(compactQuery) ? 4 : null
}
