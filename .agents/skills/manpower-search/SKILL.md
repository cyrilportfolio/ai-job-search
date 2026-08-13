---
name: manpower-search
version: 1.0.0
description: >
  Use this skill to search live job listings on manpower.lu, the Luxembourg site of the
  Manpower staffing agency, covering interim, CDD, and CDI positions across Luxembourg.
  Trigger phrases: manpower, manpower luxembourg, interim jobs Luxembourg, intérim
  Luxembourg, emploi intérimaire, mission intérim, agence d'intérim Luxembourg, CDD
  Luxembourg, temporary jobs Luxembourg, staffing agency Luxembourg.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/manpower-search/cli/src/cli.ts *)
---

# manpower.lu Search Skill

Search live job listings from manpower.lu's public pages for the Luxembourg interim/CDD/CDI
market (**French postings** — see the language note below). No authentication, no API key,
**zero runtime dependencies** — runs with just `bun`.

## Query language: French, not fr/en

Search in **French**. Verified live 2026-08-13: `search -q "comptable"` returns 5 real
results, `search -q "accountant"` returns 0. There is also no separate English site to fall
back to — `/en/jobs/` 301-redirects to `/jobs-2/`, which itself redirects back to
`/fr/offres/` (the French listing), confirmed the same day. An earlier version of this file
said "fr/en postings", assuming an English variant existed alongside `/fr/jobs/`; that was
never actually verified and turned out to be wrong on both counts.

## Two search modes (read this before using `--query`)

Unlike `alleyesonme-search` (whose `?q=` turned out to be decorative), manpower.lu's own
search — `?s=<query>&post_type=jobs` — genuinely filters server-side. This was verified live
on 2026-08-12: a nonsense query returns zero results, and real queries return only matching
postings (see `url-reference.md`).

The catch: that search endpoint **does not paginate**. It returns a single,
WordPress-relevance-capped batch (observed up to 10 results), with no way to page further.
So `search` here has two modes:

- **`--query` set** → one request to the real search endpoint. Fast, genuinely filtered,
  but capped at whatever WordPress decides is the top batch. `--page`/`--scan-pages` are
  ignored in this mode (there's nothing to paginate).
- **`--query` omitted** → scans the paginated archive instead (`/fr/jobs/`,
  `/fr/jobs/page/N/`), sorted newest-first, controlled by `--page`/`--scan-pages`/`--jobage`
  the same way `alleyesonme-search` does. Use this for exhaustive coverage of a smaller,
  well-defined recent window rather than a single relevance-capped keyword batch.

`--jobage <days>` works in both modes: in query mode it just filters the returned batch by
date; without `--query`, it also bounds the archive scan (stops early once a page's oldest
posting falls outside the window, since the listing is sorted newest-first).

## Commands

### Search job listings

```bash
bun run .agents/skills/manpower-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — server-side full-text search (title + description). Single
  batch only, see above.
- `--jobage <days>` — only jobs posted within N days.
- `--page <n>` — 1-indexed starting page for the archive scan (ignored with `--query`). Default 1.
- `--scan-pages <n>` — archive pages to fetch, starting at `--page` (ignored with `--query`).
  Default 5, or up to 12 (the whole site) when `--jobage` is set without this flag.
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side), applied after scanning.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/manpower-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the `<numeric>-<slug>` id from `search` results (e.g.
`15170-office-manager-junior-support-comptable-m-f-x`), or a full `manpower.lu/.../jobs/...`
URL. Returns the full description and employment type (Temporary/Permanent/etc.). There is
no static apply URL — the job page embeds a file-upload application form; the returned `url`
is where to apply.

## Usage examples

```bash
# Accounting roles, server-side search
bun run .agents/skills/manpower-search/cli/src/cli.ts search -q "comptable" --format table

# Technician roles posted in the last 30 days
bun run .agents/skills/manpower-search/cli/src/cli.ts search -q "technicien" --jobage 30 --format table

# Browse the archive with no filter (3 pages ≈ 30 newest listings)
bun run .agents/skills/manpower-search/cli/src/cli.ts search --scan-pages 3 --format table

# Full detail for a specific job
bun run .agents/skills/manpower-search/cli/src/cli.ts detail 15170-office-manager-junior-support-comptable-m-f-x --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning (also prints which mode ran and, for archive scans, the page range) |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- `robots.txt` allows everything (`Disallow:` is empty) — no facet/path guard is needed here,
  unlike `alleyesonme-search`.
- `company` is always `null` — postings are agency-mediated and the end client is usually
  anonymized in the description text rather than named as a distinct field.
- Data is from manpower.lu's public server-rendered pages — no credentials required.
- The CLI backs off with exponential delay on 429/5xx responses. Keep volume low regardless —
  the default `--scan-pages 5` and the 12-page cap (the whole site) exist for this reason.
- Job IDs are `<numeric>-<slug>` (e.g. `15170-office-manager-junior-support-comptable-m-f-x`) —
  pass them as-is to `detail`.
- No English version of the site exists — `/en/jobs/` redirects (301) to `/jobs-2/`, which
  redirects again to `/fr/offres/`, the same French listing. Confirmed live 2026-08-13.
