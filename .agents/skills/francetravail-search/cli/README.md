# francetravail-cli

CLI for [France Travail](https://francetravail.io)'s official partner API
(`api.francetravail.io`) — Luxembourg-first job search with Grande Région frontalier coverage
(Moselle, Meurthe-et-Moselle, Meuse, Vosges) via `--departement`.

**Data source**: France Travail's real, documented OAuth2 `client_credentials`-gated REST API.
No scraping.
**Authentication**: Required — `FRANCETRAVAIL_API_TOKEN` env var, `client_id:client_secret`.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev
type defs.

> `api.francetravail.io`'s `robots.txt` carries a blanket `Disallow: /`. This does not apply
> to this CLI — see `../SKILL.md` and `../url-reference.md` for the full, settled reasoning
> (a credentialed partner API registration overrides a generic crawler directive). The real
> constraint is the hard-coded 4 req/s rate limit below, which has no flag to disable.

## Setup

```bash
export FRANCETRAVAIL_API_TOKEN="<client_id>:<client_secret>"
cd .agents/skills/francetravail-search/cli
bun install   # optional — only installs TypeScript dev types
```

Without the env var set, every command exits `1` with
`{"error":"...","code":"MISSING_CREDENTIALS"}` — there is no anonymous fallback.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Keyword search, geography-filtered (Luxembourg by default, or a French département) |
| `detail` | Fetch full detail for a single offer |

`search` accepts `--format json\|table\|plain` (default `json`); `detail` accepts
`--format json\|plain`. All errors are written to **stderr** as
`{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Comptable roles in Luxembourg (the default market)
bun run src/cli.ts search -q "comptable" --format table

# Same, last 7 days only
bun run src/cli.ts search -q "comptable" --jobage 7 --format table

# Grande Région frontalier: Moselle instead of Luxembourg
bun run src/cli.ts search -q "comptable" --departement 57 --format table

# Full detail for one offer
bun run src/cli.ts detail 5946183 --format plain
```

See `../SKILL.md` for the full flag reference.

## Search flags

| Flag | Alias | Description |
|------|-------|--------------|
| `--query` | `-q` | Keyword search (title + description). Optional. |
| `--pays` | | Geography filter, default `lu` (Luxembourg). Numeric code or a name resolved live via `/referentiel/pays`. Mutually exclusive with `--departement`. |
| `--departement` | | French département code (e.g. `57`, `54`, `55`, `88`). Overrides `--pays`. |
| `--jobage` | | Maps to the nearest `publieeDepuis` bucket: `1`, `3`, `7`, `14`, `31` — see `../url-reference.md`. |
| `--page` | | 1-indexed page. |
| `--limit` | `-n` | Results per page. Default 20. |
| `--format` | | `json` \| `table` \| `plain`. |

## Notes

- Success status for `search` is `206 Partial Content`; pagination truth comes from the
  `Content-Range` response header, not a `?page=` parameter.
- `pays=` and `paysContinents=` (plural) are both confirmed to be silently ignored by the API,
  falling back to an unfiltered nationwide search with no error — `assertAllowedUrl()` in
  `src/helpers.ts` whitelists known-good search parameters rather than only blocking those two,
  since the underlying risk is any unrecognized parameter name.
- The dominant partner for Luxembourg-geography results is MOOVIJOB — its URL is exposed as
  `applyUrl`/`partner` metadata (never fetched directly by this CLI), feeding the repo's
  existing manual `/apply <url>` flow.
- Token is cached in memory for the process lifetime only, never written to disk.
