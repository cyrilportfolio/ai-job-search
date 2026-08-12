import { runSearchFetch, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query?: string
  luOnly?: boolean
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 48).padEnd(48)
    const loc = (c.location || "—").slice(0, 20).padEnd(20)
    const date = c.date || "—"
    return `${c.id.padEnd(8)} ${title} ${loc} ${date}`
  })
  const header = "ID".padEnd(8) + " " + "TITLE".padEnd(48) + " " + "LOCATION".padEnd(20) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const perPage = Math.min(opts.limit ?? 20, 100) // WordPress REST API caps per_page at 100
    const { count, results: allResults } = await runSearchFetch({
      query: opts.query,
      luOnly: opts.luOnly,
      jobage: opts.jobage,
      page: opts.page,
      perPage,
    })

    let results = allResults
    if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

    const meta = {
      count, // total matches across the whole site for this query (X-WP-Total)
      returned: results.length,
      page: opts.page,
      query: opts.query ?? null,
      luOnly: opts.luOnly ?? false,
      jobage: opts.jobage ?? null,
    }

    if (opts.format === "table") {
      process.stdout.write(`Page ${opts.page} — ${meta.returned} of ${count ?? "?"} total match(es)\n\n`)
      process.stdout.write(renderTable(results) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        results.map((c) => `${c.title}\n  ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`).join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(JSON.stringify({ meta, results }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "SEARCH_FAILED"
    writeError(e instanceof Error ? e.message : String(e), code)
    return 1
  }
}
