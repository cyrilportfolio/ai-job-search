import { runDetailFetch, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a raw numeric WP post id or a full job-page URL and return the id. The public
 *  URL's slug is NOT the id (slugs get deduplicated with -2/-5/-7 suffixes) — this only
 *  extracts an id from a URL if the CLI already output one there isn't a way to recover
 *  the numeric id from a bare public URL, so a slug-only URL is rejected with guidance. */
function normalizeId(input: string): string | null {
  if (/^\d+$/.test(input)) return input
  const m = input.match(/[?&]id=(\d+)/)
  return m ? m[1] : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(
      `"${opts.id}" is not a numeric job id. This portal's public URL slugs don't map back to the id (they're deduplicated with -2/-5/-7 suffixes) — pass the numeric "id" field from a search result instead.`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const job = await runDetailFetch(id)
    if (!job) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.employmentType ? `Type: ${job.employmentType}` : "",
        job.industry ? `Industry: ${job.industry}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
        job.applyUrl ? `Apply: ${job.applyUrl}` : "",
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "DETAIL_FAILED"
    writeError(e instanceof Error ? e.message : String(e), code)
    return 1
  }
}
