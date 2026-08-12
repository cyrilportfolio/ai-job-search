# legrand-cli

CLI for [Le Grand & Associates](https://legrand-associates.com), a Belgium/Luxembourg
accounting & fiduciary recruitment firm — ~410 postings, ~9-32 of them in Luxembourg
locations.

**Data source**: the site's public WordPress REST API (`/wp-json/wp/v2/job` custom post
type, plus `locatie`/`contract-type`/`industrie` taxonomy endpoints for human-readable
labels). No HTML scraping.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **⚠️ Known WAF behavior — two independent causes, both confirmed.** `robots.txt`
> explicitly permits `/wp-json/*`, but the site's WAF (SiteGround) can still reject a
> request: (1) a browser-impersonating User-Agent like `"Mozilla/5.0 (compatible; ...)"` —
> a controlled A/B test on 2026-08-12 showed that exact pattern getting a 403 while
> `"legrand-search-cli/1.0 (personal job search)"` (what this CLI uses) got 200 for an
> identical request; and (2) IP/request-volume reputation — repeated requests to this domain
> from the same origin in a short window can trigger a captcha redirect
> (`/.well-known/sgcaptcha/...`) even with the honest UA. If you see `code: "WAF_BLOCKED"`,
> wait and retry at lower volume — it isn't necessarily a site policy change or a broken
> parser. See `../url-reference.md` for the full investigation.

## Installation

```bash
cd .agents/skills/legrand-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Full-text search, optionally restricted to Luxembourg locations and/or a freshness window |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json\|table\|plain` (default `json`); `detail` accepts `--format json\|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
# English query (matches Belgium's Dutch/English-titled postings)
bun run src/cli.ts search -q "accountant" --format table

# French query, restricted to Luxembourg locations
bun run src/cli.ts search -q "comptable" --lu-only --format table

# Luxembourg postings from the last 14 days, any title
bun run src/cli.ts search --lu-only --jobage 14 --format table

# Full detail for one job (numeric id, not the slug)
bun run src/cli.ts detail 9837 --format plain
```

See `../SKILL.md` for the full flag reference and the language-mismatch note.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Full-text search (title + content). LU postings are French-titled, BE postings Dutch/English — pick your query language accordingly. |
| `--lu-only` | | Restrict to the 9 verified Luxembourg location terms (see `../url-reference.md`). |
| `--jobage` | | Posted within N days — a real server-side filter (WordPress's standard `after` param). |
| `--page` | | 1-indexed page. |
| `--limit` | `-n` | Results per page (also caps client-side), max 100. |
| `--format` | | `json` \| `table` \| `plain`. |

## Notes

- `company` is always `"Le Grand & Associates"` — the end client is never named on any
  posting; the firm anonymizes every listing.
- `detail <id>` needs the **numeric WP post id** (e.g. `9837`), not the URL slug — slugs get
  deduplicated with `-2`/`-5`/`-7` suffixes and don't map back to an id.
- `applyUrl` in `detail` output is the job's own page URL — the site's apply form lives on
  that page itself, there's no separate application endpoint.
