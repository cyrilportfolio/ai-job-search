import { describe, test, expect } from "bun:test"
import { runCLI, parseJSON } from "./helpers.js"
import { assertAllowedUrl, BASE_URL } from "../src/helpers.js"

describe("robots.txt facet guard", () => {
  test("allows the plain listing and detail URLs", () => {
    expect(() => assertAllowedUrl(`${BASE_URL}/jobs`)).not.toThrow()
    expect(() => assertAllowedUrl(`${BASE_URL}/jobs/page/5`)).not.toThrow()
    expect(() => assertAllowedUrl(`${BASE_URL}/jobs/some-slug-abc123`)).not.toThrow()
  })

  test("refuses every robots.txt-disallowed facet segment", () => {
    const forbidden = ["admin", "contractType", "employment", "degree", "exp", "workplace", "size"]
    for (const seg of forbidden) {
      expect(() => assertAllowedUrl(`${BASE_URL}/jobs/${seg}/full-time`)).toThrow()
    }
  })
})

describe("search (live)", () => {
  test("returns real results for a broad scan", async () => {
    const result = await runCLI(["search", "--scan-pages", "1", "--format", "json"])
    const parsed = parseJSON<{ meta: { count: number }; results: Array<Record<string, unknown>> }>(result)
    expect(parsed.results.length).toBeGreaterThan(0)
    const first = parsed.results[0]
    expect(first.id).toBeTruthy()
    expect(first.title).toBeTruthy()
    expect(first.url).toContain("alleyesonme.jobs")
  })

  test("--query filters locally to matching title/company", async () => {
    const result = await runCLI(["search", "-q", "comptable", "--scan-pages", "10", "--format", "json"])
    const parsed = parseJSON<{ results: Array<{ title: string; company: string | null }> }>(result)
    for (const r of parsed.results) {
      const hay = `${r.title} ${r.company ?? ""}`.toLowerCase()
      expect(hay).toContain("comptable")
    }
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
