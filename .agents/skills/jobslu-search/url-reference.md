# en.jobs.lu URL Reference

Public, unauthenticated ASP.NET WebForms pages (server-rendered HTML, no JSON API, no RSS).
Canonical host is `en.jobs.lu` — `www.jobs.lu` and `jobs.lu` both 301-redirect there.

> Personal use only, per this repo's absolute rule: `en.jobs.lu` was a Sources à réévaluer
> candidate, not a Source en mode alerte exclusion — see
> `.claude/skills/job-scraper/search-queries.md`. Keep request volume low regardless.

## robots.txt

**Absent (404)** on all three hosts (`en.jobs.lu`, `www.jobs.lu`, `jobs.lu`), confirmed
2026-08-12 and re-confirmed live during this skill's generation. No declared refusal, no
guard function needed in `helpers.ts` (contrast `randstad-search`, whose `robots.txt` lists
real disallowed paths and needs `assertAllowedUrl`).

## Bot protection: Akamai Bot Manager challenge (read before assuming a fetch failed)

`en.jobs.lu` sits behind Akamai. A first pass on 2026-08-12 morning saw a challenge on every
UA; a retest that same evening got `200` with real content on all three UAs tried, which the
handoff read as a resolved, UA-independent, time-based intermittency.

**Re-verified live during this skill's generation (2026-08-12, later the same day) with a
tighter A/B test, and that reading needs correcting:** the block reproduces on demand and
correlates with the **User-Agent string**, not just time:

