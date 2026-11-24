import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rankResults } from './search-engine.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const indexPath = path.join(root, 'data', 'index.json')
const seedsPath = path.join(root, 'data', 'crawl-seeds.json')
const crawlStatusPath = path.join(root, 'data', 'crawl-status.json')
const crawlUserAgent = 'LIOnetBot/0.1 (+own-index)'
const firstMilestone = 10000
const crawlWorkers = 20
// Pamięć procesu nie może rosnąć bez końca: limit dotyczy kolejki roboczej,
// nie liczby stron, które LIOnet może ostatecznie zarejestrować.
const maxQueueSize = 12000
const maxLinksPerPage = 40
const maxDocumentContent = 4000
const maxHtmlBytes = 2_000_000
let documents = []
let indexModifiedAt = 0
let ready = loadIndex()
let saveQueue = Promise.resolve()
let crawlPromise = null
const crawlQueue = []
const queuedUrls = new Set()
const visitedUrls = new Set()
const robotsCache = new Map()
const hostCounts = new Map()
const crawlState = {
  running: false,
  stopRequested: false,
  target: null,
  milestone: firstMilestone,
  attempted: 0,
  indexed: 0,
  failed: 0,
  skipped: 0,
  queued: 0,
  lastUrl: null,
  lastError: null,
  startedAt: null,
  updatedAt: null,
  message: 'Gotowe do indeksowania.'
}

function decodeHtml(value = '') {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function textFromHtml(html) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function firstMatch(regex, html) {
  return html.match(regex)?.[1]?.trim() || ''
}

function canonicalUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Do indeksu można dodać tylko strony HTTP lub HTTPS.')
  url.hash = ''
  return url.toString()
}

