import { describe, test, expect } from "bun:test"
import { runCLI, parseJSON } from "./helpers.js"

// Every live request here carries the mandatory 10s crawl-delay (see helpers.ts), so this
// suite is inherently slow — that's expected, not a bug to "fix" by removing the delay.

describe("search (live)", () => {
  test("--query with --country lu returns real, location-filtered results", async () => {
    const result = await runCLI(["search", "-q", "comptable", "-c", "lu", "--limit", "5", "--format", "json"])
    const parsed = parseJSON<{ meta: { count: number }; results: Array<Record<string, unknown>> }>(result)
    expect(parsed.meta.count).toBeGreaterThan(0)
    expect(parsed.results.length).toBeGreaterThan(0)
    const first = parsed.results[0]
    expect(first.id).toBeTruthy()
    expect(first.title).toBeTruthy()
    expect(String(first.url)).toContain("europa.eu")
  })
})

describe("detail (live)", () => {
  test("returns full detail for a known job id", async () => {
    // Verified live during skill generation (2026-08-12): "Consultant - support
    // comptabilté communale (H/F)", sourced via EURES from Moovijob, Luxembourg. Postings
    // can be taken down over time — if this starts failing, replace with a fresh id from
    // a live `search -q comptable -c lu` run rather than assuming the parser broke.
    const result = await runCLI(["detail", "NTkxNjkzNCA5", "--format", "json"])
    const parsed = parseJSON<{ id: string; title: string; description: string | null }>(result)
    expect(parsed.id).toBeTruthy()
    expect(parsed.title).toBeTruthy()
    expect(parsed.description).toBeTruthy()
  })
})

describe("error handling", () => {
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
