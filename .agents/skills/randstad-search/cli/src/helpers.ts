// Data source: randstad.lu public listing/detail pages (a "search-app" SPA, but the
// server-rendered HTML genuinely contains the job data — pre-rendered for SEO — plus two
// even richer embedded data sources that make regex HTML-scraping unnecessary:
//   - Listing pages embed `const data = {...}` (a GTM dataLayer object) containing the
//     total result count and every result's structured fields.
//   - Detail pages embed a schema.org JobPosting JSON-LD block with the full description,
//     employer, location, employment type, reference number, and deadline.
// No JSON API, no RSS.

export const BASE_URL = "https://www.randstad.lu"

// robots.txt (fetched 2026-08-12):
//   Allow: /
//   Disallow: /*/km- /*/postcode- /*/sa- /*/qt- /*search= /*search-app/demo/jobs/
//   Disallow: /*jobs/mvp/ /emplois/*,*/ /en/jobs/*,*/ /*/sd- /*/sh- /*/sm- /*/?id=*
//   Disallow: /*/mpage- /emplois/radius /en/jobs/radius /radius-search/ /*/radius-search/
//   Disallow: /emplois/postuler/ /*/apply/
//   Disallow: /*/?c-career-advice /*/?c-category /*/?c-wf360-category /*/?c-tags /*/?c-press-category
//   Disallow: /taxonomy/term/ /en/taxonomy/term/ /*/profile- /node/ /*/node/
//
// This CLI only ever constructs /emplois/, /emplois/q-<kw>/, /emplois/page-<n>/, and the
// placeholder-slug detail redirect (/emplois/x_x_<id>/) — none of which can accidentally
// collide with the list below. assertAllowedUrl is still called unconditionally on every
// fetch anyway, as a hard guard against any future change accidentally constructing a
// disallowed URL. **Never remove, weaken, or bypass this — including temporarily for a
// test — per explicit instruction when this skill was generated.**
const FORBIDDEN_SEGMENT_PREFIXES = ["km-", "postcode-", "sa-", "qt-", "sd-", "sh-", "sm-", "mpage-", "profile-", "radius"]
const FORBIDDEN_SEGMENTS = ["node", "apply", "postuler"]
const FORBIDDEN_PATH_SUBSTRINGS = ["search-app/demo/jobs/", "jobs/mvp/"]
const FORBIDDEN_PATH_PREFIXES = ["/taxonomy/term/", "/en/taxonomy/term/"]
const FORBIDDEN_QUERY_KEY_PREFIXES = ["c-"]
const FORBIDDEN_QUERY_KEYS = ["id"]

export function assertAllowedUrl(url: string): void {
  const parsed = new URL(url)
  const segments = parsed.pathname.split("/").filter(Boolean)

  if (FORBIDDEN_PATH_PREFIXES.some((p) => parsed.pathname.startsWith(p))) {
    throw new Error(`Refusing to fetch a robots.txt-disallowed URL (taxonomy path): ${url}`)
  }
  if (FORBIDDEN_PATH_SUBSTRINGS.some((s) => parsed.pathname.includes(s))) {
    throw new Error(`Refusing to fetch a robots.txt-disallowed URL (disallowed path substring): ${url}`)
  }
  for (const seg of segments) {
    if (seg.includes(",")) {
      throw new Error(`Refusing to fetch a robots.txt-disallowed URL (comma multi-filter segment "${seg}"): ${url}`)
    }
    if (FORBIDDEN_SEGMENTS.includes(seg)) {
      throw new Error(`Refusing to fetch a robots.txt-disallowed URL (segment "${seg}"): ${url}`)
    }
    if (FORBIDDEN_SEGMENT_PREFIXES.some((p) => seg.startsWith(p))) {
      throw new Error(`Refusing to fetch a robots.txt-disallowed URL (segment "${seg}" matches a disallowed facet prefix): ${url}`)
    }
  }
  if (parsed.search.includes("search=")) {
    throw new Error(`Refusing to fetch a robots.txt-disallowed URL (query contains "search="): ${url}`)
  }
  for (const key of parsed.searchParams.keys()) {
    if (FORBIDDEN_QUERY_KEYS.includes(key) || FORBIDDEN_QUERY_KEY_PREFIXES.some((p) => key.startsWith(p))) {
      throw new Error(`Refusing to fetch a robots.txt-disallowed URL (query param "${key}"): ${url}`)
    }
  }
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; randstad-search-cli/1.0)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  assertAllowedUrl(url)
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-LU,fr;q=0.9,en;q=0.8",
      },
      redirect: "follow",
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
    if (response.status === 404 || response.status === 410) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
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
  reference: string | null
  deadline: string | null
  applyUrl: string | null
}

