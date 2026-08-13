# Search Queries for Job Scraper

<!-- SETUP: Customize these queries based on your skills, target roles, and location -->

## Installed portal CLIs (primary for `/scrape`)

`/scrape` discovers every portal skill under `.agents/skills/*/SKILL.md` and runs its CLI first. Shipped country-agnostic CLIs include `linkedin-search` and `freehire-search`; Danish demos and any skill you add with `/add-portal` are included the same way. You do **not** need a matching `site:` line below for those CLIs to run.

The `site:` query templates in this file are the **WebSearch fallback** — for portals without a CLI, company career pages, or when a CLI fails.

**Language scope:** write every query category in every language listed in your CLAUDE.md Languages table (typically 1-2, sometimes more). A posting requiring a language you have *not* declared, as a job condition, is excluded before scoring; a posting requiring a *higher level* than you declared in a language you *do* work in is flagged for your own judgment, not excluded — see `04-job-evaluation.md`'s Language Gate, the single source of truth for this rule. Translate each category's keywords rather than machine-translating word-for-word (e.g. "Frontend Developer" -> "Desarrollador Frontend", not a literal word-for-word translation) if you work in more than one language.

## Search Sites

Primary (your market's job boards - scaffold one with `/add-portal`):
- **[YOUR_JOB_BOARD]** - your market's largest general job board
- **linkedin.com/jobs** - LinkedIn job listings (filter: [YOUR_COUNTRY] / [YOUR_CITY]); also covered by `linkedin-search` CLI
- **[YOUR_INDUSTRY_JOB_BOARD]** - a niche/industry board for your field (optional)
- **[YOUR_ADDITIONAL_JOB_BOARD]** - another major board for your market (optional)

Secondary (company career pages via Google):
- Direct Google searches with `site:` filters for known target companies

## Query Categories

Queries are grouped by priority. Write **each category in every language from your Languages table** (see Language scope above). Combine each query with your location terms (e.g. your city, region, or metro area) where the site supports it.

### Priority 1: [YOUR_PRIMARY_ROLE_TYPE]

These match your strongest and most desired career direction.

```
site:[YOUR_JOB_BOARD] "[YOUR_PRIMARY_JOB_TITLE]" [YOUR_CITY]
site:[YOUR_JOB_BOARD] "[YOUR_KEY_SKILL]" [YOUR_CITY]
site:linkedin.com/jobs "[YOUR_PRIMARY_JOB_TITLE]" [YOUR_COUNTRY]
```

### Priority 2: [YOUR_DOMAIN_EXPERTISE]

These match your domain expertise.

```
site:[YOUR_JOB_BOARD] [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] OR [YOUR_REGION]
site:[YOUR_JOB_BOARD] [YOUR_DOMAIN_KEYWORD_2] [YOUR_COUNTRY]
site:linkedin.com/jobs [YOUR_DOMAIN_KEYWORD_1] [YOUR_CITY] [YOUR_COUNTRY]
```

### Priority 3: [YOUR_ADJACENT_ROLE_TYPE]

Adjacent roles you could pivot into.

```
site:[YOUR_JOB_BOARD] "[YOUR_ADJACENT_TITLE_1]" [YOUR_KEY_SKILL] [YOUR_CITY]
site:[YOUR_JOB_BOARD] "[YOUR_ADJACENT_TITLE_2]" [YOUR_KEY_SKILL] [YOUR_CITY]
```

### Priority 4: Broader Technical / Consulting

Wider net for general technical roles.

```
site:[YOUR_JOB_BOARD] [YOUR_KEY_SKILL] developer [YOUR_CITY]
site:linkedin.com/jobs "[YOUR_KEY_SKILL] developer" [YOUR_CITY]
site:[YOUR_JOB_BOARD] "technical consultant" [YOUR_DOMAIN] [YOUR_CITY]
```

## Location Filter

When evaluating results, verify the job location is within reasonable commute distance from your home. Define acceptable areas:
- [YOUR_CITY] and surrounding areas
- [ACCEPTABLE_AREA_1]
- [ACCEPTABLE_AREA_2]
- [BORDERLINE_AREA] (borderline - ~X min by transit)
- [TOO_FAR_AREA] (too far)

## Language Filter

Your working languages and levels are in CLAUDE.md's Languages table. When filtering scraped results, apply `04-job-evaluation.md`'s Language Gate: a posting requiring a language you haven't declared at all is excluded; a posting requiring a higher level than you declared in a language you do work in is not excluded, flag it clearly instead (see `job-scraper/SKILL.md`'s Step 3 "Quick Fit Assessment" for how the flag surfaces in `/scrape` output). Postings simply *written* in a language you don't work in, that don't require it on the job, are fine.

