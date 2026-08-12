# alleyesonme.jobs URL Reference

Public, unauthenticated, server-rendered (Next.js) HTML pages. No JSON API found — `/wp-json`
returns 403, no `__NEXT_DATA__`/RSC payload carries a fetchable endpoint, no JSON-LD on
either listing or detail pages.

All findings below were verified live against alleyesonme.jobs on **2026-08-12**.

## robots.txt (fetched 2026-08-12)

```
User-Agent: *
Allow: /
Disallow: /admin
Disallow: */contractType/
Disallow: */employment/
Disallow: */degree/
Disallow: */exp/
Disallow: */workplace/
Disallow: */size/
```

These are faceted-filter path segments (e.g. `/jobs/contractType/cdi/`), not query strings.
The CLI never offers flags for these facets and additionally hard-codes a guard
(`assertAllowedUrl` in `cli/src/helpers.ts`) that refuses to fetch any URL containing one of
these segments, called unconditionally inside `htmlFetch`. **This guard must never be
removed, weakened, or bypassed — including temporarily, for a test.**

## Listing

```
GET https://alleyesonme.jobs/jobs
GET https://alleyesonme.jobs/jobs/page/<n>          (n >= 2; page 1 has no /page/1 form)
```

**Important — `?q=` does not filter server-side.** The initial handoff for this skill
described `?q=<term>` as a verified keyword filter. Live testing on 2026-08-12 disproved
this: `?q=comptable` returned the exact same 24 job slugs as no query at all, a different
real term (`?q=developer`) returned the same set again, and a nonsense term
(`?q=zzzznonexistentquery9999`) also returned the same set. Seven other parameter-name
guesses (`search`, `keyword`, `keywords`, `s`, `title`, `query`, `term`) all did the same.
The site's search box almost certainly filters client-side after a full page load — a plain
HTTP fetch never runs that JS, so it always gets the unfiltered listing.

**Do not "fix" this by re-adding server-side `?q=` filtering later** — it was checked, not
missed. If the site's implementation changes, re-verify with the nonsense-term test above
before trusting any query parameter again.

The CLI works around this by scanning a bounded run of pages (see `SearchOpts.scanPages` in
`cli/src/commands/search.ts`) and filtering locally on title/company.

**Pagination and result count.** The listing is sorted newest-first (confirmed: page 1 top
entries dated 2026-08-12, page 5 dated 2026-08-11, page 50 dated 2026-07-15). Page size is
**not** fixed — observed 24 results on page 1, 23 on page 131, 20 on page 132, 0 on page 133.
The original handoff flagged a discrepancy (132 pages × an assumed 15/page ≈ 1,980 vs. the
~3,150 offers the site advertises); the actual variable page size (~20-24) reconciles that:
132 pages × ~24 ≈ 3,150. The highest page number is discoverable from any fetched page's own
pagination links (`/jobs/page/<n>`) — `parseTotalPages` in `helpers.ts` takes the max found.
Page 132 is the true last page with content (page 133 confirmed empty); the on-page "next"
arrow may still render past that boundary as a client-side UI artifact, so treat "zero cards
returned" as the authoritative end-of-listing signal, not the presence/absence of a next link.

## Search-result card markup

Each card is an anchor with a distinctive Tailwind class (`h-[428px]`) used to split the page
into per-card chunks before parsing each independently:

```html
<a class="... h-[428px] w-full cursor-pointer ... rounded-xl border bg-white hover:shadow-lg" href="/jobs/<slug>">
  ...
  <div class="relative flex w-full flex-col px-6 pt-11 pb-5">
    <div class="flex flex-col gap-2">
      <p class="text-primary line-clamp-2 text-sm font-bold">TITLE</p>
      <p class="text-primary text-xs">COMPANY</p>
    </div>
    <div class="text-secondary mt-6 flex flex-col gap-1 text-xs leading-4 font-normal">
      <p>LOCATION</p>
      <p>DD/MM/YYYY</p>
    </div>
  </div>
  ...
</a>
```

`id` = the URL slug after `/jobs/` (e.g. `financial-controller-m-f-luxin-ab7f81`) — used as-is
to build the detail URL. The original handoff suggested using only the trailing hex suffix as
`id`; that suffix alone can't reconstruct the detail URL (which needs the full slug), so this
skill uses the whole slug as `id` instead.

## Detail page

```
GET https://alleyesonme.jobs/jobs/<slug>
```

| Field | Source |
|---|---|
| `title` | `<h1>...</h1>` |
| `company` | `alt` attribute of the `<img>` immediately following `<img alt="Banner" ...>` (the company logo) |
| `location` | `Informations` sidebar, `map-pin` icon |
| `date` | `Informations` sidebar, `clock` icon (DD/MM/YYYY, normalized to YYYY-MM-DD) |
| `contractType` | `Informations` sidebar, `file-text` icon (e.g. "À durée déterminée (CDD)") |
| `workTime` | `Informations` sidebar, `house` icon (e.g. "Temps plein") |
| `educationLevel` | `Informations` sidebar, `graduation-cap` icon (e.g. "Master") |
| `description` | `<section id="description">` → first `<div class="prose ...">`, converted to plain text with paragraph breaks preserved |

The sidebar (`<section id="info">`) renders each field as an icon + `<span>text</span>` pair;
the `lucide-<name>` class on each icon identifies the field regardless of surrounding markup
changes, which is more robust than positional parsing.

**No static apply URL.** The "Je postule" button is client-rendered (opens an email dialog or
external redirect decided by JS after hydration); nothing in the static HTML resolves it.
`detail` returns `applyUrl: null` and points users at the job page itself.

## Notes

- No authentication required; `Allow: /` in robots.txt covers general crawling of `/jobs` and
  `/jobs/<slug>` — only the facet paths above are off-limits.
- Keep volume low regardless (personal-use norm for this fork, not a robots.txt requirement):
  the CLI's default `--scan-pages 5` and the 30-page safety cap on `--jobage` scans exist for
  this reason, not just performance.
