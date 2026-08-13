---
name: jobslu-search
version: 1.0.0
description: >
  Use this skill to search live job listings on en.jobs.lu, a general job board for
  Luxembourg and the Grande Région (Belgium, France-Lorraine, Germany). Trigger phrases:
  jobs.lu, jobslu, emploi Luxembourg, offres d'emploi Luxembourg, job Luxembourg, travail
  frontalier, emploi Grande Région, vacature Luxembourg, Stellenangebote Luxemburg.
context: fork
enabled: false  # dormant: en.jobs.lu's Akamai bot protection targets tool-identifying UAs
                # (confirmed 2026-08-12, see url-reference.md); moved to search-queries.md's
                # email-alert-only sources by deliberate decision, not a bug. Parsers are
                # verified against real fixtures and this can flip back to true with no code
                # change if the site's policy changes — re-verify first, see url-reference.md.
allowed-tools: Bash(bun run .agents/skills/jobslu-search/cli/src/cli.ts *)
---

# en.jobs.lu Search Skill

Search live job listings from en.jobs.lu's public pages for the Luxembourg and Grande
Région market (59 listings for the test query "comptable" at generation time). No
authentication, no API key, **zero runtime dependencies** — runs with just `bun`.

## ⚠️ Dormant: not used by `/scrape`

**This skill is installed but `enabled: false`, so `/scrape` skips it.** `en.jobs.lu` sits
behind Akamai Bot Manager, confirmed (2026-08-12, via a test that alternates UAs per-request
*and* checks response content, not just HTTP status — see `url-reference.md` for why that
combination matters and what two earlier, less careful tests got wrong) to challenge
tool-identifying User-Agents specifically, while a generic UA passes. **This repo does not
adopt a generic UA to get past that** — the block is the site's own deliberate line between
"tool" and "not," and stepping around that distinction defeats its intent even without
impersonating anything specific, which is not something this skill will do, including
temporarily for a test. Coverage for this market instead goes through jobs.lu's own email
alerts → `/gmail-sync` → `/apply <url>` (see `search-queries.md`).

The CLI, parsers, and `CHALLENGE_BLOCKED` detection below are kept as-built rather than
removed: they're verified against real captured markup fixtures, and if the site's access
policy ever changes, flipping `enabled: true` back on needs no code change — re-verify with
the method in `url-reference.md` first rather than assuming either state.

`robots.txt` is absent (404) on `en.jobs.lu` and its two aliases — no declared refusal, so
no `assertAllowedUrl`-style guard is needed in the code; the Akamai block above is a separate
layer robots.txt says nothing about.

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
challenge page instead of real content — given the skill's dormant status above, expect this
on most calls rather than treating it as a transient "just retry" — never as "zero results".

## Notes

- Canonical host is `en.jobs.lu`; `www.jobs.lu` and `jobs.lu` both 301-redirect there.
- Search-list posting dates have no year (`"08 Aug"`, or `"Today"`) — the CLI assumes the
  current year and rolls back one year if that reading would be in the future (handles the
  December → January boundary). The detail page's "Last updated" date does carry a year and
  needs no such inference.
- Job IDs are plain numbers (e.g. `287136`) — pass them as-is to `detail`.
