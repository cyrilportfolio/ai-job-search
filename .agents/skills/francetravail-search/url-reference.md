# France Travail Partner API Reference

Official, OAuth2-gated partner API (`api.francetravail.io`) documented at
`francetravail.io/data/api/offres-emploi`. Not scraping — this is a real, credentialed REST
API. All findings below were independently verified live against the production API on
**2026-08-13**, using the credentials already configured in this environment
(`FRANCETRAVAIL_API_TOKEN`). A prior handoff document claimed this reconnaissance was already
complete and asked that it not be redone; it was redone anyway per this generator's own
Step 2/2.4 protocol, and two of its claims turned out to be wrong (see "Corrections" below) —
independent verification is not optional even when a handoff insists it already happened.

## robots.txt — settled, not a gray area

```
$ curl -s https://api.francetravail.io/robots.txt
User-Agent: *
Disallow: /
```

`api.francetravail.io` — the exact host serving `/search`, `/offres/{id}`, and
`/referentiel/*` — carries a blanket `Disallow: /` for all user agents. **This does not apply
to this CLI, and here is why, so no future session re-litigates it.**

The robots exclusion protocol governs crawlers that discover content by following links; it
predates OAuth-secured REST APIs and was never written for them. A blanket `Disallow` on an
API host means "don't index my JSON responses as a website." Access here is explicit and
named: registration in France Travail's partner program, acceptance of its terms, and
issuance of a `client_id`/`client_secret` for these exact endpoints, backed by public
documentation and published quotas. That specific, credentialed consent overrides a generic
crawler directive.

The repo's underlying principle is unchanged: **the specific signal from the infrastructure
governs.** On `alleyesonme-search`/`jobslu-search`/`moovijob`/`legrand-search`
(2026-08-12–13) that signal said no despite a permissive-looking `robots.txt`, and the
decision was to stand down. Here it says yes despite a restrictive `robots.txt`, and the
decision is to proceed. The operative compliance constraint for this skill is not
`robots.txt` — it's the published **4 requests/second per application** ceiling, which is
hard-coded in `cli/src/helpers.ts` and has no flag to disable.

`entreprise.francetravail.fr` (the OAuth token host) and `francetravail.io` (the docs/dev
portal) are different hosts with their own `robots.txt`; `francetravail.io` only disallows
`/oauth2/` and `/api-peio/`, neither of which this CLI touches.

## Authentication

```
POST https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
client_id=<from FRANCETRAVAIL_API_TOKEN, part before the first ":">
client_secret=<from FRANCETRAVAIL_API_TOKEN, part after the first ":">
scope=api_offresdemploiv2 o2dsoffre
```

Confirmed live: the scope string needs **no** `application_<client_id>` prefix. Response:

```json
{"access_token":"...","scope":"api_offresdemploiv2 o2dsoffre","token_type":"Bearer","expires_in":1499}
```

Token lifetime observed: 1499s (~25 min). Cached in memory for the process lifetime, refreshed
when expired — never written to disk.

**Gotcha found during this verification, not in the original handoff:** if the value in
`FRANCETRAVAIL_API_TOKEN` has leading/trailing whitespace (e.g. from `export X=$(cat file)`
with a trailing newline), the request fails with `400 {"error":"invalid_client"}` and gives no
hint that whitespace is the cause. `loadCredentials()` in `helpers.ts` trims both halves after
splitting on the first `:`. If you hit `invalid_client` with credentials you believe are
correct, check for stray whitespace first.

## Search

```
GET https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search
Authorization: Bearer <token>
```

Success status is **206 Partial Content** whenever `range` is supplied — confirmed on every
live call made during verification, never an error status for a valid request. Pagination is
via the `Content-Range` response header: `offres 0-9/165` (the number after `/` is the total
match count). There is no `?page=` parameter.

| Parameter | Values | Notes |
|---|---|---|
| `motsCles` | free text | keyword search |
| `paysContinent` | INSEE country/continent code | `99137` = Luxembourg, `991` = Europe (whole continent) |
| `departement` | French département code | e.g. `57` = Moselle |
| `publieeDepuis` | `1`, `3`, `7`, `14`, `31` | **fixed enum, validated server-side** — any other value returns a proper `400 {"codeErreur":"...","message":"Format du paramètre « publieeDepuis » incorrect. 1, 3, 7, 14 ou 31 attendu."}`. Unlike the geography params below, this one fails loudly on bad input. |
| `range` | `<start>-<end>`, 0-indexed | required for pagination |

### The `pays=` trap — confirmed, hard-coded as a refusal

```
GET .../offres/search?motsCles=comptable&pays=99137&range=0-4
→ 206, Content-Range: offres 0-4/22242   (nationwide French fallback, not Luxembourg)
```

`pays=` is **silently ignored** — no error, no warning, just a fallback to an unfiltered
nationwide search. `assertAllowedUrl()` in `helpers.ts` throws before any request containing
`pays=` can be sent, and `tests/smoke.test.ts` has a dedicated test for this.

### Correction to the original handoff: `paysContinents` (plural) is NOT a 404

The handoff claimed `paysContinents` doesn't exist and 404s. Verified live: it returns
**`206`**, with the exact same `22242`-result nationwide fallback as `pays=`:

```
GET .../offres/search?motsCles=comptable&paysContinents=99137&range=0-4
→ 206, Content-Range: offres 0-4/22242
```

