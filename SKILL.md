# Auto-Skill Plugin

> An always-on skill automation agent that finds, creates, improves, imports, and indexes OpenCode skills — activated naturally via conversation, with full project-scoped awareness and self-managing index via sub-agent.

The auto-skill plugin runs in the background at all times. It monitors every interaction (messages, tools, errors) to build a **term profile** of what you're working on, and it maintains a **TF-IDF skillset index** that agents can instantly search. Instead of injecting noise into your context window, it exposes **8 tools** that agents call on demand. A **learning engine** observes patterns over time and suggests skill creation when it detects recurring tasks.

---

## Quick Start

### For Agents — Natural Language Triggers

The auto-skill plugin understands these conversational prompts without needing exact tool names:

| When you say... | What it does |
|---|---|
| `find skills for X` / `get skills for X` / `search skills X` | Calls `auto_skill_search(query)` to find relevant skills |
| `list skills` / `show all skills` / `what skills do I have` | Calls `auto_skill_list()` to browse your index |
| `import skills from GitHub X` / `github skills for X` | Calls `auto_skill_import(repoUrl|query)` to discover + import |
| `create a skill for X` / `make a skill` / `teach me X as a skill` | Calls `auto_skill_create(name, description, body)` |
| `improve skill X` / `update skill X` / `this skill needs work` | Reads the existing SKILL.md, improves it, writes back, re-indexes |
| `merge skills X and Y` / `combine these skills` | Reads both skills, merges content, creates new combined skill, indexes it |
| `import skill from URL` / `web skill for X` | Calls `auto_skill_import(url)` to fetch from the web |
| `what skills are relevant right now` / `suggest a skill` | Calls `auto_skill_suggest(message, tools)` for context-aware suggestions |
| `status of my skills` / `index health` / `how many skills` | Calls `auto_skill_status()` to show index and learning stats |
| `learn about my patterns` / `what have you observed` | Calls `auto_skill_learn()` to surface learning engine insights |
| `I'm struggling with X` / `I don't know how to X` / `help me with X` | Calls `auto_skill_suggest(message)` to find helpful skills + triggers learning |

### For Humans — Always-On Behavior

The plugin requires no manual activation. On every message and tool call it:

1. **Records tool usage** (`tool.execute.before` hook) — tracks which tools are used and how often
2. **Observes messages** (`chat.message` hook) — extracts technical terms, question patterns, tech mentions
3. **Persists state** (`chat.after` hook) — saves learning patterns and term profile to disk

Whenever you type anything that sounds like "find skills", "get skills", "create skill", etc., an agent should:
1. Recognize the trigger phrase
2. Call the appropriate `auto_skill_*` tool
3. Return the result to you

---

## Tools Reference

### `auto_skill_search`
Search indexed skills by keyword with ranked relevance scores (0–10).

**Parameters:**
- `query` (string, required) — Search keywords (e.g., `"godot animation state machine"`)
- `limit` (number, optional, default 10) — Max results
- `category` (string, optional) — Filter by category (e.g., `"godot"`, `"testing"`, `"frontend"`)

**Returns:** `{ results: [{ name, description, score, slug, category, path }], total }`

### `auto_skill_list`
List all indexed skills with metadata.

**Parameters:**
- `category` (string, optional) — Filter by category
- `limit` (number, optional, default 50) — Max results
- `sort` (string, optional, `name|quality|recent`, default `quality`) — Sort order

### `auto_skill_status`
Show full index and engine status: total skills, term count, context window stats, term profile, learning engine patterns, tool usage, and suggestions.

### `auto_skill_suggest`
Get skill suggestions for current context. Pass the current message and recently used tools to get ranked recommendations.

**Parameters:**
- `message` (string, optional) — Current user message
- `tools` (string[], optional) — Recently used tool names
- `limit` (number, optional, default 5) — Max suggestions

### `auto_skill_learn`
Show learning engine status: observed patterns, frequently used tools, and auto-generated skill candidates.

### `auto_skill_info`
Get detailed information about a specific skill by name or slug (partial match supported).

**Parameters:**
- `name` (string, required) — Skill name or slug

### `auto_skill_create`
Create or update a SKILL.md file. Validates name, description, and body before writing. Automatically indexes on success.

