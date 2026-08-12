# legrand-associates.com API Reference

Public, unauthenticated WordPress REST API. No HTML scraping needed — every field is real
JSON from the `job` custom post type and its taxonomies.

All findings below were verified live on **2026-08-12**, initially via `WebFetch` and then
confirmed with direct `curl`/`bun` testing (both inside this repo's sandboxed dev
environment and from an ordinary shell) once the WAF's actual trigger was identified.

## robots.txt

Only `/wp-admin/` is disallowed. `/wp-json/*` is explicitly permitted. **The plain HTTP
fetch of `robots.txt` itself returned an HTML 403** (see below) — the actual policy was
confirmed via `tools/robots_check.py`, which falls back to a browser-header read when the
honest request is refused, per `.claude/skills/job-application-assistant/09-web-research.md`.

## ⚠️ The site's WAF (SiteGround Security) — two independent, confirmed triggers

Initial testing from this repo's sandboxed dev environment found every request — `curl`
with an honest custom UA, `curl` with full browser headers, and `bun`'s own `fetch()` — got
an identical static HTML 403 (`<title>403 - Forbidden</title>`, `server: nginx`). The first
hypothesis was a network-origin/IP-ASN block, since `WebFetch` (a different network path)
got real data with no such block, and `robots.txt` doesn't disallow the path. **That
hypothesis was wrong, or at least incomplete** — a controlled test found the real trigger:

**1. User-Agent pattern (confirmed by a controlled A/B test, from an ordinary shell,
2026-08-12):**

```
-A "Mozilla/5.0 (compatible; legrand-search-cli/1.0)"   -> HTTP 403
-A "legrand-search-cli/1.0 (personal job search)"       -> HTTP 200
```

Identical request, identical origin, only the User-Agent string differed. The WAF flags the
`"Mozilla/5.0 (compatible; ...)"` prefix specifically — the exact pattern well-known
crawlers (Googlebot, Bingbot) use to self-declare, which is presumably why an
unrecognized UA claiming that same shape reads as suspicious. This CLI's `UA` constant in
`cli/src/helpers.ts` uses the plain, no-prefix form for exactly this reason — dropping the
browser-impersonation prefix is *more* honest self-identification, not evasion.

**2. IP / request-volume reputation (confirmed by re-testing from the sandbox after the UA
fix, same day):** even with the corrected UA, a burst of repeated requests to this domain
from the same origin in a short window got a *different* response — HTTP 202 with a
meta-refresh to `/.well-known/sgcaptcha/?r=<path>&y=ipr:<client-ip>:<timestamp>`. The
client's own IP is embedded directly in that URL, which is why this reads as a rate or
reputation signal layered on top of (1), not a replacement for it — both were independently
reproduced on the same day, against the same domain.

**Practical takeaway:** use the CLI's UA unmodified, and keep request volume low
(informal, not enforced — no crawl-delay is declared in `robots.txt`, but this site's WAF
clearly reacts to burst traffic from one origin). `apiFetch`/`apiFetchCollection` in
`cli/src/helpers.ts` detect *either* failure shape — checking for non-JSON content rather
than matching a specific status code, since the two triggers return different statuses (403
vs. 202) — and raise both as `code: "WAF_BLOCKED"` with a message describing both possible
causes, rather than a generic failure or a single (and, as it turned out, wrong) diagnosis.

The mandatory Step 4 live-CLI-run of `/add-portal` was completed by the user independently,
outside this session, once the UA fix confirmed the portal is genuinely reachable.

## Search

```
GET https://legrand-associates.com/wp-json/wp/v2/job
    ?per_page=<n>          max 100 (standard WP REST cap)
    &page=<n>              1-indexed
    &search=<keyword>      full-text, title + content
    &locatie=<id,id,...>   taxonomy filter, comma-separated term IDs, OR semantics (verified:
                            17 results for 9 combined LU ids vs. fewer for any single one)
    &after=<ISO8601>       standard WP REST date filter — verified live: 47 results for
                            `after=2026-08-01T00:00:00`, all genuinely dated after that
    &_fields=id,slug,link,date,title,locatie
```

Response is a plain JSON array. **Total count is in the `X-WP-Total` response header**
(standard WP REST collection behavior), not in the body — `runSearchFetch` in `helpers.ts`
reads it from there.

### Search field shapes (verified live via `WebFetch`, one real result)

```json
{
  "id": 10071,
  "date": "2026-08-12T16:37:04",
  "slug": "accountant-az-met-wagen-3",
  "link": "https://legrand-associates.com/job/accountant-az-met-wagen-3/",
  "title": { "rendered": "Accountant AZ met wagen" },
  "content": { "rendered": "<p><strong>Wat ga je doen:</strong></p>..." },
  "contract-type": [7],
  "industrie": [9],
  "locatie": [18]
}
```

