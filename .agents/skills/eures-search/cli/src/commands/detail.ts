import { detailApiUrl, apiFetch, parseDetailResponse, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  lang: string
  format: "json" | "plain"
}

/** Accept a raw base64 id or a portal jv-details URL and return the id. */
function normalizeId(input: string): string {
  const m = input.match(/jv-details\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : input
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const raw = await apiFetch(detailApiUrl(id, opts.lang))
    const job = parseDetailResponse(raw, opts.lang)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.employmentType ? `Type: ${job.employmentType}` : "",
        job.source ? `Source: ${job.source}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
        job.applyUrl ? `Apply: ${job.applyUrl}` : "Apply: no application link found for this posting",
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
