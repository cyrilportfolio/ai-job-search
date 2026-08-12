// Data source: legrand-associates.com's public WordPress REST API (custom "job" post type).
// No HTML scraping — every field comes from JSON. Belgium/Luxembourg accounting & fiduciary
// recruitment firm; site content is Dutch/French, ~410 postings, ~9 in Luxembourg locations.
//
// robots.txt only disallows /wp-admin/ — /wp-json/* is explicitly permitted. The site's WAF
// (nginx + SiteGround Security) can still reject a request, on either of two independent,
// separately confirmed signals — not a single simple cause:
//   1. User-Agent pattern: a controlled A/B test (2026-08-12, from an ordinary shell)
//      showed "Mozilla/5.0 (compatible; legrand-search-cli/1.0)" -> HTTP 403, while
//      "legrand-search-cli/1.0 (personal job search)" -> HTTP 200 for the identical
//      request. This CLI uses the latter form for exactly this reason: it's not evasion,
//      it's the opposite — dropping the "Mozilla/5.0 (compatible; ...)" prefix that mimics
//      how well-known crawlers self-declare removes the ambiguity a WAF is reacting to.
//   2. IP / request-volume reputation: separately, repeated requests to this domain from
//      the same origin in a short window (as happened in this repo's sandboxed dev
//      environment during generation) can trigger a DIFFERENT response — HTTP 202 with a
//      meta-refresh to /.well-known/sgcaptcha/?...&y=ipr:<client-ip>:<timestamp> — even
//      with the honest UA from point 1. The source IP is embedded directly in that URL,
//      which is why this looks like a rate/reputation signal rather than a UA check.
// Both were observed on 2026-08-12. Keep request volume low and use the CLI's own UA
// unmodified; if WAF_BLOCKED still fires, wait and retry rather than assuming a change in
// site policy or a broken parser.

export const BASE_URL = "https://legrand-associates.com"
const API_BASE = `${BASE_URL}/wp-json/wp/v2`

// Verified live 2026-08-12 against /wp-json/wp/v2/locatie. The initial handoff's list (22,
// 23, 24, 85, 86, 87, 110) was missing two real Luxembourg entries present in the live
// taxonomy: Wiltz (80) and Mersch (113). This is a curated business classification ("which
// taxonomy terms count as Luxembourg"), not something re-derivable from the term data
// itself, so it's a hard-coded list rather than a live lookup — if the site adds another
// Luxembourg location later (e.g. Redange, Vianden, Remich, Echternach — the other LU
// cantons), this list will need a manual update. See url-reference.md.
export const LU_LOCATION_IDS = [22, 23, 24, 80, 85, 86, 87, 110, 113]

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// Deliberately NOT "Mozilla/5.0 (compatible; ...)" — see the module comment above. This
// plain form is the more honest identification, not a workaround: it states the tool name,
// version, and purpose without the browser-impersonation prefix a WAF reacts to.
const UA = "legrand-search-cli/1.0 (personal job search)"

interface RawResponse {
  status: number
  headers: Headers
  text: string
}

async function rawFetch(url: string): Promise<RawResponse> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
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
    return { status: response.status, headers: response.headers, text: await response.text() }
  }
  throw new Error("Request failed after max retries")
}

/** Parse a response as JSON, or raise a clear WAF_BLOCKED error if the body isn't JSON at
 *  all (the site's WAF returns non-JSON on both confirmed block shapes: a plain 403 HTML
 *  error page, and a 202 meta-refresh to /.well-known/sgcaptcha/ — checking content-type
 *  and JSON-parseability directly, rather than matching a specific status code, catches
 *  both without hard-coding either one). */
function parseJsonOrWafError(raw: RawResponse): unknown {
  if (raw.status === 404) return null
  const contentType = raw.headers.get("content-type") ?? ""
  const looksLikeJson = contentType.includes("application/json")
  let parsed: unknown
  if (looksLikeJson) {
    try {
      parsed = JSON.parse(raw.text)
    } catch {
      parsed = undefined
    }
  }
  if (parsed === undefined) {
    const err = new Error(
      `The site returned non-JSON content (HTTP ${raw.status}, content-type "${contentType}") instead of the expected API response — the WAF likely intercepted this request. See the module comment at the top of helpers.ts: this site's WAF reacts to either a browser-impersonating User-Agent (already avoided here) or IP/request-volume reputation (a captcha redirect, seen even with the honest UA after repeated requests from the same origin). Wait and retry at lower volume before assuming a site or parser regression.`,
    ) as Error & { code?: string }
    err.code = "WAF_BLOCKED"
    throw err
  }
  return parsed
}

