# greenfield.lu Reference

All findings below were verified live on **2026-08-13** via direct `curl` (honest UA
`greenfield-search-cli/1.0 (personal job search)`, no browser-impersonation prefix — repo
convention, see `legrand-search/url-reference.md` and `jobslu-search/url-reference.md` for
why that specific prefix is the thing known to trigger WAFs elsewhere in this repo, not UA
presence in general). No blocking of any kind was observed on this portal.

## robots.txt (fetched 2026-08-13)

```
User-agent: *
Allow: /

Sitemap: https://www.greenfield.lu/sitemap.xml
```

Fully open — no disallowed paths, no crawl-delay. `/terms/` returns a 404 ("Oops! Page not
found") — no ToS page exists to review either. No personal-use warning is added to `SKILL.md`
for this reason (unlike `linkedin-search`, whose ToS explicitly forbids automated access).

## Listing page — confirmed client-rendered, not scrapable

`GET /job-search/` returns real HTML (~107KB, Next.js/Turbopack chunks) but the job-list
region always renders "Sorry, no jobs available" in the raw response regardless of query —
confirmed by direct `curl` with no query params. Checked for a backing JSON API before
committing to the sitemap approach:

```
GET /api/jobs            -> 404
GET /api/job-search      -> 404
GET /_next/data/greenfield.json -> 404
```

No `fetch`/`XHR` endpoint reference found in the raw page source either (searched for
`api`/`sourceflow` substrings in `<script src>` tags and inline content — only static asset
paths and SourceFlow's own gallery/CDN asset URLs turned up, no data endpoint). Not
exhaustively reverse-engineered from the minified JS bundles themselves — see `SKILL.md`'s
architecture note for why the sitemap route was chosen instead of pursuing that further.

## Sitemap enumeration

```
GET https://www.greenfield.lu/sitemap.xml
```

Plain, **uncompressed** XML (not gzipped, despite what an earlier audit assumed) — a standard
`<urlset>` with one `<url><loc>...</loc>...</url>` per page, mixing job postings with static
pages (`/about-us/`, `/gdpr/`, case studies, etc.). Job postings are every URL matching
`/job-search/[^/]+/` (the bare `/job-search/` listing index itself is excluded — its `<loc>`
has nothing after the trailing slash). 17 job postings found live on 2026-08-13.

## Detail page — clean HTML, JSON-LD is the primary data source

```
GET https://www.greenfield.lu/job-search/<slug>/
```

Static HTML containing a `JobPosting` schema.org block:

```html
<script type="application/ld+json" id="jobposting-jsonld">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Accountants - DE/EN - 12 months CDD",
  "description": "Leading Real Estate Company – Junior Accountants – ...",
  "datePosted": "2026-07-17T14:30:48.902Z",
  "hiringOrganization": { "@type": "Organization", "name": "Greenfield Group", "logo": "..." },
  "jobLocation": { "@type": "Place", "addressRegion": "Luxembourg" },
  "validThrough": "2051-07-08T23:59:59.999Z"
}
</script>
```

Verified across all 17 live postings (2026-08-13):
- `description` is **already plain text** — no HTML tags found in any of the 17, so no
  tag-stripping is needed (unlike `linkedin-search`/`legrand-search`, which strip rich-text
  HTML). Bullet lists use literal `\t` characters, not `<li>` markup.
- `hiringOrganization.name` is **always** `"Greenfield Group"` across all 17 postings — this
  firm doesn't anonymize an end client the way `legrand-search` does; it's their own listing.
- `jobLocation.addressRegion` is usually `"Luxembourg"` but not always: one posting reads
  `"Luxembourg, United Kingdom"` (tax-manager-controller-623) and one reads `"Cappelen,
  Luxembourg"` (technical-presales-consultant-...-643) — don't assume it's a constant.
- `validThrough` is **not a real deadline signal** for most postings — 15 of 17 read a date
  literally decades out (`2051-...`), evidently a platform default rather than a curated
  value. Only one posting (`1234-senior-recruitment-consultant-...`, the internal-hire
  outlier below) has a plausible near-term date (`2026-10-30`). `--jobage` filters on
  `datePosted` instead — see `SKILL.md`.

### Meta box (outside the JSON-LD block, HTML only)

```html
<aside class="JobBody__meta">
  <div class="JobBody__metaItem">
    <div class="JobBody__metaLabel text-sm">Job Reference No.</div>
    <div class="JobBody__metaValue text-lg">670</div>
  </div>
  ...
</aside>
```

Four fields, in this order: `Job Type`, `Location`, `Salary (Per Annum)`, `Job Reference No.`.
- `Job Reference No.` is present and numeric on **all 17** live postings — this is the
  primary `id` source (`parseJobDetail` in `helpers.ts`), more reliable than parsing the URL.
- `Job Type` is **empty** on 16 of 17 postings (only the internal-hire outlier has
  `"Permanent"`) — expect `employmentType: null` on most results; this is real portal data,
  not a parser gap.
- `Salary (Per Annum)` is either `"attractive"` (16 of 17) or `"-"` (the outlier) — `"-"` is
  treated as `null`, not as a literal salary value.
- `Location` (this meta field) is redundant with `jobLocation.addressRegion` from the JSON-LD
  block in every case checked; the JSON-LD value is preferred, with the meta field only as a
  fallback if `addressRegion` is ever absent.

### id ↔ URL slug — two patterns, not one

16 of 17 postings end their URL slug in `-<id>` (e.g. `finance-controller-691` → `691`). **One
does not**: `1234-senior-recruitment-consultant-on-demand-and-interim-desk` puts the id
(`1234`, confirmed via its own "Job Reference No." meta value) at the **start** of the slug
instead — this looks like an internal Greenfield hire (recruiting for their own on-demand/
interim desk) rather than a client placement, which may explain the different slug
convention. `idFromSlug`/`slugMatchesId` in `helpers.ts` check both the leading and trailing
hyphen-token position rather than assuming the common pattern always holds; `detail <id>`
resolves a bare id to its URL the same way, via the live sitemap listing (not a hard-coded
URL-construction rule), so a future posting with yet another slug shape still resolves
correctly as long as its own "Job Reference No." matches the requested id.

### Contact / consultant block

Each detail page names a per-posting Greenfield consultant with `mailto:`/`tel:` links, e.g.:

```html
<dt>Consultant</dt><dd><b>Damien Van Bouvelen</b></dd>
...
<dd><a href="mailto:damien@greenfield.lu">damien@greenfield.lu</a></dd>
<dd><a href="tel:+352 26 38 36 51">...</a></dd>
```

Exposed as `contact: { name, email, phone }` in `detail` output — not part of the
portal-skill contract's minimum field set, but genuinely useful for this repo's
pre-application call step. The name sits **two tag-levels** below its `Consultant` label
(`<dt>...</dt><dd><b>...</b></dd>`), which the parsing regex accounts for explicitly (an
earlier version assumed only one tag-level and silently failed to match — caught while
building the offline test fixture, before any live run).

### Apply link

No separate apply URL exists — the page has an embedded form
(`data-sourceflow-url="/_sf/api/v1/jobs/<uuid>/apply"`, POST-only, not a browsable endpoint).
`applyUrl` in `detail` output is the posting's own page URL, same pattern as
`legrand-search`.

## Query-language finding (verified, not a bug)

The mandated test query `"comptable"` returns **zero** title matches, live-verified
2026-08-13 — every one of the 17 postings is titled in English (`"Accountants - DE/EN - 12
months CDD"`, `"Finance Controller"`, `"Tax Manager/Controller"`, etc.), unlike
`legrand-search` where Luxembourg-market postings genuinely are French-titled. `"accountant"`
correctly matches `accountants-de-en-12-months-cdd-670`.

## Notes

- No authentication required.
- No WAF or bot-challenge behavior observed on any of the ~35 requests made during
  investigation and testing (17 detail-page fetches × roughly two passes, plus sitemap and
  robots.txt checks) — `helpers.ts` still guards against one (`CHALLENGE_BLOCKED`/
  `PARSE_FAILED` on unexpected content) per this repo's "never a silent empty parse on a
  block" convention, in case that ever changes.
