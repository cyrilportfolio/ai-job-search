# greenfield-cli

CLI for [Greenfield Group](https://www.greenfield.lu), a Luxembourg recruitment firm — ~18
open postings, all Luxembourg-market roles.

**Data source**: `sitemap.xml` for URL enumeration (the `/job-search` listing page is
client-rendered and always returns "Sorry, no jobs available" in raw HTML — no JSON API was
found either), then each detail page's own `JobPosting` JSON-LD block plus a small HTML meta
box. No HTML scraping of a results list — every field comes from a real detail page.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev
type defs.

`robots.txt` is a bare `Allow: /` and `/terms/` 404s — no restriction found, no WAF or
challenge behavior observed during investigation (2026-08-13). Keep request volume low as an
informal courtesy regardless; `search`'s full-scan fetch uses a small concurrency cap for
exactly that reason.

## Installation

```bash
cd .agents/skills/greenfield-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Full local scan of all current postings, filtered by title substring and/or posting age |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json\|table\|plain` (default `json`); `detail` accepts `--format
json\|plain`. All errors are written to **stderr** as `{ "error": "...", "code": "..." }`
with exit code `1`.

## Quick examples

```bash
# All current postings
bun run src/cli.ts search --format table

# English-language query (every posting on this portal is titled in English — see SKILL.md)
bun run src/cli.ts search -q "accountant" --format table

# Posted in the last 30 days
bun run src/cli.ts search -q "compliance" --jobage 30 --format table

# Full detail for one job (its "Job Reference No.")
bun run src/cli.ts detail 670 --format plain
```

See `../SKILL.md` for the full flag reference and the query-language note.

## Search flags

| Flag | Alias | Description |
|------|-------|--------------|
| `--query` | `-q` | Case-insensitive substring match against the title only — no server-side search exists on this portal. |
| `--jobage` | | Posted within N days — filters on `datePosted`, client-side (the site's own `validThrough` field isn't a real deadline on most postings). |
| `--limit` | `-n` | Cap results emitted, client-side. |
| `--format` | | `json` \| `table` \| `plain`. |

No `--page` (every call scans all current postings — pagination doesn't apply) and no
`--location` (no server-side location parameter on this portal).

## Notes

- `company` is always `"Greenfield Group"` — every posting is the firm's own listing.
- `id` is the posting's "Job Reference No." (e.g. `670`), not derived by assuming a fixed URL
  pattern — one live posting puts its id at the start of the URL slug instead of the end; see
  `../url-reference.md`.
- `detail`'s `contact` field (recruiter name/email/phone) isn't part of the repo's standard
  portal-skill field set, but is genuinely present on every posting and useful for this
  repo's pre-application call step.
- `applyUrl` in `detail` output is the job's own page URL — the apply form is embedded there
  (a POST-only endpoint, not a browsable link).
