import { getAccessToken, apiFetch, parseDetailResponse, normalizeId, writeError, MissingCredentialsError, BASE_URL } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const token = await getAccessToken()
    const { data } = await apiFetch(`${BASE_URL}/offres/${encodeURIComponent(id)}`, token)
    if (!data) {
      writeError(`No offer found for id "${id}"`, "NOT_FOUND")
      return 1
    }
    const job = parseDetailResponse(data)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"}`,
        "",
        job.employmentType ? `Type: ${job.employmentType}` : "",
        job.experience ? `Expérience: ${job.experience}` : "",
        job.salary ? `Salaire: ${job.salary}` : "",
        job.partner ? `Partenaire: ${job.partner}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
        job.applyUrl && job.applyUrl !== job.url ? `Apply: ${job.applyUrl}` : "",
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    const code = e instanceof MissingCredentialsError ? "MISSING_CREDENTIALS" : "DETAIL_FAILED"
    writeError(e instanceof Error ? e.message : String(e), code)
    return 1
  }
}
