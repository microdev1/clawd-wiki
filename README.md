# clawd-wiki

A wiki-style index of knowledge mined from Claude Code session transcripts, built for future agents to navigate. Each page is a mini-article (prose + verbatim code + alternatives) rather than a terse bullet list — inspired by Karpathy's LLM-wiki pattern and the Farzapedia generation skill.

The pipeline walks `~/.claude/projects/**/*.jsonl`, scrubs PII, distills each session with parallel Sonnet subagents, normalizes and lints the output, ingests it into HydraDB, and renders a static React Router SSG site.

## Pipeline

<p align="center">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 780" width="820" role="img" aria-label="clawd-wiki pipeline diagram">
  <title>clawd-wiki pipeline</title>
  <defs>
    <linearGradient id="g-collect"  x1="0" x2="1"><stop offset="0" stop-color="#0e7490"/><stop offset="1" stop-color="#22d3ee"/></linearGradient>
    <linearGradient id="g-distill"  x1="0" x2="1"><stop offset="0" stop-color="#6d28d9"/><stop offset="1" stop-color="#c084fc"/></linearGradient>
    <linearGradient id="g-verify"   x1="0" x2="1"><stop offset="0" stop-color="#b45309"/><stop offset="1" stop-color="#fbbf24"/></linearGradient>
    <linearGradient id="g-verified" x1="0" x2="1"><stop offset="0" stop-color="#047857"/><stop offset="1" stop-color="#34d399"/></linearGradient>
    <linearGradient id="g-hydra"    x1="0" x2="1"><stop offset="0" stop-color="#be185d"/><stop offset="1" stop-color="#f472b6"/></linearGradient>
    <linearGradient id="g-mdx"      x1="0" x2="1"><stop offset="0" stop-color="#1d4ed8"/><stop offset="1" stop-color="#60a5fa"/></linearGradient>
    <linearGradient id="g-site"     x1="0" x2="1"><stop offset="0" stop-color="#b91c1c"/><stop offset="1" stop-color="#fb923c"/></linearGradient>
    <linearGradient id="g-input"    x1="0" x2="1"><stop offset="0" stop-color="#334155"/><stop offset="1" stop-color="#94a3b8"/></linearGradient>
    <style><![CDATA[
      .bg     { fill: #0d1117; }
      .label  { fill: #f8fafc; font: 700 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .sub    { fill: #e2e8f0; font: 400 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; opacity: 0.85; }
      .cmd    { font: 700 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
      .edge   { stroke: #475569; stroke-width: 1.5; fill: none; }
      .flow   { stroke-width: 3; fill: none; stroke-dasharray: 10 14; stroke-linecap: round; }
    ]]></style>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"/>
    </marker>
  </defs>

  <rect class="bg" width="820" height="780"/>

  <!-- Nodes -->
  <g>
    <rect x="260" y="20"  width="300" height="60" rx="10" fill="url(#g-input)"   stroke="#94a3b8" stroke-width="1.5"/>
    <text class="label" x="410" y="48"  text-anchor="middle">Claude Code session logs</text>
    <text class="sub"   x="410" y="66"  text-anchor="middle">~/.claude/projects/**/*.jsonl</text>

    <rect x="260" y="150" width="300" height="60" rx="10" fill="url(#g-collect)" stroke="#22d3ee" stroke-width="1.5"/>
    <text class="label" x="410" y="178" text-anchor="middle">collected</text>
    <text class="sub"   x="410" y="196" text-anchor="middle">data/collected/&lt;id&gt;/{transcript,tools/*}.md</text>

    <rect x="260" y="280" width="300" height="60" rx="10" fill="url(#g-distill)" stroke="#c084fc" stroke-width="1.5"/>
    <text class="label" x="410" y="308" text-anchor="middle">distilled</text>
    <text class="sub"   x="410" y="326" text-anchor="middle">data/distilled/&lt;id&gt;.md</text>

    <rect x="260" y="410" width="300" height="60" rx="10" fill="url(#g-verified)" stroke="#34d399" stroke-width="2"/>
    <text class="label" x="410" y="438" text-anchor="middle">verified</text>
    <text class="sub"   x="410" y="456" text-anchor="middle">data/verified/&lt;id&gt;.md</text>

    <rect x="40"  y="570" width="280" height="60" rx="10" fill="url(#g-hydra)"   stroke="#f472b6" stroke-width="1.5"/>
    <text class="label" x="180" y="598" text-anchor="middle">HydraDB tenant</text>
    <text class="sub"   x="180" y="616" text-anchor="middle">clawd-wiki · synthesis store</text>

    <rect x="500" y="570" width="280" height="60" rx="10" fill="url(#g-mdx)"     stroke="#60a5fa" stroke-width="1.5"/>
    <text class="label" x="640" y="598" text-anchor="middle">MDX wiki</text>
    <text class="sub"   x="640" y="616" text-anchor="middle">app/content/wiki/**/*.mdx</text>

    <rect x="500" y="690" width="280" height="60" rx="10" fill="url(#g-site)"    stroke="#fb923c" stroke-width="1.5"/>
    <text class="label" x="640" y="718" text-anchor="middle">static site</text>
    <text class="sub"   x="640" y="736" text-anchor="middle">build/client/**/*.html</text>
  </g>

  <!-- Edges -->
  <!-- logs → collected -->
  <path class="edge" d="M 410 80 L 410 150" marker-end="url(#arrow)"/>
  <path class="flow" stroke="#22d3ee" d="M 410 80 L 410 150">
    <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.4s" repeatCount="indefinite"/>
  </path>
  <text class="cmd" x="420" y="120" fill="#22d3ee">bun run collect</text>

  <!-- collected → distilled -->
  <path class="edge" d="M 410 210 L 410 280" marker-end="url(#arrow)"/>
  <path class="flow" stroke="#c084fc" d="M 410 210 L 410 280">
    <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.4s" begin="0.2s" repeatCount="indefinite"/>
  </path>
  <text class="cmd" x="420" y="250" fill="#c084fc">sibling Claude Code · prompts/distill.md</text>

  <!-- distilled → verified -->
  <path class="edge" d="M 410 340 L 410 410" marker-end="url(#arrow)"/>
  <path class="flow" stroke="#fbbf24" d="M 410 340 L 410 410">
    <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.4s" begin="0.4s" repeatCount="indefinite"/>
  </path>
  <text class="cmd" x="420" y="380" fill="#fbbf24">bun run verify</text>

  <!-- verified → HydraDB -->
  <path class="edge" d="M 360 470 C 280 510, 220 530, 180 570" marker-end="url(#arrow)"/>
  <path class="flow" stroke="#f472b6" d="M 360 470 C 280 510, 220 530, 180 570">
    <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.6s" begin="0.6s" repeatCount="indefinite"/>
  </path>
  <text class="cmd" x="170" y="520" text-anchor="middle" fill="#f472b6">bun run ingest</text>

  <!-- verified → MDX -->
  <path class="edge" d="M 460 470 C 540 510, 600 530, 640 570" marker-end="url(#arrow)"/>
  <path class="flow" stroke="#60a5fa" d="M 460 470 C 540 510, 600 530, 640 570">
    <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.6s" begin="0.6s" repeatCount="indefinite"/>
  </path>
  <text class="cmd" x="650" y="520" text-anchor="middle" fill="#60a5fa">bun run generate</text>

  <!-- MDX → static site -->
  <path class="edge" d="M 640 630 L 640 690" marker-end="url(#arrow)"/>
  <path class="flow" stroke="#fb923c" d="M 640 630 L 640 690">
    <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.4s" begin="0.8s" repeatCount="indefinite"/>
  </path>
  <text class="cmd" x="650" y="665" fill="#fb923c">react-router build</text>

  <!-- planned feedback HydraDB → MDX -->
  <path d="M 320 600 L 500 600" stroke="#a78bfa" stroke-width="1.5" stroke-dasharray="4 5" fill="none" marker-end="url(#arrow)" opacity="0.85"/>
  <text class="sub" x="410" y="592" text-anchor="middle" fill="#a78bfa">planned: full_recall → gen</text>

  <!-- Pulsing node dots -->
  <g>
    <circle cx="250" cy="50"  r="4" fill="#94a3b8"><animate attributeName="opacity" values="0.2;1;0.2" dur="2s" repeatCount="indefinite"/></circle>
    <circle cx="250" cy="180" r="4" fill="#22d3ee"><animate attributeName="opacity" values="0.2;1;0.2" dur="2s" begin="0.3s" repeatCount="indefinite"/></circle>
    <circle cx="250" cy="310" r="4" fill="#c084fc"><animate attributeName="opacity" values="0.2;1;0.2" dur="2s" begin="0.6s" repeatCount="indefinite"/></circle>
    <circle cx="250" cy="440" r="4" fill="#34d399"><animate attributeName="opacity" values="0.2;1;0.2" dur="2s" begin="0.9s" repeatCount="indefinite"/></circle>
    <circle cx="60"  cy="600" r="4" fill="#f472b6"><animate attributeName="opacity" values="0.2;1;0.2" dur="2s" begin="1.2s" repeatCount="indefinite"/></circle>
    <circle cx="520" cy="600" r="4" fill="#60a5fa"><animate attributeName="opacity" values="0.2;1;0.2" dur="2s" begin="1.2s" repeatCount="indefinite"/></circle>
    <circle cx="520" cy="720" r="4" fill="#fb923c"><animate attributeName="opacity" values="0.2;1;0.2" dur="2s" begin="1.5s" repeatCount="indefinite"/></circle>
  </g>
</svg>
</p>

<details>
<summary>Text version</summary>

```
~/.claude/projects/**/*.jsonl
  → bun run collect       walk + scrub
data/collected/<id>/{transcript.md, tools/*.md}
  → sibling Claude Code session driven by prompts/distill.md
data/distilled/<id>.md
  → bun run verify        scrub + normalize frontmatter + lint slug graph
data/verified/<id>.md
  → bun run ingest        upload to HydraDB (idempotent via data/state.sqlite)
  → bun run generate      slug graph → MDX
app/content/wiki/{index,projects,concepts,pitfalls,work-units}/*.mdx
  → bun run build         react-router prerender
build/client/**/*.html
```

</details>

## Scripts

| Command | What it does |
| --- | --- |
| `bun run collect` | Walk Claude Code project logs, scrub credentials/PII, write per-session transcript + tool-call sidecars under `data/collected/`. |
| `bun run distill` | Helper for the sibling distillation session (prompts live in `prompts/`). |
| `bun run verify` | Post-distill gate: re-scan for PII, normalize YAML frontmatter, lint the slug graph; quarantine on conflict. |
| `bun run ingest` | Upload verified notes to HydraDB tenant `clawd-wiki`. Flags: `--init-tenant`, `--status`, `--force`, `--limit N`, `--poll`. |
| `bun run generate` | Read `data/verified/*.md`, emit MDX into `app/content/wiki/`. |
| `bun run dev` | React Router dev server for live page inspection. |
| `bun run build` | `generate` + `react-router build` → static site in `build/client/`. |
| `bun run start` | Serve the built site locally. |
| `bun run type` | `react-router typegen` + `tsc --noEmit`. |

`scripts/recall.ts "query"` is a smoke test against `full_recall` for the HydraDB tenant.

## Setup

Requires [Bun](https://bun.sh) (the pipeline scripts use Bun APIs).

```sh
bun install
cp .env.example .env   # fill in HYDRA_API_KEY and HYDRA_TENANT_ID
bun run ingest -- --init-tenant
```

## Layout

- `scripts/` — pipeline stages (`collect`, `verify`, `ingest`, `generate`, `recall`) plus shared helpers in `scripts/lib/` (scrub, normalize, lint, slugs, render, upload, ssg).
- `prompts/` — `distill.md` (orchestrator pasted into a sibling Claude Code session) and `distill-rules.md` (read from disk by each subagent per run; edit on disk and the next run picks it up).
- `app/` — React Router 7 SSG: routes for `/`, `/projects/:slug`, `/concepts/:slug`, `/pitfalls/:slug`, `/work-units/:slug`, MDX content loaded via `import.meta.glob`, Tailwind 4 + Shiki for syntax highlighting.
- `data/` — gitignored working state: `collected/`, `distilled/`, `verified/`, `state.sqlite` (ingest ledger).
- `config/` — runtime config (scrub denylist, project path roots, etc.).
- `docs/` — design references: Karpathy's LLM-wiki note, the Farzapedia skill, the HydraDB `llms.txt`.

## Scrubbing

Three layers defend against leaking session content:

1. Regex pre-scrub at collect time (`scripts/lib/scrub.ts`): credentials, paths, emails, IPs, phones, denylist. Paths under configured project roots collapse to `<PATH:project=NAME>` so project names survive as anchors.
2. LLM-driven redaction rules in `prompts/distill-rules.md` — explicit KEEP (project / library / code identifiers) vs STRIP (people, companies, paths, emails, IPs, internal jargon).
3. `scripts/verify.ts` re-runs the scan post-distill and quarantines on any surviving PII match.

## HydraDB

Uses `@hydradb/sdk` against tenant `clawd-wiki`. One `app_knowledge` source per verified note; tenant metadata `{ project, session_id, branch }` is filterable. Idempotency via `data/state.sqlite` keyed on session id + SHA-256 of the verified markdown.
