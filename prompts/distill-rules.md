# Distillation rules — clawd-wiki

One Claude Code session → one wiki note. The note is read by future AGENTS landing on a slug page, not by humans skimming a list.

## The spine: work → pitfall → concept

Every session that's worth distilling tells one story:

1. **What work was done?** A discrete piece of engineering with a goal and an outcome.
2. **What pitfalls were hit?** Specific failing patterns — wrong code, wrong assumption, wrong tool use — that blocked or detoured the work.
3. **What concepts resolved them?** Generic, reusable engineering patterns that future agents can recognize and apply.

## Slug conventions

- `[[project:<kebab>]]` — codebase / repo name. Free-form.
- `[[work:<kebab>]]` — what was tackled. Project-anchored is fine.
- `[[pitfall:<kebab>]]` — a specific failing pattern.
- `[[concept:<kebab>]]` — a GENERIC engineering pattern reusable across codebases. Never project-bound.

A pitfall's "Resolved by" cites a `[[concept:*]]`. A concept's "Related:" cites other concepts or pitfalls. Never self-cite.

## Redaction

KEEP: project / repo names (surface as `<PATH:project=NAME>` → say "in NAME" or `[[project:NAME]]`), library / framework names, code identifiers (function / hook / component / type / module names).

STRIP — zero tolerance: person names, usernames, emails, phones, company / org names, private hostnames, absolute filesystem paths, internal jargon. Transcript already replaced these with `<PATH>`, `<EMAIL>`, `<REDACTED>`, `<IP>`, `<PHONE>` etc. — don't re-identify by context. Never invent a value for a placeholder. When in doubt, drop the sentence.

Any surviving identifier = quarantine. Project-name placeholders are the lone exception.

## Bullet depth

- **Summary**: 3-6 sentences. State what was done, the pitfalls hit, the concepts applied, the outcome. Reference `[[work:*]]`, `[[pitfall:*]]`, `[[concept:*]]` inline.
- **Work units**: 2-4 sentences each. What was tackled → pitfall hit → concept applied → outcome.
- **Pitfalls**: 2-4 sentences each. Failing pattern in plain terms → `Resolved by [[concept:*]]` → when it surfaces. Quote a reproducible error or command if the session captured one.
- **Concepts**: 3-5 sentences each. **Generic only.** Definition → when it applies → when it does NOT → 1-2 related slugs. A project may be cited as an example ("e.g. cilayer applied this in `useArtifactJson`"), but the concept must stand alone. If a candidate can't be restated without naming a project, demote it to a `[[work:*]]` or fold into a Technique snippet.
- **Techniques**: 3-8 numbered items, each 3-6 sentences, each with a verbatim fenced code block from a `tools/*.md` you actually read. Cite the slug(s) the technique relates to.
- **Decisions and tradeoffs**: 2-6 bullets. Choice → alternative considered → why this won. Cite the relevant concept or pitfall.

Omit any section whose list would have fewer than two items. Empty > thin.

## Calibration examples

Not from real sessions — they show the SHAPE you're targeting. Match the depth and abstraction, not the topic.

**Concept:**
- **[[concept:idempotency-key]]** — A client-supplied unique token on a mutating request so the server can dedupe replays; the server stores `key → result` for a TTL and returns the stored result on retry. Applies whenever retries are possible (network, queue redelivery, client crash) on state-changing operations. Does NOT apply to read-only calls or when at-most-once delivery is already guaranteed by transport. Related: [[concept:exponential-backoff]].

**Pitfall:**
- **[[pitfall:n-plus-one-query]]** — Iterating N parent rows and issuing one child query per row instead of a batch. Hidden by ORM lazy-loaders; tests pass with small fixtures, p95 latency grows linearly in prod. Symptom: ORM logs show N+1 sequential `SELECT … WHERE parent_id = ?`. Resolved by [[concept:batch-load-via-in-clause]] or an eager join.

**Work unit:**
- **[[work:rate-limit-middleware-rollout]]** — Added per-API-key token-bucket limiting to public mutations. The in-memory store let scaled replicas exceed the global cap ([[pitfall:limit-store-not-shared-across-instances]]); moved to Redis `INCR` + `EXPIRE`. Applies [[concept:token-bucket-rate-limit]]; outcome is consistent 429s under load.

Don't emit these. They're calibration only.

## Supplementing with general knowledge

If you do supplement, one sentence of background is fine (e.g. naming a well-known pattern, explaining a standard library behavior). Never invent project-specific facts; when unsure if a fact came from the session or from training, drop it.

## SKIP sentinel

When the orchestrator's triage rules tell you to skip, write this exact content as the entire file:

```
<!-- SKIP: no transferable knowledge -->
```

## Output format

```
---
title: <concept-oriented title, 3-8 words>
source_session: <session id>
project: <primary project slug, or null>
projects_referenced: [other project slugs]
work_units: [kebab-slugs]
pitfalls: [kebab-slugs]
concepts: [kebab-slugs]
---

## Summary
<3-6 sentences, work → pitfall → concept → outcome, with inline slug refs.>

## Work units
- **[[work:<slug>]]** — <what tackled, pitfall hit, concept applied, outcome.>
- ...

## Pitfalls
- **[[pitfall:<slug>]]** — <failing pattern, Resolved by [[concept:<slug>]], when it surfaces. Quote a reproducible error if captured.>
- ...

## Concepts
- **[[concept:<slug>]]** — <generic definition, applies / does NOT apply, related slugs. Project code allowed only as example.>
- ...

## Techniques
1. **<short title>.** <3-6 sentences citing [[type:slug]] inline.>

   ```<language>
   <verbatim code from a tools/*.md you read>
   ```

2. ...

## Decisions and tradeoffs
- **<choice>.** <alternative considered, why this won, relevant [[concept:*]] or [[pitfall:*]].>
- ...
```

Code blocks should be syntax-tagged. No preamble, no trailing remarks, no meta-commentary about the distillation.

## Pipeline auto-fixes vs. agent invariants

The `verify` step auto-syncs frontmatter `work_units` / `pitfalls` / `concepts` lists with body refs, and parses both flow and block YAML — don't worry about exact matches.

You MUST keep these correct (not auto-fixable):

1. **One type prefix per slug** within the note. If something's `[[pitfall:foo]]` once, it stays a pitfall.
2. **Cross-references point at the OTHER section's type.** Pitfall's "Resolved by" → concept. Concept's "Related:" → other concepts (or pitfalls). Never self.
3. **Every body-cited `[[concept:*]]` / `[[work:*]]` / `[[pitfall:*]]` has its own defining bullet in its section.** Otherwise it renders as an orphan with no page behind it.
4. **Code snippets come from `tools/*.md` files you actually read.** No fabrication. Prose-only is fine if nothing was worth quoting.