## Langue d'annonce par portail

À distinguer du Language Filter ci-dessus (langues *du candidat*, pour exclure/flaguer des
offres après scraping) : cette section documente, portail par portail, la langue réelle des
annonces et donc la langue dans laquelle une requête `--query`/`-q` doit être formulée pour
obtenir des résultats sur ce portail précis.

| Portail | Langue(s) vérifiée(s) | Preuve |
|---|---|---|
| `greenfield-search` | Anglais uniquement | `comptable` → 0 résultat, `accountant` → résultats réels (vérifié 13/08/2026 — `.agents/skills/greenfield-search/url-reference.md`) |
| `legrand-search` | Français (annonces Luxembourg) / néerlandais-anglais (annonces Belgique) | `.agents/skills/legrand-search/SKILL.md`, vérifié 12/08/2026 |
| `alleyesonme-search` | Français/anglais | `.agents/skills/alleyesonme-search/SKILL.md` ("~3,150 offers, French/English") |
| `manpower-search` | Français | `comptable` → 5 résultats, `accountant` → 0 (vérifié 13/08/2026). **Limite de la preuve** : `accountant` → 0 résultat établit qu'aucune annonce ne contient ce terme, pas qu'aucune annonce anglaise n'existe — mais pour construire des requêtes, chercher en français. Confirmé séparément le même jour : pas de version anglaise du site (`/en/jobs/` redirige en 301 vers `/jobs-2/`, qui redirige à son tour vers `/fr/offres/`, la même liste française) — corrige la description antérieure du `SKILL.md` ("fr/en postings"), qui n'avait jamais été vérifiée. |
| `randstad-search` | Français (chemin `/emplois/...`, utilisé par le CLI) — un chemin anglais existe (`/en/jobs/...`, confirmé 200 avec du contenu réellement anglais le 13/08/2026) mais **le CLI ne le construit pas aujourd'hui**, seulement `/emplois/...` (voir `helpers.ts`) | `robots.txt` ne bloque que les combinaisons multi-filtres et le radius-search sous `/en/jobs/` (`Disallow: /en/jobs/*,*/`, `Disallow: /en/jobs/radius`), jamais le chemin de base — garde-fou existant, à ne jamais contourner ni retirer |
| `eures-search` | Multilingue — `--lang <code>` paramétrable, défaut `fr` | `.agents/skills/eures-search/SKILL.md`/`url-reference.md` (`requestLanguage`) |
| `francetravail` | Français (présumé — marché national France) | **Non vérifié : aucune skill `francetravail-search` n'existe dans ce dépôt**, aucune autre trace non plus. Ligne ajoutée à titre de repère marché uniquement, pas comme un fait vérifié sur un portail installé — à confirmer si/quand une skill est construite via `/add-portal`. |

**Phase 5** : la génération de requêtes par portail devra décliner chaque intitulé de métier
dans la langue réelle de chaque portail (tableau ci-dessus), pas seulement dans les langues
déclarées du candidat (Language Filter ci-dessus) — un portail anglophone comme
`greenfield-search` ne renverra rien pour une requête purement en français, et inversement
pour `manpower-search`.

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Sources en mode alerte (non-scrapables)

Ces portails ne doivent **jamais** avoir de skill de scraping dédiée (`.agents/skills/*-search/`),
même pour un usage personnel à faible volume. Couverture uniquement via alerte e-mail du
portail → `/gmail-sync` → `/apply <url>` sur chaque offre individuelle.