**Parameters:**
- `name` (string, required) — Skill name (lowercase-hyphenated, max 64 chars)
- `description` (string, required) — One-line "Use when..." description (20–200 chars)
- `body` (string, required) — Full markdown body starting with `# Heading`
- `projectDir` (string, optional) — Project directory for project-local skill
- `targetDir` (string, optional) — Override target directory
- `categories` (string[], optional) — Category tags (e.g., `["godot", "animation"]`)

### `auto_skill_import`
Import skills from a GitHub repo or web URL.

**Parameters:**
- `repoUrl` (string, optional) — GitHub repo URL to scan for skills (e.g., `"github.com/user/repo"`)
- `url` (string, optional) — Web URL to a SKILL.md or documentation page
- `query` (string, optional) — GitHub search query for repos with skills (e.g., `"android xml skills"`)
- `discoverOnly` (boolean, default false) — Only list, do not import
- `targetDir` (string, optional) — Override target import directory

---

## Architecture

### Modules

| Module | Purpose |
|--------|---------|
| `skill-engine.mjs` | SKILL.md generation, parsing, YAML frontmatter, slugify |
| `skill-validator.mjs` | Skill quality scoring (0–100) and validation |
| `skillset-index.mjs` | TF-IDF term index for search (pure JSON, no ChromaDB) |
| `context-injector.mjs` | Term profile with exponential forgetting & tech term boosting |
| `context-window-manager.mjs` | Token-budget-aware relevance tracking with decay |
| `learning-engine.mjs` | Observation → pattern → suggestion pipeline |
| `event-hooks.mjs` | OpenCode lifecycle hook adapters |
| `skill-creator.mjs` | SKILL.md creation with directory routing + validation |
| `sourcing/github.mjs` | GitHub skill discovery and import (rate-limit aware) |
| `sourcing/web.mjs` | Web skill discovery and import (SKILL.md, markdown, HTML) |
| `index.mjs` | Plugin entry point — exports 8 tools + lifecycle hooks |

### Data Directory (`.opencode-auto-skill/`)

Persisted in the project root or `~/.config/opencode/`:

| File | Contents |
|------|----------|
| `skillset-index.json` | TF-IDF term → posting list, skill metadata, version |
| `context-profile.json` | Term profile with weights, categories, timestamps |
| `context-window.json` | Window usage stats, recent tools/terms |
| `learn-db.json` | Learning patterns (tool repeats, questions, tech mentions) |

---

## Skill Improvement Workflow

When an existing skill needs improvement — whether because the agent found it lacking, the user requested an update, or the learning engine flagged it — follow this process:

### 1. Read the existing skill
```bash
cat <skill-path>/SKILL.md   # or: cat <skill-path>.md
```

### 2. Improve the content
- Expand the description if it's too short (< 40 chars)
- Add code examples with ` ``` ` blocks (2+ for quality)
- Add more section headings (`##`) for structure
- Front-load concrete trigger keywords in the description
- Add checklists (`- [ ]`) for procedural skills
- Fix any outdated patterns, clarify ambiguous sections

### 3. Write back + re-index
Use `auto_skill_create` with the **same name** to overwrite:
- Pass `name` (same as existing), `description` (improved), `body` (improved)
- Set `targetDir` to the same directory (or omit for auto-routing)
- The plugin automatically re-indexes after successful write

### 4. Verify
Call `auto_skill_info(name)` to confirm the skill resolves correctly with the updated content.

**Auto-improvement triggers:** Whenever an agent observes the user struggling with a task, asks "how do I X" repeatedly, or the context profile shows high-weight terms that no existing skill covers, the agent should proactively:
1. `auto_skill_search(query)` — check if a skill already exists
2. If it exists but is weak/low-quality → improve it
3. If no skill exists → `auto_skill_create` a new one
4. If multiple partial skills exist → combine them

---

## Skill Combining / Merging

When two or more skills cover overlapping topics, combine them into a single, more comprehensive skill:

### Process
1. **Read all skills** — use `auto_skill_info(name)` or `cat <path>` to get full content
2. **Synthesize** — create a unified body that covers all concepts from both skills, deduplicating content and organizing with clear headings
3. **Create combined skill** — use `auto_skill_create` with a merged name (e.g., `android-ui-debugging-complete`)
4. **Optionally deprecate originals** — mark them as "superseded" by editing their description to include `(superseded by <new-skill-name>)`
5. **Delete deprecated originals** — remove the SKILL.md files and re-index with `auto_skill_import` → rebuild (or edit index directly)

