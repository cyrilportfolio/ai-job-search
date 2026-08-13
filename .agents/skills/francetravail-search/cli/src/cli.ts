#!/usr/bin/env bun
// Self-contained CLI for France Travail's official partner API (api.francetravail.io),
// OAuth2 client_credentials, Luxembourg-first with Grande Région frontalier coverage via
// --departement. No external CLI framework — runs anywhere `bun` is available.
//
// api.francetravail.io's robots.txt blanket-disallows all paths; this does not apply to this
// CLI (a credentialed partner API is not what robots.txt was written for) — see SKILL.md and
// url-reference.md for the full, settled reasoning. The real operative constraint is the
// hard-coded 4 req/s rate limit in helpers.ts, which has no flag to disable.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit" }
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

const HELP = `francetravail-cli — search France Travail's official partner API (Luxembourg-first, Grande Région frontalier coverage)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SETUP (required)
  export FRANCETRAVAIL_API_TOKEN="<client_id>:<client_secret>"

SEARCH FLAGS
  --query, -q <text>      Keyword search (title + description). Optional.
  --pays <code|name>      Geography filter. Default "lu" (Luxembourg, paysContinent=99137).
                           Accepts a raw numeric code, or a name resolved live against
                           /referentiel/pays. Mutually exclusive with --departement.
  --departement <code>    French département code (e.g. 57, 54, 55, 88 for the Grande Région
                           frontalier départements). Overrides --pays for that call.
  --jobage <days>         Maps to the nearest publieeDepuis bucket: 1, 3, 7, 14, 31. Values
                           above 31 are unfiltered.
  --page <n>              1-indexed page. Default 1.
  --limit, -n <n>         Results per page (also caps client-side). Default 20.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "comptable" --format table
  bun run src/cli.ts search -q "comptable" --jobage 7 --format table
  bun run src/cli.ts search -q "comptable" --departement 57 --format table
  bun run src/cli.ts detail 5946183 --format plain

Rate limit: hard-coded 4 requests/second per application (250ms min gap), not configurable.
All errors are written to stderr as { "error": "...", "code": "..." }, exit code 1.
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

  if (cmd === "search") {
    const fmt = (flags.format as string) || "json"

    const pays = typeof flags.pays === "string" ? flags.pays : undefined
    const departement = typeof flags.departement === "string" ? flags.departement : undefined
    if (pays !== undefined && departement !== undefined) {
      process.stderr.write(JSON.stringify({ error: "--pays and --departement are mutually exclusive", code: "BAD_ARG" }) + "\n")
      return 1
    }

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

    let limit = 20
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      if (v <= 0) {
        process.stderr.write(JSON.stringify({ error: "--limit must be a positive number", code: "BAD_ARG" }) + "\n")
        return 1
      }
      limit = v
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      pays,
      departement,
      jobage,
      page,
      limit,
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
