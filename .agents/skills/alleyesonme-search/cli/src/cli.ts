#!/usr/bin/env bun
// Self-contained CLI for searching jobs on alleyesonme.jobs (Luxembourg). No external CLI
// framework, so it runs anywhere `bun` is available with zero install beyond the repo clone.
//
// The site's own `?q=` filter is client-side only (verified live 2026-08-12 — see
// url-reference.md): `search` instead scans a bounded run of pages, newest first, and
// filters locally on title/company. See SKILL.md for the full explanation.

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

const HELP = `alleyesonme-cli — search jobs on alleyesonme.jobs (Luxembourg)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>     Match against title/company (client-side — the site's own ?q=
                          filter does not work server-side; see SKILL.md). Optional.
  --jobage <days>        Only jobs posted within N days. Scanning stops once a page's
                          oldest posting falls outside this window (listing is sorted
                          newest-first). Optional.
  --page <n>             1-indexed starting page. Default 1.
  --scan-pages <n>       How many pages to fetch, starting at --page. Default 5, or up to
                          30 (safety cap) when --jobage is set without this flag.
  --limit, -n <n>        Cap total results emitted (client-side), applied after scanning.
  --format <fmt>         json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "comptable" --format table
  bun run src/cli.ts search -q "developer" --jobage 14 --format table
  bun run src/cli.ts search --scan-pages 10 --format table
  bun run src/cli.ts detail financial-controller-m-f-luxin-ab7f81 --format plain

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
