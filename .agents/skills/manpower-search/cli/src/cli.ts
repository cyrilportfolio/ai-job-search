#!/usr/bin/env bun
// Self-contained CLI for searching jobs on manpower.lu (Luxembourg, interim/CDD/CDI). No
// external CLI framework, so it runs anywhere `bun` is available with zero install beyond
// the repo clone.
//
// --query uses the site's own ?s= full-text search (confirmed genuinely server-side, unlike
// alleyesonme.jobs's decorative ?q=) but that endpoint is NOT paginated — it returns a single
// WordPress-relevance-capped batch. Without --query, search scans the paginated archive
// instead (newest-first), which --page/--scan-pages/--jobage control. See SKILL.md.

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

const HELP = `manpower-cli — search jobs on manpower.lu (Luxembourg: interim, CDD, CDI)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Server-side full-text search (title + description). Real filtering,
                          but returns a single batch only (not paginated) — --page/--scan-pages
                          are ignored when this is set. Optional.
  --jobage <days>        Only jobs posted within N days. Without --query, this also bounds
                          how many archive pages are scanned (listing is sorted newest-first,
                          so scanning stops once a page's oldest posting falls outside the
                          window). With --query, it just filters the returned batch.
  --page <n>             1-indexed starting page for the archive scan (ignored with --query).
                          Default 1.
  --scan-pages <n>       How many archive pages to fetch, starting at --page (ignored with
                          --query). Default 5, or up to 12 (the whole site) when --jobage is
                          set without this flag.
  --limit, -n <n>        Cap total results emitted (client-side), applied after scanning.
  --format <fmt>         json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "comptable" --format table
  bun run src/cli.ts search -q "technicien" --jobage 30 --format table
  bun run src/cli.ts search --scan-pages 3 --format table
  bun run src/cli.ts detail 15170-office-manager-junior-support-comptable-m-f-x --format plain

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

    let scanPages: number | undefined
    if (flags["scan-pages"] !== undefined) {
      const v = parseIntFlag("scan-pages", flags["scan-pages"])
      if (v === null) return 1
      if (v <= 0) {
        process.stderr.write(JSON.stringify({ error: "--scan-pages must be a positive number", code: "BAD_ARG" }) + "\n")
        return 1
      }
      scanPages = v
    }

    let limit: number | undefined
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      jobage,
      page,
      scanPages,
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
