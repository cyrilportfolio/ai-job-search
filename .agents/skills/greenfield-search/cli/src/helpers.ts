// Data source: greenfield.lu (Sourceflow / Next.js platform), a Luxembourg recruitment firm.
// The /job-search listing page renders client-side (raw HTML always reads "Sorry, no jobs
// available") and no JSON API endpoint was found (checked /api/jobs, /api/job-search,
// /_next/data/*.json — all 404), so this CLI enumerates job URLs from sitemap.xml
// (~18 URLs, uncompressed XML despite the initial audit assuming otherwise) and fetches each
// detail page directly. Detail pages ARE static, clean HTML — verified live 2026-08-13, no
// blocking of any kind observed (robots.txt is a bare "Allow: /"). See url-reference.md.

export const BASE_URL = "https://www.greenfield.lu"
export const SITEMAP_URL = `${BASE_URL}/sitemap.xml`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// Honest, no-"Mozilla/5.0 (compatible; ...)" UA — see legrand-search/url-reference.md and
// jobslu-search/url-reference.md for why that prefix specifically (not UA presence in
// general) is the thing known to trigger WAFs elsewhere in this repo. No WAF was observed
// on this portal, but the convention is kept for consistency and because it's simply more
// honest self-identification either way.
const UA = "greenfield-search-cli/1.0 (personal job search)"

// Generic bot-challenge signatures (Cloudflare/Akamai/etc.) that can arrive with a 200
// status — checked on every fetch so a future block reads as a clear error, never a silent
// empty parse. Not observed on this portal during investigation; kept as a guard because a
// 200 that isn't real content should never be treated as real content.
const CHALLENGE_MARKERS = [
  /just a moment/i,
  /attention required[^<]*cloudflare/i,
  /access denied/i,
  /captcha/i,
  /request unsuccessful.*incapsula/i,
]

function looksLikeChallenge(html: string): boolean {
  return CHALLENGE_MARKERS.some((re) => re.test(html))
}

interface RawResponse {
  status: number
  text: string
}

async function rawFetch(url: string, accept: string): Promise<RawResponse> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: accept },
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
    return { status: response.status, text: await response.text() }
  }
  throw new Error("Request failed after max retries")
}

/** Fetch a job detail page. Returns null on 404 (expired posting — treat as removed, not an
 *  error, per the portal's observed behavior). Throws CHALLENGE_BLOCKED if a 200 response
 *  doesn't look like a real job page. */
export async function fetchDetailHtml(url: string): Promise<string | null> {
  const raw = await rawFetch(url, "text/html,application/xhtml+xml")
  if (raw.status === 404) return null
  if (!raw.text.includes('id="jobposting-jsonld"')) {
    if (looksLikeChallenge(raw.text)) {
      const err = new Error(
        `${url} returned a bot-challenge page instead of job content (HTTP ${raw.status}). Not observed during this skill's investigation (2026-08-13) — wait and retry at lower volume before assuming a parser regression.`,
      ) as Error & { code?: string }
      err.code = "CHALLENGE_BLOCKED"
      throw err
    }
    const err = new Error(
      `${url} returned HTTP ${raw.status} but no #jobposting-jsonld block was found — the page markup may have changed. See url-reference.md for the expected structure.`,
    ) as Error & { code?: string }
    err.code = "PARSE_FAILED"
    throw err
  }
  return raw.text
}

export async function fetchSitemapXml(): Promise<string> {
  const raw = await rawFetch(SITEMAP_URL, "application/xml,text/xml")
  if (raw.status !== 200) {
    const err = new Error(`Sitemap fetch failed: HTTP ${raw.status}`) as Error & { code?: string }
    err.code = "SITEMAP_FETCH_FAILED"
    throw err
  }
  return raw.text
}

/** Extract every /job-search/<slug>/ URL from the sitemap, excluding the bare listing index. */
export function extractJobUrls(sitemapXml: string): string[] {
  const urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  return urls.filter((u) => /\/job-search\/[^/]+\/?$/.test(u))
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null // YYYY-MM-DD
  url: string
}

export interface Contact {
  name: string | null
  email: string | null
  phone: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  salary: string | null
  validThrough: string | null
  applyUrl: string | null
  contact: Contact | null
}

interface JobPostingLd {
  title?: string
  description?: string
  datePosted?: string
  validThrough?: string
  hiringOrganization?: { name?: string }
  jobLocation?: { addressRegion?: string; addressLocality?: string }
}

/** Slug's leading or trailing hyphen-delimited numeric token, e.g. "670" from
 *  ".../accountants-de-en-12-months-cdd-670/" or "1234" from ".../1234-senior-....../".
 *  Used only as a fallback id source — the "Job Reference No." meta field (parsed in
 *  parseJobDetail) is the primary, always-present source verified live across all postings. */
export function idFromSlug(url: string): string | null {
  const slug = url.replace(/\/$/, "").split("/").pop() ?? ""
  const tokens = slug.split("-")
  if (tokens.length === 0) return null
  if (/^\d+$/.test(tokens[0])) return tokens[0]
  if (/^\d+$/.test(tokens[tokens.length - 1])) return tokens[tokens.length - 1]
  return null
}

/** Does this job's URL slug carry the given id as a leading or trailing hyphen token? Used
 *  by `detail <id>` to resolve a bare numeric id back to its URL via the sitemap listing. */
