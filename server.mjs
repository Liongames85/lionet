import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { handleApiRequest } from './api-handler.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(root, 'dist')
const port = Number(process.env.PORT || 4173)
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
}

const server = http.createServer(async (req, res) => {
  if (await handleApiRequest(req, res)) return

  const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const requestedPath = requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname
  const filePath = path.resolve(distDir, `.${requestedPath}`)
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  try {
    const file = await readFile(filePath)
    const extension = path.extname(filePath)
    res.writeHead(200, { 'content-type': mimeTypes[extension] || 'application/octet-stream' })
    res.end(file)
  } catch {
    const index = await readFile(path.join(distDir, 'index.html'))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(index)
  }
})

server.listen(port, () => {
  console.log(`LIOnet działa na http://127.0.0.1:${port}`)
})
