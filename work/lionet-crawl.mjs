import { getIndexStatus, persistCrawlStatus, startCrawl } from '../index-store.mjs'

const started = await startCrawl()
await persistCrawlStatus()
console.log(`[LIOnet] crawler wystartował: ${JSON.stringify(started)}`)

const timer = setInterval(async () => {
  await persistCrawlStatus()
  const status = await getIndexStatus()
  console.log(`[LIOnet] ${status.indexed} stron | kolejka ${status.crawl.queued} | błędy ${status.crawl.failed}`)
  if (!status.crawl.running) {
    clearInterval(timer)
    process.exit(0)
  }
}, 30000)
