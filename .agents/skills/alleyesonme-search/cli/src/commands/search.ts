import {
  listingUrl,
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

// alleyesonme.jobs's own `?q=` parameter does not filter server-rendered results (verified
// live 2026-08-12 — see url-reference.md). This CLI scans a bounded run of pages, newest
// first, and filters locally on title/company instead.
const DEFAULT_SCAN_PAGES = 5
// Upper bound on pages fetched per call when --jobage is set without an explicit
// --scan-pages, so a large --jobage can't turn one search into a hundred-plus requests.
const SAFETY_CAP_PAGES = 30

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const date = c.date || "—"
    return `${c.id.slice(0, 30).padEnd(31)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(31) + " " + "TITLE".padEnd(42) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(22) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
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
      if (opts.query) {
        const q = opts.query.toLowerCase()
        cards = cards.filter(
          (c) => (c.title && c.title.toLowerCase().includes(q)) || (c.company && c.company.toLowerCase().includes(q)),
        )
      }

      allCards.push(...cards)
      if (stopAfterThisPage) break
    }

    if (opts.limit !== undefined && opts.limit >= 0) allCards = allCards.slice(0, opts.limit)

    const meta = {
      count: allCards.length,
      page: opts.page,
      scanned,
      totalPagesAvailable,
      query: opts.query ?? null,
      jobage: opts.jobage ?? null,
    }

    if (opts.format === "table") {
      process.stdout.write(
        `Scanned pages ${opts.page}-${opts.page + scanned - 1} of ~${totalPagesAvailable ?? "?"} — ${meta.count} result(s)\n\n`,
      )
      process.stdout.write(renderTable(allCards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        allCards
          .map((c) => `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`)
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(JSON.stringify({ meta, results: allCards }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
