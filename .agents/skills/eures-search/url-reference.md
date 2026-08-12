# EURES API Reference

Public, anonymous JSON API behind europa.eu/eures — the EU's official job-mobility portal.
No scraping: this is a real backend API (not the SPA's own client-rendered pages).

All findings below were verified live against europa.eu on **2026-08-12**.

## robots.txt (fetched 2026-08-12)

```
User-agent: *
Disallow: /cgi-bin/
Disallow: /eur-lex/     <- unrelated old service, not /eures
Disallow: /archives/
...
Crawl-delay: 10
```

`/eures` is not in any `Disallow` line (confirmed: searched the full robots.txt body for
"eures", zero matches). The blanket `Crawl-delay: 10` under `User-agent: *` does apply,
though — the CLI enforces a hard 10s gap between every request, persisted across separate
process invocations via a temp file (`os.tmpdir()/eures-search-cli-last-request`), so
`search` immediately followed by `detail` still waits. **Never remove or shorten this.**

## Base URL

```
https://europa.eu/eures/api
```

Both `jv-searchengine` and `shared-data-rest-api` live under this prefix — a bare
`/eures/shared-data-rest-api/...` (missing `/api`) 404s.

## Search

```
POST https://europa.eu/eures/api/jv-searchengine/public/jv-search/search
Content-Type: application/json
```

Request body (all fields required by the endpoint; unused ones pass `null`/`[]`):

```json
{
  "resultsPerPage": 10,
  "page": 1,
  "sortSearch": "MOST_RECENT",
  "keywords": [{ "keyword": "comptable", "specificSearchCode": "EVERYWHERE" }],
  "publicationPeriod": null,
  "locationCodes": ["LU"],
  "occupationUris": [], "skillUris": [], "requiredExperienceCodes": [],
  "positionScheduleCodes": [], "sectorCodes": [],
  "educationAndQualificationLevelCodes": [], "positionOfferingCodes": [],
  "euresFlagCodes": [], "otherBenefitsCodes": [], "requiredLanguages": [],
  "minNumberPost": null,
  "sessionId": "<random-uuid>",
  "requestLanguage": "fr"
}
```

`keywords: []` (omitting `--query`) is inferred to mean an unfiltered browse of whatever
`locationCodes` selects — this specific case wasn't exercised live (the mandated test query
was `"comptable"`), so treat it as plausible-but-unverified if it ever needs debugging.

### `locationCodes` casing — resolved

