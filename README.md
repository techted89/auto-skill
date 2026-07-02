# Auto-Skill Plugin

An intelligent skill management plugin for OpenCode that automatically indexes, searches, creates, improves, and imports skills — making thousands of specialized instructions instantly accessible through natural language.

## Features

### 🎯 Intelligent Skill Discovery
- **Auto-indexing** — Scans skill directories and builds a TF-IDF-based search index
- **Multi-factor search** — Combines TF-IDF relevance, category boosting, quality scoring, and recency decay
- **Natural language triggers** — Find skills with phrases like "get skills for react" or "find skills for debugging"

### 🛠️ Complete Skill Lifecycle
- **Search** — Find relevant skills by description, category, or content
- **Create** — Generate new SKILL.md files with validation and proper formatting
- **Improve** — Read, enhance, and re-index existing skills
- **Import** — Discover and fetch skills from GitHub repos and web URLs
- **Merge** — Combine related skills into comprehensive guides
- **Validate** — Quality scoring (0–100) with actionable feedback

### 🤖 Subagent Tool Engine
- **Per-skill tools** — Every indexed skill becomes a callable tool (`skill__{slug}`) that returns the skill's full content
- **Management tool** — `auto_skill_subagent` for invoke, list, refresh, and stats operations
- **Lazy initialization** — Tools become available asynchronously after the index finishes loading
- **Content caching** — 30-second TTL cache avoids redundant disk reads

### 📊 Always-On Awareness
- **Lifecycle hooks** — `chat.message` and `tool.execute.before` hooks observe usage patterns
- **Context injection** — Tracks term frequency with exponential forgetting and tech-stack boosting
- **Proactive learning** — Monitors tool usage, question patterns, and error signals to suggest new skills

## Tools

| Tool | Description |
|------|-------------|
| `auto_skill_search` | Search for skills by query. Returns ranked results with relevance scores. |
| `auto_skill_list` | List all indexed skills. Supports filtering by category. |
| `auto_skill_status` | Get index health and stats (total skills, last built, etc.). |
| `auto_skill_suggest` | Get skill suggestions based on current context and usage patterns. |
| `auto_skill_create` | Create a new skill from name, description, and body content. |
| `auto_skill_learn` | Analyze recent activity and suggest skill improvement/creation topics. |
| `auto_skill_info` | Get detailed information about a specific skill. |
| `auto_skill_import` | Import skills from GitHub repos or web URLs. |
| `auto_skill_subagent` | Manage per-skill subagent tools. Actions: invoke, list, refresh, stats. |
| `skill__{slug}` | Dynamically generated per-skill tools (e.g., `skill__react_expert`). |

## Architecture

```
src/
├── index.mjs                   # Plugin entry point, tool registration, lifecycle hooks
├── subagent-tool-engine.mjs    # Dynamic per-skill tool generation engine (NEW)
├── skillset-index.mjs          # TF-IDF index, search, scoring, category detection
├── skill-creator.mjs           # Skill creation with validation, project-local vs global routing
├── skill-engine.mjs            # SKILL.md parsing, assembly, slug generation
├── skill-validator.mjs         # Quality scoring (0–100) with actionable criteria
├── learning-engine.mjs         # Pattern detection for proactive suggestions
├── context-injector.mjs        # Term profile with exponential forgetting
├── context-window-manager.mjs  # Token-budget-aware relevance tracking
├── sourcing/
│   ├── github.mjs              # GitHub skill discovery and import
│   └── web.mjs                 # Web URL skill import
├── config.js                   # Directory configuration
└── lifecycle.js                # File I/O helpers
```

## Data Directory

Skills and index data are stored at:

- **`~/.opencode-auto-skill/`** — Global index, learned patterns, term profiles
- **`~/.config/opencode/skills/`** — Global skill directory
- **`{project}/.opencode/skills/`** — Project-scoped skills (higher priority)
- **`$HOME/.claude/skills/`** — Legacy skill directory
- **`$HOME/.agents/skills/`** — Legacy skill directory

## Quick Start

```bash
# Search for relevant skills
"get skills for building a React dashboard"
"find skills related to debugging"

# Create a new skill
"create a skill for tailwind css responsive patterns"

# Import from GitHub
"import skills from github.com/user/repo"

# Improve an existing skill
"improve the react-expert skill"

# List all indexed skills
auto_skill_list
```

## Development

```bash
# Run tests
cd /root/.config/opencode/plugins/auto-skill
npx jest --config tests/jest.config.js

# Syntax check
node --check src/index.mjs
```

## Version History

- **v2.1.0** — Added Subagent Tool Engine (per-skill tools, management tool)
- **v2.0.0** — Modern plugin API, .mjs implementation, TF-IDF index
- **v1.0.0** — Legacy activate/deactivate API
