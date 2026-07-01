---
name: auto-skill
version: "1.1.0"
description: Auto-generate skills from interactions, documentation, and codebases - https://github.com/techted89/auto-skill
author: techted89
license: MIT
platforms: ["linux", "macos", "windows"]
metadata:
  hermes:
    tags: ["automation", "plugin", "skill", "generation", "opencode"]
    related_skills: ["hermes-agent", "opencode"]
---

# Auto-Skill Plugin

Generate, manage, discover, and search opencode skills automatically. Includes an
inverted-term index for ranked relevance search, a context injector that builds a
compact term-weight profile from observed chat/tool signals, a root-filesystem
scanner to find additional SKILL.md files, and an injection rotation log tracking
the last ~100 skill surface events.

## Features

- **Skill Conversion**: Turn markdown/docs/code into reusable SKILL.md files
- **Ranked Search**: Inverted-term index with relevance scoring by name/description match
- **Skillset Status**: Collection count + rotation log of recent skill injections
- **Root Filesystem Scan**: Recursively find unregistered SKILL.md files in /root/
- **Context Injection**: Compact term-weight profile from observed chat + tool signals
- **Document Decomposition**: Split long documents into focused atomic skills
- **Auto-Learning**: Observe interaction patterns and suggest skills based on recurring behaviors
- **Skill Registry**: List, inspect, and manage installed skills
- **Web Sourcing**: Fetch documentation from URLs and search engines
- **GitHub Sourcing**: Clone and extract patterns from GitHub repositories

## Tools Provided

| Tool | Description |
|------|-------------|
| `auto_skill_convert` | Generate a skill from markdown content |
| `auto_skill_list` | List all installed skills |
| `auto_skill_search` | Search skills by keyword with ranked relevance |
| `auto_skill_decompose` | Split a document into atomic skills |
| `auto_skill_info` | Get details about a specific skill |
| `auto_skill_status` | Show collection count + injection rotation log |
| `auto_skill_scan_root` | Scan /root/ for additional SKILL.md files |
| `auto_skill_learn` | Check learning engine status |
| `auto_skill_github_search` | Clone a GitHub repo and extract skill content |
| `auto_skill_web_search` | Search the web + fetch full pages for skill research |

## Configuration

The plugin stores data in `<project>/.opencode-auto-skill/` or `~/.config/opencode-auto-skill/`.
