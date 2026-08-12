import { detailUrl, htmlFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

/** Accept a raw slug or a full job-detail URL and return the slug. */
function normalizeId(input: string): string {
  const m = input.match(/\/jobs\/([^/?#]+)/)
  return m ? m[1] : input.replace(/^\/+/, "")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(detailUrl(id))
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, id)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.contractType ? `Contract: ${job.contractType}` : "",
        job.workTime ? `Work time: ${job.workTime}` : "",
        job.educationLevel ? `Education: ${job.educationLevel}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
        "Apply: use the \"Je postule\" button on the job page (client-side, no static apply URL)",
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
