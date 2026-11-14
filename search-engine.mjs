const polishStopWords = new Set([
  'a', 'aby', 'ale', 'albo', 'az', 'by', 'byc', 'być', 'co', 'czy', 'dla', 'do',
  'gdy', 'gdzie', 'i', 'ich', 'im', 'jak', 'jako', 'jest', 'jego', 'jej', 'jeśli',
  'już', 'lub', 'ma', 'mi', 'mnie', 'na', 'nad', 'nie', 'nim', 'no', 'o', 'od',
  'oraz', 'po', 'pod', 'przez', 'przy', 'są', 'sie', 'się', 'ta', 'tak', 'te',
  'ten', 'to', 'tu', 'tych', 'tylko', 'w', 'we', 'z', 'za', 'ze', 'że'
])

const polishEndings = [
  'owego', 'owej', 'owymi', 'owych', 'anie', 'enie', 'ami', 'owie', 'ach', 'ego',
  'emu', 'iem', 'om', 'ów', 'ie', 'em', 'ą', 'ę', 'a', 'e', 'y', 'i', 'o', 'u'
]

export function normalizeSearchText(value = '') {
  return value
    .toLocaleLowerCase('pl-PL')
    .replace(/[ł]/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function stemWord(word) {
  if (word.length < 5) return word
  for (const ending of polishEndings) {
    if (word.endsWith(ending) && word.length - ending.length >= 4) {
      return word.slice(0, -ending.length)
    }
  }
  return word
}

export function tokenizeSearchText(value = '') {
  return normalizeSearchText(value)
    .split(/\s+/)
    .filter((word) => word.length > 1 && !polishStopWords.has(word))
    .map(stemWord)
}

function termMatches(tokens, term) {
  return tokens.some((token) => token === term || token.startsWith(term) || term.startsWith(token))
}

function fieldScore(tokens, terms, weight) {
  return terms.reduce((score, term) => score + (termMatches(tokens, term) ? weight : 0), 0)
}

function resultScore(result, query, queryTerms) {
  const title = normalizeSearchText(result.title)
  const domain = normalizeSearchText(result.domain)
  const path = normalizeSearchText(result.path)
  const body = normalizeSearchText(result.content || result.snippet)
  const phrase = normalizeSearchText(query)
  const titleTokens = tokenizeSearchText(result.title)
  const domainTokens = tokenizeSearchText(result.domain)
  const pathTokens = tokenizeSearchText(result.path)
  const bodyTokens = tokenizeSearchText(result.content || result.snippet)

  let score = 0
  score += fieldScore(titleTokens, queryTerms, 12)
  score += fieldScore(domainTokens, queryTerms, 8)
  score += fieldScore(pathTokens, queryTerms, 6)
  score += fieldScore(bodyTokens, queryTerms, 3)
  if (phrase && title.includes(phrase)) score += 35
  if (phrase && domain.includes(phrase)) score += 28
  if (phrase && path.includes(phrase)) score += 18
  if (phrase && body.includes(phrase)) score += 8

  const matchedTerms = queryTerms.filter((term) => (
    termMatches(titleTokens, term) || termMatches(domainTokens, term) || termMatches(pathTokens, term) || termMatches(bodyTokens, term)
  )).length
  return score + matchedTerms * 5
}

export function rankResults(results, query) {
  const queryTerms = tokenizeSearchText(query)
  if (!queryTerms.length) return results

  return results
    .map((result, index) => ({ result, index, score: resultScore(result, query, queryTerms) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ result }) => result)
}