- **indeed.lu, indeed.fr, optioncarriere.lu, lhh.com, andersonwise.lu, lesfrontaliers.lu**
  — exclues par règle absolue de l'utilisateur (audit du 12/08/2026), raison non détaillée
  ici.
- **en.jobs.lu** (hôte canonique ; `www.jobs.lu`/`jobs.lu` redirigent dessus) — skill
  `jobslu-search` construite le 12/08/2026 (`.agents/skills/jobslu-search/`), mais
  **désactivée par décision assumée** plutôt que par contrainte technique non contournable.
  `robots.txt` absent (404) sur les trois hôtes, aucun refus déclaré à ce niveau — la cause
  est un challenge Akamai Bot Manager, confirmé le 12/08/2026 via un test qui alterne l'UA à
  chaque requête **et** vérifie le contenu de la réponse (pas seulement le code HTTP, car la
  page de challenge répond aussi en `200`) : le blocage cible spécifiquement les UA
  d'outils (`jobslu-search-cli/1.0 (personal job search)` compris), stable sur la fenêtre
  testée, alors qu'un UA générique passe systématiquement. Deux lectures précédentes du même
  jour s'étaient trompées, l'une par mesure invalide (code HTTP seul), l'autre par méthode
  invalide (deux séries successives par UA au lieu d'une alternance stricte) — détail complet
  et méthode correcte dans `.agents/skills/jobslu-search/url-reference.md`.
  **Décision : ne pas basculer sur un UA générique pour passer.** Le site trace une
  distinction délibérée entre "outil qui s'annonce" et "pas un outil" ; s'y soustraire
  contournerait cette intention même sans usurper une identité précise. La skill et ses
  parseurs restent en place (`SKILL.md`: `enabled: false`), vérifiés sur des fixtures réelles,
  réactivables sans changement de code si la politique du site évolue. Couverture actuelle :
  alertes e-mail jobs.lu (compte existant) → `/gmail-sync` → `/apply <url>`.
- **moovijob.com** — un Cloudflare Managed Challenge (JS/cookies, en-tête
  `cf-mitigated: challenge`, page "Just a moment...") a bloqué la page de listing
  (`/offres-emploi/jobs-luxembourg`) et même la page d'accueil, de façon reproductible sur
  plusieurs essais. Constaté et documenté le 12/08/2026. `robots.txt` n'interdit pas les
  chemins visés : ce n'est pas un refus déclaré du site, mais une protection technique active
  exigeant l'exécution de JS, hors de portée de tout en-tête honnête. Pas de tentative de
  contournement, même règle que ci-dessus.
  **Confirmé UA-indépendant (contrairement à `en.jobs.lu` ci-dessus) :** retesté le
  12/08/2026 avec un UA honnête sans préfixe navigateur (`moovijob-search-cli/1.0 (personal
  job search)`) — toujours 403. Le blocage tient donc à Cloudflare lui-même, pas à un motif
  d'UA suspect. **À retester dans ~6 mois** via `python3 tools/robots_check.py` puis un fetch
  direct, la situation peut évoluer.
  Route de remplacement : alertes e-mail Moovijob quotidiennes (comptes existants) →
  `/gmail-sync` → `/apply <url>`. Egalement candidat à une passe manuelle hebdomadaire via
  Claude in Chrome (session navigateur réelle, résout le challenge comme un utilisateur
  normal) si une couverture plus large que les alertes e-mail s'avère nécessaire.

## Sources à réévaluer (candidates /add-portal, pas encore construites)

Contrairement aux portails de la section précédente, celles-ci ne sont **pas** exclues par
principe — la reconnaissance disponible est juste insuffisante ou contradictoire pour
lancer `/add-portal` en confiance. Alerte e-mail en attendant.

*(en.jobs.lu retiré de cette section — passée en mode alerte ci-dessus après construction
et désactivation de la skill `jobslu-search`, pas un simple retour au statut "candidate".)*

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
