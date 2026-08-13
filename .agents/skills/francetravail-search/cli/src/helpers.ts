// Data source: France Travail's official partner API (api.francetravail.io) — a real,
// documented, OAuth2 client_credentials-gated REST API, not scraping.
//
// api.francetravail.io's robots.txt carries a blanket "Disallow: /" for all user agents.
// This does NOT apply to this CLI — see the "robots.txt on api.francetravail.io" section in
// ../SKILL.md and url-reference.md for the full reasoning (settled 2026-08-13, not a gray
// area to re-litigate). The operative compliance constraint is the published 4 req/s ceiling
// enforced below, not robots.txt.

import { tmpdir } from "os"
import { join } from "path"

export const BASE_URL = "https://api.francetravail.io/partenaire/offresdemploi/v2"
const AUTH_URL = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=%2Fpartenaire"
const SCOPE = "api_offresdemploiv2 o2dsoffre"
const PORTAL_DETAIL_BASE = "https://candidat.francetravail.fr/offres/recherche/detail"

// Deliberately not "Mozilla/5.0 (compatible; ...)" — that exact prefix (the shape well-known
// crawlers self-declare with) got flagged by a real WAF in a controlled A/B test
// (legrand-associates.com, 2026-08-12; see legrand-search/url-reference.md), while this plain
// tool/version/purpose form passed. Applied here preventively.
const UA = "francetravail-search-cli/1.0 (personal job search)"

// --- Rate limiting: 4 requests/second per application, published and hard-coded. ---
// Persisted across separate CLI invocations (same pattern as eures-search's crawl-delay) via
// a temp file, so a `search` immediately followed by `detail` still respects the gap. This is
// NOT configurable — there is no flag to shorten or disable it, by design.
const MIN_INTERVAL_MS = 250
const RATE_LIMIT_FILE = join(tmpdir(), "francetravail-search-cli-last-request")

async function enforceRateLimit(): Promise<void> {
  try {
    const last = parseInt(await Bun.file(RATE_LIMIT_FILE).text(), 10)
    if (!isNaN(last)) {
      const elapsed = Date.now() - last
      if (elapsed < MIN_INTERVAL_MS) {
        await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed))
      }
    }
  } catch {
    // No timestamp file yet — first request from this machine, nothing to wait for.
  }
  await Bun.write(RATE_LIMIT_FILE, String(Date.now()))
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// --- Credentials ---

export class MissingCredentialsError extends Error {}

export interface Credentials {
  clientId: string
  clientSecret: string
}

/** Reads FRANCETRAVAIL_API_TOKEN ("client_id:client_secret") from the environment only.
 *  Never a CLI flag, never hardcoded. Trims both halves — a trailing newline/whitespace in
 *  the env var (e.g. from `export X=$(cat file)`) otherwise causes a confusing
 *  400 invalid_client with no hint that whitespace was the cause (found live 2026-08-13). */
export function loadCredentials(): Credentials {
  const raw = process.env.FRANCETRAVAIL_API_TOKEN
  if (!raw) {
    throw new MissingCredentialsError(
      'FRANCETRAVAIL_API_TOKEN is not set (expected "client_id:client_secret"). Register a partner application at francetravail.io to obtain one.',
    )
  }
  const idx = raw.indexOf(":")
  if (idx === -1) {
    throw new MissingCredentialsError('FRANCETRAVAIL_API_TOKEN is malformed — expected "client_id:client_secret".')
  }
  const clientId = raw.slice(0, idx).trim()
  const clientSecret = raw.slice(idx + 1).trim()
  if (!clientId || !clientSecret) {
    throw new MissingCredentialsError('FRANCETRAVAIL_API_TOKEN is malformed — expected "client_id:client_secret", both parts non-empty.')
  }
  return { clientId, clientSecret }
}

// --- Auth: OAuth2 client_credentials, token cached in memory for the process lifetime only. ---

interface CachedToken {
  token: string
  expiresAt: number
}

