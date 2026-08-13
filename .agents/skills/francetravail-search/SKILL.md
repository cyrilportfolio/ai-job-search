---
name: francetravail-search
version: 1.0.0
description: >
  Use this skill to search live job listings from France Travail's official partner API
  (api.francetravail.io), covering France nationwide with a Luxembourg-first default for
  Grande Région frontalier searches (Moselle, Meurthe-et-Moselle, Meuse, Vosges). Requires an
  OAuth2 client_credentials API token. Trigger phrases: France Travail, Pôle Emploi, offres
  d'emploi France, comptable Luxembourg, emploi frontalier, Moselle jobs, Grande Région job
  search, francetravail.io, offres partenaires MOOVIJOB PMEJOB.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/francetravail-search/cli/src/cli.ts *)
---

# France Travail Search Skill

Search live job listings from **France Travail's official, credentialed partner API**
(`api.francetravail.io`) — not scraping, a real documented REST API behind OAuth2
`client_credentials`. Defaults to **Luxembourg** (`paysContinent=99137`); `--departement` lets
you pivot to the French side of the Grande Région (Moselle `57`, Meurthe-et-Moselle `54`,
Meuse `55`, Vosges `88`) without losing that default coverage. Zero runtime dependencies —
`bun install` only pulls TypeScript dev types.

## robots.txt on api.francetravail.io — settled, read before touching this

`api.francetravail.io` (the host every endpoint below lives on) publishes a blanket
`Disallow: /` in `robots.txt`. **This does not block this skill, and this is a closed
question, not one to re-litigate on a future pass.** The robots exclusion protocol governs
crawlers that discover content by following links; it predates OAuth-secured REST APIs and was
never written for them. Access here is explicit, named, and credentialed: registration in
France Travail's own partner program, acceptance of its terms, issuance of a
`client_id`/`client_secret` scoped to these exact endpoints, public documentation, and
published quotas — that specific consent overrides a generic crawler directive. The repo's
underlying principle — the specific signal from the infrastructure governs — said *no* for
`alleyesonme-search`/`jobslu-search`/`moovijob`/`legrand-search` despite permissive-looking
`robots.txt` there; it says *yes* here despite a restrictive one. The real operative
constraint is the published **4 requests/second per application** ceiling, hard-coded below
with no way to disable it. Full reasoning and verification trail: `url-reference.md`.

## Setup (required — this skill needs a credential)

Every call is billed against France Travail's partner API quota for your registered
application (no per-call monetary cost was found in the public docs, but requests do count
against your app's published rate limit — see below).

```bash
export FRANCETRAVAIL_API_TOKEN="<client_id>:<client_secret>"
```

Obtain a `client_id`/`client_secret` pair by registering an application at
`francetravail.io` for the `Recherche d'offres v2` API. Without this variable set, every
command exits `1` with `{"error":"...","code":"MISSING_CREDENTIALS"}` — there is no anonymous
fallback.

## Commands

### Search job listings

```bash
bun run .agents/skills/francetravail-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword search (title + description). Optional.
- `--pays <code|name>` — geography filter. Default `lu` (Luxembourg, `paysContinent=99137`).
  Accepts a raw numeric code directly, or a name resolved live against `/referentiel/pays`
  (never a hardcoded country table). Mutually exclusive with `--departement`.
- `--departement <code>` — French département code (e.g. `57`, `54`, `55`, `88` for the Grande
  Région frontalier départements). Overrides `--pays` for that call.
- `--jobage <days>` — maps to the nearest of France Travail's fixed `publieeDepuis` buckets:
  `1`, `3`, `7`, `14`, `31`. Values above 31 are treated as unfiltered (the API rejects
  anything outside that enum with a `400`).
- `--page <n>` — 1-indexed page.
- `--limit <n>` / `-n <n>` — results per page (also the client-side cap). Default `20`.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/francetravail-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric France Travail offer id from `search` results, or a
`candidat.francetravail.fr/offres/recherche/detail/<id>` URL. Returns the full description,
contract type, experience required, salary, contact, and both the France Travail fiche URL
and the originating partner's own apply URL when the offer is partner-sourced.

## Usage examples

```bash
# Default: comptable roles in Luxembourg (the skill's default market)
bun run .agents/skills/francetravail-search/cli/src/cli.ts search -q "comptable" --format table

# Same search restricted to postings from the last 7 days
bun run .agents/skills/francetravail-search/cli/src/cli.ts search -q "comptable" --jobage 7 --format table

# Grande Région frontalier: Moselle (French side) instead of Luxembourg
bun run .agents/skills/francetravail-search/cli/src/cli.ts search -q "comptable" --departement 57 --format table

# Second page, 10 per page
bun run .agents/skills/francetravail-search/cli/src/cli.ts search -q "comptable" --page 2 --limit 10 --format table

# Full detail for a specific offer
bun run .agents/skills/francetravail-search/cli/src/cli.ts detail 5946183 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process
exits with code `1`.

## Notes

- Success status for `search` is `206 Partial Content` (never an error) — pagination truth
  comes from the `Content-Range` response header, parsed internally.
- `pays=` and `paysContinents=` are both confirmed traps: this API silently ignores unknown
  query-parameter names and falls back to an unfiltered nationwide search rather than erroring.
  The CLI whitelists known-good parameter names rather than merely blocking `pays=`, and
  `tests/smoke.test.ts` has a dedicated regression test for this.
- No 150-result search cap was found live (verified past offset 3000) despite an earlier claim
  to the contrary — see `url-reference.md` for the full correction.
- The dominant partner for Luxembourg-geography results is **MOOVIJOB**. This skill never
  fetches `moovijob.com` itself — the partner URL is passed through as metadata from France
  Travail's own API response, feeding the existing manual `/apply <url>` flow. This does not
  conflict with the repo's standing exclusion of a dedicated `moovijob-search` scraping skill.
- Rate limit: hard-coded 4 requests/second per application (250ms minimum gap between calls,
  persisted across separate CLI invocations). Not configurable, by design.
- Token is cached in memory for the process lifetime only — never written to disk.