function extractImages(html, pageUrl, pageTitle) {
  const page = new URL(pageUrl)
  return [...html.matchAll(/<img\b[^>]*>/gi)]
    .map((match) => {
      const tag = match[0]
      const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1]
      const alt = decodeHtml(tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || '')
      if (!src) return null
      try {
        const imageUrl = new URL(src, page).toString()
        if (!['http:', 'https:'].includes(new URL(imageUrl).protocol)) return null
        return {
          imageUrl,
          pageUrl,
          title: alt || pageTitle,
          alt: alt || pageTitle,
          domain: page.hostname.replace(/^www\./, ''),
          path: page.pathname.replace(/^\//, '').replaceAll('/', ' › ') || 'strona główna',
          content: `${alt} ${pageTitle} ${page.hostname}`
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .filter((item, index, all) => all.findIndex((candidate) => candidate.imageUrl === item.imageUrl) === index)
    .slice(0, 24)
}

function extractLinks(html, pageUrl, scopeHost) {
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)]
    .map((match) => {
      try {
        const link = new URL(decodeHtml(match[1]), pageUrl)
        if (!['http:', 'https:'].includes(link.protocol)) return null
        if (link.hostname.replace(/^www\./, '') !== scopeHost) return null
        if (/\.(?:pdf|zip|rar|7z|docx?|xlsx?|pptx?|mp[34]|avi|mov|jpg|jpeg|png|gif|webp|svg)(?:$|\?)/i.test(link.pathname)) return null
        link.hash = ''
        link.search = ''
        return canonicalUrl(link.toString())
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .filter((url, index, all) => all.indexOf(url) === index)
}

function parseDocument(html, requestedUrl) {
  const url = canonicalUrl(requestedUrl)
  const title = decodeHtml(firstMatch(/<title[^>]*>([\s\S]*?)<\/title>/i, html)) || new URL(url).hostname
  const description = decodeHtml(firstMatch(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i, html))
  const content = textFromHtml(html)
  const parsed = new URL(url)
  const fallbackSnippet = content.replace(title, '').trim()

  return {
    url,
    title: title.slice(0, 180),
    domain: parsed.hostname.replace(/^www\./, ''),
    path: parsed.pathname.replace(/^\//, '').replaceAll('/', ' › ') || 'strona główna',
    snippet: (description || fallbackSnippet || 'Strona została dodana do indeksu LIOnet.').slice(0, 360),
    content: content.slice(0, maxDocumentContent),
    images: extractImages(html, url, title),
    indexedAt: new Date().toISOString()
  }
}

async function loadIndex() {
  try {
    documents = JSON.parse(await readFile(indexPath, 'utf8'))
    if (!Array.isArray(documents)) documents = []
    documents = documents.map((document) => ({ ...document, content: document.content?.slice(0, maxDocumentContent) || '' }))
    indexModifiedAt = (await stat(indexPath)).mtimeMs
  } catch {
    documents = []
    indexModifiedAt = 0
  }
}

async function syncIndexFromDisk() {
  try {
    const modifiedAt = (await stat(indexPath)).mtimeMs
    if (modifiedAt === indexModifiedAt) return
    const nextDocuments = JSON.parse(await readFile(indexPath, 'utf8'))
    if (Array.isArray(nextDocuments)) documents = nextDocuments
    indexModifiedAt = modifiedAt
  } catch {
    // Plik może być chwilowo zapisywany przez osobny proces crawlera.
  }
}

async function saveIndex() {
  await mkdir(path.dirname(indexPath), { recursive: true })
  const snapshot = JSON.stringify(documents, null, 2) + '\n'
  saveQueue = saveQueue.then(async () => {
    const tempPath = `${indexPath}.${process.pid}.tmp`
    await writeFile(tempPath, snapshot, 'utf8')
    await rename(tempPath, indexPath)
    indexModifiedAt = (await stat(indexPath)).mtimeMs
  })
  await saveQueue
}

async function loadCrawlSeeds() {
  try {
    const source = JSON.parse(await readFile(seedsPath, 'utf8'))
    return [...(source.polish || []), ...(source.foreign || [])]
  } catch {
    return []
  }
}

function getCrawlStatus() {
  return {
    ...crawlState,
    indexed: documents.length,
    queued: crawlQueue.length,
    progress: Math.min(100, Math.round((documents.length / crawlState.milestone) * 100))
  }
}

export async function persistCrawlStatus() {
  await mkdir(path.dirname(crawlStatusPath), { recursive: true })
  await writeFile(crawlStatusPath, JSON.stringify(getCrawlStatus(), null, 2) + '\n', 'utf8')
}

async function readPersistedCrawlStatus() {
  try {
    return JSON.parse(await readFile(crawlStatusPath, 'utf8'))
  } catch {
    return null
  }
}

function enqueueUrl(rawUrl, scopeHost) {
  try {
    if (crawlQueue.length >= maxQueueSize) return false
    const url = canonicalUrl(rawUrl)
    const host = scopeHost || new URL(url).hostname.replace(/^www\./, '')
    if (new URL(url).hostname.replace(/^www\./, '') !== host) return false
    if (queuedUrls.has(url) || visitedUrls.has(url)) return false
    queuedUrls.add(url)
    crawlQueue.push({ url, scopeHost: host })
    return true
  } catch {
    return false
  }
}

function parseRobots(text) {
  const groups = text.split(/(?=^\s*user-agent\s*:)/gim)
  const relevant = groups.find((group) => /user-agent\s*:\s*LIOnetBot/i.test(group))
    || groups.find((group) => /user-agent\s*:\s*\*/i.test(group))
  if (!relevant) return { allow: [], disallow: [] }
  const allow = [...relevant.matchAll(/^\s*allow\s*:\s*(\S*)/gim)].map((match) => match[1])
  const disallow = [...relevant.matchAll(/^\s*disallow\s*:\s*(\S*)/gim)].map((match) => match[1])
  return { allow, disallow }
}

async function getRobots(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin)
  try {
    const response = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': crawlUserAgent }
    })
    const rules = response.ok ? parseRobots(await response.text()) : { allow: [], disallow: [] }
    robotsCache.set(origin, rules)
    return rules
  } catch {
    // Awaria robots.txt nie blokuje całego indeksu; każda strona nadal ma timeout.
    const rules = { allow: [], disallow: [] }
    robotsCache.set(origin, rules)
    return rules
  }
}

async function isAllowedByRobots(rawUrl) {
  const url = new URL(rawUrl)
  const rules = await getRobots(`${url.protocol}//${url.host}`)
  const pathname = url.pathname || '/'
  const longestAllow = rules.allow.filter((rule) => rule && pathname.startsWith(rule)).reduce((length, rule) => Math.max(length, rule.length), 0)
  const longestDisallow = rules.disallow.filter((rule) => rule && pathname.startsWith(rule)).reduce((length, rule) => Math.max(length, rule.length), 0)
  return longestAllow >= longestDisallow
}

async function fetchHtml(rawUrl) {
  const response = await fetch(rawUrl, {
    signal: AbortSignal.timeout(12000),
    headers: { 'user-agent': crawlUserAgent, accept: 'text/html,application/xhtml+xml' }
  })
  if (!response.ok) throw new Error(`Strona odpowiedziała kodem ${response.status}.`)
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) throw new Error('Adres nie prowadzi do strony HTML.')
  const reader = response.body?.getReader()
  if (!reader) return { html: (await response.text()).slice(0, maxHtmlBytes), url: response.url || rawUrl }
  const decoder = new TextDecoder()
  const chunks = []
  let totalBytes = 0
  while (totalBytes < maxHtmlBytes) {
    const { done, value } = await reader.read()
    if (done) break
    const remaining = maxHtmlBytes - totalBytes
    const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
    totalBytes += chunk.byteLength
    chunks.push(decoder.decode(chunk, { stream: chunk.byteLength === value.byteLength }))
    if (chunk.byteLength < value.byteLength) {
      await reader.cancel()
      break
    }
  }
  chunks.push(decoder.decode())
  return { html: chunks.join(''), url: response.url || rawUrl }
}

function upsertDocument(document) {
  const existingIndex = documents.findIndex((item) => item.url === document.url)
  if (existingIndex >= 0) documents[existingIndex] = document
  else documents.push(document)
}

async function crawlOne() {
  const entry = crawlQueue.shift()
  if (!entry) return false
  queuedUrls.delete(entry.url)
  if (visitedUrls.has(entry.url)) return true
  visitedUrls.add(entry.url)
  const host = entry.scopeHost
  hostCounts.set(host, (hostCounts.get(host) || 0) + 1)
  crawlState.attempted += 1
  crawlState.lastUrl = entry.url
  crawlState.updatedAt = new Date().toISOString()
  try {
    if (!await isAllowedByRobots(entry.url)) {
      crawlState.skipped += 1
      return true
    }
    const { html, url } = await fetchHtml(entry.url)
    const document = parseDocument(html, url)
    upsertDocument(document)
    crawlState.indexed = documents.length
    for (const link of extractLinks(html, url, host).slice(0, maxLinksPerPage)) enqueueUrl(link, host)
    if (crawlState.attempted % 100 === 0) {
      await saveIndex()
      await persistCrawlStatus()
    }
  } catch (error) {
    crawlState.failed += 1
    crawlState.lastError = `${entry.url}: ${error instanceof Error ? error.message : 'Nieznany błąd'}`
  }
  crawlState.updatedAt = new Date().toISOString()
  return true
}

async function runCrawl() {
  const worker = async () => {
    while (!crawlState.stopRequested) {
      const didWork = await crawlOne()
      if (!didWork) break
      if (crawlState.attempted % 5 === 0) await new Promise((resolve) => setImmediate(resolve))
    }
  }
  try {
    await Promise.all(Array.from({ length: crawlWorkers }, worker))
    await saveIndex()
  } finally {
    const wasStopped = crawlState.stopRequested
    crawlState.running = false
    crawlState.stopRequested = false
    crawlState.indexed = documents.length
    crawlState.queued = crawlQueue.length
    crawlState.updatedAt = new Date().toISOString()
    crawlState.message = wasStopped ? 'Crawler zatrzymany przez użytkownika.' : 'Kolejka została wyczerpana; crawler czeka na nowe adresy.'
    await persistCrawlStatus()
    crawlPromise = null
  }
}

export async function searchIndex(query, page = 1) {
  await ready
  await syncIndexFromDisk()
  const ranked = rankResults(documents, query)
  const safePage = Math.max(1, page)
  const start = (safePage - 1) * 10
  return {
    results: ranked.slice(start, start + 10).map(({ content, indexedAt, ...result }) => result),
    total: ranked.length,
    indexed: documents.length,
    page: safePage
  }
}

export async function searchImages(query, page = 1) {
  await ready
  await syncIndexFromDisk()
  const allImages = documents.flatMap((document) => document.images || [])
  const ranked = rankResults(allImages, query)
  const safePage = Math.max(1, page)
  const start = (safePage - 1) * 10
  return {
    results: ranked.slice(start, start + 10).map(({ content, ...result }) => result),
    total: ranked.length,
    indexed: documents.length,
    page: safePage
  }
}

export async function getIndexStatus() {
  await ready
  await syncIndexFromDisk()
  const localCrawl = getCrawlStatus()
  const persistedCrawl = await readPersistedCrawlStatus()
  const usePersisted = persistedCrawl?.updatedAt && (!localCrawl.updatedAt || persistedCrawl.updatedAt > localCrawl.updatedAt)
  const crawl = usePersisted ? { ...localCrawl, ...persistedCrawl, indexed: documents.length, progress: Math.min(100, Math.round((documents.length / (persistedCrawl.milestone || firstMilestone)) * 100)) } : localCrawl
  return { indexed: documents.length, updatedAt: documents.at(-1)?.indexedAt || null, crawl }
}

export async function indexPage(rawUrl) {
  await ready
  await syncIndexFromDisk()
  const url = canonicalUrl(rawUrl)
  const { html, url: finalUrl } = await fetchHtml(url)
  const document = parseDocument(html, finalUrl)
  upsertDocument(document)
  await saveIndex()
  return document
}

export async function startCrawl() {
  await ready
  await syncIndexFromDisk()
  if (crawlState.running) return getCrawlStatus()
  const seeds = await loadCrawlSeeds()
  crawlQueue.length = 0
  queuedUrls.clear()
  visitedUrls.clear()
  hostCounts.clear()
  crawlState.running = true
  crawlState.stopRequested = false
  crawlState.target = null
  crawlState.attempted = 0
  crawlState.indexed = documents.length
  crawlState.failed = 0
  crawlState.skipped = 0
  crawlState.lastUrl = null
  crawlState.lastError = null
  crawlState.startedAt = new Date().toISOString()
  crawlState.updatedAt = crawlState.startedAt
  crawlState.message = 'Indeksowanie stron polskich i zagranicznych działa bez globalnego limitu.'
  for (const seed of seeds) enqueueUrl(seed)
  await persistCrawlStatus()
  crawlPromise = runCrawl()
  return getCrawlStatus()
}

export async function stopCrawl() {
  await ready
  crawlState.stopRequested = true
  await persistCrawlStatus()
  return getCrawlStatus()
}
