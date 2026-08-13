import { fetchAllJobs, toCard, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query?: string
  jobage?: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 48).padEnd(48)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    const date = c.date || "—"
    return `${c.id.padEnd(8)} ${title} ${loc} ${date}`
  })
  const header = "ID".padEnd(8) + " " + "TITLE".padEnd(48) + " " + "LOCATION".padEnd(22) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const allJobs = await fetchAllJobs()

    let filtered = allJobs
    if (opts.query) {
      const q = opts.query.toLowerCase()
      filtered = filtered.filter((j) => j.title.toLowerCase().includes(q))
    }
    if (opts.jobage !== undefined) {
      const cutoff = Date.now() - opts.jobage * 86400000
      filtered = filtered.filter((j) => j.date !== null && new Date(j.date).getTime() >= cutoff)
    }

    filtered = [...filtered].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))

    let results = filtered.map(toCard)
    if (opts.limit !== undefined && opts.limit >= 0) results = results.slice(0, opts.limit)

    const meta = {
      count: filtered.length, // total matches after filtering — this portal has no server-side pagination, every search is a full scan
      returned: results.length,
      query: opts.query ?? null,
      jobage: opts.jobage ?? null,
    }

    if (opts.format === "table") {
      process.stdout.write(`${meta.returned} of ${meta.count} match(es)\n\n`)
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
