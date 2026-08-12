// Data source: manpower.lu public archive/search/detail pages (WordPress + the Matador
// Jobs plugin, backed by Bullhorn ATS). No JSON API — the CPT is not exposed via
// /wp-json/wp/v2 (show_in_rest is false), so parsing is HTML-based throughout.
//
// robots.txt (fetched 2026-08-12):
//   User-agent: *
//   Disallow:
// Empty Disallow = everything is allowed. No facet/path guard is needed here (contrast
// with alleyesonme-search, which hard-blocks several disallowed facet segments).

export const BASE_URL = "https://manpower.lu"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// Deliberately not "Mozilla/5.0 (compatible; ...)" — that exact prefix (the shape
// well-known crawlers self-declare with) got flagged by legrand-associates.com's WAF in a
// controlled A/B test (2026-08-12; see legrand-search/url-reference.md), while this plain
// tool/version/purpose form passed. Applied here preventively, not because this portal has
// shown the same behavior.
const UA = "manpower-search-cli/1.0 (personal job search)"

/** Fetch HTML with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
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
  employmentType: string | null
  applyUrl: string | null
}

export function listingUrl(page: number): string {
  return page <= 1 ? `${BASE_URL}/fr/jobs/` : `${BASE_URL}/fr/jobs/page/${page}/`
}

/** WordPress full-text search over the "jobs" post type. Confirmed live 2026-08-12 to
 *  genuinely filter server-side (unlike alleyesonme.jobs's decorative ?q=). It is NOT
 *  paginated — the results page carries no page-numbers nav — so it returns a single,
 *  WordPress-relevance-capped batch (observed up to 10 results). */
export function searchUrl(query: string): string {
  return `${BASE_URL}/?s=${encodeURIComponent(query)}&post_type=jobs`
}

export function detailUrl(slug: string): string {
  return `${BASE_URL}/fr/jobs/${slug}/`
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
    // WordPress's wptexturize converts straight quotes/dashes to these entities throughout
    // titles and descriptions (e.g. "d&rsquo;un logiciel") — decode to plain ASCII so
    // downstream keyword matching isn't broken by a smart-quote/straight-quote mismatch.
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

/** Convert the site's DD/MM/YYYY date to YYYY-MM-DD. Returns null if unparseable. */
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

/** Rich-text block -> plain text, keeping paragraph/list/heading breaks as newlines. */
function richTextToPlain(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Parse a listing/search-results page: one job card per `<article id="post-...
 * matador-job-listings ...">`. Cards are split by that anchor's position and parsed
 * independently so one malformed card cannot break the rest. The same markup is used by
 * both the archive listing and the ?s= search-results page.
 */
export function parseJobCards(html: string): JobCard[] {
  const cardRe = /<article[^>]*class="[^"]*matador-job-listings[^"]*"[^>]*>/g
  const matches = [...html.matchAll(cardRe)]
  const results: JobCard[] = []

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const start = m.index ?? 0
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? html.length) : html.length
    const chunk = html.slice(start, end)

    const linkMatch = chunk.match(/class="post-title"><a href="([^"]+)">([\s\S]*?)<\/a>/)
    if (!linkMatch) continue
    const href = linkMatch[1]
    const title = clean(linkMatch[2])
    if (!title) continue

    // id = the "<numeric>-<slug>" segment, regardless of whether the URL carries a /fr/ prefix.
    const idMatch = href.match(/\/jobs\/([0-9]+-[a-z0-9-]+)\/?$/i)
    const id = idMatch ? idMatch[1] : href.replace(/^https?:\/\/[^/]+/, "").replace(/^\/|\/$/g, "")

    const dateMatch = chunk.match(/fa-calendar"><\/i>(\d{2}\/\d{2}\/\d{4})/)
    const date = parseListingDate(dateMatch ? dateMatch[1] : null)

    const locTypeMatch = chunk.match(/Location:\s*([^<]*?)\s*Type:\s*(\S+)/)
    const location = locTypeMatch ? clean(locTypeMatch[1]) || null : null

    results.push({
      id,
      title,
      // No company/client name is exposed on listing or detail pages — postings are
      // agency-mediated and the end client is usually anonymized in the body text
      // ("notre client, ..."). See url-reference.md.
      company: null,
      location,
      date,
      url: detailUrl(id),
    })
  }

  return results
}

/** Highest page number linked from the archive pagination nav, if present on this page. */
export function parseTotalPages(html: string): number | null {
  const nums = [...html.matchAll(/href="[^"]*\/jobs\/page\/(\d+)\/"/g)].map((m) => parseInt(m[1], 10))
  if (!nums.length) return null
  return Math.max(...nums)
}

/** Parse a single job's detail page. */
export function parseJobDetail(html: string, id: string): JobDetail {
  const linkMatch = html.match(/class="post-title"><a href="[^"]+">([\s\S]*?)<\/a>/)
  const title = linkMatch ? clean(linkMatch[1]) : "(untitled)"

  const dateMatch = html.match(/fa-calendar"><\/i>(\d{2}\/\d{2}\/\d{4})/)
  const date = parseListingDate(dateMatch ? dateMatch[1] : null)

  // The "matador-job-meta" list renders labeled fields; matador-job-field-<key> identifies
  // each one regardless of label wording (verified live on manpower.lu 2026-08-12).
  const fields: Record<string, string> = {}
  const fieldRe =
    /matador-job-field-([a-zA-Z_]+)[^"]*"[^>]*>[\s\S]*?matador-job-meta-value">([^<]*)<\/span>/g
  let fm: RegExpExecArray | null
  while ((fm = fieldRe.exec(html)) !== null) {
    fields[fm[1]] = clean(fm[2])
  }

  // Description: everything between the end of the meta list and the application form.
  // Anchor on the <ul class="matador-job-meta ...> element itself, not the bare string
  // "matador-job-meta" — that also appears earlier in an inline <style> block
  // (".matador-job-meta-value { ... }"), which would anchor on the wrong, much earlier
  // </ul> (a nav menu's) and pull the entire nav into the description.
  const metaEnd = html.indexOf("</ul>", html.indexOf('<ul class="matador-job-meta'))
  const formAttrIdx = html.indexOf('id="matador-application-form"')
  // Slice up to the <form tag's own start, not the id="..." attribute partway through it —
  // slicing mid-tag leaves an unclosed "<form" fragment that stripTags can't remove (its
  // regex requires a matching ">").
  const formStart = formAttrIdx !== -1 ? html.lastIndexOf("<form", formAttrIdx) : -1
  let description: string | null = null
  if (metaEnd !== -1 && formStart !== -1 && formStart > metaEnd) {
    description = richTextToPlain(html.slice(metaEnd + 5, formStart)) || null
  }

  return {
    id,
    title,
    company: null,
    location: fields["job_general_location"] ?? null,
    date,
    url: detailUrl(id),
    description,
    employmentType: fields["employmentType"] ?? null,
    // The apply form POSTs multipart/form-data (CV upload, etc.) to a Matador API endpoint
    // — not something this CLI submits on the user's behalf. Point at the job page itself.
    applyUrl: null,
  }
}