/** Fetch JSON with exponential backoff on 429/5xx, null on 404, and a WAF_BLOCKED error
 *  (see parseJsonOrWafError) if the WAF intercepted the request instead of the API. */
export async function apiFetch(url: string): Promise<unknown> {
  return parseJsonOrWafError(await rawFetch(url))
}

/** Fetch a collection endpoint and also return X-WP-Total (standard WP REST pagination
 *  header on every collection route). */
async function apiFetchCollection(url: string): Promise<{ items: unknown[]; total: number | null }> {
  const raw = await rawFetch(url)
  const items = (parseJsonOrWafError(raw) ?? []) as unknown[]
  const totalHeader = raw.headers.get("X-WP-Total")
  return { items, total: totalHeader ? parseInt(totalHeader, 10) : null }
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null // YYYY-MM-DD
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  industry: string | null
  applyUrl: string | null
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

function clean(text: string): string {
  return decodeHtmlEntities(text).trim()
}

/** Rich-text HTML -> plain text, keeping paragraph/list/heading breaks as newlines. */
function richTextToPlain(html: string): string {
  const withBreaks = html.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim()
}

// --- WP REST shapes (fields actually observed live 2026-08-12) ---

interface RawTaxonomyTerm {
  id: number
  name: string
}

interface RawJob {
  id: number
  slug: string
  link: string
  date: string
  title: { rendered: string }
  content?: { rendered: string }
  locatie?: number[]
  industrie?: number[]
  "contract-type"?: number[]
}

async function fetchTaxonomyMap(taxonomy: "locatie" | "contract-type" | "industrie"): Promise<Map<number, string>> {
  const raw = await apiFetch(`${API_BASE}/${taxonomy}?per_page=100&_fields=id,name`)
  const terms = (raw ?? []) as RawTaxonomyTerm[]
  return new Map(terms.map((t) => [t.id, clean(t.name)]))
}

function joinTermNames(ids: number[] | undefined, map: Map<number, string>): string | null {
  if (!ids || ids.length === 0) return null
  const names = ids.map((id) => map.get(id)).filter((n): n is string => Boolean(n))
  return names.length ? names.join(", ") : null
}

function toCard(job: RawJob, locatieMap: Map<number, string>): JobCard {
  return {
    id: String(job.id),
    title: clean(job.title.rendered),
    company: "Le Grand & Associates", // client company is anonymized on every posting
    location: joinTermNames(job.locatie, locatieMap),
    date: job.date ? job.date.slice(0, 10) : null,
    url: job.link,
  }
}

export interface SearchParams {
  query?: string
  luOnly?: boolean
  jobage?: number
  page: number
  perPage: number
}

export function buildSearchUrl(params: SearchParams): string {
  const url = new URL(`${API_BASE}/job`)
  url.searchParams.set("per_page", String(params.perPage))
  url.searchParams.set("page", String(params.page))
  url.searchParams.set("_fields", "id,slug,link,date,title,locatie")
  if (params.query) url.searchParams.set("search", params.query)
  if (params.luOnly) url.searchParams.set("locatie", LU_LOCATION_IDS.join(","))
  if (params.jobage !== undefined) {
    const after = new Date(Date.now() - params.jobage * 86400000).toISOString()
    url.searchParams.set("after", after)
  }
  return url.toString()
}

export async function runSearchFetch(params: SearchParams): Promise<{ count: number | null; results: JobCard[] }> {
  const [locatieMap, { items, total }] = await Promise.all([
    fetchTaxonomyMap("locatie"),
    apiFetchCollection(buildSearchUrl(params)),
  ])
  const jobs = items as RawJob[]
  return { count: total, results: jobs.map((j) => toCard(j, locatieMap)) }
}

export function detailApiUrl(id: string): string {
  return `${API_BASE}/job/${encodeURIComponent(id)}?_fields=id,slug,link,date,title,content,locatie,industrie,contract-type`
}

export async function runDetailFetch(id: string): Promise<JobDetail | null> {
  const [locatieMap, contractTypeMap, industrieMap, raw] = await Promise.all([
    fetchTaxonomyMap("locatie"),
    fetchTaxonomyMap("contract-type"),
    fetchTaxonomyMap("industrie"),
    apiFetch(detailApiUrl(id)),
  ])
  if (!raw) return null
  const job = raw as RawJob
  const card = toCard(job, locatieMap)
  return {
    ...card,
    description: job.content?.rendered ? richTextToPlain(job.content.rendered) : null,
    employmentType: joinTermNames(job["contract-type"], contractTypeMap),
    industry: joinTermNames(job.industrie, industrieMap),
    applyUrl: job.link, // the job page itself carries the application form; no separate link
  }
}