### Auto-merge triggers
The learning engine may detect that two skills are frequently searched together. When this pattern emerges, suggest combining them and ask the user for confirmation.

---

## Project-Scoped vs Global Skills

Skills can be **global** (available to all projects) or **project-scoped** (only indexed when working in a specific project directory). This is critical for domain-specific skills like Godot, Unity, or mobile development.

### How it works

The plugin scans **all** configured skill directories during index build:

| Directory | Scope | When indexed |
|-----------|-------|-------------|
| `~/.config/opencode/skills/` | **Global** — always indexed | Every rebuild |
| `~/.claude/skills/` | **Global** — always indexed | Every rebuild |
| `~/.agents/skills/` | **Global** — always indexed | Every rebuild |
| `<project>/.opencode/skills/` | **Project-local** — only when working in that project | When `directory` matches the project root |

### For domain-specific skills (Godot, Unity, iOS, etc.)

**Place them in the project's `.opencode/skills/` directory:**

```
ZeroDayMMO/.opencode/skills/
  godot-animation-state-machine.md
  godot-tween-patterns.md
  godot-ai-navigation.md
```

These skills will **only appear in the index** when the plugin is activated inside the `ZeroDayMMO` project directory. This keeps global index clean and focused.

### Best practices
- **Put generic skills** in `~/.config/opencode/skills/` (e.g., debugging, testing, API design)
- **Put project-domain skills** in `<project>/.opencode/skills/` (e.g., godot, unity, android-specific)
- **To scope a search**, use `auto_skill_search(query, { category: "godot" })` for category filtering
- **To check what's scoped**, use `auto_skill_status()` to see total count (varies by project)

---

## Constant Index Awareness

The plugin maintains **always-on awareness** through three mechanisms:

### 1. Lifecycle hooks (passive, always running)
- `tool.execute.before` — every tool call feeds the term profile and learning engine
- `chat.message` — every message feeds term profile, question detection, tech mentions
- `chat.after` — periodic persistence

### 2. Immediate index access (agent-initiated)
- Any agent can call `auto_skill_search()` at any time — zero latency
- `auto_skill_suggest()` provides context-aware recommendations from current conversation state
- `auto_skill_status()` surfaces the full picture: index health, term stats, learning patterns

### 3. Proactive suggestion (learning-engine-driven)
When the learning engine detects patterns (tool repeats ≥3, recurring questions, frequent tech mentions), it stores suggestions that `auto_skill_learn()` surfaces. Agents should periodically check this during idle time or before starting complex work.

### When to use index awareness
- **At session start:** `auto_skill_status()` to gauge available skill coverage
- **When user asks a question:** `auto_skill_search(query)` before answering — there might be a skill for it
- **Before implementing:** `auto_skill_suggest(message, tools)` to check if relevant skills exist
- **After tool usage pattern emerges:** `auto_skill_learn()` to see if the engine recommends creating a skill
- **When stuck:** `auto_skill_search("debug " + topic)` or `auto_skill_suggest("struggling with " + topic)`

---

## Self-Management Sub-Agent Pattern

For true autonomous skill management, an orchestrator can spawn a background sub-agent dedicated to auto-skill maintenance. This sub-agent follows a periodic loop:

```
LOOP:
  1. auto_skill_status()                  → check index health
  2. auto_skill_learn()                   → check learning suggestions
  3. auto_skill_suggest(current_context)   → context-aware need detection
  
  4. For each learning suggestion with score > 0.3:
     - Check if a skill exists (auto_skill_search)
     - If no: create skill (auto_skill_create)
     - If yes but weak: improve existing skill
     
  5. For each repeated tool pattern (≥3 uses):
     - auto_skill_search(tool_name)
     - If no relevant skill found:
       - Create a how-to skill for that tool
       
  6. For overlapping skills (similar search results):
     - Read both, merge into one combined skill
     - Deprecate originals
  
  7. auto_skill_status() → verify index updated
```

The self-management sub-agent should be triggered **whenever the main agent detects it has idle capacity** — for example, between user requests, during long-running operations, or as a background task at session start.

