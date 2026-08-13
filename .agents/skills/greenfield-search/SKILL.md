---
name: greenfield-search
version: 1.0.0
description: >
  Use this skill to search live job listings on greenfield.lu, a Luxembourg recruitment
  firm (~18 open postings, all Luxembourg-market roles, titles in English). Trigger phrases:
  Greenfield Group, Greenfield Luxembourg, jobs Luxembourg, offres emploi Luxembourg,
  emploi Luxembourg, recruitment Luxembourg, comptable Luxembourg, accountant Luxembourg,
  compliance jobs Luxembourg, finance jobs Luxembourg.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/greenfield-search/cli/src/cli.ts *)
---

# greenfield.lu Search Skill

Search live job listings from Greenfield Group's site — a Luxembourg recruitment firm. No
authentication, no API key, **zero runtime dependencies** — runs with just `bun`.

## Data source — sitemap enumeration, not a search API

The `/job-search` listing page renders entirely client-side (Next.js): its raw HTML always
reads "Sorry, no jobs available" no matter the query, and no JSON API endpoint exists (`/api/
jobs`, `/api/job-search`, `/_next/data/*.json` all checked — 404). What **does** work:
`sitemap.xml` is plain, uncompressed XML listing every current posting's URL (~18 total), and
each posting's own detail page is static, clean HTML with a `JobPosting` JSON-LD block plus a
small meta box (job type, location, salary, reference number).

So `search` enumerates the sitemap, fetches every detail page, and filters **locally on the
title** — there's no server-side query to send. Volume is small enough (~18 postings) that a
full scan is fast; `--limit` and `--jobage` still apply after the scan.

## Commands

### Search job listings

```bash
bun run .agents/skills/greenfield-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — case-insensitive substring match against the **title only**
  (no description search — matches the architecture of this portal, which has no
  server-side search to call). Every posting on this site is titled in **English**
  regardless of it being a Luxembourg-market firm — see the query-language note below.
- `--jobage <days>` — only postings whose `datePosted` falls within N days. This filters on
  the **posting date**, not the site's `validThrough` field — see Notes.
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

No `--page` flag (every call is a full local scan — pagination doesn't apply) and no
`--location` flag (the portal has no server-side location parameter; location is a text
field on each result, occasionally combined oddly — e.g. one posting lists
`"Luxembourg, United Kingdom"`).

### Fetch full job detail

```bash
bun run .agents/skills/greenfield-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the **"Job Reference No."** shown on the posting (e.g. `670`), which is also the
CLI's `id` field in search results. You may also pass a full posting URL directly. Returns
the full description, employment type (when set), salary, and the per-posting recruiter's
contact details (name, email, phone) — useful for this repo's "call before applying" step
(`.claude/skills/job-application-assistant/04-job-evaluation.md`).

## Query-language note — read before assuming zero results is a bug

Unlike `legrand-search` (whose Luxembourg postings are titled in French), **every posting on
greenfield.lu is titled in English**, even though it's a Luxembourg-only recruiter. A French
query like `"comptable"` returns **zero** title matches — verified live during generation
(2026-08-13). Use `"accountant"` (or another English term) for accounting-domain searches on
this portal specifically.

## Usage examples

```bash
# All current postings
bun run .agents/skills/greenfield-search/cli/src/cli.ts search --format table

# Accounting-domain roles (English query — see note above)
bun run .agents/skills/greenfield-search/cli/src/cli.ts search -q "accountant" --format table

# Compliance roles posted in the last 30 days
bun run .agents/skills/greenfield-search/cli/src/cli.ts search -q "compliance" --jobage 30 --format table

# Full detail for a specific job
bun run .agents/skills/greenfield-search/cli/src/cli.ts detail 670 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process
exits with code `1`. A dedicated `CHALLENGE_BLOCKED` or `PARSE_FAILED` code (rather than a
silent empty result) fires if a fetch ever returns something other than a real job page — not
observed during investigation, robots.txt is a bare `Allow: /` and `/terms/` 404s (no ToS
found either), but the guard stays in regardless.

## Notes

- `company` is always `"Greenfield Group"` — every posting is the firm's own listing (they
  don't anonymize a separate end-client the way `legrand-search` does), taken directly from
  the JSON-LD `hiringOrganization.name`.
- The site's `validThrough` field is **not a real deadline** for most postings — commonly
  decades in the future (e.g. `2051-07-08`). `--jobage` deliberately filters on `datePosted`
  instead; `validThrough` is exposed in `detail` output for reference only.
- `id` comes from the posting's own "Job Reference No." meta field, not parsed out of the
  URL. Almost every slug ends in `-<id>` (e.g. `.../finance-controller-691/` → `691`), but at
  least one observed posting puts the id at the **start** of the slug instead
  (`.../1234-senior-recruitment-consultant.../`  → `1234`) — `detail <id>` resolves either
  shape by checking the sitemap listing, so don't assume the trailing-token pattern always
  holds.
- Expired postings 404 and are treated as removed (silently dropped from `search`, reported
  as `NOT_FOUND` from `detail`) — not surfaced as errors.
- No crawl-delay declared in `robots.txt`; keep request volume low as an informal courtesy
  regardless (`search` uses a small concurrency cap when fetching all posting pages).
