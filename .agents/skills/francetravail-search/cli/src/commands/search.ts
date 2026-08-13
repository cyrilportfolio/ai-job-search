import {
  getAccessToken,
  resolvePaysCode,
  jobageToPublieeDepuis,
  buildRange,
  buildSearchUrl,
  apiFetch,
  parseContentRangeTotal,
  parseSearchResponse,
  writeError,
  MissingCredentialsError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  pays?: string
  departement?: string
  jobage?: number
  page: number
  limit: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 46).padEnd(46)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 16).padEnd(16)
    const date = c.date || "—"
    return `${c.id.padEnd(10)} ${title} ${company} ${loc} ${date}`
  })
  const header = "ID".padEnd(10) + " " + "TITLE".padEnd(46) + " " + "COMPANY".padEnd(24) + " " + "LOC".padEnd(16) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const token = await getAccessToken()

    let paysContinent: string | undefined
    if (!opts.departement) {
      paysContinent = await resolvePaysCode(token, opts.pays ?? "lu")
    }

    const range = buildRange(opts.page, opts.limit)
    const url = buildSearchUrl({
      query: opts.query,
      paysContinent,
      departement: opts.departement,
      publieeDepuis: jobageToPublieeDepuis(opts.jobage),
      range,
    })

    const { data, contentRange } = await apiFetch(url, token)
    const total = parseContentRangeTotal(contentRange)
    const results = parseSearchResponse(data).slice(0, opts.limit)

    const meta = {
      count: total ?? results.length,
      returned: results.length,
      page: opts.page,
      limit: opts.limit,
      paysContinent: paysContinent ?? null,
      departement: opts.departement ?? null,
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
    const code = e instanceof MissingCredentialsError ? "MISSING_CREDENTIALS" : "SEARCH_FAILED"
    writeError(e instanceof Error ? e.message : String(e), code)
    return 1
  }
}
