---
name: randstad-search
version: 1.0.0
description: >
  Use this skill to search live job listings on randstad.lu, the Luxembourg site of the
  Randstad staffing agency (interim, CDD, CDI). Trigger phrases: randstad, randstad
  luxembourg, interim jobs Luxembourg, intérim Luxembourg, emploi intérimaire, mission
  intérim, agence d'intérim Luxembourg, temporary jobs Luxembourg, staffing agency
  Luxembourg.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/randstad-search/cli/src/cli.ts *)
---

# randstad.lu Search Skill

Search live job listings from randstad.lu's public pages for the Luxembourg interim/CDD/CDI
market (143 listings at generation time). No authentication, no API key, **zero runtime
dependencies** — runs with just `bun`.

## ⚠️ Personal use only

`robots.txt` allows general crawling (`Allow: /`) but explicitly disallows several
faceted-search URL patterns — multi-filter combinations, radius search, a handful of
URL-facet prefixes, and the apply-form path. This skill's CLI never constructs any of those
URLs, and additionally hard-blocks them in code (`assertAllowedUrl`, called on every fetch)
so a future change can't accidentally do so either — **this guard must never be disabled or
bypassed, including temporarily for a test**, per explicit instruction when this skill was
generated. Keep request volume low and don't use this for bulk data collection.

## Commands

### Search job listings

```bash
bun run .agents/skills/randstad-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword. **Single words only** — multi-word queries were
  tested three different ways (space, dash, `+` encodings) and none returned results; treat
  multi-word `--query` as unsupported (see `url-reference.md` for the full test record).
- `--jobage <days>` — only jobs posted within N days. Filters the fetched page's own results
  client-side; this portal has no server-side date filter, so it doesn't widen the search.
- `--page <n>` — 1-indexed page (30 results/page). Default 1.
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/randstad-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job id from `search` results (e.g. `47209488`) — the bare number is
enough; the CLI fetches a placeholder-slug URL that the site redirects to the real page
(verified live). Returns the full description, employment type, agency reference number,
application deadline, and a real (but not auto-fetched) apply link.

## Usage examples

```bash
# Accounting roles
bun run .agents/skills/randstad-search/cli/src/cli.ts search -q "comptable" --format table

# Same, posted in the last 14 days
bun run .agents/skills/randstad-search/cli/src/cli.ts search -q "comptable" --jobage 14 --format table

# Browse page 2 of the full listing, no keyword filter
bun run .agents/skills/randstad-search/cli/src/cli.ts search --page 2 --format table

# Full detail for one job
bun run .agents/skills/randstad-search/cli/src/cli.ts detail 47209488 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning (also prints total-match count vs. what's shown) |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Despite being a "search-app" SPA, listing and detail pages both embed reliable structured
  data in the server-rendered HTML — a GTM `dataLayer` object on listings, a schema.org
  `JobPosting` JSON-LD block on detail pages — so this skill parses JSON, not fragile CSS
  selectors, for almost everything.
- `company` defaults to `"Randstad Luxembourg"` when no distinct employer is named — Randstad
  posts on behalf of clients that are often anonymized in the listing itself.
- Job IDs are plain numbers (e.g. `47209488`) — pass them as-is to `detail`.
