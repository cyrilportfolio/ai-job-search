# randstad.lu URL Reference

Public, unauthenticated, server-rendered pages (a "search-app" SPA shell, but the SEO
pre-rendered HTML genuinely contains the job data — no headless browser needed). No JSON
API, no RSS.

All findings below were verified live against randstad.lu on **2026-08-12**.

## robots.txt (fetched 2026-08-12)

```
User-agent: *
Allow: /

Disallow: /*/km-              Disallow: /*/postcode-        Disallow: /*/sa-
Disallow: /*/qt-              Disallow: /*search=           Disallow: /*search-app/demo/jobs/
Disallow: /*jobs/mvp/         Disallow: /emplois/*,*/       Disallow: /en/jobs/*,*/
Disallow: /*/sd-              Disallow: /*/sh-              Disallow: /*/sm-
Disallow: /*/?id=*            Disallow: /*/mpage-           Disallow: /emplois/radius
Disallow: /en/jobs/radius     Disallow: /radius-search/     Disallow: /*/radius-search/
Disallow: /emplois/postuler/  Disallow: /*/apply/
Disallow: /*/?c-career-advice /*/?c-category /*/?c-wf360-category /*/?c-tags /*/?c-press-category
Disallow: /taxonomy/term/     Disallow: /en/taxonomy/term/  Disallow: /*/profile-
Disallow: /node/              Disallow: /*/node/

Sitemap: https://www.randstad.lu/sitemaps/sitemap.xml
```

`Allow: /` covers general crawling; the disallows above target faceted-search filter
combinations (multi-filter, radius, several URL-facet prefixes), the apply-form path, blog
taxonomy, and CMS profile pages — not the plain listing/search/detail paths this skill uses.

`assertAllowedUrl` in `cli/src/helpers.ts` hard-blocks every pattern above, called
unconditionally inside `htmlFetch`. This CLI's own URL construction (`/emplois/`,
`/emplois/q-<kw>/`, `/emplois/page-<n>/`, `/emplois/x_x_<id>/`) can never collide with any of
them, but the guard exists regardless as a hard stop against a future change accidentally
doing so. **Never remove, weaken, or bypass it — including temporarily for a test** — per
the user's explicit instruction when this skill was generated.

## Listing / search

```
GET https://www.randstad.lu/emplois/
GET https://www.randstad.lu/emplois/q-<keyword>/
GET https://www.randstad.lu/emplois/page-<n>/              (n >= 2)
GET https://www.randstad.lu/emplois/q-<keyword>/page-<n>/  (combines; verified)
```

**Page size is 30, not 60.** The initial handoff estimated "60/page" from "143 offres,
60/page" — live testing shows 30 results on page 1, 30 on page 2 (unfiltered listing,
`search_result_amount: 143` both times), so ⌈143/30⌉ = 5 pages, not the ~3 implied by 60/page.

**Total-count display, verified:** the page's `<h1 class="sortbar__count">` reads e.g. "6
offres d'emploi Comptable trouvées" (matches the handoff's "143 offres d'emploi trouvées"
pattern) — but the far more reliable source is the embedded `dataLayer` JSON below, which
gives the exact count as a number rather than requiring French-text parsing.

**Multi-word `--query` does not work**, tested three ways against `/emplois/q-<...>/`:
- `%20`-encoded space (`q-assistant%20administratif`) → HTTP 410, 0 results, though the
  dataLayer's `search_result_keyword` did correctly read back as the two-word string.
- Dash-joined (`q-comptable-senior`) → HTTP 410, 0 results; the dash was NOT treated as a
  word separator — `search_result_keyword` came back as the single literal token
  `"comptable-senior"`.
- `+`-encoded (`q-assistant+administratif`) → HTTP 410, 0 results; `+` has no special
  meaning in a path segment, so `search_result_keyword` read back as one literal token.

Single-word queries (the mandated test query, `"comptable"`) work correctly (HTTP 200, 6
real results). Treat multi-word `--query` as unsupported until someone finds the actual
mechanism — don't assume the CLI is broken if it returns 0 results for a multi-word query;
this is the site's own behavior, reproduced three different ways.

### Embedded listing data (`const data = {...}`)

Every listing page embeds a GTM `dataLayer` object as a plain (non-JSON-LD) inline script.
It parses as valid JSON once the `const data = ` prefix and trailing `;` are stripped:

