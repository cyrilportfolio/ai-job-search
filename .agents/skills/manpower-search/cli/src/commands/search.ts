import {
  listingUrl,
  searchUrl,
  htmlFetch,
  parseJobCards,
  parseTotalPages,
  jobageCutoffISO,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  jobage?: number
  page: number
  scanPages?: number
  limit?: number
  format: "json" | "table" | "plain"
}

// The archive listing (/fr/jobs/, /fr/jobs/page/N/) is sorted newest-first and paginates
// cleanly (verified live 2026-08-12). Used when --query is absent, or as the only way to
// see beyond ?s='s single-batch result set.
const DEFAULT_SCAN_PAGES = 5
// manpower.lu only has ~12 pages of listings total; this cap just avoids an unbounded scan
// if a very large --jobage is passed without --scan-pages.
const SAFETY_CAP_PAGES = 12

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 46).padEnd(46)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const date = c.date || "—"
    return `${c.id.slice(0, 34).padEnd(35)} ${title} ${loc} ${date}`
  })
  const header = "ID".padEnd(35) + " " + "TITLE".padEnd(46) + " " + "LOCATION".padEnd(22) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

async function runQuerySearch(opts: SearchOpts): Promise<{ cards: JobCard[]; scanned: number; totalPagesAvailable: null }> {
  const html = await htmlFetch(searchUrl(opts.query as string))
  let cards = parseJobCards(html)
  if (opts.jobage !== undefined) {
    const cutoff = jobageCutoffISO(opts.jobage)
    cards = cards.filter((c) => c.date !== null && c.date >= cutoff)
  }
  return { cards, scanned: 1, totalPagesAvailable: null }
}

async function runArchiveScan(
  opts: SearchOpts,
): Promise<{ cards: JobCard[]; scanned: number; totalPagesAvailable: number | null }> {
  const cutoff = opts.jobage !== undefined ? jobageCutoffISO(opts.jobage) : null
  const scanPagesLimit = opts.scanPages ?? (cutoff !== null ? SAFETY_CAP_PAGES : DEFAULT_SCAN_PAGES)

  let allCards: JobCard[] = []
  let totalPagesAvailable: number | null = null
  let scanned = 0

  for (let i = 0; i < scanPagesLimit; i++) {
    const page = opts.page + i
    const html = await htmlFetch(listingUrl(page))
    scanned++

    if (totalPagesAvailable === null) totalPagesAvailable = parseTotalPages(html)

    let cards = parseJobCards(html)
    if (cards.length === 0) break // past the last page

    let stopAfterThisPage = false
    if (cutoff !== null) {
      stopAfterThisPage = cards.some((c) => c.date !== null && c.date < cutoff)
      cards = cards.filter((c) => c.date !== null && c.date >= cutoff)
    }

    allCards.push(...cards)
    if (stopAfterThisPage) break
  }

  return { cards: allCards, scanned, totalPagesAvailable }
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const { cards, scanned, totalPagesAvailable } = opts.query ? await runQuerySearch(opts) : await runArchiveScan(opts)

    let results = cards
    if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

    const meta = {
      count: results.length,
      page: opts.query ? null : opts.page,
      scanned,
      totalPagesAvailable,
      query: opts.query ?? null,
      jobage: opts.jobage ?? null,
      mode: opts.query ? "search" : "archive-scan",
    }

    if (opts.format === "table") {
      const scanNote = opts.query
        ? `Server-side search for "${opts.query}" (single batch, not paginated)`
        : `Scanned pages ${opts.page}-${opts.page + scanned - 1} of ~${totalPagesAvailable ?? "?"}`
      process.stdout.write(`${scanNote} — ${meta.count} result(s)\n\n`)
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        results
          .map((c) => `${c.title}\n  ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`)
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(JSON.stringify({ meta, results }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