This means the real risk isn't one specific misspelled parameter — **this API silently
ignores any unrecognized query-parameter name and falls back to an unfiltered result set,
with no error of any kind.** Given that, `assertAllowedUrl()` doesn't just blocklist
`pays`/`paysContinents`; it **whitelists** the known-good parameter set (`motsCles`,
`paysContinent`, `departement`, `publieeDepuis`, `range`) and refuses to build a request
containing anything outside it. This is stronger than the literal spec ("refuse `pays=`") and
catches the class of bug the spec's own example demonstrates, not just one instance of it.

### Correction to the original handoff: no 150-result cap found

The handoff claimed a hard 150-result-per-search ceiling requiring splitting by département or
date window beyond it. Verified live, this does not hold:

```
motsCles=comptable, paysContinent=99137 (165 total): range=150-160 → 206, real results, Content-Range 150-160/165
motsCles=comptable, departement=57 (239 total):     range=150-155 → 206, real results, Content-Range 150-155/239
motsCles=comptable (22242 total, unfiltered):       range=1000-1005 → 206, real results
                                                      range=3000-3005 → 206, real results
```

No cap was found up to offset 3000. The CLI does not implement automatic département/date-window
splitting, since the premise for needing it wasn't confirmed. If a real ceiling exists further
out than what was probed here (probing further would have meant a lot more live calls for a
number that isn't documented anywhere found so far), `search --page`/`--range` will surface
whatever error the API returns at that point rather than silently truncating — treat that as
new information to add here, not a bug in the CLI.

## Detail

```
GET https://api.francetravail.io/partenaire/offresdemploi/v2/offres/{id}
Authorization: Bearer <token>
```

Returns `200` (not `206` — single resource, no range) with the full offer, including the
complete `description` (already present in full in search results too — no separate
truncated/full distinction was observed). Fields: `id, intitule, description, dateCreation,
dateActualisation, lieuTravail, romeCode, romeLibelle, appellationlibelle, entreprise,
typeContrat, typeContratLibelle, natureContrat, experienceExige, experienceLibelle, salaire,
alternance, contact, nombrePostes, origineOffre, contexteTravail, entrepriseAdaptee,
employeurHandiEngage`.

## `lieuTravail` — two shapes, confirmed

```json
// French offer (departement=57):
{"libelle": "57 - Metz", "latitude": 49.1221, "longitude": 6.195502, "codePostal": "57000", "commune": "57463"}

// Luxembourg offer (paysContinent=99137):
{"libelle": "Luxembourg"}
```

Foreign offers carry **only** `libelle` — no `codePostal`, `commune`, or coordinates. Never
assume `codePostal` is present.

## `origineOffre` — confirmed, present in both search results and detail

```json
{
  "origine": "2",
  "urlOrigine": "https://candidat.francetravail.fr/offres/recherche/detail/5946183",
  "partenaires": [
    {"nom": "MOOVIJOB", "url": "https://www.moovijob.com/offres-emploi/...", "logo": "https://www.francetravail.fr/logos/img/partenaires/moovijob80.png"}
  ]
}
```

`origine="2"` = partner-sourced offer. In a live 5-result Luxembourg "comptable" sample, all 5
were MOOVIJOB-sourced. The CLI exposes both `url` (France Travail's own fiche, `urlOrigine`)
and `applyUrl` (the partner's own URL when present, else same as `url`), plus `partner` (the
partner name) for cross-portal deduplication — as specified.

**MOOVIJOB note:** this repo's [[project-scraping-exclusions]] memory permanently excludes
`moovijob.com` from ever getting its own scraping skill (Cloudflare Managed Challenge,
UA-independent). This skill does not contradict that: it never fetches `moovijob.com` at
all — France Travail's own API is the sole data source, and the MOOVIJOB `applyUrl` is passed
through as inert metadata, feeding the same manual `/apply <url>` flow already used for that
portal's email-alert coverage. No moovijob.com scraping skill is created or implied here.

## Referentials

```
GET https://api.francetravail.io/partenaire/offresdemploi/v2/referentiel/pays
```

197 entries, `{code, libelle}`. Confirmed: `{"code": "99137", "libelle": "Luxembourg"}`. This
is the CLI's one hard-coded default (a stable, government-assigned INSEE code, not looked up
per invocation for performance) — any other `--pays` value the user types is resolved live
against this endpoint (see `helpers.ts::resolvePaysCode`), never against an in-code label
table, per the original instruction not to hardcode country-name resolution.

Note the naming mismatch: the referential endpoint is `pays`, the search parameter is
`paysContinent`; `paysContinents` (as tested above) is not a distinct valid parameter.

## Rate limit

Published: **4 requests/second per application.** Not independently stress-tested (verification
here made roughly a dozen sequential calls with spacing, never approaching that ceiling, so
no 429 was observed either way) — but the CLI enforces a hard 250ms minimum gap between
requests regardless, via a temp-file timestamp persisted across separate CLI invocations
(same pattern as `eures-search`'s crawl-delay). **This is hard-coded and there is no flag to
disable or shorten it**, independent of whether the exact published number is ever
stress-confirmed — throttling costs nothing and the downside of not throttling is real.

## Credentials

`FRANCETRAVAIL_API_TOKEN`, format `client_id:client_secret`, read only from the environment,
trimmed on both halves (see the whitespace gotcha above), never logged, never written to a
flag, README, or fixture. Missing or malformed → exit 1, `{"error":"...","code":"MISSING_CREDENTIALS"}`
on stderr, naming the variable.