export function listingUrl(query: string | undefined, page: number): string {
  const segments = ["emplois"]
  if (query) segments.push(`q-${encodeURIComponent(query)}`)
  if (page > 1) segments.push(`page-${page}`)
  return `${BASE_URL}/${segments.join("/")}/`
}

/** A placeholder-slug URL that the site 301-redirects to the job's real canonical URL,
 *  verified live 2026-08-12 (GET /emplois/x_x_<id>/ -> 301 -> the full titled slug). This
 *  means `detail` only needs the numeric id, not the title/location slug text. */
export function detailUrl(id: string): string {
  return `${BASE_URL}/emplois/x_x_${encodeURIComponent(id)}/`
}

/** Real apply link — robots.txt disallows *crawling* /emplois/postuler/ (assertAllowedUrl
 *  refuses to fetch it), but the URL itself is perfectly valid output data for a human to
 *  open in their own browser. Never pass this to htmlFetch. */
export function applyUrl(id: string): string {
  return `${BASE_URL}/emplois/postuler/${encodeURIComponent(id)}`
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

/** Rich-text HTML -> plain text, keeping paragraph/line breaks as newlines. */
function richTextToPlain(html: string): string {
  const withBreaks = html.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim()
}

// --- Shapes of the embedded data, fields actually observed live 2026-08-12 ---

interface RawImpression {
  job_title: string
  job_id: string
  operating_company?: string
  city?: string
  region?: string
  url: string
  launch_date?: string // already YYYY-MM-DD
}

interface RawDataLayer {
  page: { search_results: { search_result_amount: number; search_result_page: number } }
  ecommerce: { impressions?: RawImpression[] }
}

export function parseListingPage(html: string): { count: number; page: number; results: JobCard[] } {
  const m = html.match(/const data = (\{[\s\S]*?\});/)
  if (!m) return { count: 0, page: 1, results: [] }
  const data = JSON.parse(m[1]) as RawDataLayer
  const results: JobCard[] = (data.ecommerce.impressions ?? []).map((jv) => {
    const location = [jv.city, jv.region && jv.region !== jv.city ? jv.region : null].filter(Boolean).join(", ") || null
    return {
      id: jv.job_id,
      title: clean(jv.job_title),
      company: jv.operating_company ? clean(jv.operating_company) : "Randstad Luxembourg",
      location,
      date: jv.launch_date ?? null,
      url: `${BASE_URL}${jv.url}`,
    }
  })
  return {
    count: data.page.search_results.search_result_amount,
    page: data.page.search_results.search_result_page,
    results,
  }
}

interface RawJobPosting {
  "@type": "JobPosting"
  title: string
  description?: string
  datePosted?: string
  validThrough?: string
  employmentType?: string
  hiringOrganization?: { name?: string }
  identifier?: { value?: string }
  jobLocation?: { address?: { addressLocality?: string } }
}

export function parseDetailPage(html: string, id: string): JobDetail | null {
  const scripts = [...html.matchAll(/<script type='application\/ld\+json'>([\s\S]*?)<\/script>/g)]
  let jobPosting: RawJobPosting | null = null
  for (const s of scripts) {
    try {
      const parsed = JSON.parse(s[1])
      if (parsed["@type"] === "JobPosting") {
        jobPosting = parsed
        break
      }
    } catch {
      // malformed block — skip, try the next one
    }
  }
  if (!jobPosting) return null

  return {
    id,
    title: clean(jobPosting.title ?? ""),
    company: jobPosting.hiringOrganization?.name ? clean(jobPosting.hiringOrganization.name) : "Randstad Luxembourg",
    location: jobPosting.jobLocation?.address?.addressLocality ? clean(jobPosting.jobLocation.address.addressLocality) : null,
    date: jobPosting.datePosted ? jobPosting.datePosted.slice(0, 10) : null,
    // No canonical <link> tag was found on the detail page to read the fully-slugged URL
    // back from, so this reports the placeholder redirect URL rather than the pretty one —
    // it resolves to the same job when opened, just via a 301 hop.
    url: detailUrl(id),
    description: jobPosting.description ? richTextToPlain(jobPosting.description) : null,
    employmentType: jobPosting.employmentType ?? null,
    reference: jobPosting.identifier?.value ?? null,
    deadline: jobPosting.validThrough ? jobPosting.validThrough.slice(0, 10) : null,
    applyUrl: applyUrl(id),
  }
}