**`locatie`/`industrie`/`contract-type` are arrays of raw integer term IDs, not embedded
name objects** — a separate taxonomy lookup is required to get human-readable labels (see
below). `title.rendered` and `content.rendered` are HTML-entity-encoded strings.

### `--query` language mismatch (verified, not a bug)

The mandated test query `"accountant"` combined with `--lu-only` returns **zero results** —
verified live. This isn't a broken filter: Luxembourg postings on this site are titled in
**French** ("Comptable", "Contrôleur financier", "Responsable Comptable"), while Belgium
postings use Dutch/English ("Accountant AZ met wagen"). `search -q "accountant"` alone
(without `--lu-only`) correctly returns 5 real Belgium results. For Luxembourg results, use
a French query term like `"comptable"` — verified live to return correctly LU-located
results when combined with `--lu-only`.

## Luxembourg location filter — corrected from the handoff

The initial handoff proposed `locatie=22,23,24,85,86,87,110` (7 term IDs). **Live
verification against `/wp-json/wp/v2/locatie?per_page=100` found 18 total location terms,
including two genuine Luxembourg locations missing from that list: Wiltz (80) and Mersch
(113).** The corrected, verified set used by `LU_LOCATION_IDS` in `helpers.ts`:

| id | name |
|---|---|
| 22 | Luxembourg |
| 23 | Luxembourg-city |
| 24 | Grevenmacher |
| 80 | Wiltz |
| 85 | Esch-sur-Alzette |
| 86 | Capellen |
| 87 | Diekirch |
| 110 | Clervaux |
| 113 | Mersch |

(Non-Luxembourg terms present in the same taxonomy, for reference: België/Belgium(16),
Brussel(19), France(27), Limburg(36), Oost-Vlaanderen(21), Paris(28), Vlaams-Brabant(82),
West-Vlaanderen(17), Antwerpen(18).)

This is a **curated business classification** (which taxonomy terms count as "Luxembourg"),
not something re-derivable from the term data alone — if the site later adds another
Luxembourg canton as a term (Redange, Vianden, Remich, Echternach are the ones missing even
from this corrected 9), `LU_LOCATION_IDS` will need a manual update. Re-verify against
`/wp-json/wp/v2/locatie?per_page=100&_fields=id,name` if `--lu-only` result counts ever look
suspiciously low.

## `contract-type` taxonomy (verified live)

| id | name |
|---|---|
| 7 | Permanent |
| 30 | interim |
| 31 | projectbasis |
| 29 | Tijdelijk werk |
| 33 | Contract |
| 35 | Tijdelik werk |
| 108 | Tijdelik werk, interim, projectbasis |
| 114 | Interim met optie "vast werk" |

## `industrie` taxonomy (verified live, partial — 17 terms total)

Includes: Accounting(9), Fiduciary(10), Finance(8), Tax(123), Legal(11), Banking(20),
Controlling(26), Financial Management(34), Consultancy(90), M&A(120), and others. Full list
fetched live via `/wp-json/wp/v2/industrie?per_page=100`.

## Detail

```
GET https://legrand-associates.com/wp-json/wp/v2/job/<id>
    ?_fields=id,slug,link,date,title,content,locatie,industrie,contract-type
```

Same field shapes as a search result, single object instead of an array, plus the full
`content.rendered` HTML body. **`id` must be the numeric WordPress post id** (e.g. `9837`),
never the slug — verified that slugs get deduplicated with `-2`/`-5`/`-7`/`-3` suffixes
across postings (e.g. `accountant-az-met-wagen-3`), so there's no reliable way to recover
the numeric id from a bare slug/URL without already having fetched it from a search result.

**No distinct company field** — `employer`/similar isn't present anywhere in the schema;
every posting is anonymized. `company` is hard-coded to `"Le Grand & Associates"`.

**No distinct apply-link field** — the job's own `link` doubles as `applyUrl`; the
application form lives on that page itself.

## Notes

- No authentication required; no crawl-delay declared in `robots.txt`.
- Taxonomy id→name maps (`locatie`, `contract-type`, `industrie`) are fetched live on every
  `search`/`detail` call rather than hard-coded, so label changes on the site are picked up
  automatically — the only hard-coded piece is the curated `LU_LOCATION_IDS` business
  classification above.
- Fallback data source if this API ever breaks: `/job-sitemap.xml` (~410 URLs with
  `lastmod`) — noted in the handoff, not used by this skill since the REST API already
  covers everything the sitemap would (and more, with real field data).
