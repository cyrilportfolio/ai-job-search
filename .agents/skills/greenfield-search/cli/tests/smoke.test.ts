import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { runCLI, parseJSON, type CLIResult } from "./helpers.js"
import { extractJobUrls, idFromSlug, slugMatchesId, parseJobDetail } from "../src/helpers.js"

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf-8")

// CI runs `bun test` directly (not `bun run test`), so package.json's --timeout never applies
// there — bun:test's own 5000ms-per-test default does, and a live network call can easily
// exceed that. CI's "Run fixture/mock tests when present" step is upstream convention for
// offline-only tests, so skip the live describe blocks when running in CI (GitHub Actions sets
// CI=true) and keep only the offline ones (fixture parsing, error handling) running there.
const inCI = Boolean(process.env.CI)

function assertNotBlocked(result: CLIResult): void {
  if (result.exitCode === 0) return
  // Parse first, throw outside the try/catch — a throw inside the try would be caught by its
  // own catch and silently swallowed (the bug fixed in legrand-search's equivalent helper).
  let code: string | undefined
  try {
    code = (JSON.parse(result.stderr) as { code?: string }).code
  } catch {
    return
  }
  if (code === "CHALLENGE_BLOCKED" || code === "PARSE_FAILED") {
    throw new Error(`${code} — not observed during this skill's investigation (2026-08-13); see url-reference.md before assuming a parser regression.`)
  }
}

describe("sitemap enumeration (offline, real captured markup)", () => {
  const urls = extractJobUrls(fixture("sitemap-fragment.xml"))

  test("extracts job-search URLs, excluding the bare listing index and non-job pages", () => {
    expect(urls).toEqual([
      "https://www.greenfield.lu/job-search/accountants-de-en-12-months-cdd-670/",
      "https://www.greenfield.lu/job-search/1234-senior-recruitment-consultant-on-demand-and-interim-desk/",
    ])
  })
})

describe("id extraction (offline)", () => {
  test("extracts a trailing numeric token", () => {
    expect(idFromSlug("https://www.greenfield.lu/job-search/accountants-de-en-12-months-cdd-670/")).toBe("670")
  })

  test("extracts a leading numeric token when there's no trailing one", () => {
    // The one posting observed live (2026-08-13) that doesn't follow the usual
    // <slug>-<id> pattern — its id is a leading token instead.
    expect(idFromSlug("https://www.greenfield.lu/job-search/1234-senior-recruitment-consultant-on-demand-and-interim-desk/")).toBe("1234")
  })

  test("slugMatchesId matches both leading and trailing id positions", () => {
    expect(slugMatchesId("https://www.greenfield.lu/job-search/accountants-de-en-12-months-cdd-670/", "670")).toBe(true)
    expect(slugMatchesId("https://www.greenfield.lu/job-search/1234-senior-recruitment-consultant-on-demand-and-interim-desk/", "1234")).toBe(true)
    expect(slugMatchesId("https://www.greenfield.lu/job-search/accountants-de-en-12-months-cdd-670/", "999")).toBe(false)
  })
})

describe("job-detail parsing (offline, real captured markup)", () => {
  const job = parseJobDetail(fixture("detail-fragment.html"), "https://www.greenfield.lu/job-search/accountants-de-en-12-months-cdd-670/")

  test("parses the core fields from the JSON-LD block and the meta box", () => {
    expect(job.id).toBe("670") // from "Job Reference No." meta field, not the URL
    expect(job.title).toBe("Accountants - DE/EN - 12 months CDD")
    expect(job.company).toBe("Greenfield Group")
    expect(job.location).toBe("Luxembourg")
    expect(job.date).toBe("2026-07-17")
    expect(job.employmentType).toBeNull() // "Job Type" meta value is empty on this posting
    expect(job.salary).toBe("attractive")
    expect(job.applyUrl).toBe(job.url)
  })

  test("extracts the plain-text description (JSON-LD carries no HTML to strip)", () => {
    expect(job.description).toContain("Leading Real Estate Company")
    expect(job.description).toContain("Greenfield Luxembourg is an equal opportunities employer")
  })

  test("extracts the per-posting consultant contact, nested two tag-levels below its label", () => {
    expect(job.contact?.name).toBe("Damien Van Bouvelen")
    expect(job.contact?.email).toBe("damien@greenfield.lu")
  })
})

describe.skipIf(inCI)("search (live)", () => {
  test("an English query returns real, matching results", async () => {
    const result = await runCLI(["search", "-q", "accountant", "--format", "json"])
    assertNotBlocked(result)
    const parsed = parseJSON<{ meta: { count: number }; results: Array<Record<string, unknown>> }>(result)
    expect(parsed.results.length).toBeGreaterThan(0)
    const first = parsed.results[0]
    expect(first.id).toBeTruthy()
    expect(first.title).toBeTruthy()
    expect(String(first.url)).toContain("greenfield.lu")
  })

  test("the mandated test query \"comptable\" returns zero title matches — a real language mismatch, not a bug", async () => {
    // Verified live during generation (2026-08-13): every posting on this portal is titled
    // in English regardless of it being a Luxembourg-market firm — unlike legrand-search
    // (whose Luxembourg postings ARE titled in French), there is no French-titled posting to
    // match here. "Accountants - DE/EN - 12 months CDD" is the closest real posting.
    const result = await runCLI(["search", "-q", "comptable", "--format", "json"])
    assertNotBlocked(result)
    const parsed = parseJSON<{ results: unknown[] }>(result)
    expect(parsed.results.length).toBe(0)
  })

  test("--jobage narrows to recently posted jobs", async () => {
    const result = await runCLI(["search", "--jobage", "14", "--format", "json"])
    assertNotBlocked(result)
    const parsed = parseJSON<{ results: Array<{ date: string | null }> }>(result)
    const cutoff = Date.now() - 14 * 86400000
    for (const r of parsed.results) {
      expect(r.date).toBeTruthy()
      expect(new Date(r.date as string).getTime()).toBeGreaterThanOrEqual(cutoff)
    }
  })
})

describe.skipIf(inCI)("detail (live)", () => {
  test("returns full detail for a known job id", async () => {
    // "Accountants - DE/EN - 12 months CDD" — verified live during generation (2026-08-13).
    const result = await runCLI(["detail", "670", "--format", "json"])
    assertNotBlocked(result)
    const parsed = parseJSON<{ id: string; title: string; description: string | null }>(result)
    expect(parsed.id).toBe("670")
    expect(parsed.title).toBeTruthy()
    expect(parsed.description).toBeTruthy()
  })

  test("resolves an id whose slug carries it as a leading token, not a trailing one", async () => {
    const result = await runCLI(["detail", "1234", "--format", "json"])
    assertNotBlocked(result)
    const parsed = parseJSON<{ id: string; title: string }>(result)
    expect(parsed.id).toBe("1234")
    expect(parsed.title).toBeTruthy()
  })
})

describe("error handling (offline)", () => {
  test("bogus flag value exits 1 with a JSON error on stderr, no network call", async () => {
    const result = await runCLI(["search", "--jobage", "not-a-number"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("BAD_ARG")
  })

  test("detail without an id exits 1 with a JSON error on stderr, no network call", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("NO_ID")
  })
})