export function slugMatchesId(url: string, id: string): boolean {
  const slug = url.replace(/\/$/, "").split("/").pop() ?? ""
  const tokens = slug.split("-")
  return tokens[0] === id || tokens[tokens.length - 1] === id
}

function cleanText(s: string): string {
  return s.trim() || ""
}

/** Parse one detail page's HTML into a JobDetail. Assumes fetchDetailHtml already verified
 *  the #jobposting-jsonld block exists. */
export function parseJobDetail(html: string, url: string): JobDetail {
  const ldMatch = html.match(/id="jobposting-jsonld">([\s\S]*?)<\/script>/)
  const ld: JobPostingLd = ldMatch ? JSON.parse(ldMatch[1]) : {}

  const metaPairs = [
    ...html.matchAll(
      /JobBody__metaLabel[^>]*>([^<]*)<\/div><div class="JobBody__metaValue[^>]*>([^<]*)<\/div>/g,
    ),
  ]
  const meta = new Map(metaPairs.map((m) => [cleanText(m[1]), cleanText(m[2])]))

  const refNo = meta.get("Job Reference No.")
  const id = refNo && /^\d+$/.test(refNo) ? refNo : idFromSlug(url) ?? url

  const jobType = meta.get("Job Type")
  const salaryRaw = meta.get("Salary (Per Annum)")

  const locationRegion = ld.jobLocation?.addressRegion ?? null
  const location = locationRegion ?? meta.get("Location") ?? null

  // Contact block: a per-posting consultant (name, mailto, tel) sits alongside the embedded
  // apply form. Bonus field — useful for this repo's "call before applying" workflow
  // (job-application-assistant/04-job-evaluation.md).
  //
  // Scoped to a window starting at the "Consultant" label rather than searched globally: the
  // page has other mailto links before it (a "share via email" link with no real address,
  // `mailto:?subject=...`) and after it (a generic `clientcontact@greenfield.lu` in the
  // footer, ~28000 chars further down) — a global first-match grabbed the share link's empty
  // address during live testing (2026-08-13). 4600 chars comfortably covers the verified
  // name/email/phone (up to ~4200 chars out) while stopping short of the footer.
  const consultantIdx = html.indexOf(">Consultant<")
  const contactWindow = consultantIdx === -1 ? "" : html.slice(consultantIdx, consultantIdx + 4600)
  const emailMatch = contactWindow.match(/href="mailto:([^"]+)"/)
  const phoneMatch = contactWindow.match(/href="tel:([^"]+)"/)
  // The "Consultant" label and the name text are two tag-levels apart
  // (<dt>Consultant</dt><dd><b>Name</b></dd>), so this skips forward past however many tags
  // sit in between rather than assuming exactly one.
  const nameMatch = contactWindow.match(/>Consultant<[\s\S]{0,120}?>([A-Z][A-Za-z .'-]{2,60})</)
  const contact: Contact | null =
    emailMatch || phoneMatch || nameMatch
      ? { name: nameMatch ? cleanText(nameMatch[1]) : null, email: emailMatch ? emailMatch[1] : null, phone: phoneMatch ? phoneMatch[1] : null }
      : null

  return {
    id,
    title: ld.title ? cleanText(ld.title) : "(untitled)",
    company: ld.hiringOrganization?.name ?? "Greenfield Group",
    location,
    date: ld.datePosted ? ld.datePosted.slice(0, 10) : null,
    url,
    description: ld.description ? ld.description.trim() : null,
    employmentType: jobType && jobType !== "" ? jobType : null,
    salary: salaryRaw && salaryRaw !== "" && salaryRaw !== "-" ? salaryRaw : null,
    validThrough: ld.validThrough ?? null,
    applyUrl: url, // embedded on-page form (POST-only /_sf/api endpoint) — the page itself is the apply flow
    contact,
  }
}

export function toCard(job: JobDetail): JobCard {
  return { id: job.id, title: job.title, company: job.company, location: job.location, date: job.date, url: job.url }
}

/** Fetch and parse every job listed in the sitemap. Expired postings (404) are dropped
 *  silently, matching the portal's own behavior — not surfaced as errors. A modest
 *  concurrency cap keeps this a burst of a few requests at a time rather than 18 at once,
 *  even though the portal declared no crawl-delay and showed no rate-limiting during
 *  investigation. */
export async function fetchAllJobs(): Promise<JobDetail[]> {
  const urls = extractJobUrls(await fetchSitemapXml())
  const jobs: JobDetail[] = []
  const concurrency = 4
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency)
    const results = await Promise.all(
      batch.map(async (url) => {
        const html = await fetchDetailHtml(url)
        return html ? parseJobDetail(html, url) : null
      }),
    )
    for (const r of results) if (r) jobs.push(r)
  }
  return jobs
}

/** Resolve a bare numeric id or a full URL to a job's detail URL, via the sitemap listing.
 *  Needed because a bare id alone doesn't determine the URL: most slugs end in "-<id>", but
 *  at least one observed posting starts with "<id>-" instead (see idFromSlug). */
export async function resolveJobUrl(idOrUrl: string): Promise<string | null> {
  if (/^https?:\/\//.test(idOrUrl)) return idOrUrl
  const urls = extractJobUrls(await fetchSitemapXml())
  return urls.find((u) => slugMatchesId(u, idOrUrl)) ?? null
}
