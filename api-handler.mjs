import { getIndexStatus, indexPage, searchImages, searchIndex, startCrawl, stopCrawl } from './index-store.mjs'

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload))
}

export async function handleApiRequest(req, res, prefix = '') {
  const requestUrl = new URL(req.url || '/', 'http://localhost')
  const pathname = `${prefix}${requestUrl.pathname}`.replace(/\/+/g, '/')

  if (!pathname.startsWith('/api/')) return false

  try {
    if (pathname === '/api/search' && req.method === 'GET') {
      const query = requestUrl.searchParams.get('q')?.trim() || ''
      const page = Math.max(1, Number(requestUrl.searchParams.get('page') || '1'))
      sendJson(res, 200, await searchIndex(query, page))
      return true
    }

    if (pathname === '/api/images' && req.method === 'GET') {
      const query = requestUrl.searchParams.get('q')?.trim() || ''
      const page = Math.max(1, Number(requestUrl.searchParams.get('page') || '1'))
      sendJson(res, 200, await searchImages(query, page))
      return true
    }

    if (pathname === '/api/index/status' && req.method === 'GET') {
      sendJson(res, 200, await getIndexStatus())
      return true
    }

    if (pathname === '/api/index/crawl' && req.method === 'GET') {
      const status = await getIndexStatus()
      sendJson(res, 200, status.crawl)
      return true
    }

    if (pathname === '/api/index/crawl' && req.method === 'POST') {
      await readBody(req)
      sendJson(res, 202, await startCrawl())
      return true
    }

    if (pathname === '/api/index/crawl/stop' && req.method === 'POST') {
      sendJson(res, 200, await stopCrawl())
      return true
    }

    if (pathname === '/api/index' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req) || '{}')
      if (!body.url) {
        sendJson(res, 400, { error: 'Podaj adres strony.' })
        return true
      }
      const document = await indexPage(body.url)
      sendJson(res, 200, { ok: true, document })
      return true
    }

    sendJson(res, 404, { error: 'Nie znaleziono endpointu.' })
    return true
  } catch (error) {
    sendJson(res, 502, { error: error instanceof Error ? error.message : 'Nie udało się wykonać operacji.' })
    return true
  }
}

export function createApiMiddleware(prefix = '') {
  return async (req, res, next) => {
    const handled = await handleApiRequest(req, res, prefix)
    if (!handled && next) next()
  }
}
