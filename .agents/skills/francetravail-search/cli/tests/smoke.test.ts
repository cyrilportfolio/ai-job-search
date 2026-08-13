import { describe, test, expect } from "bun:test"
import { runCLI, parseJSON } from "./helpers.js"
import { assertAllowedUrl, BASE_URL } from "../src/helpers.js"

// CI runs `bun test` directly (not `bun run test`), so package.json's --timeout never
// applies there — bun:test's own 5000ms-per-test default does, and a live network call can
// easily exceed that. CI's "Run fixture/mock tests when present" step is upstream convention
// for offline-only tests, so skip the live describe blocks when running in CI (GitHub Actions
// sets CI=true) and keep only the offline ones (param guard, credentials, error handling)
// running there.
const inCI = Boolean(process.env.CI)

describe("search-param guard", () => {
  test("refuses pays= (verified live 2026-08-13: silently falls back to unfiltered nationwide search)", () => {
    expect(() => assertAllowedUrl(`${BASE_URL}/offres/search?motsCles=comptable&pays=99137&range=0-4`)).toThrow()
  })

  test("refuses paysContinents= plural (verified live: NOT a 404 as an earlier handoff claimed — also silently falls back)", () => {
    expect(() => assertAllowedUrl(`${BASE_URL}/offres/search?motsCles=comptable&paysContinents=99137&range=0-4`)).toThrow()
  })

  test("refuses any other unrecognized query parameter, not just the two known traps", () => {
    expect(() => assertAllowedUrl(`${BASE_URL}/offres/search?motsCles=comptable&paisContinent=99137&range=0-4`)).toThrow()
  })

  test("allows the known-good parameter set", () => {
    expect(() =>
      assertAllowedUrl(`${BASE_URL}/offres/search?motsCles=comptable&paysContinent=99137&publieeDepuis=7&range=0-19`),
    ).not.toThrow()
    expect(() => assertAllowedUrl(`${BASE_URL}/offres/search?motsCles=comptable&departement=57&range=0-19`)).not.toThrow()
  })

  test("does not guard non-search endpoints (referentiel, offres/{id})", () => {
    expect(() => assertAllowedUrl(`${BASE_URL}/referentiel/pays`)).not.toThrow()
    expect(() => assertAllowedUrl(`${BASE_URL}/offres/5946183`)).not.toThrow()
  })
})

describe("credentials", () => {
  test("missing FRANCETRAVAIL_API_TOKEN exits 1 with MISSING_CREDENTIALS, no network call", async () => {
    const result = await runCLI(["search", "-q", "comptable"], { FRANCETRAVAIL_API_TOKEN: undefined })
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("MISSING_CREDENTIALS")
    expect(err.error).toContain("FRANCETRAVAIL_API_TOKEN")
  })

  test("malformed FRANCETRAVAIL_API_TOKEN (no colon) exits 1 with MISSING_CREDENTIALS", async () => {
    const result = await runCLI(["search", "-q", "comptable"], { FRANCETRAVAIL_API_TOKEN: "not-a-valid-token" })
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("MISSING_CREDENTIALS")
  })
})

describe.skipIf(inCI)("search (live)", () => {
  test("--query with default --pays (lu) returns real, Luxembourg-filtered results", async () => {
    const result = await runCLI(["search", "-q", "comptable", "--limit", "5", "--format", "json"])
    const parsed = parseJSON<{ meta: { count: number; paysContinent: string }; results: Array<Record<string, unknown>> }>(result)
    expect(parsed.meta.paysContinent).toBe("99137")
    expect(parsed.meta.count).toBeGreaterThan(0)
    expect(parsed.results.length).toBeGreaterThan(0)
    const first = parsed.results[0]
    expect(first.id).toBeTruthy()
    expect(first.title).toBeTruthy()
    expect(String(first.url)).toContain("francetravail.fr")
  })

  test("--departement 57 switches to the French side without needing --pays", async () => {
    const result = await runCLI(["search", "-q", "comptable", "--departement", "57", "--limit", "3", "--format", "json"])
    const parsed = parseJSON<{ meta: { departement: string; paysContinent: string | null }; results: Array<Record<string, unknown>> }>(
      result,
    )
    expect(parsed.meta.departement).toBe("57")
    expect(parsed.meta.paysContinent).toBeNull()
    expect(parsed.results.length).toBeGreaterThan(0)
  })
})

describe.skipIf(inCI)("detail (live)", () => {
  test("returns full detail for a real Luxembourg comptable offer", async () => {
    const search = await runCLI(["search", "-q", "comptable", "--limit", "1", "--format", "json"])
    const { results } = parseJSON<{ results: Array<{ id: string }> }>(search)
    const id = results[0].id

    const result = await runCLI(["detail", id, "--format", "json"])
    const job = parseJSON<{ id: string; title: string; description: string | null }>(result)
    expect(job.id).toBe(id)
    expect(job.title).toBeTruthy()
    expect(job.description).toBeTruthy()
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

  test("--pays and --departement together exit 1 with BAD_ARG, no network call", async () => {
    const result = await runCLI(["search", "--pays", "lu", "--departement", "57"])
    expect(result.exitCode).toBe(1)
    const err = JSON.parse(result.stderr)
    expect(err.code).toBe("BAD_ARG")
  })
})
