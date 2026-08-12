import { describe, test, expect } from "bun:test"
import { runCLI, parseJSON, type CLIResult } from "./helpers.js"

// IMPORTANT: this portal's WAF (SiteGround) has two independently confirmed triggers — a
// browser-impersonating User-Agent (already avoided by this CLI's UA, see helpers.ts) and
// IP/request-volume reputation (can still fire even with the honest UA, after enough
// requests from one origin in a short window — running this whole suite repeatedly in a
// tight loop is exactly the kind of burst that can trigger it). If these live tests fail
// with code "WAF_BLOCKED", that's most likely volume-based, not a broken parser or a
// changed site policy — wait a bit and rerun rather than treating it as a regression.

function assertNotWafBlocked(result: CLIResult): void {
  if (result.exitCode !== 0) {
    try {
      const err = JSON.parse(result.stderr)
      if (err.code === "WAF_BLOCKED") {
        throw new Error("WAF_BLOCKED — likely request-volume reputation, not a parser bug. Wait and rerun (see helpers.ts).")
      }
    } catch {
      // stderr wasn't JSON — fall through and let parseJSON's own error surface below.
    }
  }
}

describe("search (live)", () => {
  test("--query returns real results", async () => {
    const result = await runCLI(["search", "-q", "accountant", "--limit", "5", "--format", "json"])
    assertNotWafBlocked(result)
    const parsed = parseJSON<{ meta: { count: number | null }; results: Array<Record<string, unknown>> }>(result)
    expect(parsed.results.length).toBeGreaterThan(0)
    const first = parsed.results[0]
    expect(first.id).toBeTruthy()
    expect(first.title).toBeTruthy()
    expect(String(first.url)).toContain("legrand-associates.com")
  })

  test("--lu-only with a French query returns Luxembourg-located results", async () => {
    // "accountant" (the mandated test query) is an English/Dutch title used for Belgium
    // postings; Luxembourg postings are titled in French, so this uses "comptable" instead
    // — verified live during generation that --lu-only + "accountant" returns zero results
    // for exactly this reason, not because the filter is broken.
    const result = await runCLI(["search", "-q", "comptable", "--lu-only", "--format", "json"])
    assertNotWafBlocked(result)
    const parsed = parseJSON<{ results: Array<{ location: string | null }> }>(result)
    expect(parsed.results.length).toBeGreaterThan(0)
    const luNames = ["Luxembourg", "Grevenmacher", "Esch-sur-Alzette", "Capellen", "Diekirch", "Clervaux", "Wiltz", "Mersch"]
    for (const r of parsed.results) {
      expect(luNames.some((n) => (r.location ?? "").includes(n))).toBe(true)
    }
  })
})

describe("detail (live)", () => {
  test("returns full detail for a known job id", async () => {
    // "Responsable Comptable – BelGaap", Luxembourg-city — verified live during generation.
    const result = await runCLI(["detail", "9837", "--format", "json"])
    assertNotWafBlocked(result)
    const parsed = parseJSON<{ id: string; title: string; description: string | null }>(result)
    expect(parsed.id).toBe("9837")
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

  test("detail with a non-numeric id exits 1 with a JSON error on stderr, no network call", async () => {
    const result = await runCLI(["detail", "some-slug-not-an-id"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("BAD_ID")
  })
})
