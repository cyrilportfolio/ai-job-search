import {
  searchUrl,
  apiFetch,
  buildSearchBody,
  parseSearchResponse,
  jobageToPublicationPeriod,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  country?: string[] // ISO alpha-2, e.g. ["LU", "FR"]. Empty/undefined = EU-wide.
  jobage?: number
  page: number
  limit?: number
  lang: string
  format: "json" | "table" | "plain"
}

// EURES's own results-per-page cap wasn't probed live (out of scope for the mandated test
// query); this is a conservative ceiling so --limit can't accidentally request an enormous
// single response. Raise it if the API is later confirmed to support more.
const MAX_RESULTS_PER_PAGE = 50
const DEFAULT_RESULTS_PER_PAGE = 10

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 46).padEnd(46)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 10).padEnd(10)
    const date = c.date || "—"
    return `${c.id.padEnd(16)} ${title} ${company} ${loc} ${date}`
  })
  const header = "ID".padEnd(16) + " " + "TITLE".padEnd(46) + " " + "COMPANY".padEnd(24) + " " + "LOC".padEnd(10) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const resultsPerPage = Math.min(opts.limit ?? DEFAULT_RESULTS_PER_PAGE, MAX_RESULTS_PER_PAGE)
    const body = buildSearchBody({
      query: opts.query,
      locationCodes: opts.country ?? [],
      publicationPeriod: jobageToPublicationPeriod(opts.jobage),
      page: opts.page,
      resultsPerPage,
      lang: opts.lang,
    })

    const raw = await apiFetch(searchUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    let { count, results } = parseSearchResponse(raw, opts.lang)
    if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

    const meta = {
      count,
      returned: results.length,
      page: opts.page,
      country: opts.country ?? null,
      jobage: opts.jobage ?? null,
      query: opts.query ?? null,
    }

    if (opts.format === "table") {
      process.stdout.write(`${meta.returned} of ${meta.count} total match(es)\n\n`)
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
