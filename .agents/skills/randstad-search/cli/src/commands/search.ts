import { listingUrl, htmlFetch, parseListingPage, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query?: string
  page: number
  jobage?: number
  limit?: number
  format: "json" | "table" | "plain"
}

function jobageCutoffISO(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 46).padEnd(46)
    const company = (c.company || "—").slice(0, 20).padEnd(20)
    const loc = (c.location || "—").slice(0, 20).padEnd(20)
    const date = c.date || "—"
    return `${c.id.padEnd(10)} ${title} ${company} ${loc} ${date}`
  })
  const header = "ID".padEnd(10) + " " + "TITLE".padEnd(46) + " " + "COMPANY".padEnd(20) + " " + "LOCATION".padEnd(20) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(listingUrl(opts.query, opts.page))
    const { count, page, results: allResults } = parseListingPage(html)

    let results = allResults
    if (opts.jobage !== undefined) {
      const cutoff = jobageCutoffISO(opts.jobage)
      results = results.filter((c) => c.date !== null && c.date >= cutoff)
    }
    if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

    const meta = {
      count, // total matches across the whole site for this query, not just this page
      returned: results.length,
      page,
      query: opts.query ?? null,
      jobage: opts.jobage ?? null,
    }

    if (opts.format === "table") {
      process.stdout.write(`Page ${page} — ${meta.returned} of ${count} total match(es)\n\n`)
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        results
          .map((c) => `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`)
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
