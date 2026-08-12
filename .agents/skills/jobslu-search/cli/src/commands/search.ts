import { searchUrl, htmlFetch, parseJobCards, resolveRegion, writeError, type JobCard } from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage?: number // days; no server-side support, filtered client-side (see helpers.ts)
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 26).padEnd(26)
    const loc = (c.location || "—").slice(0, 18).padEnd(18)
    const date = c.date || "—"
    return `${c.id.padEnd(9)} ${title} ${company} ${loc} ${date}`
  })
  const header =
    "ID".padEnd(9) + " " + "TITLE".padEnd(42) + " " + "COMPANY".padEnd(26) + " " + "LOCATION".padEnd(18) + " DATE"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  let region: string | null = null
  if (opts.location) {
    region = resolveRegion(opts.location)
    if (!region) {
      writeError(
        `Unrecognized --location "${opts.location}". Valid values: luxembourg, belgium, lorraine (or france), rheinland-pfalz (or germany), saarland, abroad — or the numeric region id.`,
        "BAD_LOCATION",
      )
      return 1
    }
  }

  try {
    const html = await htmlFetch(
      searchUrl({
        query: opts.query,
        region: region ?? undefined,
        sortByDate: opts.jobage !== undefined,
        page: opts.page,
      }),
    )
    let cards = parseJobCards(html)

    if (opts.jobage !== undefined) {
      const cutoff = new Date()
      cutoff.setUTCDate(cutoff.getUTCDate() - opts.jobage)
      const cutoffIso = cutoff.toISOString().slice(0, 10)
      cards = cards.filter((c) => c.date !== null && c.date >= cutoffIso)
    }

    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    const code = (e as { code?: string }).code ?? "SEARCH_FAILED"
    writeError(e instanceof Error ? e.message : String(e), code)
    return 1
  }
}
