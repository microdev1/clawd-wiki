# Distillation rules — clawd-wiki

These rules govern how a single Claude Code session transcript is distilled into a wiki note.

## Audience and goal

Use `[[slug]]` wikilink syntax for every project, work unit, pitfall, and concept so the wiki-gen stage can build bi-directional backlinks.

Slug conventions:

- `[[project:<kebab-name>]]` — e.g. `[[project:cilayer]]`
- `[[work:<kebab-slug>]]` — e.g. `[[work:backend-frontend-contract]]`
- `[[pitfall:<kebab-slug>]]` — e.g. `[[pitfall:polling-too-fast]]`
- `[[concept:<kebab-slug>]]` — e.g. `[[concept:exponential-backoff]]`

The chain to expose is: **project → work unit → pitfall → concept**. Every distilled note with a pitfall should name the concept that resolved it; every concept should reference the pitfall(s) it addresses. This is what makes the wiki navigable.

## Redaction — what to KEEP and what to STRIP

KEEP (project navigation depends on these):

- Project / repo / codebase names: `cilayer`, `cfilayer`, `clawd-wiki`, `IBD`, etc. The transcript surfaces these as `<PATH:project=NAME>` placeholders. Treat NAME as a real project name and reference it as `[[project:NAME]]` when relevant.
- Library / framework / tool names: React Router, TanStack Query, Drizzle, Shiki, Spark, Kafka, etc.
- Technique / concept terminology.
- Project-specific code identifiers — function names, hook names, component names, type names, module aliases (`useArtifactJson`, `EnrichRun`, `@/lib/dag`, `enrichment-view.tsx`), relative module paths. They are valuable anchors for future agents working in the same project. They belong under `[[project:*]]` / `[[work:*]]` entries naturally. (`[[concept:*]]` definitions should still read as transferable knowledge, but mentioning the specific identifier the project uses is fine — wiki-gen separates project-page detail from concept-page generality later.)

STRIP — output must contain ZERO of these:

- Person names, usernames, email addresses, phone numbers.
- Company / organisation names, hostnames, URLs to private resources.
- Absolute filesystem paths. The transcript already replaced these with `<PATH>`, `<PATH:project=NAME>`, `<EMAIL>`, `<REDACTED>`, `<ENCODED_PATH>`, `<IP>`, `<PHONE>` placeholders.
- Internal jargon that only makes sense at one company.

Critical rules:

- Treat surviving identifiers as a failure. When in doubt, paraphrase or drop the sentence.
- Never echo the context around a placeholder if doing so would re-identify the original. ("I edited `<PATH>` to add a plugin" → write "added a Vite plugin", not "edited a path to add a plugin".)
- Never invent a value for a placeholder.
- Project-name placeholders ARE the exception — `<PATH:project=cilayer>` means you may say "in cilayer" or `[[project:cilayer]]`.

## Content rules

- Extract TRANSFERABLE knowledge, not chronology. "Cursor pattern works well with TanStack Query when X" — not "the user did X then Y".
- A fact only meaningful inside one specific codebase = drop it. Keep only what generalises.
- No stubs. If a section would have fewer than two items, omit the section entirely.
- Quote the user directly only when their exact phrasing carries information paraphrase would lose. Use blockquotes and `[...]` to drop identifiers.
- Distill the session if ANY of {techniques, concepts, pitfalls} would have non-trivial entries — even if the other categories are empty. A session full of useful techniques but no clear pitfalls IS worth distilling; omit the empty sections.
- SKIP only when the session is genuinely trivial: status check, one-off syntax question, a fix with no general lesson, pure tool-output inspection. When in doubt, distill. Write exactly one line as the file content and stop:

  ```
  <!-- SKIP: no transferable knowledge -->
  ```

## Output format

Write the file as Markdown with this exact frontmatter shape:

```
---
title: <concept-oriented title, 3-8 words>
source_session: <session id — filename without .md>
project: <primary project slug, or null if none>
projects_referenced: [list of other project slugs touched, kebab-case]
work_units: [kebab-slugs]
pitfalls: [kebab-slugs]
concepts: [kebab-slugs]
---

## Summary
<2-4 sentences, dense and factual. May reference [[project:*]], [[work:*]], [[pitfall:*]], [[concept:*]] inline.>

## Work units
- **[[work:<slug>]]** — <1-2 sentences on what was tackled>. Encountered [[pitfall:<slug>]]; applied [[concept:<slug>]].
- ...

## Pitfalls
- **[[pitfall:<slug>]]** — <what went wrong, generic phrasing>. Resolved by [[concept:<slug>]]. Context: <when this surfaces>.
- ...

## Concepts
- **[[concept:<slug>]]** — <one-line definition or role>. Applies when <condition>. Related: [[concept:<other>]], [[concept:<other>]].
- ...

## Techniques
1. <numbered transferable technique, 1-3 sentences. Reference [[concept:*]] inline. Include code only when essential — fenced with language.>
2. ...

## Decisions and tradeoffs
- <bullets describing non-obvious choices and *why*, abstracted from any specific project>
- ...
```

Section rules:

- The frontmatter slug lists (`work_units`, `pitfalls`, `concepts`) MUST exactly match the slugs used in the body's `[[type:slug]]` references. They are the index the wiki-gen scans.
- Omit any section whose list would have fewer than two items. (Better: zero entries than thin ones.)
- No preamble, no trailing remarks, no explanation of the distillation itself.

## Pre-flight checklist — verify BEFORE calling Write

A `verify` gate runs after distillation and quarantines any file that fails these checks. Self-check first; a quarantined file blocks ingestion.

1. **Every body `[[work:|pitfall:|concept:slug]]` reference has its slug declared in the matching frontmatter list.** If you write `[[concept:exponential-backoff]]` anywhere in the body, `exponential-backoff` must appear in the `concepts:` frontmatter list — and there should be a `[[concept:exponential-backoff]]` definition entry in the `## Concepts` section.
2. **Every frontmatter-declared slug is referenced at least once in the body.** No dead declarations.
3. **A slug uses ONE type prefix consistently.** If `foo-bar` is declared as a pitfall, never write `[[concept:foo-bar]]` (even in "Related:" lines). Pick the type at first use and stay there.
4. **Cross-references inside one section's bullets use the OTHER section's type.** A pitfall's "Resolved by" points at a `[[concept:*]]`. A concept's "Related:" points at other `[[concept:*]]`s (or a `[[pitfall:*]]` when relevant), never at itself.
5. **The `project:` type is free-form** — it does NOT appear in any frontmatter slug list and is exempt from these checks.

Mentally walk through each `[[...]]` in your draft and confirm the slug appears in the right frontmatter list. Mismatches are the most common cause of quarantine.

## When done

Write the file with the Write tool. Report back exactly one line: either `ok` (file written) or `skip` (no transferable knowledge). Nothing else.
