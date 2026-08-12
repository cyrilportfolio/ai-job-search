// Data source: alleyesonme.jobs public listing/detail pages (Next.js, server-rendered
// HTML, no JSON API — /wp-json returns 403). No authentication required.
//
// robots.txt (fetched 2026-08-12):
//   User-Agent: *
//   Allow: /
//   Disallow: /admin
//   Disallow: */contractType/
//   Disallow: */employment/
//   Disallow: */degree/
//   Disallow: */exp/
//   Disallow: */workplace/
//   Disallow: */size/
//
// This CLI never offers flags for those facets in the first place, but assertAllowedUrl
// below is a hard, unconditional guard: every fetch goes through it, so no future edit to
// this file can construct a disallowed URL by accident. Do not remove or weaken this guard,
// and do not add flags that would require it to.

export const BASE_URL = "https://alleyesonme.jobs"

const FORBIDDEN_PATH_SEGMENTS = [
  "admin",
  "contractType",
  "employment",
  "degree",
  "exp",
  "workplace",
  "size",
]

export function assertAllowedUrl(url: string): void {
  const { pathname } = new URL(url)
  const segments = pathname.split("/").filter(Boolean)
  for (const forbidden of FORBIDDEN_PATH_SEGMENTS) {
    if (segments.includes(forbidden)) {
      throw new Error(
        `Refusing to fetch a robots.txt-disallowed URL (segment "/${forbidden}/" is off-limits): ${url}`,
      )
    }
  }
}

export function listingUrl(page: number): string {
  return page <= 1 ? `${BASE_URL}/jobs` : `${BASE_URL}/jobs/page/${page}`
}

export function detailUrl(slug: string): string {
  return `${BASE_URL}/jobs/${slug}`
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// Deliberately not "Mozilla/5.0 (compatible; ...)" — that exact prefix (the shape
// well-known crawlers self-declare with) got flagged by legrand-associates.com's WAF in a
// controlled A/B test (2026-08-12; see legrand-search/url-reference.md), while this plain
// tool/version/purpose form passed. Applied here preventively, not because this portal has
// shown the same behavior.
const UA = "alleyesonme-search-cli/1.0 (personal job search)"

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
    if (response.status === 404) return ""
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
  date: string | null // normalized to YYYY-MM-DD
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  contractType: string | null
  workTime: string | null
  educationLevel: string | null
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
    // CMS-authored rich text (like this portal's job descriptions) commonly texturizes
    // straight quotes/dashes into these entities — decode to plain ASCII so downstream
    // keyword matching isn't broken by a smart-quote/straight-quote mismatch.
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

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

/** Convert the site's DD/MM/YYYY listing date to YYYY-MM-DD. Returns null if unparseable. */
export function parseListingDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const [, dd, mm, yyyy] = m
  return `${yyyy}-${mm}-${dd}`
}

/** YYYY-MM-DD cutoff for "posted within N days", for lexicographic comparison against parseListingDate output. */
export function jobageCutoffISO(days: number): string {
  const d = new Date(Date.now() - days * 86400000)
  return d.toISOString().slice(0, 10)
}

/**
 * Extract the inner HTML of the first <div> whose class attribute contains
 * `classFragment`, tracking tag depth so nested <div>s don't truncate it early.
 */
export function extractDivContent(html: string, classFragment: string): string | null {
  const escaped = classFragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const openRe = new RegExp(`<div[^>]*class="[^"]*${escaped}[^"]*"[^>]*>`, "i")
  const open = openRe.exec(html)
  if (!open) return null

  let i = open.index + open[0].length
  let depth = 1
  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)
    if (nextClose === -1) return null
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }
  return html.slice(open.index + open[0].length, i - 6)
}

