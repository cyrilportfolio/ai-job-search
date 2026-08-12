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

## Date Filter

Only include jobs posted within the last 14 days, or with an application deadline that has not yet passed. If a posting date cannot be determined, include it but flag as "date unknown".

## Sources en mode alerte (non-scrapables)

Ces portails ne doivent **jamais** avoir de skill de scraping dédiée (`.agents/skills/*-search/`),
même pour un usage personnel à faible volume. Couverture uniquement via alerte e-mail du
portail → `/gmail-sync` → `/apply <url>` sur chaque offre individuelle.

- **indeed.lu, indeed.fr, optioncarriere.lu, lhh.com, andersonwise.lu, lesfrontaliers.lu**
  — exclues par règle absolue de l'utilisateur (audit du 12/08/2026), raison non détaillée
  ici.
- **moovijob.com** — un Cloudflare Managed Challenge (JS/cookies, en-tête
  `cf-mitigated: challenge`, page "Just a moment...") a bloqué la page de listing
  (`/offres-emploi/jobs-luxembourg`) et même la page d'accueil, de façon reproductible sur
  plusieurs essais. Constaté et documenté le 12/08/2026. `robots.txt` n'interdit pas les
  chemins visés : ce n'est pas un refus déclaré du site, mais une protection technique active
  exigeant l'exécution de JS, hors de portée de tout en-tête honnête. Pas de tentative de
  contournement, même règle que ci-dessus.
  **Confirmé UA-indépendant (contrairement à `en.jobs.lu`, voir plus bas) :** retesté le
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

*(en.jobs.lu retiré de cette section — skill construite, voir ci-dessous.)*

## Sources couvertes par un skill (historique de reconnaissance)

- **en.jobs.lu** (hôte canonique ; `www.jobs.lu`/`jobs.lu` redirigent dessus) — skill
  `jobslu-search` générée le 12/08/2026, voir `.agents/skills/jobslu-search/`. `robots.txt`
  absent (404) sur les trois hôtes, aucun refus déclaré.
  **Blocage Akamai Bot Manager : la lecture "intermittent, indépendant de l'UA" du premier
  passage (matin du 12/08) était incomplète.** Un nouveau test A/B plus serré, le même jour
  lors de la génération de la skill, montre une corrélation reproductible avec l'UA : tout
  UA personnalisé de type outil (`jobslu-search-cli/1.0 (personal job search)`, sa variante
  `/1.1`, et même l'ancienne forme "navigateur" `Mozilla/5.0 (compatible; ...)`) déclenche le
  challenge à chaque tentative (5/5), alors que des UA génériques très répandus (`curl/8.x`
  nu, `python-requests/2.31.0`, un vrai UA de navigateur) passent systématiquement. Détail
  complet et tableau du test dans `.agents/skills/jobslu-search/url-reference.md`. La skill
  garde volontairement l'UA honnête par défaut (jamais de bascule vers un UA générique pour
  contourner le blocage — ce serait de l'usurpation, pas une identification honnête) et
  détecte explicitement la page de challenge (`CHALLENGE_BLOCKED`) plutôt que de retourner un
  résultat vide silencieux. Statut au 12/08/2026 soir : toujours bloqué avec l'UA honnête
  (retesté après plusieurs minutes). Alerte e-mail jobs.lu → `/gmail-sync` → `/apply <url>`
  reste la couverture de secours quand `CHALLENGE_BLOCKED` apparaît.

## Adapting Queries

If the user specifies a focus area, select queries from the matching category and also generate 2-3 custom queries for that focus. For example:
- "/scrape [focus_area]" -> relevant category queries + custom focus-specific queries
