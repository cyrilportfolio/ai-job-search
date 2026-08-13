# jobslu-cli

CLI for searching jobs on **en.jobs.lu** (Luxembourg + Grande Région), across any sector.

**Data source**: en.jobs.lu's public `Jobs.aspx` / `ApplyForJob.aspx` pages (server-rendered HTML).
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Dormant skill — not used by `/scrape`.** `robots.txt` is absent (no declared refusal) but
> the site sits behind Akamai Bot Manager, confirmed to specifically block tool-identifying
> User-Agents like this CLI's honest one (see `../url-reference.md`). By deliberate repo
> decision this CLI does not switch to a generic UA to get past that, so expect
> `CHALLENGE_BLOCKED` on most calls. Coverage for this market goes through jobs.lu's email
> alerts instead — see `../url-reference.md` and `../SKILL.md`.

## Installation

```bash
cd .agents/skills/jobslu-search/cli
bun install   # optional — only installs TypeScript dev types
```

The CLI runs without any install because it has zero runtime dependencies.

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings |
| `detail` | Fetch full detail for a single job listing |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

A `CHALLENGE_BLOCKED` error means Akamai served its challenge page instead of real content —
not zero results, and (per the note above) not something a retry or UA change fixes here.

## Quick examples

```bash
# Accounting roles anywhere in scope
bun run src/cli.ts search -q "comptable" --format table

# Same, restricted to the French side of the Grande Région (frontalier-relevant)
bun run src/cli.ts search -q "comptable" -l lorraine --format table

# Developer roles in Luxembourg, posted in the last 7 days
bun run src/cli.ts search -q "developer" -l luxembourg --jobage 7 --format table

# Full detail for one job
bun run src/cli.ts detail 287136 --format plain
```

See `../SKILL.md` for the full flag reference.

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role). |
| `--location` | `-l` | `luxembourg` \| `belgium` \| `lorraine` (or `france`) \| `rheinland-pfalz` (or `germany`) \| `saarland` \| `abroad` — or the numeric region id. Omit for no filter. |
| `--jobage` | | Posted within N days. No server-side support — implemented client-side (see `../url-reference.md`). |
| `--page` | | 1-indexed page (40 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |
