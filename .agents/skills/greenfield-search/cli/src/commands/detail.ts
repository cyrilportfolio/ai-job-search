import { fetchDetailHtml, parseJobDetail, resolveJobUrl, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  try {
    const url = await resolveJobUrl(opts.id)
    if (!url) {
      writeError(`No posting found for id/url "${opts.id}" (checked the current sitemap listing).`, "NOT_FOUND")
      return 1
    }

    const html = await fetchDetailHtml(url)
    if (!html) {
      writeError("Posting no longer exists (404) — likely expired and removed from the site.", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, url)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.employmentType ? `Type: ${job.employmentType}` : "",
        job.salary ? `Salary: ${job.salary}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
        job.contact?.name ? `Contact: ${job.contact.name}${job.contact.email ? ` <${job.contact.email}>` : ""}${job.contact.phone ? ` · ${job.contact.phone}` : ""}` : "",
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