```json
{
  "page": {
    "search_results": {
      "search_result_amount": 6,
      "search_result_page": 1,
      "search_result_keyword": "comptable"
    }
  },
  "ecommerce": {
    "impressions": [
      {
        "job_title": "Comptable Fournisseur (M/F/D) - (intérim en vue d'embauche)",
        "job_id": "47209488",
        "category": "Services administratifs",
        "operating_company": "Randstad Luxembourg",
        "employment_type": "mission en vue d'embauche",
        "city": "Luxembourg Sud",
        "region": "",
        "reference_number": "25576",
        "url": "/emplois/comptable-fournisseur-mfd-interim-en-vue-dembauche_luxembourg-sud_47209488/",
        "launch_date": "2026-07-28"
      }
    ]
  }
}
```

Field mapping used by `parseListingPage`:

| Output field | Source |
|---|---|
| `id` | `job_id` |
| `title` | `job_title` |
| `company` | `operating_company`, falls back to `"Randstad Luxembourg"` |
| `location` | `city` + `region` (joined, region dropped if empty or identical to city) |
| `date` | `launch_date` — already `YYYY-MM-DD`, no parsing needed |
| `url` | `BASE_URL + url` |

`page.search_results.search_result_amount` is the total match count across the whole site
for the query (not just the current page) — used as `meta.count`.

## Detail

```
GET https://www.randstad.lu/emplois/<any-slug-text>_<any-slug-text>_<id>/
```

**Verified quirk: the slug text doesn't need to be correct.** `GET
/emplois/x_x_47209488/` → HTTP 301 → `Location: /emplois/comptable-fournisseur-...-47209488/`
— the site resolves purely on the trailing numeric id and redirects to the canonical
fully-slugged URL. `detailUrl(id)` in `helpers.ts` exploits this, so `detail` only ever needs
the bare numeric id from a `search` result, never the full slug. (A bare `/emplois/<id>/`
with no slug segments at all does **not** work — tested, HTTP 410 — the three-segment
`_..._<id>` shape is required, even with placeholder text.)

### Embedded detail data (schema.org JSON-LD)

Detail pages embed a `JobPosting` block — note the **single-quoted** `type` attribute,
which a naive `type="application/ld+json"` regex will miss:

```html
<script type='application/ld+json'>{"@context":"http://schema.org","@type":"JobPosting","description":"<p>...</p>","employmentType":"TEMPORARY","hiringOrganization":{"name":"Randstad"},"identifier":{"value":"25576"},"jobLocation":{"address":{"addressLocality":"Luxembourg Sud"}},"datePosted":"2026-07-28T07:38:18+0000","validThrough":"2026-09-25T00:00:00+0000","title":"..."}</script>
```

A second `BreadcrumbList` JSON-LD block is also present on the page — `parseDetailPage`
checks each script's `@type` and picks the `JobPosting` one.

**Do not use the visible `body-copy`/`collapsible__content` HTML blocks for the
description** — they're duplicated 3× across responsive breakpoints (mobile/tablet/desktop
variants of the same content all present in the static HTML at once), so naive extraction
would triple the text. The JSON-LD `description` field is a single clean copy.

Field mapping used by `parseDetailPage`:

| Output field | Source |
|---|---|
| `title` | `title` |
| `company` | `hiringOrganization.name`, falls back to `"Randstad Luxembourg"` |
| `location` | `jobLocation.address.addressLocality` |
| `date` | `datePosted`, sliced to `YYYY-MM-DD` |
| `description` | `description` (HTML with `<p>`/`<br>`), converted to plain text with paragraph breaks preserved |
| `employmentType` | `employmentType` (e.g. `"TEMPORARY"`) |
| `reference` | `identifier.value` (e.g. `"25576"`) — note this differs from `job_id`/the URL id (`"47209488"`); it's the agency's own internal reference |
| `deadline` | `validThrough`, sliced to `YYYY-MM-DD` |
| `applyUrl` | Constructed as `BASE_URL + /emplois/postuler/<id>` — a real, working link (confirmed present as `id="jobApplyButton"` on the rendered page), but **never fetched by this CLI** since robots.txt disallows crawling it |

## Notes

- No authentication required.
- `--jobage` has no server-side equivalent here — it's a client-side filter over whatever
  page was fetched, not a search-wide narrowing (contrast with `alleyesonme-search`'s
  scan-and-stop approach, which wasn't needed here given the site's total size is small:
  143 listings / 30 per page = 5 pages max).
- Personal-use warning carried in `SKILL.md` per the portal-skill contract, even though
  `robots.txt`'s `Allow: /` doesn't strictly require one — matches the cautious default this
  fork applies to all Luxembourg staffing-agency portals.
