#!/usr/bin/env bun
// Self-contained CLI for EURES's public JSON API (europa.eu/eures), the EU's official
// job-mobility portal (~2.8M listings aggregated from national boards across the EU/EEA).
// No external CLI framework, so it runs anywhere `bun` is available with zero install
// beyond the repo clone.
//
// robots.txt sets "Crawl-delay: 10" for this host. That delay is hard-coded into every
// request this CLI makes (see helpers.ts) and is NOT configurable from here — there is no
// flag to shorten or skip it, by design.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit", c: "country" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `eures-cli — search jobs on EURES (EU-wide, filterable by country)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keyword search (title + description, EU-wide full-text). Optional
                           — omit for an unfiltered browse of a country's postings.
  --country, -c <codes>   ISO alpha-2 country code(s), comma-separated (e.g. "lu",
                           "lu,fr"). Case-insensitive. Omit for EU-wide results.
  --jobage <days>         Maps to the nearest EURES freshness bucket: <=1 -> last day,
                           <=7 -> last week, <=30 -> last month, >30 or omitted -> no filter.
                           EURES doesn't support an arbitrary day count, only these buckets.
  --page <n>              1-indexed page. Default 1.
  --limit, -n <n>         Results per page (also caps client-side), max 50. Default 10.
  --format <fmt>          json (default) | table | plain.
  --lang <code>           Response language for title/description. Default "fr".

EXAMPLES
  bun run src/cli.ts search -q "comptable" -c lu --format table
  bun run src/cli.ts search -q "developer" -c lu,fr --jobage 7 --format table
  bun run src/cli.ts search -c lu --format table
  bun run src/cli.ts detail NTkxNjkzNCA5 --format plain

Every request waits at least 10s since the last one (robots.txt Crawl-delay: 10), enforced
regardless of command or flags. All errors are written to stderr as
{ "error": "...", "code": "..." }, exit code 1.
`

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const parseIntFlag = (name: string, raw: string | boolean | string[]): number | null => {
    const val = parseInt(raw as string, 10)
    if (isNaN(val)) {
      process.stderr.write(JSON.stringify({ error: `--${name} must be a number, got "${raw}"`, code: "BAD_ARG" }) + "\n")
      return null
    }
    return val
  }

  const lang = typeof flags.lang === "string" ? flags.lang : "fr"

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    let jobage: number | undefined
    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      jobage = v
    }

    let page = 1
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      page = Math.max(1, v)
    }

    let limit: number | undefined
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      if (v <= 0) {
        process.stderr.write(JSON.stringify({ error: "--limit must be a positive number", code: "BAD_ARG" }) + "\n")
        return 1
      }
      limit = v
    }

    const country =
      typeof flags.country === "string"
        ? flags.country
            .split(",")
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean)
        : undefined

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      country,
      jobage,
      page,
      limit,
      lang,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) {
      process.stderr.write(JSON.stringify({ error: "detail requires an <id|url>", code: "NO_ID" }) + "\n")
      return 1
    }
    const fmt = (flags.format as string) || "json"
    const opts: DetailOpts = {
      id,
      lang,
      format: (fmt === "plain" ? "plain" : "json") as DetailOpts["format"],
    }
    return runDetail(opts)
  }

  process.stderr.write(JSON.stringify({ error: `Unknown command "${cmd}"`, code: "BAD_CMD" }) + "\n")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({
        error: e instanceof Error ? e.message : String(e),
        code: "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