| User-Agent tried | Result |
|---|---|
| `jobslu-search-cli/1.0 (personal job search)` (this skill's honest UA) | **Blocked** — `Challenge Validation` page, every attempt (5/5) |
| `jobslu-search-cli/1.1 (personal job search)` (trivial version bump) | **Blocked** — same page |
| `Mozilla/5.0 (compatible; jobslu-search-cli/1.0)` (the old browser-prefixed form) | **Blocked** — same page |
| `curl/8.x` (bare curl default, no `-A`) | **Passed** — real 76KB listing page, repeatably |
| `python-requests/2.31.0` | **Passed** — real content |
| Full Chrome UA string | **Passed** — real content |

So: any custom, tool-identifying UA (whether or not it uses the flagged
`Mozilla/5.0 (compatible; ...)` prefix — see `legrand-search/url-reference.md` for that
separate, unrelated finding) gets challenged here, while generic/extremely-common UA
strings (bare `curl`, `python-requests`, real browsers) pass. This is very likely an Akamai
heuristic that trusts UA strings by how common/recognized they are, rather than a
browser-vs-non-browser check — the opposite shape of the legrand WAF finding. **Do not
conclude from this that switching to a common-tool UA is the fix**: doing so on purpose to
dodge detection would be impersonation, not honest identification, and this skill's contract
forbids it (see `SKILL.md` and `.claude/commands/add-portal.md`'s portal-skill contract).
The CLI keeps the honest UA and instead **detects the challenge page explicitly** (see
below) rather than silently parsing it as zero results.

Whether this is permanent or will lift again like the first pass did is unknown — re-verify
UA-by-UA rather than assuming either "it's fixed" or "it's still blocked" from a single probe.
**Retest via a fresh set of `curl -A` probes before reopening this file's conclusions.**

### Detecting the challenge page

A blocked request returns **HTTP 200** (not 403/429), with a short (~1.8KB) HTML body:

```html
<title>Challenge Validation</title>
...
<iframe title="Challenge Content" id="sec-cpt-if" ... challenge="eyJ0b2tlbiI6...">
```

`helpers.ts`'s `htmlFetch` checks the response body for `<title>Challenge Validation</title>`
(case-insensitive) after every successful (2xx) fetch, before handing HTML to a parser. If
found, it throws with code `CHALLENGE_BLOCKED` rather than letting a parser run on the
challenge markup and silently return zero results. Never treat a `CHALLENGE_BLOCKED` error as
"no results" — it means the fetch never reached the real listing.

## Search

```
GET https://en.jobs.lu/Jobs.aspx
```

Query params:

| Param | Meaning | Example |
|---|---|---|
| `keywords` | Free-text query | `comptable` |
| `regions` | Location filter (see table below) | `1` |
| `sort` | `Date` or `Relevance` (default `Relevance` if omitted) | `Date` |
| `page` | 1-indexed page number. Omitting it or passing `page=1` are identical (verified byte-identical result sets live). | `2` |

Not exercised (present in the page's own link templates but not needed by this CLI):
`categories`, `toPage`, `employerId`, `isPhraseOnly`.

**Page size is 40.** Verified live for `keywords=comptable`: page 1 → 40 results, page 2 →
19 results (59 total), disjoint job IDs across pages — a plain offset pagination, not
cursor-based.

**No server-side posting-age filter.** `sort=Date` orders newest-first but there is no
`jobage`-style day-count param. `--jobage` is implemented client-side: force `sort=Date`,
fetch, then drop results older than N days after parsing each listing's date field.

### `regions` values (verified from the search form's `<select id="Regions">`, 2026-08-12)

| id | Label on site | Covers |
|---|---|---|
| `0` | Jobs By Location (default, no filter) | — |
| `1` | Luxembourg | Luxembourg |
| `2` | Belgium-Province of Luxembourg | Belgian side of the Grande Région |
| `3` | Allemagne-Rheinland-Pfalz | German side (Rheinland-Pfalz) |
| `4` | Allemagne-Saarland | German side (Saarland) |
| `5` | France-Lorraine | French side (Lorraine) — the frontalier-relevant value |
| `6` | Abroad | Outside the Grande Région entirely |

These map directly onto the Grande Région frontalier market this fork targets — `--location`
accepts the id or a handful of case-insensitive aliases (`luxembourg`/`lu`, `lorraine`/
`france`, `saarland`, `rheinland-pfalz`/`germany`, `belgium`, `abroad`); see `helpers.ts`'s
`REGION_MAP`.

### Result markup (per listing, from `<article class="job-list-item" id="job-id-<id>">`)

| Field | Source |
|---|---|
| `id` | `id="job-id-(\d+)"` attribute on the `<article>` |
| `title` + `url` | `<a href="..." class="job-title">Title text</a>` |
| `date` | `<span class="date">08 Aug</span>` — **no year**, and `Today` for same-day postings. Assume current year; if the parsed date is in the future relative to today, it's from the previous year (December/late-year rollover). |
| `company` + `companyUrl` | `<a href="/Slug/" class="recruiter-name">Name</a>` (relative URL, resolve against `BASE_URL`) |
| `location` | `<span class="location">Luxembourg</span>` |

The page also declares a cosmetic SEO `<link rel="canonical">` to a pretty category-slug URL
(e.g. `/accounting-officer-jobs`) when the keyword matches a known category — this is not a
redirect (confirmed `curl -L`: 0 redirects, direct 200), so the plain `Jobs.aspx?keywords=`
form always works regardless of query and doesn't need to chase that canonical link.

## Detail

```
GET https://en.jobs.lu/ApplyForJob.aspx?Id=<int>
```

`Id` is the same numeric id as in the search results' `job-id-<id>`.

| Field | Source |
|---|---|
| `title` | `<h1 class="job-title">...</h1>` |
| `company` | `<dd class="company-name">...</dd>` (first `<dd>` in the `.c1` definition list) |
| `location` | `<dt>Location:</dt>` followed by `<dd>...</dd>` |
| `payment` | `<dt>Payment:</dt>` followed by `<dd>...</dd>` — often "Market related" |
| `date` (last updated) | `<dt>Last updated:</dt>` followed by `<dd>08 August 2026</dd>` — full month name, has a year, unlike the search-list date |
| `employmentType` (contract type) | `<dt>Contract Type:</dt>` followed by `<dd>...</dd>` — e.g. "Permanent" |
| `hours` | `<dt>Hours:</dt>` followed by `<dd>...</dd>` — e.g. "Full Time" |
| `description` | `<div class="job-html-description">...</div>` — rich HTML, nested `<div>`s (some from what looks like a recruiter-side AI writing-assistant plugin, e.g. `class="_wdUoQG_assistantMessage"`), extract with depth-tracking like `linkedin-search`'s `extractDivContent`, then strip tags/decode entities keeping paragraph breaks |

There is no separate "apply" URL — "Apply Now" is an in-page JS action (form `type="button"`,
no `href`), so `applyUrl` in the CLI's output is the detail page URL itself.

## Notes

- Zero runtime dependencies — plain `bun` + `fetch` + regex, matching `linkedin-search`.
- Exponential backoff with jitter on 429/5xx (max 6 retries), `""`/`null` on 404, per the
  portal-skill contract — separate from and checked before the `CHALLENGE_BLOCKED` check
  above, since a challenge page is a 200, not a 404/429/5xx.
- Test query used during generation and live-verified: `comptable` → 59 results across 2 pages.
- **Re-verify this file's Akamai section in ~1-2 months** rather than trusting it indefinitely
  — both the "blocked" and "resolved" readings have each looked true on a given day this week.
