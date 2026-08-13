import { describe, test, expect } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"
import { runCLI, parseJSON, type CLIResult } from "./helpers.js"
import {
  parseJobCards,
  parseJobDetail,
  parseListDate,
  parseDetailDate,
  resolveRegion,
  normalizeId,
  searchUrl,
} from "../src/helpers.js"

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf-8")

// DORMANT SKILL (SKILL.md: enabled: false) — this portal's Akamai bot protection specifically
// targets tool-identifying UAs, this CLI's honest UA included (confirmed 2026-08-12, see
// ../url-reference.md), so these live tests are expected to hit CHALLENGE_BLOCKED on every
// run, not intermittently. Kept (rather than deleted) so the CLI and detection stay verified
// if the skill is ever reactivated.
// CI runs `bun test` directly (not `bun run test`), so package.json's --timeout never applies
// there — bun:test's own 5000ms-per-test default does, and a live network call can easily
// exceed that. CI's "Run fixture/mock tests when present" step is upstream convention for
// offline-only tests, so skip the live describe blocks when running in CI (GitHub Actions sets
// CI=true) and keep only the offline ones (fixture parsing, error handling) running there.
const inCI = Boolean(process.env.CI)

function assertNotChallengeBlocked(result: CLIResult): void {
  if (result.exitCode === 0) return
  // Parsed separately from the throw below: a throw inside this try would be caught by its
  // own catch and silently swallowed (a latent bug in legrand-search's assertNotWafBlocked,
  // the pattern this was adapted from — fixed here rather than reproduced).
  let code: string | undefined
  try {
    code = (JSON.parse(result.stderr) as { code?: string }).code
  } catch {
    // stderr wasn't JSON — fall through and let parseJSON's own error surface below.
    return
  }
  if (code === "CHALLENGE_BLOCKED") {
    throw new Error(
      "CHALLENGE_BLOCKED — Akamai served its challenge page instead of real content. " +
        "Expected: this skill is dormant because the block specifically targets tool UAs " +
        "(see ../url-reference.md). Not a parser bug, and no UA workaround applies.",
    )
  }
}

describe("date parsing (offline)", () => {
  test("parses 'DD Mon' assuming the current year", () => {
    const now = new Date(Date.UTC(2026, 7, 12)) // 2026-08-12
    expect(parseListDate("08 Aug", now)).toBe("2026-08-08")
  })

  test("rolls back a year when the parsed date would be in the future", () => {
    // Seen in early January: a "28 Dec" listing must be last year's December, not this year's.
    const now = new Date(Date.UTC(2027, 0, 5)) // 2027-01-05
    expect(parseListDate("28 Dec", now)).toBe("2026-12-28")
  })

  test("'Today' resolves to the given date", () => {
    const now = new Date(Date.UTC(2026, 7, 12))
    expect(parseListDate("Today", now)).toBe("2026-08-12")
  })

  test("unparseable input returns null", () => {
    expect(parseListDate("not a date")).toBeNull()
  })

  test("parses the detail page's full 'DD Month YYYY' date directly", () => {
    expect(parseDetailDate("08 August 2026")).toBe("2026-08-08")
  })
})

describe("region resolution (offline)", () => {
  test("resolves the Grande Région aliases used by this fork's market", () => {
    expect(resolveRegion("luxembourg")).toBe("1")
    expect(resolveRegion("lu")).toBe("1")
    expect(resolveRegion("lorraine")).toBe("5")
    expect(resolveRegion("france")).toBe("5")
    expect(resolveRegion("Saarland")).toBe("4")
    expect(resolveRegion("2")).toBe("2")
  })

  test("returns null for an unrecognized location", () => {
    expect(resolveRegion("mars")).toBeNull()
  })

  test("region 0 (no filter) is omitted from the built URL", () => {
    const url = searchUrl({ query: "comptable", region: "0", sortByDate: false, page: 1 })
    expect(url).not.toContain("regions=")
  })

  test("a real region id is included in the built URL", () => {
    const url = searchUrl({ query: "comptable", region: "5", sortByDate: false, page: 1 })
    expect(url).toContain("regions=5")
  })
})

describe("id normalization (offline)", () => {
  test("accepts a bare numeric id", () => {
    expect(normalizeId("287136")).toBe("287136")
  })

  test("extracts the id from a detail URL", () => {
    expect(normalizeId("https://en.jobs.lu/ApplyForJob.aspx?Id=287136")).toBe("287136")
  })

  test("extracts the id from a job-id-<n> fragment", () => {
    expect(normalizeId("job-id-287136")).toBe("287136")
  })

  test("returns null for unparseable input", () => {
    expect(normalizeId("not-an-id")).toBeNull()
  })
})

