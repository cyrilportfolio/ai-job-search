---
name: jobslu-search
version: 1.0.0
description: >
  Use this skill to search live job listings on en.jobs.lu, a general job board for
  Luxembourg and the Grande Région (Belgium, France-Lorraine, Germany). Trigger phrases:
  jobs.lu, jobslu, emploi Luxembourg, offres d'emploi Luxembourg, job Luxembourg, travail
  frontalier, emploi Grande Région, vacature Luxembourg, Stellenangebote Luxemburg.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/jobslu-search/cli/src/cli.ts *)
---

# en.jobs.lu Search Skill

Search live job listings from en.jobs.lu's public pages for the Luxembourg and Grande
Région market (59 listings for the test query "comptable" at generation time). No
authentication, no API key, **zero runtime dependencies** — runs with just `bun`.

## ⚠️ Personal use only

`robots.txt` is absent (404) on `en.jobs.lu` and its two aliases — no declared refusal, so
no `assertAllowedUrl`-style guard is needed here. The site does, however, sit behind Akamai
Bot Manager, which was verified live during this skill's generation to challenge this CLI's
own honest User-Agent (`jobslu-search-cli/1.0 (personal job search)`) on every attempt that
day, while generic tool/browser UAs pass through. **This CLI does not switch to a
common-tool UA to dodge that — doing so on purpose would be impersonation, not honest
identification, and is not something this skill will ever do, including temporarily for a
test.** Instead it detects the challenge page explicitly and fails with a clear
`CHALLENGE_BLOCKED` error rather than silently returning zero results. See
`url-reference.md` for the full A/B test and re-verification notes. Keep request volume low
regardless of whether the block is currently active.

## Commands

### Search job listings

```bash
bun run .agents/skills/jobslu-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — keyword (title, skill, or role).
- `--location <text>` / `-l <text>` — `luxembourg`, `belgium`, `lorraine` (or `france`),
  `rheinland-pfalz` (or `germany`), `saarland`, `abroad` — or the numeric region id. Omit for
  no location filter. These map onto the site's own region filter and cover the Grande
  Région frontalier market (`lorraine` is the French-side value).
- `--jobage <days>` — only jobs posted within N days. This portal has no server-side
  posting-age filter; the CLI forces newest-first sort and filters client-side.
- `--page <n>` — 1-indexed page (40 results/page). Default 1.
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/jobslu-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric job id from `search` results (e.g. `287136`) — a full detail URL or a
`job-id-<n>` fragment also works. Returns the full description, contract type, hours,
payment note, and last-updated date. There is no separate apply link — "Apply Now" happens
on the detail page itself, so `applyUrl` in the output is that same page.

## Usage examples

```bash
# Accounting roles anywhere in scope
bun run .agents/skills/jobslu-search/cli/src/cli.ts search -q "comptable" --format table

# Same, restricted to the French side of the Grande Région (frontalier-relevant)
bun run .agents/skills/jobslu-search/cli/src/cli.ts search -q "comptable" -l lorraine --format table

# Developer roles in Luxembourg, posted in the last 7 days
bun run .agents/skills/jobslu-search/cli/src/cli.ts search -q "developer" -l luxembourg --jobage 7 --format table

# Full detail for one job
bun run .agents/skills/jobslu-search/cli/src/cli.ts detail 287136 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process
exits with code `1`. A `CHALLENGE_BLOCKED` code specifically means Akamai served its
challenge page instead of real content — treat it as "retry later", never as "zero results".

## Notes

- Canonical host is `en.jobs.lu`; `www.jobs.lu` and `jobs.lu` both 301-redirect there.
- Search-list posting dates have no year (`"08 Aug"`, or `"Today"`) — the CLI assumes the
  current year and rolls back one year if that reading would be in the future (handles the
  December → January boundary). The detail page's "Last updated" date does carry a year and
  needs no such inference.
- Job IDs are plain numbers (e.g. `287136`) — pass them as-is to `detail`.
