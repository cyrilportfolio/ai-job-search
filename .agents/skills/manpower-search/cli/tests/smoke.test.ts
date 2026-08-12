import { describe, test, expect } from "bun:test"
import { runCLI, parseJSON } from "./helpers.js"

describe("search (live)", () => {
  test("--query returns real, server-filtered results", async () => {
    const result = await runCLI(["search", "-q", "comptable", "--format", "json"])
    const parsed = parseJSON<{ meta: { count: number; mode: string }; results: Array<Record<string, unknown>> }>(result)
    expect(parsed.meta.mode).toBe("search")
    expect(parsed.results.length).toBeGreaterThan(0)
    const first = parsed.results[0]
    expect(first.id).toBeTruthy()
    expect(first.title).toBeTruthy()
    expect(String(first.url)).toContain("manpower.lu")
    // This is a full-text search over title + description, so a match doesn't guarantee
    // the term appears in the title itself (e.g. "Employé(e) Administratif(ve) &
    // Facturation" matched because "comptable" appears in its body text). The
    // nonsense-query test below is what actually proves the filter is real.
  })

  test("a nonsense query returns zero results, proving the filter is real", async () => {
    const result = await runCLI(["search", "-q", "zzzznonexistentquery9999", "--format", "json"])
    const parsed = parseJSON<{ results: unknown[] }>(result)
    expect(parsed.results.length).toBe(0)
  })

  test("without --query, scans the archive and returns real results", async () => {
    const result = await runCLI(["search", "--scan-pages", "1", "--format", "json"])
    const parsed = parseJSON<{ meta: { mode: string }; results: Array<Record<string, unknown>> }>(result)
    expect(parsed.meta.mode).toBe("archive-scan")
    expect(parsed.results.length).toBeGreaterThan(0)
  })
})

describe("error handling", () => {
  test("bogus flag value exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["search", "--jobage", "not-a-number"])
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("BAD_ARG")
  })

  test("detail without an id exits 1 with a JSON error on stderr", async () => {
    const result = await runCLI(["detail"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("NO_ID")
  })
})
