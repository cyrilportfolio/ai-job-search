# manpower-cli

CLI for searching jobs on [manpower.lu](https://manpower.lu), the Luxembourg site of the
Manpower staffing agency (interim, CDD, CDI — ~113 live listings).

**Data source**: public archive (`/fr/jobs/`, `/fr/jobs/page/N/`), search (`/?s=<q>&post_type=jobs`),
and detail (`/fr/jobs/<id>-<slug>/`) pages. WordPress + the Matador Jobs plugin (Bullhorn ATS
backend); no JSON API is exposed for the jobs post type.
**Authentication**: None required. `robots.txt` allows everything (`Disallow:` is empty).
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **`--query` uses the site's real search, but it doesn't paginate.** Verified live
> 2026-08-12: `?s=<term>&post_type=jobs` genuinely filters server-side (a nonsense term
> returns zero results, a real term returns only matching postings) — unlike
> `alleyesonme-search`'s decorative `?q=`. But the results page carries no page-numbers nav,
> so it's a single WordPress-relevance-capped batch (observed up to 10). Omit `--query` to
> scan the paginated archive instead. See `../url-reference.md`.

## Installation

```bash
cd .agents/skills/manpower-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Server-side keyword search, or an archive scan when `--query` is omitted |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json\|table\|plain` (default `json`); `detail` accepts `--format json\|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Accounting roles, server-side search
bun run src/cli.ts search -q "comptable" --format table

# Technician roles posted in the last 30 days
bun run src/cli.ts search -q "technicien" --jobage 30 --format table

# Browse the archive, no filter
bun run src/cli.ts search --scan-pages 3 --format table

# Full detail for one job
bun run src/cli.ts detail 15170-office-manager-junior-support-comptable-m-f-x --format plain
```

See `../SKILL.md` for the full flag reference and the search-vs-archive-scan explanation.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Server-side full-text search. Single batch only — `--page`/`--scan-pages` are ignored when set. |
| `--jobage` | | Posted within N days. Without `--query`, also bounds the archive scan. |
| `--page` | | 1-indexed starting page for the archive scan (ignored with `--query`). |
| `--scan-pages` | | Archive pages to fetch, starting at `--page` (ignored with `--query`). |
| `--limit` | `-n` | Cap results emitted, applied after scanning. |
| `--format` | | `json` \| `table` \| `plain`. |

## Notes

- `company` is always `null` — Manpower postings are agency-mediated and the end client is
  usually anonymized in the description ("notre client, ..."), never named as a distinct field.
- `applyUrl` is always `null` — the job page embeds a multipart file-upload form
  (`POST /fr/matador/api/application/`) rather than a static apply link; this CLI does not
  submit it. Point users at the job's `url` to apply manually.
