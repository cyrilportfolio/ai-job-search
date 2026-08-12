# randstad-cli

CLI for searching jobs on [randstad.lu](https://www.randstad.lu), the Luxembourg site of the
Randstad staffing agency (143 listings at generation time).

**Data source**: public listing (`/emplois/`, `/emplois/q-<kw>/`, `/emplois/page-<n>/`) and
detail (`/emplois/<slug>_<slug>_<id>/`) pages. Despite being a "search-app" SPA, the
server-rendered HTML embeds two structured, reliable data sources: a GTM `dataLayer` object
on listings (total count + every result's fields) and a schema.org `JobPosting` JSON-LD
block on detail pages (full description, employer, location, deadline). No JSON API, no RSS.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** `robots.txt` allows general crawling (`Allow: /`) but explicitly
> disallows several faceted-search path patterns (multi-filter combinations, radius search,
> a handful of URL-facet prefixes, the apply-form path). This CLI never constructs those
> URLs and additionally hard-blocks them in `assertAllowedUrl` (`src/helpers.ts`), called on
> every fetch — see `../url-reference.md` for the full list. Keep volume low regardless.

## Installation

```bash
cd .agents/skills/randstad-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Keyword search (30 results/page) |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json\|table\|plain` (default `json`); `detail` accepts `--format json\|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Accounting roles
bun run src/cli.ts search -q "comptable" --format table

# Same, posted in the last 14 days
bun run src/cli.ts search -q "comptable" --jobage 14 --format table

# Browse page 2 of the full listing, no keyword
bun run src/cli.ts search --page 2 --format table

# Full detail for one job (bare numeric id is enough)
bun run src/cli.ts detail 47209488 --format plain
```

See `../SKILL.md` for the full flag reference and the multi-word-query caveat.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keyword. Single words verified working; multi-word queries returned zero results across three encodings tested — treat as unsupported. |
| `--jobage` | | Posted within N days. Filters the fetched page's own results only — no server-side date filter exists here. |
| `--page` | | 1-indexed page (30 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Notes

- `detail <id>` only needs the bare numeric id — it fetches a placeholder-slug URL
  (`/emplois/x_x_<id>/`) that the site 301-redirects to the real canonical page, verified live.
- `applyUrl` in `detail` output points at `/emplois/postuler/<id>` — a real link, but
  robots.txt disallows *crawling* it, so this CLI never fetches it itself. It's returned as
  plain output data for a human to open in their own browser.
- `company` defaults to `"Randstad Luxembourg"` when the page doesn't name a distinct
  employer — Randstad is the agency posting on behalf of (often anonymized) clients.
