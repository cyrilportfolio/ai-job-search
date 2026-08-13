# en.jobs.lu URL Reference

Public, unauthenticated ASP.NET WebForms pages (server-rendered HTML, no JSON API, no RSS).
Canonical host is `en.jobs.lu` — `www.jobs.lu` and `jobs.lu` both 301-redirect there.

> **Status: dormant.** `en.jobs.lu` moved to `.claude/skills/job-scraper/search-queries.md`'s
> "mode alerte" (email-alert-only) sources on 2026-08-12 — its Akamai bot protection blocks
> the category of tool-identifying User-Agents this CLI's honest UA belongs to (see below),
> and this repo's policy is to accept that rather than evade it. The skill and its parsers
> are kept, verified against real captured markup fixtures, and require no changes to
> reactivate if the site's policy changes later — see `SKILL.md`'s `enabled: false`.

## robots.txt

**Absent (404)** on all three hosts (`en.jobs.lu`, `www.jobs.lu`, `jobs.lu`), confirmed
2026-08-12 and re-confirmed live during this skill's generation. No declared refusal, no
guard function needed in `helpers.ts` (contrast `randstad-search`, whose `robots.txt` lists
real disallowed paths and needs `assertAllowedUrl`).

## Bot protection: Akamai Bot Manager challenge (why this skill is dormant)

`en.jobs.lu` sits behind Akamai. **Confirmed 2026-08-12 by a test that both alternates UAs on
every single request and checks response *content* (not just HTTP status): the block targets
tool-identifying User-Agents specifically, and is otherwise stable, not intermittent.**

```
curl + jobslu-search-cli/1.0 (personal job search)   -> CHALLENGE  (3/3)
curl + curl's own default UA                         -> OK, 40 real listings (3/3)
bun  + jobslu-search-cli/1.0 (personal job search)   -> CHALLENGE
```

Same client, same machine, same moment — the only variable across each pair is the UA
string. This confirms the original 2026-08-12 morning recon's instinct (a tool-UA-shaped
block) over two later, wrong readings; both of those are retracted below with the specific
methodology mistake each one made, because the mistake matters more than the wrong
conclusion for anyone testing this site again:

1. **First wrong reading ("resolved, intermittent, UA-independent"):** based on three UAs
   each getting HTTP `200` on a single retest. **`200` is not evidence of real content on
   this site** — Akamai's challenge page is *also* served with HTTP `200` (see below), so a
   status-code-only check cannot distinguish "passed" from "challenged." All three of those
   retest probes may well have been challenged too; the check simply never looked.
2. **Second wrong reading ("UA-correlated" — directionally right conclusion, wrong test):**
   did check page content, and did alternate UAs — but in **two successive series** (all of
   one UA's probes, then all of the other's), not interleaved per-request. That design cannot
   separate a UA effect from a time-based one, so even though this reading's conclusion
   happened to match the final, correctly-tested result, it wasn't actually established by
   that test and got flagged as unverified at the time.

**The methodology that actually settles it, for any future retest of this or a similar
Akamai-fronted site:** alternate UAs on every single request (A, B, A, B, ...), never as
successive series — *and* verify response **content**, never HTTP status code alone, since a
challenge page can return `200`.

### The decision: alert-only, not a generic UA

The block is Akamai's own policy, deliberately targeting the *category* "client that
announces itself as a tool" — the test above shows `curl`'s own bare default UA passes, not
because it's specifically allow-listed, but because it doesn't self-identify as anything in
particular the way `jobslu-search-cli/1.0 (personal job search)` does. Switching this CLI to
a bare/generic UA would therefore work, but only by making the client stop honestly
identifying itself — which is exactly the category the site is drawing its line around.
**This repo does not evade that by adopting a generic/non-descriptive UA.** Doing so wouldn't
be a lie about any specific fact, but it would defeat the exact distinction the site's
operator chose to draw, which this repo treats as out of bounds the same way it treats the
browser-impersonation rule elsewhere in this repo's UA conventions (see `SKILL.md` and
`.claude/commands/add-portal.md`'s portal-skill contract) even though no specific identity is
being impersonated here. **Decision (2026-08-12): `en.jobs.lu` moves to `search-queries.md`'s
email-alert-only sources.** The CLI, parsers, and `CHALLENGE_BLOCKED` detection are kept
as-built (see `SKILL.md`'s dormant/`enabled: false` status) rather than deleted, since the
site's policy could change and the parsers are independently verified against real captured
markup fixtures.

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
- Test query used during generation and live-verified: `comptable` → 59 results across 2 pages
  (both counts observed while the block was inactive, via a UA that passed).
- The Akamai section above is settled (stable, tool-UA-targeted block, confirmed via an
  interleaved + content-checked A/B test) and the skill is dormant as a result — no need to
  re-open it casually. If the site's policy changes and this skill is reactivated, re-verify
  with the same method (interleaved UAs, content check, not status code alone) before
  trusting any new reading.