let cachedToken: CachedToken | null = null

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token

  const { clientId, clientSecret } = loadCredentials()
  await enforceRateLimit()

  const response = await fetch(AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: SCOPE,
    }).toString(),
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Authentication failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`)
  }

  const data = (await response.json()) as { access_token: string; expires_in: number }
  // 30s safety margin so a token doesn't expire mid-request.
  cachedToken = { token: data.access_token, expiresAt: Date.now() + Math.max(0, data.expires_in - 30) * 1000 }
  return cachedToken.token
}

// --- Search-endpoint parameter guard ---
//
// Verified live 2026-08-13: BOTH "pays=" and "paysContinents=" (plural) are silently ignored
// by the search endpoint — no error, just a fallback to an unfiltered nationwide search. This
// means the real risk is any unrecognized parameter name, not one specific typo. Rather than
// blocklisting the two known traps, this whitelists the known-good set. Never remove, weaken,
// or bypass this — including temporarily for a test — per url-reference.md.
const ALLOWED_SEARCH_PARAMS = new Set(["motsCles", "paysContinent", "departement", "publieeDepuis", "range"])
const KNOWN_TRAP_PARAMS = new Set(["pays", "paysContinents"])

export function assertAllowedUrl(url: string): void {
  const parsed = new URL(url)
  if (!parsed.pathname.endsWith("/offres/search")) return
  for (const key of parsed.searchParams.keys()) {
    if (KNOWN_TRAP_PARAMS.has(key)) {
      throw new Error(
        `Refusing to build a request containing "${key}=" — verified live 2026-08-13: this parameter is silently ignored by the API (no error), falling back to an unfiltered nationwide search. Use "paysContinent" instead.`,
      )
    }
    if (!ALLOWED_SEARCH_PARAMS.has(key)) {
      throw new Error(
        `Refusing to build a request with unrecognized query parameter "${key}" — this API silently ignores unknown parameter names instead of rejecting them (verified live 2026-08-13 for both "pays" and "paysContinents"), so an unrecognized key is far more likely a typo than a real filter. Add it to ALLOWED_SEARCH_PARAMS only after confirming live that it does what you expect.`,
      )
    }
  }
}

// --- Fetch with rate limiting, retries, and the param guard ---

export interface ApiResult {
  data: unknown
  contentRange: string | null
}

export async function apiFetch(url: string, token: string): Promise<ApiResult> {
  assertAllowedUrl(url)
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await enforceRateLimit()
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) {
      return { data: null, contentRange: null }
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`Request failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`)
    }
    const data = await response.json()
    return { data, contentRange: response.headers.get("content-range") }
  }
  throw new Error("Request failed after max retries")
}

export function parseContentRangeTotal(header: string | null): number | null {
  if (!header) return null
  const m = header.match(/\/(\d+)$/)
  return m ? parseInt(m[1], 10) : null
}

// --- Geography resolution ---
//
// DEFAULT_PAYS_ALIAS/PAYS_ALIASES is intentionally a single documented shortcut for this
// skill's one default market, not a general country-name table — resolving an arbitrary
// --pays value always goes through the live /referentiel/pays endpoint below, per the
// instruction not to hardcode label resolution. "99137" was confirmed live 2026-08-13 via
// GET /referentiel/pays -> {"code":"99137","libelle":"Luxembourg"}; INSEE country codes are
// stable government identifiers, safe to default to without a lookup on every invocation.
export const DEFAULT_PAYS_ALIAS = "lu"
const PAYS_ALIASES: Record<string, string> = { lu: "99137", luxembourg: "99137" }

interface ReferentielPays {
  code: string
  libelle: string
}

export async function resolvePaysCode(token: string, input: string): Promise<string> {
  if (/^\d+$/.test(input)) return input

  const alias = PAYS_ALIASES[input.toLowerCase()]
  if (alias) return alias

  const { data } = await apiFetch(`${BASE_URL}/referentiel/pays`, token)
  const list = (data as ReferentielPays[]) ?? []
  const exact = list.filter((p) => p.libelle.toLowerCase() === input.toLowerCase())
  if (exact.length === 1) return exact[0].code
  const partial = list.filter((p) => p.libelle.toLowerCase().includes(input.toLowerCase()))
  if (partial.length === 1) return partial[0].code

  throw new Error(
    `Could not resolve --pays "${input}" to a unique code via /referentiel/pays (${partial.length} matches). Pass the numeric code directly instead.`,
  )
}

// --- jobage -> publieeDepuis ---
//
// publieeDepuis is a fixed, server-validated enum: {1, 3, 7, 14, 31}. Confirmed live
// 2026-08-13 — any other value returns a proper 400 (unlike the geography params, this one
// fails loudly). --jobage maps to the nearest bucket that still covers the requested window.
export function jobageToPublieeDepuis(days: number | undefined): 1 | 3 | 7 | 14 | 31 | undefined {
  if (days === undefined) return undefined
  if (days <= 1) return 1
  if (days <= 3) return 3
  if (days <= 7) return 7
  if (days <= 14) return 14
  if (days <= 31) return 31
  return undefined
}

// --- Search URL building ---

export function buildRange(page: number, limit: number): string {
  const start = (page - 1) * limit
  const end = start + limit - 1
  return `${start}-${end}`
}

export function buildSearchUrl(opts: {
  query?: string
  paysContinent?: string
  departement?: string
  publieeDepuis?: 1 | 3 | 7 | 14 | 31
  range: string
}): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("motsCles", opts.query)
  if (opts.departement) {
    params.set("departement", opts.departement)
  } else if (opts.paysContinent) {
    params.set("paysContinent", opts.paysContinent)
  }
  if (opts.publieeDepuis !== undefined) params.set("publieeDepuis", String(opts.publieeDepuis))
  params.set("range", opts.range)
  return `${BASE_URL}/offres/search?${params.toString()}`
}

// --- Response shapes (fields observed live 2026-08-13; see url-reference.md) ---

interface RawPartenaire {
  nom?: string
  url?: string
  logo?: string
}

interface RawOrigineOffre {
  origine?: string
  urlOrigine?: string
  partenaires?: RawPartenaire[]
}

interface RawLieuTravail {
  libelle?: string
  codePostal?: string
  commune?: string
}

interface RawOffre {
  id: string
  intitule: string
  description?: string
  dateCreation?: string
  lieuTravail?: RawLieuTravail
  entreprise?: { nom?: string | null }
  origineOffre?: RawOrigineOffre
  typeContratLibelle?: string
  experienceLibelle?: string
  salaire?: { libelle?: string }
  contact?: { nom?: string; courriel?: string; telephone?: string }
}

interface RawSearchResponse {
  resultats?: RawOffre[]
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  applyUrl: string | null
  partner: string | null
}

export interface JobDetail extends JobCard {
  description: string | null
  employmentType: string | null
  experience: string | null
  salary: string | null
  contact: { name: string | null; email: string | null; phone: string | null } | null
}

function fichUrl(id: string): string {
  return `${PORTAL_DETAIL_BASE}/${encodeURIComponent(id)}`
}

function toJobCard(o: RawOffre): JobCard {
  const partner = o.origineOffre?.partenaires?.[0] ?? null
  const url = o.origineOffre?.urlOrigine ?? fichUrl(o.id)
  return {
    id: o.id,
    title: o.intitule,
    company: o.entreprise?.nom ?? null,
    location: o.lieuTravail?.libelle ?? null,
    date: o.dateCreation ? o.dateCreation.slice(0, 10) : null,
    url,
    applyUrl: partner?.url ?? url,
    partner: partner?.nom ?? null,
  }
}

export function parseSearchResponse(raw: unknown): JobCard[] {
  const data = raw as RawSearchResponse
  return (data.resultats ?? []).map(toJobCard)
}

export function parseDetailResponse(raw: unknown): JobDetail {
  const o = raw as RawOffre
  const card = toJobCard(o)
  return {
    ...card,
    description: o.description ?? null,
    employmentType: o.typeContratLibelle ?? null,
    experience: o.experienceLibelle ?? null,
    salary: o.salaire?.libelle ?? null,
    contact: o.contact
      ? { name: o.contact.nom ?? null, email: o.contact.courriel ?? null, phone: o.contact.telephone ?? null }
      : null,
  }
}

/** Accepts a raw numeric id or a candidat.francetravail.fr detail URL. */
export function normalizeId(input: string): string {
  const m = input.match(/detail\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : input
}
