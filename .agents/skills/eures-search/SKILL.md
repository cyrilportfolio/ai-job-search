---
name: eures-search
version: 1.0.0
description: >
  Use this skill to search live job listings on EURES, the European Union's official
  job-mobility portal, an aggregator covering ~2.8M postings from national job boards
  across the EU/EEA — filterable by country, e.g. Luxembourg and France for Grande Région
  frontalier searches. Trigger phrases: EURES, EU jobs, European job mobility, emploi UE,
  offres EURES, travailler dans l'UE, cross-border jobs Europe, frontalier jobs France
  Luxembourg, EU-wide job search.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/eures-search/cli/src/cli.ts *)
---

# EURES Search Skill

Search live job listings from EURES's public JSON API — the EU's official job-mobility
portal, aggregating postings from national job boards across the EU/EEA. No authentication,
no API key, **zero runtime dependencies** — runs with just `bun`.

Unlike the HTML-scraped portals in this repo (`alleyesonme-search`, `manpower-search`), this
is a real, documented-by-inspection JSON API: `POST .../jv-search/search` for search,
`GET .../jv/id/<id>` for detail. Both `--country` filtering and `--query` keyword matching
were verified live to genuinely filter server-side (a control search for `"comptable"` in
Iceland returned 1 result vs. 502 in Luxembourg) — see `url-reference.md` for the full
verification.

## The mandatory 10-second delay

`robots.txt` sets `Crawl-delay: 10` for europa.eu. This skill's CLI enforces a hard 10s gap
between **every** request it makes, persisted across separate invocations (not just within
one `search` call) via a small state file in the OS temp directory — so running `search`
immediately followed by `detail` still respects the full gap. **This is hard-coded and there
is no flag to shorten or disable it.** That was an explicit requirement when this skill was
generated, not an implementation detail to "optimize" away later — a single `search` +
`detail` pair takes at least ~10-20 seconds; plan accordingly (and don't loop this skill
across many keywords back-to-back without expecting real wall-clock time to pass).

## Commands

### Search job listings

```bash
bun run .agents/skills/eures-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — EU-wide full-text search (title + description). Optional.
- `--country <codes>` / `-c <codes>` — ISO alpha-2 code(s), comma-separated (e.g. `lu`,
  `lu,fr` for a Luxembourg + France Grande Région search). Case-insensitive. Omit for EU-wide.
- `--jobage <days>` — maps to the nearest EURES freshness bucket (≤1d / ≤7d / ≤30d / none —
  EURES only supports these three buckets, not an arbitrary day count; see `url-reference.md`).
- `--page <n>` — 1-indexed page. Default 1.
- `--limit <n>` / `-n <n>` — results per page, max 50. Default 10.
- `--lang <code>` — response language for title/description. Default `fr`.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/eures-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the base64 id from `search` results (e.g. `NTkxNjkzNCA5`), or a portal
`jv-details/...` URL. Returns the full description, employment type, originating source
board (EURES aggregates — the sampled job during generation actually came from Pôle Emploi
via Moovijob, not EURES itself), and a real apply link when the source posting provides one.

## Usage examples

```bash
# Accounting roles in Luxembourg
bun run .agents/skills/eures-search/cli/src/cli.ts search -q "comptable" -c lu --format table

# Grande Région frontalier search: Luxembourg + France, last 7 days
bun run .agents/skills/eures-search/cli/src/cli.ts search -q "developer" -c lu,fr --jobage 7 --format table

# Browse Luxembourg postings with no keyword filter
bun run .agents/skills/eures-search/cli/src/cli.ts search -c lu --format table

# Full detail for a specific job
bun run .agents/skills/eures-search/cli/src/cli.ts detail NTkxNjkzNCA5 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- `robots.txt` does not disallow `/eures` (don't confuse it with the unrelated, disallowed
  `/eur-lex/`) — the only real constraint is the crawl-delay above.
- `company` is often the literal placeholder `"Non renseigné"` ("not disclosed") rather than
  a real employer name — passed through as-is since that's genuinely what EURES returns, the
  same anonymization pattern seen in `manpower-search`.
- The `url` field is a best-effort, **unverified** portal deep link — the public EURES
  portal is a client-rendered SPA, so it couldn't be confirmed by a plain HTTP fetch (every
  path returns the same empty shell). If it ever doesn't resolve to the right job, that's a
  known, documented limitation (see `url-reference.md`), not a regression to chase.
- `--jobage` is an approximation onto EURES's fixed 3-bucket enum, not an exact day count.
- `--country` values combine additively (union), not as an intersection — `lu,fr` means
  "Luxembourg OR France," matching ~33k results rather than a narrower intersection.
