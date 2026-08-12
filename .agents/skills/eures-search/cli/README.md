# eures-cli

CLI for [EURES](https://europa.eu/eures) (europa.eu/eures), the European Union's official
job-mobility portal — an aggregator pulling postings from national job boards across the
EU/EEA (~2.8M live listings at generation time).

**Data source**: EURES's public, anonymous JSON API (`POST .../jv-search/search`,
`GET .../jv/id/<id>`). No scraping — this is a real API, not HTML parsing.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Every request waits 10 seconds since the last one, unconditionally.** `robots.txt` sets
> `Crawl-delay: 10` for this host. This is hard-coded in `src/helpers.ts` and persisted
> across separate CLI invocations (via a small file in the OS temp dir), so running `search`
> immediately followed by `detail` still respects the gap. There is no flag to shorten or
> disable it — this was an explicit requirement when the skill was generated, not an
> incidental default. **Do not remove or weaken it.**

## Installation

```bash
cd .agents/skills/eures-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Full-text keyword search, optionally filtered by country and freshness |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json\|table\|plain` (default `json`); `detail` accepts `--format json\|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# Accounting roles in Luxembourg
bun run src/cli.ts search -q "comptable" -c lu --format table

# Developer roles in Luxembourg or France, posted in the last week
bun run src/cli.ts search -q "developer" -c lu,fr --jobage 7 --format table

# Browse Luxembourg postings with no keyword filter
bun run src/cli.ts search -c lu --format table

# Full detail for one job
bun run src/cli.ts detail NTkxNjkzNCA5 --format plain
```

See `../SKILL.md` for the full flag reference.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | EU-wide full-text keyword search (title + description). Optional. |
| `--country` | `-c` | ISO alpha-2 code(s), comma-separated (`lu`, `lu,fr`). Case-insensitive. Omit for EU-wide. |
| `--jobage` | | Maps to the nearest EURES bucket: ≤1d/≤7d/≤30d/none — see `../url-reference.md`. |
| `--page` | | 1-indexed page. |
| `--limit` | `-n` | Results per page (max 50). Default 10. |
| `--lang` | | Response language for title/description. Default `fr`. |
| `--format` | | `json` \| `table` \| `plain`. |

## Notes

- `applyUrl` (in `detail` output) is a real, static link extracted from the posting's
  `applicationInstructions` field when present — this API actually provides one, unlike
  `alleyesonme-search` and `manpower-search`.
- EURES is an aggregator: `detail`'s `source` field names the originating board (e.g.
  `"MOOVIJOB"`) for the sampled posting used during generation — useful context, since the
  same job may also be found directly on its origin site.
