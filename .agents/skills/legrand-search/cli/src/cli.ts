#!/usr/bin/env bun
// Self-contained CLI for Le Grand & Associates's public WordPress REST API
// (legrand-associates.com, Belgium/Luxembourg accounting & fiduciary recruitment). No
// external CLI framework, so it runs anywhere `bun` is available with zero install beyond
// the repo clone.
//
// NOTE ON THE SITE'S WAF (SiteGround): confirmed 2026-08-12, robots.txt permits /wp-json/*,
// but two independent signals can still trigger a block — a browser-impersonating
// User-Agent ("Mozilla/5.0 (compatible; ...)", which this CLI deliberately avoids — see the
// UA constant in helpers.ts) and separately, IP/request-volume reputation (a captcha
// redirect seen even with the honest UA after repeated requests from the same origin in a
// short window). If this CLI reports WAF_BLOCKED, wait and retry at lower volume rather than
// assuming the site's policy changed or the parser broke.

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

const HELP = `legrand-cli — search jobs on legrand-associates.com (Belgium + Luxembourg accounting/fiduciary)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Full-text search (title + content), e.g. "accountant" or
                          "comptable". Note: Luxembourg postings are titled in French,
                          Belgium postings in Dutch/English — an English query like
                          "accountant" will mostly miss --lu-only results; try "comptable".
  --lu-only               Restrict to Luxembourg locations (Luxembourg, Luxembourg-city,
                          Grevenmacher, Esch-sur-Alzette, Capellen, Diekirch, Clervaux,
                          Wiltz, Mersch — verified term list, ~9-32 of ~410 total postings).
  --jobage <days>         Only jobs posted within N days (real server-side filter, WP's
                          standard "after" parameter).
  --page <n>              1-indexed page. Default 1.
  --limit, -n <n>         Results per page (also caps client-side), max 100. Default 20.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "accountant" --format table
  bun run src/cli.ts search -q "comptable" --lu-only --format table
  bun run src/cli.ts search --lu-only --jobage 14 --format table
  bun run src/cli.ts detail 9837 --format plain

All errors are written to stderr as { "error": "...", "code": "..." }, exit code 1. A
"WAF_BLOCKED" code means the site's firewall rejected the request outright — see the note at
the top of src/cli.ts before assuming the site itself is unreachable.
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

    let page = 1
    if (flags.page !== undefined) {
      const v = parseIntFlag("page", flags.page)
      if (v === null) return 1
      page = Math.max(1, v)
    }

    let jobage: number | undefined
    if (flags.jobage !== undefined) {
      const v = parseIntFlag("jobage", flags.jobage)
      if (v === null) return 1
      jobage = v
    }

    let limit: number | undefined
    if (flags.limit !== undefined) {
      const v = parseIntFlag("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      luOnly: Boolean(flags["lu-only"]),
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
      process.stderr.write(JSON.stringify({ error: "detail requires an <id>", code: "NO_ID" }) + "\n")
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
        code: (e as { code?: string })?.code ?? "INTERNAL_ERROR",
      }) + "\n",
    )
    process.exit(1)
  })