---

## Search & Indexing Details

### Search algorithm
The `SkillsetIndex.search()` method uses multi-factor relevance scoring:

| Factor | Weight | Description |
|--------|--------|-------------|
| Exact name match | +3.0 | Skill name equals query term |
| Partial name match | +2.0 | Skill name contains query term |
| Description match | +1.5 | Description contains query term |
| TF-IDF term index | +tf × idf | Term frequency × inverse document frequency |
| Keyword match | +1.0 | Skill keywords contain query term |
| Quality bonus | ×0.3 | Content quality score (body length, code blocks, headings) |

### Quality scoring (0–100)
Each skill gets a quality score used implicitly in ranking. Factors:
- **Name length ≥ 8 chars** (+5), no generic prefix (+5)
- **Description ≥ 40 chars** (+5), starts with capital (+5), has action verbs (+5)
- **Body ≥ 200 chars** (+5), ≥ 500 chars (+5)
- **Code blocks ≥ 1** (+5), ≥ 3 (+5)
- **Checklists** (+5), ≥ 3 sections (+5), ≥ 4 headings (+5)

### Categories
Skills are auto-categorized: frontend, backend, devops, testing, security, debugging, architecture, data, mobile, godot, workflow, meta, uncategorized.

---

## Troubleshooting

| Issue | Likely cause | Fix |
|-------|-------------|-----|
| `auto_skill_search` returns empty | Index not built yet | Wait for init, or call a dummy tool to trigger `tool.execute.before` hook |
| Skills not found for obvious query | Terms too short (< 2 chars) or stop words | Use longer, specific keywords |
| New skill not showing in search | Index not rebuilt after `auto_skill_create` | The plugin auto-indexes on create; check `auto_skill_status()` |
| `auto_skill_import` returns no skills | No SKILL.md files in standard paths | Use `discoverOnly: true` first to list what's found |
| Index empty after project switch | Project-local `.opencode/skills/` missing | Create the directory or add skills there |
| Learning engine shows no patterns | Not enough interactions yet | Minimum 3 repeated tool calls or 3 question patterns |
| Plugin not responding | Not installed or disabled | Check `opencode.json` has the plugin registered |

---

## Example Workflows

### "Find skills for debugging React performance"
```
Agent detects "find skills" → calls auto_skill_search(query="react performance debugging", limit=5)
→ Returns ranked results: react-performance-optimizer (9.2), react-debugging (8.1), ...
```

### "Create a skill for what I just learned about Shadcn forms"
```
Agent detects "create" + "skill" → calls auto_skill_create(
  name="shadcn-form-patterns",
  description="Use when building forms with shadcn/ui — validation, error states, and controlled inputs",
  body="# Shadcn Form Patterns\n\n..."
)
→ Returns: { success: true, path: "~/.config/opencode/skills/shadcn-form-patterns.md" }
```

### "Import skills from GitHub for Android XML debugging"
```
Agent detects "import" + "GitHub" → calls auto_skill_import(query="android xml ui debugging skills")
→ Discovers repos → imports SKILL.md files → returns imported list
→ Index auto-rebuilds: totalCount increases
```

### "Improve the godot-animation skill — it's missing tween examples"
```
Agent detects "improve" + "skill" → calls auto_skill_info("godot-animation")
→ Reads the skill → identifies gaps → improves body with tween examples
→ Calls auto_skill_create(name="godot-animation", description=..., body=...improved)
```

### "I'm struggling with setting up Playwright for my project — is there a skill?"
```
Agent detects "struggling" + "how to" pattern:
1. auto_skill_search("playwright setup configuration")
2. If found → load and apply the skill
3. If not → auto_skill_learn() to see if learning engine suggests "playwright" as a pattern
4. Auto-create skill if the pattern is strong enough
```

### Self-management sub-agent session
```
Background sub-agent:
1. auto_skill_status() → 381 skills, 2.4k terms, last rebuilt 2h ago
2. auto_skill_learn() → suggests "playwright" tool_skill (used 5x across 3 sessions)
3. auto_skill_search("playwright") → no exact match found
4. auto_skill_create(name="playwright-test-patterns", ...)
5. Verifies with auto_skill_search("playwright") → 1 result, score 9.8
```
