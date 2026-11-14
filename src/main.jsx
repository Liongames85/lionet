import { StrictMode, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { rankResults } from '../search-engine.mjs'
import './styles.css'

const staticMode = import.meta.env.VITE_STATIC_MODE === 'true'
let staticIndexPromise

async function getStaticIndex() {
  if (!staticIndexPromise) {
    const indexUrl = `${import.meta.env.BASE_URL}data/search-index.json`
    staticIndexPromise = fetch(indexUrl).then(async (response) => {
      if (!response.ok) throw new Error('Nie udało się pobrać statycznego indeksu LIOnet.')
      return response.json()
    })
  }
  return staticIndexPromise
}

async function getStaticStatus() {
  const [index, statusResponse] = await Promise.all([
    getStaticIndex(),
    fetch(`${import.meta.env.BASE_URL}data/crawl-status.json`).catch(() => null)
  ])
  const crawl = statusResponse?.ok ? await statusResponse.json() : { running: false, indexed: index.length, queued: 0, progress: 100 }
  return { indexed: index.length, updatedAt: index.at(-1)?.indexedAt || null, crawl: { ...crawl, indexed: index.length } }
}

async function getStaticJson(url) {
  const query = new URL(url, window.location.origin).searchParams
  const index = await getStaticIndex()
  if (url.startsWith('/api/index/status')) return getStaticStatus()
  if (url.startsWith('/api/index')) throw new Error('Ta wersja LIOnet jest statyczna. Nowe strony dodaje automatyczny crawler GitHub Actions.')

  const queryText = query.get('q') || ''
  const page = Math.max(1, Number(query.get('page') || '1'))
  const source = url.startsWith('/api/images') ? index.flatMap((document) => document.images || []) : index
  const ranked = rankResults(source, queryText)
  const start = (page - 1) * 10
  return { results: ranked.slice(start, start + 10), total: ranked.length, indexed: index.length, page }
}

const tabs = [
  { id: 'all', label: 'Wszystko' },
  { id: 'images', label: 'Obrazy' },
  { id: 'news', label: 'Wiadomości' },
  { id: 'maps', label: 'Mapy' }
]

function SearchIcon({ size = 22 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="10.8" cy="10.8" r="6.7" stroke="currentColor" strokeWidth="2" />
      <path d="m16 16 4.3 4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function ImageIcon({ size = 22 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="8.2" cy="9" r="1.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="m4.5 17 4.8-4.6 3.2 3 2.3-2.2 4.7 4.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <span className="check-icon" aria-hidden="true">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
        <path d="m6.6 12.4 3.6 3.5 7.4-8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function ArrowIcon({ direction = 'right' }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" className={direction === 'left' ? 'arrow-left' : ''}>
      <path d="M5 12h13M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SearchResult({ result, focused }) {
  return (
    <article className={`result ${focused ? 'result--focused' : ''}`}>
      <a className="result-link" href={result.url} target="_blank" rel="noreferrer">
        <span className="result-address">
          <span>{result.domain}</span>
          <span aria-hidden="true">›</span>
          <span>{result.path}</span>
        </span>
        <h2>{result.title}</h2>
      </a>
      <p>{result.snippet}</p>
    </article>
  )
}

function ImageResult({ result }) {
  return (
    <article className="image-result">
      <a className="image-result__media" href={result.pageUrl} target="_blank" rel="noreferrer">
        <img src={result.imageUrl} alt={result.alt || result.title} loading="lazy" />
      </a>
      <a className="image-result__title" href={result.pageUrl} target="_blank" rel="noreferrer">{result.title}</a>
      <span className="image-result__domain">{result.domain}</span>
    </article>
  )
}

async function getJson(url, options) {
  if (staticMode) return getStaticJson(url, options)
  const response = await fetch(url, options)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Nie udało się wykonać operacji.')
  return payload
}

function App() {
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [activeTab, setActiveTab] = useState('all')
  const [hasSearched, setHasSearched] = useState(false)
  const [results, setResults] = useState([])
  const [imageResults, setImageResults] = useState([])
  const [totalResults, setTotalResults] = useState(0)
  const [totalImages, setTotalImages] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [focusedResult, setFocusedResult] = useState(0)
  const [indexOpen, setIndexOpen] = useState(false)
  const [indexUrl, setIndexUrl] = useState('')
  const [indexMessage, setIndexMessage] = useState('')
  const [indexing, setIndexing] = useState(false)
  const [indexedCount, setIndexedCount] = useState(null)
  const [crawlStatus, setCrawlStatus] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    refreshIndexStatus()
    const statusTimer = window.setInterval(refreshIndexStatus, 2500)
    return () => window.clearInterval(statusTimer)
  }, [indexOpen])

  const resultCountLabel = useMemo(() => {
    if (loading) return activeTab === 'images' ? 'Szukam obrazów…' : 'Szukam stron…'
    if (error) return 'Wyniki są tymczasowo niedostępne'
    return `${activeTab === 'images' ? totalImages : totalResults} wyników`
  }, [activeTab, error, loading, totalImages, totalResults])

  async function refreshIndexStatus() {
    try {
      const status = await getJson('/api/index/status')
      setIndexedCount(status.indexed)
      setCrawlStatus(status.crawl || null)
    } catch {
      setIndexedCount(null)
    }
  }

  async function runTextSearch(nextQuery, nextPage = 1) {
    const cleanQuery = nextQuery.trim()
    if (!cleanQuery) return
    setHasSearched(true)
    setQuery(cleanQuery)
    setSubmittedQuery(cleanQuery)
    setPage(nextPage)
    setFocusedResult(0)
    setLoading(true)
    setError('')
    try {
      const payload = await getJson(`/api/search?q=${encodeURIComponent(cleanQuery)}&page=${nextPage}`)
      setResults(payload.results)
      setTotalResults(payload.total)
    } catch (searchError) {
      setResults([])
      setTotalResults(0)
      setError(searchError.message)
    } finally {
      setLoading(false)
    }
  }

  async function runImageSearch(nextQuery, nextPage = 1) {
    const cleanQuery = nextQuery.trim()
    if (!cleanQuery) return
    setHasSearched(true)
    setQuery(cleanQuery)
    setSubmittedQuery(cleanQuery)
    setPage(nextPage)
    setLoading(true)
    setError('')
    try {
      const payload = await getJson(`/api/images?q=${encodeURIComponent(cleanQuery)}&page=${nextPage}`)
      setImageResults(payload.results)
      setTotalImages(payload.total)
    } catch (searchError) {
      setImageResults([])
      setTotalImages(0)
      setError(searchError.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleSearch(event) {
    event?.preventDefault()
    if (!query.trim()) {
      inputRef.current?.focus()
      return
    }
    setHasSearched(true)
    if (activeTab === 'images') await runImageSearch(query, 1)
    else await runTextSearch(query, 1)
  }

  function handleTab(tabId) {
    setHasSearched(true)
    setActiveTab(tabId)
    if (submittedQuery.trim()) {
      if (tabId === 'images') runImageSearch(submittedQuery, 1)
      else runTextSearch(submittedQuery, 1)
    } else {
      setPage(1)
      setError('')
    }
    inputRef.current?.focus()
  }

  function handlePageChange(nextPage) {
    if (nextPage < 1 || nextPage > 5 || nextPage === page || loading) return
    if (activeTab === 'images') runImageSearch(submittedQuery, nextPage)
    else runTextSearch(submittedQuery, nextPage)
  }

  async function handleIndexSubmit(event) {
    event.preventDefault()
    if (!indexUrl.trim()) return
    setIndexing(true)
    setIndexMessage('Pobieram stronę i tworzę wpis w naszym indeksie…')
    try {
      const payload = await getJson('/api/index', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: indexUrl.trim() })
      })
      setIndexUrl('')
      setIndexMessage(`Dodano do indeksu: ${payload.document.title}`)
      await refreshIndexStatus()
      if (activeTab === 'images') await runImageSearch(submittedQuery, 1)
      else await runTextSearch(submittedQuery, 1)
    } catch (indexError) {
      setIndexMessage(indexError.message)
    } finally {
      setIndexing(false)
    }
  }

  async function handleCrawlStart() {
    setIndexMessage('Uruchamiam automatyczne indeksowanie stron polskich i zagranicznych bez globalnego limitu…')
    try {
      await getJson('/api/index/crawl', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      })
      await refreshIndexStatus()
    } catch (crawlError) {
      setIndexMessage(crawlError.message)
    }
  }

  async function handleCrawlStop() {
    try {
      await getJson('/api/index/crawl/stop', { method: 'POST' })
      setIndexMessage('Zatrzymuję kolejkę po zakończeniu aktualnej strony…')
      await refreshIndexStatus()
    } catch (crawlError) {
      setIndexMessage(crawlError.message)
    }
  }

  function handleHome(event) {
    event?.preventDefault()
    setHasSearched(false)
    setActiveTab('all')
    setQuery('')
    setSubmittedQuery('')
    setResults([])
    setImageResults([])
    setTotalResults(0)
    setTotalImages(0)
    setPage(1)
    setError('')
    setFocusedResult(0)
    setIndexOpen(false)
    inputRef.current?.focus()
  }

  function openIndexPanel() {
    setIndexOpen(true)
    setIndexMessage('')
  }

  function openImageSearch() {
    setHasSearched(true)
    setActiveTab('images')
    setQuery('')
    setSubmittedQuery('')
    setImageResults([])
    setTotalImages(0)
    setPage(1)
    setError('')
  }

  function renderSearchForm(home = false) {
    return (
      <form className={`search-form ${home ? 'search-form--home' : ''}`} onSubmit={handleSearch} role="search">
        {activeTab === 'images' ? <ImageIcon size={24} /> : <SearchIcon size={25} />}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={home ? (activeTab === 'images' ? 'Szukaj obrazów w LIOnet' : 'Szukaj w LIOnet') : undefined}
          aria-label={activeTab === 'images' ? 'Wyszukaj obrazy w indeksie LIOnet' : 'Wyszukaj w indeksie LIOnet'}
          spellCheck="false"
        />
        {query && <button type="button" className="clear-button" onClick={() => setQuery('')} aria-label="Wyczyść zapytanie">×</button>}
        <button className="search-button" type="submit" aria-label={activeTab === 'images' ? 'Szukaj obrazów' : 'Szukaj'}>
          {activeTab === 'images' ? <ImageIcon size={23} /> : <SearchIcon size={25} />}
        </button>
      </form>
    )
  }

  function renderIndexPanel() {
    return (
      <section className="index-panel" aria-label="Własny indeks LIOnet">
        <div className="index-panel__copy">
          <strong>Własny indeks LIOnet</strong>
          <span>{indexedCount === null ? 'Status niedostępny' : `${indexedCount} stron w indeksie`}</span>
        </div>
        {!staticMode ? (
          <form className="index-form" onSubmit={handleIndexSubmit}>
            <input value={indexUrl} onChange={(event) => setIndexUrl(event.target.value)} placeholder="https://example.com" aria-label="Adres strony do zindeksowania" inputMode="url" />
            <button type="submit" disabled={indexing}>{indexing ? 'Indeksuję…' : 'Indeksuj'}</button>
          </form>
        ) : (
          <p className="index-message">Indeks jest aktualizowany automatycznie przez własny crawler.</p>
        )}
        <div className="crawl-panel">
          <div className="crawl-panel__heading">
            <strong>Crawler LIOnet</strong>
            <span>{crawlStatus?.running ? 'pracuje bez limitu' : 'gotowy'}</span>
          </div>
          <div className="crawl-progress" aria-label="Postęp do pierwszych 10 000 stron">
            <span style={{ width: `${crawlStatus?.progress || 0}%` }} />
          </div>
          <div className="crawl-panel__meta">
            <span>{(crawlStatus?.indexed ?? indexedCount ?? 0).toLocaleString('pl-PL')} stron zindeksowanych</span>
            <span>{(crawlStatus?.queued || 0).toLocaleString('pl-PL')} w kolejce</span>
          </div>
          {!staticMode && (
            <div className="crawl-panel__actions">
              <button type="button" onClick={handleCrawlStart} disabled={crawlStatus?.running}>Uruchom crawler</button>
              {crawlStatus?.running && <button type="button" className="crawl-stop" onClick={handleCrawlStop}>Zatrzymaj</button>}
            </div>
          )}
          <small>{staticMode ? 'Wersja GitHub Pages: crawler działa cyklicznie w GitHub Actions.' : 'Polskie i zagraniczne domeny, własny crawler, robots.txt i brak globalnego limitu.'}</small>
        </div>
        {indexMessage && <p className="index-message" role="status">{indexMessage}</p>}
      </section>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={handleHome} aria-label="LIOnet, strona główna">LIOnet</a>
        <nav className="topnav" aria-label="Nawigacja główna">
          <a href="#about">O nas</a>
          <a href="#privacy">Prywatność</a>
          <button type="button" className="index-toggle" onClick={() => setIndexOpen((open) => !open)}>{indexOpen ? 'Zamknij indeks' : 'Dodaj stronę'}</button>
        </nav>
      </header>

      <main className={`page-layout ${hasSearched ? '' : 'page-layout--home'}`}>
        <section className={`search-column ${hasSearched ? '' : 'search-column--home'}`} aria-label={hasSearched ? 'Wyniki wyszukiwania' : 'Strona startowa LIOnet'}>
          {!hasSearched ? (
            <div className="home-state">
              <div className="home-logo" aria-label="LIOnet">LIOnet</div>
              {renderSearchForm(true)}
              {indexOpen && renderIndexPanel()}
              <div className="home-cards" aria-label="Skróty LIOnet">
                <button type="button" className="home-card" onClick={openIndexPanel}>
                  <span className="home-card__icon"><CheckIcon /></span>
                  <strong>Własny indeks</strong>
                  <span>Indeks rośnie automatycznie</span>
                </button>
                <button type="button" className="home-card" onClick={openIndexPanel}>
                  <span className="home-card__icon"><ArrowIcon /></span>
                  <strong>Dodaj stronę</strong>
                  <span>Zasil indeks własną stroną</span>
                </button>
                <button type="button" className="home-card" onClick={openImageSearch}>
                  <span className="home-card__icon"><ImageIcon size={24} /></span>
                  <strong>Obrazy</strong>
                  <span>Szukaj grafik w zindeksowanych stronach</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {renderSearchForm()}
              {indexOpen && renderIndexPanel()}

              <div className="tabs" role="tablist" aria-label="Typ wyników">
                {tabs.map((tab) => (
                  <button key={tab.id} className={`tab ${activeTab === tab.id ? 'tab--active' : ''}`} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => handleTab(tab.id)}>
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="results-header">
                <span>{resultCountLabel}</span>
                {submittedQuery && <span className="query-note">dla „{submittedQuery}”</span>}
              </div>

              {loading && <div className="loading-state" role="status"><span className="loader" />{activeTab === 'images' ? 'Przeszukuję obrazy w naszym indeksie…' : 'Przeszukuję strony w naszym indeksie…'}</div>}

              {!loading && error && (
                <div className="error-state" role="alert">
                  <p>{error}</p>
                  <button type="button" className="retry-button" onClick={() => activeTab === 'images' ? runImageSearch(submittedQuery, page) : runTextSearch(submittedQuery, page)}>Spróbuj ponownie <ArrowIcon /></button>
                </div>
              )}

              {!loading && !error && activeTab !== 'images' && results.length === 0 && (
                <div className="empty-state"><strong>Brak tej frazy w naszym indeksie.</strong><span>Dodaj stronę przyciskiem „Dodaj stronę”, żeby LIOnet mogło ją zindeksować.</span></div>
              )}

              {!loading && !error && activeTab === 'images' && imageResults.length === 0 && (
                <div className="empty-state"><strong>Brak obrazów dla tej frazy.</strong><span>Obrazy pojawiają się po zindeksowaniu stron zawierających grafiki.</span></div>
              )}

              {!loading && !error && activeTab !== 'images' && results.length > 0 && (
                <div className="results-list">{results.map((result, index) => <SearchResult key={`${result.url}-${index}`} result={result} focused={focusedResult === index} />)}</div>
              )}

              {!loading && !error && activeTab === 'images' && imageResults.length > 0 && (
                <div className="images-grid">{imageResults.map((result, index) => <ImageResult key={`${result.imageUrl}-${index}`} result={result} />)}</div>
              )}

              {!loading && !error && (activeTab === 'images' ? imageResults.length > 0 : results.length > 0) && (
                <nav className="pagination" aria-label="Paginacja wyników">
                  <button type="button" className="pagination-button pagination-button--wide" disabled={page === 1} onClick={() => handlePageChange(page - 1)}><ArrowIcon direction="left" /><span>Poprzednia</span></button>
                  {[1, 2, 3, 4, 5].map((number) => <button key={number} type="button" className={`pagination-button ${page === number ? 'pagination-button--active' : ''}`} onClick={() => handlePageChange(number)}>{number}</button>)}
                  <button type="button" className="pagination-button pagination-button--wide" disabled={page === 5} onClick={() => handlePageChange(page + 1)}><span>Następna</span><ArrowIcon /></button>
                </nav>
              )}
            </>
          )}
        </section>

        {hasSearched && (
          <aside className="trust-rail" aria-label="Zasady LIOnet">
            <div className="trust-item"><CheckIcon /><span>Własny indeks</span></div>
            <div className="trust-item"><CheckIcon /><span>Bez śledzenia</span></div>
            <div className="trust-item"><CheckIcon /><span>Tylko wyniki</span></div>
          </aside>
        )}
      </main>

      <footer className="footer-note"><span>LIOnet — własny indeks stron, własne słowa i własny ranking.</span><span className="footer-dot" aria-hidden="true">·</span><a href="#privacy">Prywatność</a></footer>
    </div>
  )
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
