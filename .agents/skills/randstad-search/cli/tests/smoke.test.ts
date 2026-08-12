import { describe, test, expect } from "bun:test"
import { runCLI, parseJSON } from "./helpers.js"
import { assertAllowedUrl, BASE_URL } from "../src/helpers.js"

describe("robots.txt guard", () => {
  test("allows the plain listing, query, page, and placeholder-detail URLs", () => {
    expect(() => assertAllowedUrl(`${BASE_URL}/emplois/`)).not.toThrow()
    expect(() => assertAllowedUrl(`${BASE_URL}/emplois/q-comptable/`)).not.toThrow()
    expect(() => assertAllowedUrl(`${BASE_URL}/emplois/q-comptable/page-2/`)).not.toThrow()
    expect(() => assertAllowedUrl(`${BASE_URL}/emplois/x_x_47209488/`)).not.toThrow()
  })

  test("refuses every robots.txt-disallowed pattern", () => {
    const forbidden = [
      `${BASE_URL}/emplois/km-10/`,
      `${BASE_URL}/emplois/postcode-1234/`,
      `${BASE_URL}/emplois/sa-1/`,
      `${BASE_URL}/emplois/qt-1/`,
      `${BASE_URL}/emplois/sd-1/`,
      `${BASE_URL}/emplois/sh-1/`,
      `${BASE_URL}/emplois/sm-1/`,
      `${BASE_URL}/emplois/mpage-2/`,
      `${BASE_URL}/emplois/profile-x/`,
      `${BASE_URL}/emplois/radius/`,
      `${BASE_URL}/radius-search/`,
      `${BASE_URL}/emplois/postuler/47209488`,
      `${BASE_URL}/en/jobs/apply/`,
      `${BASE_URL}/node/1`,
      `${BASE_URL}/taxonomy/term/1`,
      `${BASE_URL}/emplois/a,b/`,
      `${BASE_URL}/emplois/?search=comptable`,
      `${BASE_URL}/emplois/?id=1`,
      `${BASE_URL}/emplois/?c-category=finance`,
    ]
    for (const url of forbidden) {
      expect(() => assertAllowedUrl(url)).toThrow()
    }
  })
})

describe("search (live)", () => {
  test("returns real, matching results for the test query", async () => {
    const result = await runCLI(["search", "-q", "comptable", "--format", "json"])
    const parsed = parseJSON<{ meta: { count: number }; results: Array<Record<string, unknown>> }>(result)
    expect(parsed.meta.count).toBeGreaterThan(0)
    expect(parsed.results.length).toBeGreaterThan(0)
    const first = parsed.results[0]
    expect(first.id).toBeTruthy()
    expect(first.title).toBeTruthy()
    expect(String(first.url)).toContain("randstad.lu")
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
