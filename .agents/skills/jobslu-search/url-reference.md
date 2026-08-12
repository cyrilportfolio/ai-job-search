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

`en.jobs.lu` sits behind Akamai, which serves a challenge page (see below) on some requests
and real content on others. **Confirmed 2026-08-12 via a strictly interleaved A/B test
(custom CLI UA and a bare-default UA alternated on every single call, ~30s total span): both
UAs got `200` with real content on every call.** The block is **intermittent and
UA-independent** — it is not caused by, and does not correlate with, this CLI's honest User
-Agent string.

An earlier same-day test run wrongly concluded the opposite (UA-correlated: honest UA
blocked 5/5, generic UAs passed every time) and that conclusion briefly lived in this file,
in `search-queries.md`, and in a project memory. **It was a methodology error, not a
real finding, and has been retracted everywhere.** That test ran one UA several times, then
switched and ran the other UA several times — two successive series, not interleaved calls.
Since the block itself flips on and off over time independent of UA, running same-UA calls
back-to-back makes whichever time-window each series happened to land in look like a
UA effect. **Any future test of this block must alternate UAs on every single request
(A, B, A, B, ...), never run one UA's probes as a block before switching to the other** —
that is the only design that actually separates a UA cause from a time-based one.

Given it's confirmed intermittent and UA-independent, this CLI's own honest-UA requests will
sometimes hit the challenge and sometimes not, on no predictable schedule discovered so far.
That is exactly what `CHALLENGE_BLOCKED` (below) exists to handle cleanly — retry later, it
is not a "no results" answer and not a reason to consider changing the UA.

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
- The Akamai section above is settled (intermittent, UA-independent, confirmed via an
  interleaved A/B test) — no need to re-open it from scratch, but if `CHALLENGE_BLOCKED`
  starts firing on most/all calls rather than intermittently, that would be a real change
  worth re-testing with the interleaved method described above, not reason enough on its own
  to suspect the UA.
