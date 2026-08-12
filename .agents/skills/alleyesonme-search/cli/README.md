# alleyesonme-cli

CLI for searching jobs on [alleyesonme.jobs](https://alleyesonme.jobs), a Luxembourg job board
(fr/en, ~3,150 listings).

**Data source**: public listing (`/jobs`, `/jobs/page/N`) and detail (`/jobs/<slug>`) pages.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **The site's own `?q=` filter does not work server-side.** Verified live 2026-08-12:
> `?q=comptable`, `?search=comptable`, `?keyword=comptable`, and seven other parameter-name
> guesses all returned the exact same listing as no query at all — filtering happens
> client-side (JS) after the page loads, which a plain HTTP fetch never triggers. `search`
> works around this by scanning a bounded run of pages (newest-first) and filtering locally
> on title/company. See `../url-reference.md` for the full investigation.

## Installation

```bash
cd .agents/skills/alleyesonme-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Scan the listing (optionally filtered by `--query`/`--jobage`) |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json\|table\|plain` (default `json`); `detail` accepts `--format json\|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Accounting roles (title/company match), table view
bun run src/cli.ts search -q "comptable" --format table

# Developer roles posted in the last 14 days
bun run src/cli.ts search -q "developer" --jobage 14 --format table

# Just browse the 10 newest pages, no filter
bun run src/cli.ts search --scan-pages 10 --format table

# Full detail for one job
bun run src/cli.ts detail financial-controller-m-f-luxin-ab7f81 --format plain
```

See `../SKILL.md` for the full flag reference and the scanning-model explanation.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Match against title/company (client-side scan, not the site's own filter). |
| `--jobage` | | Posted within N days. Scanning stops once a page's oldest posting falls outside this window. |
| `--page` | | 1-indexed starting page. Default 1. |
| `--scan-pages` | | Pages to fetch, starting at `--page`. Default 5 (30 if `--jobage` is set without this flag). |
| `--limit` | `-n` | Cap results emitted, applied after scanning. |
| `--format` | | `json` \| `table` \| `plain`. |

## robots.txt guardrail

`assertAllowedUrl` in `src/helpers.ts` refuses to fetch any URL whose path contains
`/admin/`, `/contractType/`, `/employment/`, `/degree/`, `/exp/`, `/workplace/`, or `/size/`
— the facets `robots.txt` disallows. This CLI has no flags that would construct such a URL,
and the guard runs unconditionally inside `htmlFetch` so it can't be bypassed by a future
change to this file without also deleting the check itself. **Do not remove or weaken it.**
