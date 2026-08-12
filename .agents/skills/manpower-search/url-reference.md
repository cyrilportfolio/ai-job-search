# manpower.lu URL Reference

Public, unauthenticated, server-rendered WordPress pages (+ the Matador Jobs plugin, backed
by a Bullhorn ATS). No JSON API — `/wp-json/wp/v2/types` responds, but the `matador-job-listings`
CPT is not exposed there (`show_in_rest: false`); all parsing here is HTML-based.

All findings below were verified live against manpower.lu on **2026-08-12**.

## robots.txt (fetched 2026-08-12)

```
User-agent: *
Disallow:

Sitemap: https://manpower.lu/sitemap_index.xml
```

Empty `Disallow` = everything is allowed. No path/facet guard is needed (contrast with
`alleyesonme-search`, which hard-blocks several robots.txt-disallowed facet segments).

## Archive listing

```
GET https://manpower.lu/fr/jobs/
GET https://manpower.lu/fr/jobs/page/<n>/          (n >= 2)
```

Sorted newest-first (confirmed: page 1 top entries dated 2026-08-12/11, page 6 dated
2026-07-24, page 12 — the last page, confirmed by a 301 on page 13 — dated 2026-03-12 to
2026-03-20). 10 results/page, 12 pages total, ~113 listings — matches the
`matador-job-listings-sitemap.xml` count (114 `<loc>` entries, one of which is the `/jobs/`
index page itself, so 113 postings).

The highest page number is discoverable from any fetched page's own pagination links
(`/jobs/page/<n>/`) — `parseTotalPages` in `helpers.ts` takes the max found, same technique
as `alleyesonme-search`.

## Search

```
GET https://manpower.lu/?s=<query>&post_type=jobs
```

**This one actually filters server-side.** Verified with three checks: `?s=comptable` (5
results, all accounting-related), `?s=technicien` (10 results), and
`?s=zzzznonexistentquery9999` (0 results, 65KB smaller response than the real queries). This
is the opposite finding from `alleyesonme-search`'s `?q=`, which turned out to be
client-side-only decoration — don't assume every portal's query param is fake just because
one was; each has to be checked.

**But it does not paginate.** The results page has no `page-numbers`/pagination markup at
all — tested `?s=technicien&paged=2` (0 results even though the sitemap independently
confirms more than 10 "technicien"-adjacent postings exist) and `/page/2/?s=technicien&post_type=jobs`
(301 redirect, not a valid results page). Treat `search -q "..."` as returning a single,
WordPress-relevance-capped batch (observed up to 10 results) — for exhaustive coverage of a
term, omit `--query` and scan the archive instead (`--scan-pages`, optionally combined with
manual filtering downstream).

## Search-result / archive card markup

Both the archive listing and the `?s=` results page render the same card markup, so one
parser (`parseJobCards`) covers both:

```html
<article id="post-258676" class="row post-258676 matador-job-listings type-matador-job-listings
    status-publish hentry matador-categories-administrative matador-locations-hesperange
    matador-types-temporary">
  <div class="col-sm-2">...</div>
  <div class="col-sm-10">
    <h2 class="post-title"><a href="https://manpower.lu/fr/jobs/15170-office-manager-junior-support-comptable-m-f-x/">Office Manager Junior &amp; Support Comptable (M/F/X)</a></h2>
    <div class="meta">
      <span><i class="fa fa-user"></i></span>
      <span><i class="fa fa-calendar"></i>10/08/2026</span>
    </div>
    <p>Location: Hesperange Type: Temporary Job #15170 Notre client, un groupe actif...&hellip;</p>
    <a href="..." class="btn btn-primary read-more-btn">En savoir plus/Read more...</a>
  </div>
</article>
```

The `<article class="...">` attribute usefully double-encodes location/type/category as
slugs (`matador-locations-hesperange`, `matador-types-temporary`) — not currently used by
this skill's parser (the human-readable "Location: X Type: Y" text in the `<p>` is simpler
to extract and sufficient), but worth knowing about if a future field needs a stable slug
rather than a display label.

`id` = the `<numeric>-<slug>` path segment (e.g. `15170-office-manager-junior-support-comptable-m-f-x`).
URLs from the archive carry a `/fr/` locale prefix; URLs from `?s=` results omit it — both
resolve to the same page (both verified 200 directly, no redirect), so the parser strips the
prefix when present and the CLI always constructs canonical `/fr/jobs/<id>/` URLs on output.

**No company/client field.** Manpower postings are agency-mediated; the end client is
usually anonymized in the body text ("notre client, un groupe actif dans...") rather than
named as a distinct field anywhere in the markup. `company` is always `null`.

## Detail page

```
GET https://manpower.lu/fr/jobs/<id>-<slug>/
```

Same `<h2 class="post-title">` and calendar-icon date as the listing card. Additionally, a
`matador-job-meta` list renders labeled fields:

```html
<ul class="matador-job-meta matador-job-meta-job-258676 matador-job-meta-default">
  <li class="matador-job-meta-field matador-job-field-job_general_location matador-job-field-value-hesperange">
    <span class="matador-job-meta-label">Location:</span> <span class="matador-job-meta-value">Hesperange</span>
  </li>
  <li class="matador-job-meta-field matador-job-field-employmentType matador-job-field-value-temporary">
    <span class="matador-job-meta-label">Type:</span> <span class="matador-job-meta-value">Temporary</span>
  </li>
  <li class="matador-job-meta-field matador-job-field-bullhorn_job_id matador-job-field-value-15170">
    <span class="matador-job-meta-label">Job</span> <span class="matador-job-meta-value">#15170</span>
  </li>
</ul>
```

The `matador-job-field-<key>` class identifies each field regardless of label wording —
`parseJobDetail` reads `job_general_location` and `employmentType`; `bullhorn_job_id`
duplicates the numeric id already in the slug so it isn't re-extracted.

**Description** is every rich-text paragraph between the end of the `matador-job-meta` list
(`</ul>`) and the start of the application form (`<form id="matador-application-form" ...>`)
— a clean, reliable boundary.

**No static apply URL.** The form itself is real (`action="https://manpower.lu/fr/matador/api/application/"`,
`method="post"`, `enctype="multipart/form-data"`, with hidden `bhid`/`wpid` fields tying it to
the Bullhorn job record) but requires a CV upload — not something this CLI submits.
`detail` returns `applyUrl: null` and points users at the job page itself.

## Notes

- No authentication required; robots.txt allows everything.
- The listing is sorted newest-first, so `--jobage`'s scan-stop trick (same technique as
  `alleyesonme-search`) works here too, for the archive-scan mode.
- Keep volume low regardless (personal-use norm for this fork): the archive scan defaults to
  5 pages, capped at 12 (the whole site) even with `--jobage`.
