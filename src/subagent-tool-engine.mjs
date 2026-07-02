/**
 * Subagent Tool Engine — dynamically converts indexed skills into callable tools
 * that subagents can invoke to get full skill content.
 *
 * Each indexed skill becomes a tool named `skill__{slug}` (e.g., `skill__react_expert`).
 * The handler loads the SKILL.md content from disk and returns it, optionally
 * filtered by format (full, body, or description).
 *
 * A management tool (`auto_skill_subagent`) provides invoke/list/refresh/stats
 * operations for convenience.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const TOOL_PREFIX = 'skill__';
const CACHE_TTL = 30_000; // 30 seconds

export class SubagentToolEngine {
  /**
   * @param {Object} skillsetIndex - An initialized SkillsetIndex instance
   */
  constructor(skillsetIndex) {
    this.index = skillsetIndex;
    /** @type {Map<string, {content: string, ts: number}>} */
    this._contentCache = new Map();
    this._ready = true;
  }

  /**
   * Generate tool definitions for every indexed skill.
   * @returns {Array<{name: string, def: Object}>}
   */
  generateToolDefs() {
    const skills = this.index.getAll();
    if (skills.length === 0) return [];

    return skills.map(skill => ({
      name: this._toToolName(skill.slug),
      skill,
      def: {
        description: this._buildDescription(skill),
        inputSchema: {
          type: 'object',
          properties: {
            format: {
              type: 'string',
              enum: ['full', 'body', 'description'],
              description: 'Output format: full (frontmatter + body), body (body only), description (just the one-liner)',
              default: 'full',
            },
          },
        },
        handler: async (input) => {
          return await this.invoke(skill, input?.format || 'full');
        },
      },
    }));
  }

  /**
   * Generate management tool definition for the auto_skill_subagent tool.
   * @returns {Object} Tool definition
   */
  generateManagementTool() {
    return {
      description: 'Manage and invoke skill-based subagent tools. Use "invoke" to call a skill by slug, "list" to see all available skill-tools, "refresh" to regenerate after index changes, "stats" for engine summary.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['invoke', 'list', 'refresh', 'stats'],
            description: 'Action to perform',
          },
          skill: {
            type: 'string',
            description: 'Skill slug for invoke action (e.g., "react-expert", "godot-engine")',
          },
          format: {
            type: 'string',
            enum: ['full', 'body', 'description'],
            description: 'Output format for invoke action',
            default: 'full',
          },
          query: {
            type: 'string',
            description: 'Search query for list action (optional filter)',
          },
          limit: {
            type: 'number',
            description: 'Max results for list action (default 20)',
            default: 20,
          },
        },
        required: ['action'],
      },
      handler: async (input) => {
        if (!this._ready) return { error: 'Subagent tool engine not ready' };

        switch (input.action) {
          case 'invoke': {
            if (!input.skill) return { error: 'skill slug is required for invoke action' };
            const skill = this.index.getBySlug(input.skill);
            if (!skill) return { error: `Skill "${input.skill}" not found` };
            return await this.invoke(skill, input.format || 'full');
          }

          case 'list': {
            const allSkills = this.index.getAll();
            let filtered = allSkills;
            const q = (input.query || '').toLowerCase();
            if (q) {
              filtered = allSkills.filter(s =>
                s.name.toLowerCase().includes(q) ||
                s.slug.includes(q) ||
                (s.description || '').toLowerCase().includes(q)
              );
            }
            filtered.sort((a, b) => (b.quality || 0) - (a.quality || 0));
            const items = filtered.slice(0, input.limit || 20).map(s => ({
              slug: s.slug,
              name: s.name,
              description: s.description,
              category: s.category,
              quality: s.quality,
              tool: this._toToolName(s.slug),
            }));
            return { items, total: filtered.length, indexed: allSkills.length };
          }

          case 'refresh': {
            this._contentCache.clear();
            return { success: true, message: 'Subagent tool engine cache cleared. Re-generate tool definitions via the plugin init lifecycle.' };
          }

          case 'stats': {
            return this.getStats();
          }

          default:
            return { error: `Unknown action: ${input.action}` };
        }
      },
    };
  }

  /**
   * Invoke a skill by index entry.
   * @param {Object} skill - Skill index entry
   * @param {string} [format='full'] - Output format
   * @returns {Promise<Object>}
   */
  async invoke(skill, format = 'full') {
    try {
      let content = '';
      if (skill.path && existsSync(skill.path)) {
        content = await this._readWithCache(skill.path);
      }

      switch (format) {
        case 'body': {
          // Strip YAML frontmatter, return body only
          const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n?\n?([\s\S]*)$/);
          return { skill: skill.name, slug: skill.slug, content: bodyMatch ? bodyMatch[1].trim() : content };
        }
        case 'description':
          return { skill: skill.name, slug: skill.slug, content: skill.description || '' };
        case 'full':
        default:
          return { skill: skill.name, slug: skill.slug, content: content || skill.description || '' };
      }
    } catch (err) {
      return { skill: skill.name, slug: skill.slug, error: err.message, content: skill.description || '' };
    }
  }

  /**
   * Clear caches (call after index changes).
   */
  refresh() {
    this._contentCache.clear();
  }

  /**
   * Get engine stats.
   * @returns {Object}
   */
  getStats() {
    const allSkills = this.index.getAll();
    const withPath = allSkills.filter(s => s.path).length;
    return {
      ready: this._ready,
      indexedSkills: allSkills.length,
      skillsWithPath: withPath,
      toolPrefix: TOOL_PREFIX,
      generatedTools: allSkills.length,
    };
  }

  // ─── Private ─────────────────────────────────────────────

  /**
   * Convert a slug to a valid tool name.
   * @param {string} slug
   * @returns {string|null}
   */
  _toToolName(slug) {
    if (!slug || typeof slug !== 'string') return null;
    const safe = slug.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    return safe ? `${TOOL_PREFIX}${safe}` : null;
  }

  /**
   * Build a human-readable description for a skill-tool.
   * @param {Object} skill
   * @returns {string}
   */
  _buildDescription(skill) {
    const cat = skill.category && skill.category !== 'uncategorized'
      ? `[${skill.category}] `
      : '';
    return `${cat}${skill.description || `Skill: ${skill.name}`}`;
  }

  /**
   * Read file with in-memory cache and TTL.
   * @param {string} filePath
   * @returns {Promise<string>}
   */
  async _readWithCache(filePath) {
    const cached = this._contentCache.get(filePath);
    if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.content;
    const content = await readFile(filePath, 'utf-8');
    this._contentCache.set(filePath, { content, ts: Date.now() });
    return content;
  }
}
