import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sourcePath = path.join(root, 'data', 'index.json')
const outputDir = path.join(root, 'dist', 'data')
const outputPath = path.join(outputDir, 'search-index.json')
const statusPath = path.join(root, 'data', 'crawl-status.json')
const statusOutputPath = path.join(outputDir, 'crawl-status.json')

const documents = JSON.parse(await readFile(sourcePath, 'utf8'))
const compactDocuments = documents.map(({ content, images = [], ...document }) => ({
  ...document,
  content: content?.slice(0, 1200) || '',
  images: images.map(({ content: imageContent, ...image }) => ({
    ...image,
    content: imageContent?.slice(0, 300) || ''
  }))
}))

await mkdir(outputDir, { recursive: true })
await writeFile(outputPath, JSON.stringify(compactDocuments), 'utf8')

try {
  const status = JSON.parse(await readFile(statusPath, 'utf8'))
  await writeFile(statusOutputPath, JSON.stringify({
    ...status,
    running: false,
    message: 'Indeks aktualizowany cyklicznie przez GitHub Actions.'
  }), 'utf8')
} catch {
  await writeFile(statusOutputPath, JSON.stringify({ indexed: documents.length, running: false, queued: 0, progress: 100 }), 'utf8')
}

console.log(`[LIOnet] statyczny indeks przygotowany: ${compactDocuments.length} stron`)