The initial handoff flagged this as unverified: the portal's own URL uses lowercase `"lu"`
while `/reference/countries` returns uppercase `"LU"`. **Both work identically** — verified
live: `locationCodes: ["lu"]` and `locationCodes: ["LU"]` both returned exactly 502 records
for `"comptable"`. The CLI normalizes `--country` input to uppercase (matching the reference
endpoint's own casing) since that's the more "canonical" form, but the API itself is
case-insensitive here.

**Location filtering is real, not decorative** (unlike `alleyesonme-search`'s `?q=`): a
control test with `locationCodes: ["IS"]` (Iceland, where the French term "comptable" should
essentially never appear) returned only 1 record, vs. 502 for `["LU"]` and 32,777 for `["FR"]`.
Multiple country codes combine additively: `["LU","FR"]` → 33,279 ≈ 502 + 32,777 exactly.
Empty `locationCodes: []` → EU-wide, 75,494 records for the same keyword.

### `publicationPeriod` values — resolved

The initial handoff didn't know the accepted values. Tested live against `locationCodes:
["LU"]`, keyword `"comptable"`:

| Value | Records | Notes |
|---|---|---|
| `null` | 502 | no filter |
| `"LAST_MONTH"` | 320 | |
| `"LAST_WEEK"` | 148 | |
| `"LAST_DAY"` | 103 | |
| `"P1D"`, `"P7D"`, `"P30D"`, `"TODAY"` | — | all rejected: `{"key":"invalid-json","message":"The provided JSON is not correct"}` despite being syntactically valid JSON — the error name is misleading; it really means "invalid enum value" |

So `publicationPeriod` is a **fixed three-value enum** (`LAST_DAY` / `LAST_WEEK` /
`LAST_MONTH`), not an arbitrary day count or ISO-8601 duration. `--jobage <days>` maps onto
the nearest bucket that still covers the window: ≤1 → `LAST_DAY`, ≤7 → `LAST_WEEK`, ≤30 →
`LAST_MONTH`, otherwise `null`. This is an approximation, not an exact N-day cutoff — call it
out to the user if precision matters (e.g. `--jobage 3` silently becomes "last week", a wider
window than asked for).

### Response shape

```json
{
  "numberRecords": 502,
  "jvs": [
    {
      "title": "Consultant - support comptabilté communale (H/F)",
      "description": "Notre client, basé au Luxembourg... (plain text, but with raw HTML entities like &amp; inside — decode them)",
      "id": "NTkxNjkzNCA5",
      "creationDate": 1786503662000,
      "lastModificationDate": 1786503662000,
      "numberOfPosts": 1,
      "locationMap": { "LU": [null] },
      "euresFlag": false,
      "jobCategoriesCodes": ["http://data.europa.eu/esco/occupation/..."],
      "positionScheduleCodes": [],
      "positionOfferingCode": "directhire",
      "employer": { "name": "Non renseigné", "legalID": null, "...": "..." },
      "availableLanguages": ["fr"],
      "translationType": "REQUESTED",
      "translations": { "fr": { "title": "...", "description": "..." } }
    }
  ],
  "facets": { "LANGUAGE_SKILLS": "...", "POSITION_LOCATION": "...", "...": "..." }
}
```

Field mapping used by `parseSearchResponse` in `helpers.ts`:

| Output field | Source |
|---|---|
| `id` | `jv.id` — an opaque base64 string, e.g. `base64("5916934 9")` = `reference` + `connectionPointId` joined by a space. May contain `+`/`/` for other jobs even though none of the sampled ids did — always `encodeURIComponent()` it when building a URL. |
| `title` | `jv.title`, HTML-entity-decoded |
| `company` | `jv.employer.name` — frequently the literal placeholder `"Non renseigné"` ("not disclosed"), not an empty value; passed through as-is rather than nulled out, since that's genuinely what the source returned |
| `location` | `Object.keys(jv.locationMap).join(", ")` — country codes only; the per-country array values were `[null]` in every sampled result, so city-level detail isn't reliably available here (see `detail`, which does carry city/region) |
| `date` | `jv.creationDate`, epoch milliseconds → `YYYY-MM-DD` |
| `url` | Best-effort portal deep link (see below) |

`employer.name` being `"Non renseigné"` is common — EURES aggregates from national boards
that themselves often anonymize the employer (same pattern as `manpower-search`).

## Detail

```
GET https://europa.eu/eures/api/jv-searchengine/public/jv/id/<url-encoded id>?requestLang=<lang>
```

Response shape (id `NTkxNjkzNCA5`, `requestLang=fr`):

```json
{
  "id": "NTkxNjkzNCA5",
  "reference": "5916934",
  "documentId": "329275",
  "connectionPointId": 9,
  "source": "MOOVIJOB",
  "creationDate": 1786503662000,
  "lastModificationDate": null,
  "preferredLanguage": "fr",
  "jvProfiles": {
    "fr": {
      "title": "...",
      "description": "...",
      "positionOfferingCode": "directhire",
      "employer": { "name": "Non renseigné", "...": "..." },
      "locations": [{ "countryCode": "lu", "region": null, "cityName": null, "...": "..." }],
      "applicationInstructions": [
        "Pour postuler, utiliser le lien suivant : <a href=\"https://candidat.pole-emploi.fr/offres/recherche/detail/5916934\" target=\"_blank\" rel=\"nofollow\">...</a>"
      ]
    }
  },
  "translationType": "REQUESTED",
  "translation": null
}
```

`source: "MOOVIJOB"` on the sampled job shows EURES is a genuine aggregator here — this
particular Luxembourg posting actually originates from Pôle Emploi (France) via Moovijob,
not from EURES itself; the real apply link resolves to `candidat.pole-emploi.fr`.

Field mapping used by `parseDetailResponse`:

| Output field | Source |
|---|---|
| `title`, `description` | `jvProfiles[lang].title` / `.description`, entity-decoded. If the requested `lang` isn't present, falls back to `preferredLanguage`, then the first available key. |
| `company` | `jvProfiles[lang].employer.name` |
| `location` | Built from `jvProfiles[lang].locations[]` — `cityName`, `region`, `countryCode` (uppercased) joined; entries were mostly `null` city/region in samples, so this often reduces to just the country. |
| `date` | `creationDate` (top-level, not per-profile) |
| `employmentType` | `jvProfiles[lang].positionOfferingCode` (e.g. `"directhire"`) |
| `source` | top-level `source` (originating board name) |
| `applyUrl` | First `href="..."` found inside `applicationInstructions[]` (real HTML embedded in a JSON string field) — a genuine static apply link when the source posting provides one. `null` if absent or unparseable. |

## Human-facing portal URL — best-effort, unverified

`portalUrl()` in `helpers.ts` builds `https://europa.eu/eures/portal/jv-se/jv-details/<id>?lang=<lang>`,
inferred from the API's own `jv-search`/`jv` naming. **This could not be independently
verified**: the public portal is a client-side-rendered SPA (React/Angular) — every path
fetched with plain HTTP, including this one and a `jv-se/details/...` variant, returned an
identical empty-shell HTML document (`<title></title>`, ~69KB of JS bundles) regardless of
the ID in the path, because routing happens entirely in the browser after JS executes. A
plain fetch cannot distinguish "correct deep link" from "wrong path, same SPA shell." If a
user reports this link doesn't resolve to the right job, don't assume the id-encoding logic
regressed — this specific URL format was always a best guess, not a confirmed one. The
verified fallback for programmatic access is always the detail API URL itself.

## Notes

- No authentication required; the mandatory 10s crawl-delay is the only real constraint,
  and it's non-negotiable per the user's explicit instruction when this skill was generated.
- `sessionId` is a client-generated random UUID per request (`crypto.randomUUID()`) — the
  API accepts an arbitrary one; it doesn't appear to require session continuity across calls.
- `--country` accepts multiple comma-separated codes; they combine additively (union), not
  as an intersection.
