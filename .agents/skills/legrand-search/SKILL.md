---
name: legrand-search
version: 1.0.0
description: >
  Use this skill to search live job listings on legrand-associates.com, a Belgium and
  Luxembourg accounting and fiduciary recruitment firm (~410 postings, ~9-32 in Luxembourg
  locations). Trigger phrases: Le Grand & Associates, accounting jobs Luxembourg, comptable
  Luxembourg, fiduciary jobs Belgium, offres comptable, boekhouder vacature, accountant
  vacature, tax jobs Luxembourg, financial jobs Belgium.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/legrand-search/cli/src/cli.ts *)
---

# legrand-associates.com Search Skill

Search live job listings from Le Grand & Associates's public WordPress REST API — a
Belgium/Luxembourg accounting & fiduciary recruitment firm. No authentication, no API key,
**zero runtime dependencies** — runs with just `bun`. Unlike the HTML-scraped portals in
this repo, this is a real JSON API (`/wp-json/wp/v2/job`), not scraping.

## ⚠️ WAF caveat — two confirmed triggers, not a site outage

`robots.txt` explicitly permits `/wp-json/*`, but this site's WAF (SiteGround) can still
reject a request for two independent, separately confirmed reasons: (1) a
browser-impersonating User-Agent like `"Mozilla/5.0 (compatible; ...)"` — a controlled A/B
test got 403 on that exact pattern and 200 on the CLI's actual (honest, no-prefix) UA for an
identical request — and (2) IP/request-volume reputation — repeated requests from one origin
in a short window can trigger a captcha redirect even with the honest UA. If `search`/
`detail` reports `code: "WAF_BLOCKED"`, wait and retry at lower volume rather than assuming
the site is down or the parser broke. Full investigation in `url-reference.md`.

## `--query` language mismatch — read before assuming zero results is a bug

Luxembourg postings on this site are titled in **French** ("Comptable", "Contrôleur
financier"); Belgium postings use **Dutch/English** ("Accountant AZ met wagen"). Combining
an English query like `accountant` with `--lu-only` returns zero results — verified live,
not a broken filter. Use a French term (e.g. `comptable`) for Luxembourg-focused searches.

## Commands

### Search job listings

```bash
bun run .agents/skills/legrand-search/cli/src/cli.ts search [flags]
```

Key flags:
- `--query <text>` / `-q <text>` — full-text search (title + content). Match the query
  language to the market you want (French for Luxembourg, Dutch/English for Belgium).
- `--lu-only` — restrict to the 9 verified Luxembourg location terms (Luxembourg,
  Luxembourg-city, Grevenmacher, Esch-sur-Alzette, Capellen, Diekirch, Clervaux, Wiltz,
  Mersch — corrects a 2-term gap in the original handoff; see `url-reference.md`).
- `--jobage <days>` — only jobs posted within N days. Real server-side filter (WordPress's
  standard `after` parameter), not a client-side approximation.
- `--page <n>` — 1-indexed page. Default 1.
- `--limit <n>` / `-n <n>` — results per page (also caps client-side), max 100. Default 20.
- `--format json|table|plain` — default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/legrand-search/cli/src/cli.ts detail <id> [--format json|plain]
```

`id` is the **numeric WordPress post id** from a `search` result (e.g. `9837`) — the URL
slug is not usable as an id here (slugs get deduplicated with `-2`/`-5`/`-7` suffixes and
don't map back). Returns the full description, employment type, industry, and an apply link
(the job's own page, which hosts the application form).

## Usage examples

```bash
# Belgium accounting roles (English/Dutch titles)
bun run .agents/skills/legrand-search/cli/src/cli.ts search -q "accountant" --format table

# Luxembourg accounting roles (French titles)
bun run .agents/skills/legrand-search/cli/src/cli.ts search -q "comptable" --lu-only --format table

# All Luxembourg postings from the last 14 days, any title
bun run .agents/skills/legrand-search/cli/src/cli.ts search --lu-only --jobage 14 --format table

# Full detail for a specific job
bun run .agents/skills/legrand-search/cli/src/cli.ts detail 9837 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- `company` is always `"Le Grand & Associates"` — every posting anonymizes the actual
  hiring client; there is no distinct employer field anywhere in the API.
- Taxonomy id→name maps (location, contract type, industry) are fetched live on every call
  rather than hard-coded, so label changes on the site are picked up automatically. Only the
  *classification* of which location terms count as "Luxembourg" (`--lu-only`) is hard-coded
  — see `url-reference.md` if that ever needs updating.
- No crawl-delay declared in `robots.txt`; keep volume reasonable regardless.
