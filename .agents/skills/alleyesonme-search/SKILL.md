---
name: alleyesonme-search
version: 1.0.0
description: >
  Use this skill to search live job listings on alleyesonme.jobs, a Luxembourg job board
  (~3,150 offers, French/English) covering roles across Luxembourg and the Grande Région
  (frontalier-friendly postings included). Trigger phrases: alleyesonme, Luxembourg jobs,
  emploi Luxembourg, offres d'emploi Luxembourg, jobs Luxembourg, recherche d'emploi
  Luxembourg, poste vacant Luxembourg, "job openings in Luxembourg", frontalier jobs.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/alleyesonme-search/cli/src/cli.ts *)
---

# alleyesonme.jobs Search Skill

Search live job listings from alleyesonme.jobs's public pages for the Luxembourg market
(fr/en). No authentication, no API key, **zero runtime dependencies** — runs with just `bun`.

## How search works here (read this before using `--query`)

alleyesonme.jobs's own `?q=` search box does **not** filter results server-side — this was
verified live on 2026-08-12 (see `url-reference.md` for the full test). A plain HTTP fetch of
`?q=<anything>`, including a nonsense term, always returns the same unfiltered listing,
because the site filters client-side with JavaScript after the page loads.

So `search` here works differently: it fetches a bounded run of listing pages — newest first,
since the listing is sorted by posting date — and filters **locally** on title and company
text. This means:

- `--query` matches against title/company only, not the full job description (the
  description isn't present on the listing page — fetching it per-job for every scanned
  result would mean one request per posting, which this skill deliberately avoids).
- Results are a scan of recent postings, not an exhaustive search of all ~3,150 listings.
  Widen with `--scan-pages` or narrow the freshness window with `--jobage` as needed.
- `--jobage <days>` doubles as the scan's stopping condition: because the listing is sorted
  newest-first, once a fetched page's oldest posting falls outside the requested window,
  later pages are guaranteed to be older too, so the scan stops there rather than continuing
  to a fixed page count.

## Commands

### Search job listings

```bash
bun run .agents/skills/alleyesonme-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — match against title/company (local scan, see above).
- `--jobage <days>` — only jobs posted within N days; also bounds how many pages are scanned.
- `--page <n>` — 1-indexed starting page. Default 1.
- `--scan-pages <n>` — how many pages to fetch, starting at `--page`. Default 5; if `--jobage`
  is set without this flag, defaults to a 30-page safety cap instead.
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side), applied after scanning.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/alleyesonme-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the slug from `search` results (e.g. `financial-controller-m-f-luxin-ab7f81`), or a
full `alleyesonme.jobs/jobs/...` URL. Returns the full description, contract type
(CDI/CDD/etc.), work time (full/part-time), education level, and location. There is no static
apply URL — the "Je postule" button is client-rendered; the returned `url` is the job page to
open for applying.

## Usage examples

```bash
# Accounting roles, table view
bun run .agents/skills/alleyesonme-search/cli/src/cli.ts search -q "comptable" --format table

# Developer roles posted in the last 14 days
bun run .agents/skills/alleyesonme-search/cli/src/cli.ts search -q "developer" --jobage 14 --format table

# Browse the 10 newest pages with no filter (~200-240 listings)
bun run .agents/skills/alleyesonme-search/cli/src/cli.ts search --scan-pages 10 --format table

# Full detail for a specific job
bun run .agents/skills/alleyesonme-search/cli/src/cli.ts detail financial-controller-m-f-luxin-ab7f81 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning (also prints the scanned-page range and total-pages estimate) |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## robots.txt guardrail — do not touch

`robots.txt` disallows the faceted-filter paths `/admin`, `*/contractType/`, `*/employment/`,
`*/degree/`, `*/exp/`, `*/workplace/`, `*/size/`. This CLI has no flags that construct URLs
with those segments, and `assertAllowedUrl` in `cli/src/helpers.ts` additionally refuses,
unconditionally, to fetch any URL that contains one anyway. **This guard must never be
disabled or bypassed, including temporarily for a test** — that instruction came directly
from the user during this skill's generation and applies to any future change here too.

## Notes

- Data is from alleyesonme.jobs's public server-rendered pages — no credentials required.
- Page size varies (~20-24 results/page, not a fixed number) — see `url-reference.md` for how
  this reconciles the site's advertised ~3,150-listing count with its ~132-page pagination.
- The CLI backs off with exponential delay on 429/5xx responses. Keep volume low regardless —
  the default `--scan-pages 5` and the 30-page `--jobage` safety cap exist for this reason.
- Job IDs are URL slugs (e.g. `financial-controller-m-f-luxin-ab7f81`) — pass them as-is to `detail`.
