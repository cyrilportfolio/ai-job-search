// Data source: en.jobs.lu (canonical host; www.jobs.lu/jobs.lu 301-redirect here), an
// ASP.NET WebForms site. Server-rendered HTML, no JSON API, no RSS. robots.txt is absent
// (404) on all three hosts, confirmed 2026-08-12 — no declared refusal, so no
// assertAllowedUrl-style guard is needed here (contrast randstad-search).
//
// The site sits behind Akamai Bot Manager. Verified live 2026-08-12 during this skill's
// generation: any custom, tool-identifying User-Agent (this CLI's honest UA included) gets
// served a "Challenge Validation" page — HTTP 200, ~1.8KB body, not a 403/429 — while bare
// `curl`, `python-requests`, and real browser UAs pass through untouched. See
// url-reference.md for the full A/B test. This CLI does NOT switch to a common-tool UA to
// dodge that — doing so on purpose would be impersonation, not honest identification, and
// the portal-skill contract forbids it. Instead htmlFetch detects the challenge page's
// content explicitly and fails loudly with CHALLENGE_BLOCKED rather than letting a parser
// run on it and silently returning zero results.

export const BASE_URL = "https://en.jobs.lu"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// Deliberately not "Mozilla/5.0 (compatible; ...)" — see .claude/commands/add-portal.md's
// portal-skill contract and legrand-search/url-reference.md for why that prefix is avoided
// repo-wide. Note this portal's own WAF finding (module comment above) cuts the other way —
// it challenges this honest form too — but the fix for that is explicit detection below,
// never a switch to a UA that isn't this tool's own honest identification.
const UA = "jobslu-search-cli/1.0 (personal job search)"

const CHALLENGE_MARKER = /<title>\s*challenge validation\s*<\/title>/i

/** Fetch HTML with exponential backoff on 429/5xx, "" on 404, and an explicit
 *  CHALLENGE_BLOCKED error if Akamai served its challenge page instead of real content. */
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
    const text = await response.text()
    if (CHALLENGE_MARKER.test(text)) {
      const err = new Error(
        "Akamai a affiché une page de challenge (\"Challenge Validation\") au lieu des résultats — " +
          "blocage intermittent connu sur ce portail (corrélé à l'UA, pas au contenu de la requête), " +
          "réessayer plus tard. Voir url-reference.md pour le détail de l'A/B test. Ce n'est pas une " +
          "erreur de parsing : aucune page réelle n'a été reçue.",
      ) as Error & { code?: string }
      err.code = "CHALLENGE_BLOCKED"
      throw err
    }
    return text
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  date: string | null // YYYY-MM-DD
  url: string
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  hours: string | null
  payment: string | null
  applyUrl: string | null
}

// Region filter, from the search form's <select id="Regions"> (verified live 2026-08-12).
// Aliases cover the Grande Région frontalier market this fork targets.
export const REGION_MAP: Record<string, string> = {
  "0": "0",
  luxembourg: "1",
  lu: "1",
  "1": "1",
  "belgium-province of luxembourg": "2",
  belgium: "2",
  "2": "2",
  "allemagne-rheinland-pfalz": "3",
  "rheinland-pfalz": "3",
  germany: "3",
  "3": "3",
  "allemagne-saarland": "4",
  saarland: "4",
  "4": "4",
  "france-lorraine": "5",
  lorraine: "5",
  france: "5",
  "5": "5",
  abroad: "6",
  "6": "6",
}

export function resolveRegion(location: string | undefined): string | null {
  if (!location) return null
  const key = location.trim().toLowerCase()
  return REGION_MAP[key] ?? null
}

export interface SearchParams {
  query?: string
  region?: string // resolved region id, e.g. "1"
  sortByDate: boolean
  page: number
}

export function searchUrl(params: SearchParams): string {
  const url = new URL(`${BASE_URL}/Jobs.aspx`)
  if (params.query) url.searchParams.set("keywords", params.query)
  if (params.region && params.region !== "0") url.searchParams.set("regions", params.region)
  if (params.sortByDate) url.searchParams.set("sort", "Date")
  if (params.page > 1) url.searchParams.set("page", String(params.page))
  return url.toString()
}

export function detailUrl(id: string): string {
  return `${BASE_URL}/ApplyForJob.aspx?Id=${encodeURIComponent(id)}`
}

/** Parse a job ID out of a raw id, a detail URL, or a job-id-<n> fragment. */
export function normalizeId(input: string): string | null {
  const q = input.match(/[?&]Id=(\d+)/i)
  if (q) return q[1]
  const frag = input.match(/job-id-(\d+)/)
  if (frag) return frag[1]
  const bare = input.match(/^\d+$/)
  return bare ? input : null
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

// This portal's rich-text job descriptions are French, and use named entities (not raw
// UTF-8 or numeric refs) for every accented letter — &eacute;, &agrave;, &Eacute;, etc. are
// pervasive (verified live 2026-08-12, see tests/fixtures/detail-fragment.html). The
// named-entity set other portal skills in this repo copy from linkedin-search doesn't cover
// these at all, so it was extended here rather than reused as-is.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"',
  mdash: "—", ndash: "–", hellip: "...", nbsp: " ",
  eacute: "é", Eacute: "É", egrave: "è", Egrave: "È",
  ecirc: "ê", Ecirc: "Ê", euml: "ë", Euml: "Ë",
  agrave: "à", Agrave: "À", acirc: "â", Acirc: "Â", auml: "ä", Auml: "Ä",
  icirc: "î", Icirc: "Î", iuml: "ï", Iuml: "Ï",
  ocirc: "ô", Ocirc: "Ô", ouml: "ö", Ouml: "Ö",
  ucirc: "û", Ucirc: "Û", uuml: "ü", Uuml: "Ü", ugrave: "ù", Ugrave: "Ù",
  ccedil: "ç", Ccedil: "Ç", oelig: "œ", OElig: "Œ", aelig: "æ", AElig: "Æ",
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).trim()
}

