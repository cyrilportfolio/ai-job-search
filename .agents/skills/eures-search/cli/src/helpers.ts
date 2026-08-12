// Data source: EURES's public JSON API (europa.eu/eures), the EU's official job-mobility
// portal — an aggregator that pulls postings from national job boards across the EU/EEA
// (~2.8M live listings). No authentication, anonymous public endpoints.
//
// robots.txt (fetched 2026-08-12): /eures is NOT disallowed (don't confuse with the
// unrelated /eur-lex/ disallow). But the blanket "User-agent: *" block carries:
//   Crawl-delay: 10
// This is enforced below unconditionally — every request, from any command, waits for a
// full 10s gap since the last one, persisted across separate CLI invocations (via a temp
// file) so back-to-back `search` then `detail` calls from /scrape still respect it. This is
// hard-coded and intentionally has no flag to disable or shorten it.

import { tmpdir } from "os"
import { join } from "path"

export const BASE_URL = "https://europa.eu/eures/api"
const PORTAL_BASE_URL = "https://europa.eu/eures/portal/jv-se/jv-details"

const CRAWL_DELAY_MS = 10_000
const RATE_LIMIT_FILE = join(tmpdir(), "eures-search-cli-last-request")

async function enforceCrawlDelay(): Promise<void> {
  try {
    const last = parseInt(await Bun.file(RATE_LIMIT_FILE).text(), 10)
    if (!isNaN(last)) {
      const elapsed = Date.now() - last
      if (elapsed < CRAWL_DELAY_MS) {
        await new Promise((r) => setTimeout(r, CRAWL_DELAY_MS - elapsed))
      }
    }
  } catch {
    // No timestamp file yet — first request from this machine, nothing to wait for.
  }
  await Bun.write(RATE_LIMIT_FILE, String(Date.now()))
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// Deliberately not "Mozilla/5.0 (compatible; ...)" — that exact prefix (the shape
// well-known crawlers self-declare with) got flagged by legrand-associates.com's WAF in a
// controlled A/B test (2026-08-12; see legrand-search/url-reference.md), while this plain
// tool/version/purpose form passed. Applied here preventively, not because this portal has
// shown the same behavior.
const UA = "eures-search-cli/1.0 (personal job search)"

/** JSON fetch with the mandatory crawl-delay, exponential backoff on 429/5xx, and a
 *  parsed-JSON return. Throws on any other non-2xx status (this API returns
 *  { key, message } error bodies, surfaced in the thrown message). */
export async function apiFetch(url: string, init?: RequestInit): Promise<unknown> {
  const maxRetries = 6
  let delay = 1000
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await enforceCrawlDelay()
    const response = await fetch(url, {
      ...init,
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Request failed: ${response.status} ${response.statusText} — ${body.slice(0, 300)}`)
    }
    return response.json()
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null // normalized to YYYY-MM-DD
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  source: string | null
  applyUrl: string | null
}

export function searchUrl(): string {
  return `${BASE_URL}/jv-searchengine/public/jv-search/search`
}

export function detailApiUrl(id: string, lang: string): string {
  return `${BASE_URL}/jv-searchengine/public/jv/id/${encodeURIComponent(id)}?requestLang=${encodeURIComponent(lang)}`
}

/** Best-effort human-facing deep link. NOT independently verified: the portal is a
 *  client-side-rendered SPA, so a plain fetch always returns the same empty shell
 *  regardless of path, making this route unconfirmable without a browser. Inferred from
 *  the API's own "jv-search"/"jv" naming. If this ever 404s in practice, the API detail
 *  URL (detailApiUrl) is the verified fallback. */
export function portalUrl(id: string, lang: string): string {
  return `${PORTAL_BASE_URL}/${encodeURIComponent(id)}?lang=${encodeURIComponent(lang)}`
}

/** publicationPeriod is a fixed enum (LAST_DAY | LAST_WEEK | LAST_MONTH | null) verified
 *  live 2026-08-12 — arbitrary day counts and ISO-8601 durations are rejected. --jobage
 *  maps onto the nearest bucket that still covers the requested window. */
export function jobageToPublicationPeriod(days: number | undefined): "LAST_DAY" | "LAST_WEEK" | "LAST_MONTH" | null {
  if (days === undefined) return null
  if (days <= 1) return "LAST_DAY"
  if (days <= 7) return "LAST_WEEK"
  if (days <= 30) return "LAST_MONTH"
  return null
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&[lr]squo;/g, "'")
    .replace(/&[lr]dquo;/g, '"')
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "...")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

/** epoch-milliseconds -> YYYY-MM-DD. */
function epochToDate(ms: number | null | undefined): string | null {
  if (!ms) return null
  const d = new Date(ms)
  if (isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

// --- Response shapes (fields actually observed live 2026-08-12; see url-reference.md) ---

interface RawSearchJv {
  id: string
  title: string
  description?: string
  creationDate?: number | null
  locationMap?: Record<string, unknown>
  employer?: { name?: string | null }
}

interface RawSearchResponse {
  numberRecords: number
  jvs: RawSearchJv[]
}

interface RawDetailLocation {
  countryCode?: string | null
  region?: string | null
  cityName?: string | null
}

interface RawDetailProfile {
  title: string
  description?: string
  positionOfferingCode?: string | null
  employer?: { name?: string | null }
  applicationInstructions?: string[]
  locations?: RawDetailLocation[]
}

interface RawDetailResponse {
  id: string
  source?: string | null
  creationDate?: number | null
  preferredLanguage?: string
  jvProfiles: Record<string, RawDetailProfile>
}

export function buildSearchBody(opts: {
  query?: string
  locationCodes: string[]
  publicationPeriod: "LAST_DAY" | "LAST_WEEK" | "LAST_MONTH" | null
  page: number
  resultsPerPage: number
  lang: string
}): Record<string, unknown> {
  return {
    resultsPerPage: opts.resultsPerPage,
    page: opts.page,
    sortSearch: "MOST_RECENT",
    keywords: opts.query ? [{ keyword: opts.query, specificSearchCode: "EVERYWHERE" }] : [],
    publicationPeriod: opts.publicationPeriod,
    locationCodes: opts.locationCodes,
    occupationUris: [],
    skillUris: [],
    requiredExperienceCodes: [],
    positionScheduleCodes: [],
    sectorCodes: [],
    educationAndQualificationLevelCodes: [],
    positionOfferingCodes: [],
    euresFlagCodes: [],
    otherBenefitsCodes: [],
    requiredLanguages: [],
    minNumberPost: null,
    sessionId: crypto.randomUUID(),
    requestLanguage: opts.lang,
  }
}

export function parseSearchResponse(raw: unknown, lang: string): { count: number; results: JobCard[] } {
  const data = raw as RawSearchResponse
  const results: JobCard[] = (data.jvs ?? []).map((jv) => {
    const location = jv.locationMap ? Object.keys(jv.locationMap).join(", ") || null : null
    return {
      id: jv.id,
      title: decodeHtmlEntities(stripTags(jv.title ?? "")),
      company: jv.employer?.name ? decodeHtmlEntities(jv.employer.name) : null,
      location,
      date: epochToDate(jv.creationDate),
      url: portalUrl(jv.id, lang),
    }
  })
  return { count: data.numberRecords ?? results.length, results }
}

export function parseDetailResponse(raw: unknown, requestedLang: string): JobDetail {
  const data = raw as RawDetailResponse
  const lang = data.jvProfiles[requestedLang] ? requestedLang : (data.preferredLanguage ?? Object.keys(data.jvProfiles)[0])
  const profile = data.jvProfiles[lang]

  let applyUrl: string | null = null
  const instructions = profile?.applicationInstructions?.join(" ") ?? ""
  const hrefMatch = instructions.match(/href="([^"]+)"/)
  if (hrefMatch) applyUrl = decodeHtmlEntities(hrefMatch[1])

  const location =
    profile?.locations
      ?.map((l) => [l.cityName, l.region, l.countryCode?.toUpperCase()].filter(Boolean).join(", "))
      .filter(Boolean)
      .join(" / ") || null

  return {
    id: data.id,
    title: decodeHtmlEntities(stripTags(profile?.title ?? "")),
    company: profile?.employer?.name ? decodeHtmlEntities(profile.employer.name) : null,
    location,
    date: epochToDate(data.creationDate),
    url: portalUrl(data.id, lang),
    description: profile?.description ? decodeHtmlEntities(stripTags(profile.description)) : null,
    employmentType: profile?.positionOfferingCode ?? null,
    source: data.source ?? null,
    applyUrl,
  }
}