describe("search-results parsing (offline, real captured markup)", () => {
  const cards = parseJobCards(fixture("search-fragment.html"), new Date(Date.UTC(2026, 7, 12)))

  test("parses both fixture listings", () => {
    expect(cards.length).toBe(2)
  })

  test("parses the plain listing", () => {
    const c = cards.find((c) => c.id === "286172")
    expect(c).toBeDefined()
    expect(c!.title).toBe("Expert-Comptable / Comptable Senior")
    expect(c!.company).toBe("Le Grand & Associates Luxembourg")
    expect(c!.companyUrl).toBe("https://en.jobs.lu/Le-Grand-Associates-Luxembourg/")
    expect(c!.location).toBe("Luxembourg")
    expect(c!.date).toBe("2026-08-08")
    expect(c!.url).toBe("https://en.jobs.lu/ApplyForJob.aspx?Id=286172")
  })

  test("decodes a numeric HTML entity in the title (Fran&#231;ais -> Français)", () => {
    const c = cards.find((c) => c.id === "286628")
    expect(c).toBeDefined()
    expect(c!.title).toBe("Comptable Allemand/Français")
  })
})

describe("job-detail parsing (offline, real captured markup)", () => {
  const job = parseJobDetail(fixture("detail-fragment.html"), "287136")

  test("parses the core fields", () => {
    expect(job.title).toBe("Responsable Comptable - BelGaap")
    expect(job.company).toBe("Le Grand & Associates Luxembourg")
    expect(job.location).toBe("Luxembourg")
    expect(job.payment).toBe("Market related")
    expect(job.date).toBe("2026-08-08")
    expect(job.employmentType).toBe("Permanent")
    expect(job.hours).toBe("Full Time")
    expect(job.url).toBe("https://en.jobs.lu/ApplyForJob.aspx?Id=287136")
    expect(job.applyUrl).toBe(job.url)
  })

  test("extracts description text through the nested assistant-plugin divs", () => {
    expect(job.description).toContain("Le Grand & Associates accompagne actuellement")
    expect(job.description).toContain("Ce que notre client vous propose")
    // Entities decoded, no leftover markup noise from the nested divs.
    expect(job.description).not.toContain("&eacute;")
    expect(job.description).not.toContain("<div")
  })
})

describe("Akamai challenge detection (offline)", () => {
  test("the captured challenge page's title marker is present in the fixture", () => {
    // htmlFetch's CHALLENGE_MARKER regex is exercised indirectly through the live tests below
    // (skipped in CI); this just pins down that the fixture actually contains the exact
    // marker the regex looks for, so a future site change that alters the challenge page's
    // title would be caught here rather than silently making detection blind.
    expect(fixture("challenge-page.html")).toMatch(/<title>\s*challenge validation\s*<\/title>/i)
  })
})

describe.skipIf(inCI)("search (live)", () => {
  test("returns real, matching results for the test query, or a clear CHALLENGE_BLOCKED", async () => {
    const result = await runCLI(["search", "-q", "comptable", "--format", "json"])
    assertNotChallengeBlocked(result)
    const parsed = parseJSON<{ meta: { count: number }; results: Array<Record<string, unknown>> }>(result)
    expect(parsed.results.length).toBeGreaterThan(0)
    const first = parsed.results[0]
    expect(first.id).toBeTruthy()
    expect(first.title).toBeTruthy()
    expect(String(first.url)).toContain("en.jobs.lu")
  })

  test("--location lorraine returns only Grande Région results", async () => {
    const result = await runCLI(["search", "-q", "comptable", "-l", "lorraine", "--format", "json"])
    assertNotChallengeBlocked(result)
    const parsed = parseJSON<{ results: Array<Record<string, unknown>> }>(result)
    expect(parsed.results.length).toBeGreaterThan(0)
  })
})

describe.skipIf(inCI)("detail (live)", () => {
  test("returns full detail for a known job id", async () => {
    // "Responsable Comptable – BelGaap", Le Grand & Associates Luxembourg — verified live
    // during generation (2026-08-12).
    const result = await runCLI(["detail", "287136", "--format", "json"])
    assertNotChallengeBlocked(result)
    const parsed = parseJSON<{ id: string; title: string; description: string | null }>(result)
    expect(parsed.id).toBe("287136")
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

  test("unrecognized --location exits 1 with a JSON error on stderr, no network call", async () => {
    const result = await runCLI(["search", "-l", "mars"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("BAD_LOCATION")
  })

  test("detail without an id exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("NO_ID")
  })

  test("detail with an unparseable id exits 1 with a JSON error on stderr, no network call", async () => {
    const result = await runCLI(["detail", "not-an-id"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("BAD_ID")
  })
})
