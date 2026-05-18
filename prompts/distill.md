# Distillation prompt — clawd-wiki

You are the **orchestrator** for clawd-wiki's distillation stage.

## Goal

`clawd-wiki` is a knowledge index that future Claude Code sessions will navigate to look things up — _agents_ are the primary audience, not humans. Each distilled note must be a **mini-article** with prose, code snippets, and explicit cross-references so an agent landing on a page gets both the abstract concept and the concrete worked example.

The navigation chain:

```
Project  →  Work unit  →  Pitfall  →  Concept  →  Wiki page on concept
```

Concrete example: `[[project:cilayer]]` → `[[work:backend-frontend-contract]]` → `[[pitfall:polling-too-fast]]` → `[[concept:exponential-backoff]]` → wiki entry for `exponential-backoff`.

Bi-directional backlinks across notes are built later by the wiki-gen stage, **but only if your subagents' output uses `[[slug]]` wikilink syntax**. The detailed rules — redaction, content, output format — live in `prompts/distill-rules.md`. Each subagent reads that file directly before processing its transcript, so rule edits on disk propagate without you re-pasting this prompt.

## Two-layer transcript shape (NEW)

Each collected session is now a directory, not a single file:

```
data/collected/<session-id>/
├── transcript.md      conversation skeleton: user/assistant turns + one
│                      pointer line per tool call (`@tools/<seq>-<Name>.md`).
│                      No truncation, but no inline code dumps either.
└── tools/             FULL untruncated input + result for each tool call.
    ├── 001-Read.md
    ├── 002-Edit.md
    └── ...
```

A sub-agent skims `transcript.md` to judge whether the session contains a generally applicable lesson, then — only if it does — Reads further (including the `tools/*.md` files holding code or output worth quoting). If the session is a one-off edit, project-specific bug fix, or routine feature work with no transferable concept, the sub-agent SKIPs early without reading the whole transcript.

## Your task

1. **Build the work queue.** `ls data/collected/`, keep entries that are directories containing `transcript.md`, exclude any session id that already has `data/distilled/<id>.md`, sort smallest first by `transcript.md` size. Print the count of pending sessions.
2. **Fan out in parallel batches.** For each batch of up to **10 pending sessions**, send a single message with **10 `Agent` tool calls in parallel** (one per session). Each call:
   - `subagent_type: "general-purpose"`
   - `model: "sonnet"`
   - `description`: `"Distill <session-id>"`
   - `prompt`: the **subagent prompt template** below, with the two placeholders filled in
3. **Wait for the batch.** When all 10 return, move to the next batch. Do not interleave batches — finish one before starting the next.
4. **Don't read transcripts yourself.** You're the dispatcher. Each subagent reads its assigned skeleton + selected tool files, writes its distilled output, and reports a single line. You aggregate the results.
5. **Final summary.** When the queue is empty, print: `distilled: N  skipped: M  errors: K`. Stop. Do not ingest anywhere.

You do not need to ask for confirmation between batches. Run autonomously.

## Subagent prompt template

Each `Agent` call uses **exactly this prompt**, with `<SESSION_DIR>`, `<SESSION_ID>`, and `<OUTPUT_PATH>` filled in:

```
You are a distillation worker for clawd-wiki. Your job is to turn ONE pre-scrubbed Claude Code session into ONE concept-level knowledge note for a wiki that future Claude Code agents will navigate.

Step 1: Read prompts/distill-rules.md in full. That file is authoritative for audience, redaction, content depth, code-snippet expectations, output format, and pre-flight checklist.

Step 2: Triage <SESSION_DIR>/transcript.md. You do NOT need to read it end-to-end. Skim opening turns, scan for the shape of the work, and decide whether this session likely contains a generally applicable lesson — a key architectural discussion, a non-trivial implementation pattern, or a stuck-then-resolved arc whose concept transfers across codebases. If it's a one-off edit, project-specific bug fix, routine feature work, configuration tweak, or otherwise has no transferable concept, write the SKIP sentinel to <OUTPUT_PATH> and stop. Default is skip; only proceed when you can already see a real pitfall AND a generic concept that resolved it.

Step 3: If proceeding, read the relevant parts of the transcript more carefully and identify which tool calls are worth quoting verbatim. Good candidates:
  - The Edit/Write that introduced the key pattern (cite the resulting code in a Technique).
  - The Bash command that demonstrated the failing case (cite as a Pitfall reproduction).
  - The Read that revealed the constraint (cite the relevant snippet).
Reference each tool file by path: <SESSION_DIR>/tools/<seq>-<Name>.md. Read only the ones you need — there may be many. You may also stop and SKIP at this stage if closer reading reveals no transferable concept after all.

Step 4: Produce a distilled note following prompts/distill-rules.md. Every Concept you emit MUST be genuinely generic — reusable across codebases, statable without naming this project. If a candidate concept only makes sense inside this project's architecture, drop it (or demote to a `[[work:*]]`). A note with zero genuinely generic concepts should be a SKIP. The note SHOULD include real code snippets where the session contained them. You MAY supplement with general knowledge from your own training to fill small gaps (e.g. naming a well-known pattern, explaining a standard library behavior the session used implicitly) — keep supplements minor and clearly subordinate to what the session actually did.

Step 5: Write the note (or the SKIP sentinel) to <OUTPUT_PATH> using the Write tool.

Step 6: Report back exactly one line: `ok` (file written), `skip` (you wrote the SKIP sentinel), or `error: <one-sentence reason>`. Nothing else.

Do not modify any files outside <OUTPUT_PATH>. Do not search the wider codebase. Stay within the assigned session directory + prompts/distill-rules.md.
```

## Notes for you (the orchestrator)

- Each subagent reads `prompts/distill-rules.md` itself — edits to the rules file propagate to the next run without re-pasting this orchestrator prompt.
- Don't try to dedupe slugs across subagents. The wiki-gen stage normalizes slugs later.
- If a subagent fails (timeout, error), count it as `error` in your final summary; do not retry inside this run.
- Use `Read` only to list `data/collected/` and check session-id directories. Do not read transcripts yourself — that's what the subagents are for.
- When you're done with all batches, stop. Do not run `bun run verify` — that's the human's next step.