/** Rich-text HTML -> plain text, keeping paragraph/list/heading breaks as newlines. */
function richTextToPlain(html: string): string {
  const withBreaks = html.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(stripTags(withBreaks)).replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Extract the inner HTML of a <div> identified by a CSS class name, correctly handling
 * nested <div> elements by tracking tag depth. Needed because the description block nests
 * further <div>s inside it (see url-reference.md). Copied from linkedin-search/helpers.ts,
 * the repo's worked example for this exact problem.
 */
export function extractDivContent(html: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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

const MONTHS_SHORT: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const MONTHS_LONG: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

/** ISO YYYY-MM-DD for "today", in UTC (matches the ISO dates this function produces). */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The search-list date has no year ("08 Aug", or "Today"). Assume the current year; if that
 * reading falls in the future relative to today, the listing is from last year (a
 * December/late-year posting seen after New Year's). Returns null if unparseable.
 */
export function parseListDate(raw: string, now: Date = new Date()): string | null {
  const text = raw.trim()
  if (/^today$/i.test(text)) return now.toISOString().slice(0, 10)

  const m = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})$/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = MONTHS_SHORT[m[2].slice(0, 3).toLowerCase()]
  if (!month) return null

  let year = now.getUTCFullYear()
  let candidate = new Date(Date.UTC(year, month - 1, day))
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  if (candidate.getTime() > todayUtc.getTime()) {
    year -= 1
    candidate = new Date(Date.UTC(year, month - 1, day))
  }
  return candidate.toISOString().slice(0, 10)
}

/** The detail page's "Last updated" date has a full month name and a year ("08 August
 *  2026") — unlike the list date, this parses directly with no ambiguity to resolve. */
export function parseDetailDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  if (!m) return null
  const day = parseInt(m[1], 10)
  const month = MONTHS_LONG[m[2].toLowerCase()]
  const year = parseInt(m[3], 10)
  if (!month) return null
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

/**
 * Parse the search-results listing: one <article class="job-list-item" id="job-id-<id>">
 * per posting. We split on that opener and parse each chunk independently so one malformed
 * card cannot break the rest (see linkedin-search's parseJobCards for the same pattern).
 */
export function parseJobCards(html: string, now: Date = new Date()): JobCard[] {
  const results: JobCard[] = []
  const chunks = html.split(/<article class="job-list-item[^"]*"\s+id="job-id-(\d+)">/).slice(1)

  // .split() with a capturing group interleaves [id, chunk, id, chunk, ...].
  for (let i = 0; i < chunks.length; i += 2) {
    const id = chunks[i]
    const chunk = chunks[i + 1] ?? ""

    const titleMatch = chunk.match(/href="([^"]+)"\s+class="job-title">([\s\S]*?)<\/a>/i)
    if (!titleMatch) continue
    const url = titleMatch[1]
    const title = clean(titleMatch[2])
    if (!title) continue

    const dateMatch = chunk.match(/class="date">([\s\S]*?)<\/span>/i)
    const date = dateMatch ? parseListDate(clean(dateMatch[1]), now) : null

    const companyMatch = chunk.match(/href="([^"]+)"\s+class="recruiter-name">([\s\S]*?)<\/a>/i)
    const company = companyMatch ? clean(companyMatch[2]) || null : null
    const companyUrl = companyMatch
      ? new URL(decodeHtmlEntities(companyMatch[1]), BASE_URL).toString()
      : null

    const locMatch = chunk.match(/class="location">([\s\S]*?)<\/span>/i)
    const location = locMatch ? clean(locMatch[1]) || null : null

    results.push({ id, title, company, companyUrl, location, date, url })
  }

  return results
}

function ddField(html: string, label: string): string | null {
  const re = new RegExp(`<dt>${label}:</dt>\\s*<dd>([\\s\\S]*?)</dd>`, "i")
  const m = html.match(re)
  return m ? clean(m[1]) || null : null
}

/** Parse the single-job detail page. */
export function parseJobDetail(html: string, id: string): JobDetail {
  const titleMatch = html.match(/<h1 class="job-title">([\s\S]*?)<\/h1>/i)
  const title = titleMatch ? clean(titleMatch[1]) : "(untitled)"

  const companyMatch = html.match(/<dd class="company-name">([\s\S]*?)<\/dd>/i)
  const company = companyMatch ? clean(companyMatch[1]) || null : null

  const location = ddField(html, "Location")
  const payment = ddField(html, "Payment")
  const lastUpdated = ddField(html, "Last updated")
  const date = lastUpdated ? parseDetailDate(lastUpdated) : null
  const employmentType = ddField(html, "Contract Type")
  const hours = ddField(html, "Hours")

  const descHtml = extractDivContent(html, "job-html-description")
  const description = descHtml ? richTextToPlain(descHtml) || null : null

  return {
    id,
    title,
    company,
    companyUrl: null,
    location,
    date,
    url: detailUrl(id),
    description,
    employmentType,
    hours,
    payment,
    // No separate apply link — "Apply Now" is an in-page JS action, not an href
    // (see url-reference.md). The detail page itself is where a human applies.
    applyUrl: detailUrl(id),
  }
}