/** Rich-text block -> plain text, keeping paragraph/list/heading breaks as newlines. */
function richTextToPlain(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Parse the listing page: one job card per `<a class="... h-[428px] ...">`.
 * Cards are split by that anchor's position and parsed independently so one
 * malformed card cannot break the rest.
 */
export function parseJobCards(html: string): JobCard[] {
  const cardRe = /<a[^>]*class="[^"]*h-\[428px\][^"]*"[^>]*href="([^"]+)"/g
  const matches = [...html.matchAll(cardRe)]
  const results: JobCard[] = []

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const start = m.index ?? 0
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? html.length) : html.length
    const chunk = html.slice(start, end)
    const href = m[1]
    if (!href || !href.startsWith("/jobs/")) continue
    const id = href.replace(/^\/jobs\//, "").split("?")[0]

    const titleMatch = chunk.match(/class="text-primary line-clamp-2 text-sm font-bold">([\s\S]*?)<\/p>/)
    const title = titleMatch ? clean(titleMatch[1]) : null
    if (!title) continue

    const companyMatch = chunk.match(/class="text-primary text-xs">([\s\S]*?)<\/p>/)
    const company = companyMatch ? clean(companyMatch[1]) || null : null

    const secMatch = chunk.match(/class="text-secondary mt-6[^"]*"[^>]*>([\s\S]*?)<\/div>/)
    let location: string | null = null
    let date: string | null = null
    if (secMatch) {
      const ps = [...secMatch[1].matchAll(/<p>([\s\S]*?)<\/p>/g)].map((pm) => clean(pm[1]))
      location = ps[0] || null
      date = parseListingDate(ps[1])
    }

    results.push({
      id,
      title,
      company,
      location,
      date,
      url: `${BASE_URL}${href}`,
    })
  }

  return results
}

/** Highest page number linked from the pagination component, if present on this page. */
export function parseTotalPages(html: string): number | null {
  const nums = [...html.matchAll(/href="\/jobs\/page\/(\d+)"/g)].map((m) => parseInt(m[1], 10))
  if (!nums.length) return null
  return Math.max(...nums)
}

/** Parse a single job's detail page. */
export function parseJobDetail(html: string, id: string): JobDetail {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = h1 ? clean(h1[1]) : "(untitled)"

  // The company logo's alt text is the next <img alt="..."> after the banner image.
  const companyMatch = html.match(/alt="Banner"[\s\S]*?alt="([^"]+)"/)
  const company = companyMatch ? clean(companyMatch[1]) || null : null

  // The "Informations" sidebar renders icon+text pairs; the lucide icon name identifies
  // the field (verified live on alleyesonme.jobs 2026-08-12 — see url-reference.md).
  const infoStart = html.indexOf('id="info"')
  const infoEnd = infoStart >= 0 ? html.indexOf("</section>", infoStart) : -1
  const infoBlock = infoStart >= 0 && infoEnd >= 0 ? html.slice(infoStart, infoEnd) : ""

  const fields: Record<string, string> = {}
  const iconRe = /lucide-([a-z-]+)[^>]*>[\s\S]*?<\/svg><\/span><span>([^<]*)<\/span>/g
  let im: RegExpExecArray | null
  while ((im = iconRe.exec(infoBlock)) !== null) {
    fields[im[1]] = clean(im[2])
  }

  const descStart = html.indexOf('id="description"')
  const descEnd = descStart >= 0 ? html.indexOf("</section>", descStart) : -1
  const descSection = descStart >= 0 && descEnd >= 0 ? html.slice(descStart, descEnd) : html
  const descHtml = extractDivContent(descSection, "prose")
  const description = descHtml ? richTextToPlain(descHtml) || null : null

  return {
    id,
    title,
    company,
    location: fields["map-pin"] ?? null,
    date: parseListingDate(fields["clock"]),
    url: detailUrl(id),
    description,
    contractType: fields["file-text"] ?? null,
    workTime: fields["house"] ?? null,
    educationLevel: fields["graduation-cap"] ?? null,
    // "Je postule" is a client-side button/dialog (email or external redirect decided by
    // JS after hydration) — no static href to extract. Point users at the job page itself.
    applyUrl: null,
  }
}
