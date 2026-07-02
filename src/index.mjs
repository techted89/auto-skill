/**
 * Auto-Skill Plugin — OpenCode Plugin entry point.
 *
 * Provides:
 * 1. Skillset index — TF-IDF search over all known skill directories
 * 2. Learning engine — observes tool+message patterns, suggests skill creation
 * 3. Context injector — term profile with exponential forgetting
 * 4. Context window — budget-aware relevance tracking
 * 5. Web/GitHub sourcing — discovers skills externally
 * 6. Skill creation — validates and writes new SKILL.md files
 *
 * Exposes tools: auto_skill_search, auto_skill_list, auto_skill_status,
 * auto_skill_suggest, auto_skill_learn, auto_skill_info, auto_skill_create,
 * auto_skill_import
 */

import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

import { SubagentToolEngine } from './subagent-tool-engine.mjs';

const PLUGIN_VERSION = '2.1.0';
const PLUGIN_NAME = 'auto-skill';

function resolveDataDir(baseDir) {
  return baseDir
    ? join(baseDir, '.opencode-auto-skill')
    : join(process.env.HOME || '/root', '.config', 'opencode', '.opencode-auto-skill');
}

/**
 * OpenCode Plugin entry point.
 *
 * @param {Object} input - { client, project, directory, $ }
 * @param {Object} options - User config overrides
 * @returns {Promise<Object>} Hooks object
 */
export default async function autoSkillPlugin(input, options = {}) {
  const { directory } = input || {};
  const dataDir = resolveDataDir(directory);

  const config = {
    enabled: true,
    maxInjections: 5,
    confidenceThreshold: 0.3,
    skillDirs: [
      directory ? join(directory, '.opencode', 'skills') : null,
      join(process.env.HOME || '/root', '.config', 'opencode', 'skills'),
      join(process.env.HOME || '/root', '.claude', 'skills'),
      join(process.env.HOME || '/root', '.agents', 'skills'),
    ].filter(Boolean),
    ...options,
  };

  // ── Lazy-loaded engine refs ─────────────────────────────
  let skillsetIndex = null;
  let learningEngine = null;
  let contextWindow = null;
  let contextInjector = null;
  let subagentToolEngine = null;

  // ── Async Init ──────────────────────────────────────────
  async function init() {
    try {
      await mkdir(dataDir, { recursive: true });

      const { SkillsetIndex } = await import('./skillset-index.mjs');
      skillsetIndex = new SkillsetIndex(dataDir, { skillDirs: config.skillDirs, autoRebuild: true });
      await skillsetIndex.init();

      const { ContextWindowManager } = await import('./context-window-manager.mjs');
      contextWindow = new ContextWindowManager({ dataDir, maxTokens: config.maxInjections * 512 });

      const { ContextInjector } = await import('./context-injector.mjs');
      contextInjector = new ContextInjector(dataDir);
      await contextInjector.init();

      const { LearningEngine } = await import('./learning-engine.mjs');
      learningEngine = new LearningEngine(dataDir);
      await learningEngine.init();

      console.log(`[${PLUGIN_NAME}] Initialized — ${skillsetIndex.getStatus().totalCount} skills, ${contextInjector.getStats().totalTerms} terms`);

      // Initialize Subagent Tool Engine and register dynamic skill-tools
      subagentToolEngine = new SubagentToolEngine(skillsetIndex);
      const skillToolDefs = subagentToolEngine.generateToolDefs();
      let registered = 0;
      for (const { name, def } of skillToolDefs) {
        if (name && !tools[name]) {
          tools[name] = def;
          registered++;
        }
      }
      console.log(`[${PLUGIN_NAME}] Registered ${registered} subagent skill-tools`);
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] Init error:`, err.message);
    }
  }

  // Init in background; don't block hook registration
  init().catch(err => console.error(`[${PLUGIN_NAME}] Init failed:`, err.message));

  // ── Helpers ─────────────────────────────────────────────
  function extractTerms(text) {
    if (!text || typeof text !== 'string') return [];
    return text.toLowerCase().split(/[^a-z0-9+#]+/).filter(t => t.length > 2 && t.length < 30);
  }

  function findRelevantSkills(message, tools = [], limit = 5) {
    if (!skillsetIndex) return [];
    const query = [message || '', ...(tools || [])].filter(Boolean).join(' ');
    return skillsetIndex.search(query, limit);
  }

  // ── Hooks ───────────────────────────────────────────────
  const tools = {

    // ── Tool definitions ──────────────────────────────────
    auto_skill_search: {
        description: 'Search indexed skills by keyword with ranked relevance scores (0-10). Returns name, description, score, category.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search keywords' },
            limit: { type: 'number', description: 'Max results (default 10)', default: 10 },
            category: { type: 'string', description: 'Filter by category (optional)' },
          },
          required: ['query'],
        },
        handler: async (input) => {
          if (!skillsetIndex) return { error: 'Skillset index not initialized' };
          return {
            results: skillsetIndex.search(input.query, input.limit || 10, {
              categories: input.category ? [input.category] : undefined,
            }),
            total: skillsetIndex.getStatus().totalCount,
          };
        },
      },

      auto_skill_list: {
        description: 'List all indexed skills with names, descriptions, categories, and quality scores.',
        inputSchema: {
          type: 'object',
          properties: {
            category: { type: 'string', description: 'Filter by category' },
            limit: { type: 'number', description: 'Max results (default 50)', default: 50 },
            sort: { type: 'string', enum: ['name', 'quality', 'recent'], description: 'Sort order', default: 'quality' },
          },
        },
        handler: async (input) => {
          if (!skillsetIndex) return { error: 'Skillset index not initialized' };
          let skills = skillsetIndex.getAll();
          if (input.category) {
            skills = skills.filter(s => s.category === input.category || s.categories?.includes(input.category));
          }
          if (input.sort === 'quality') skills.sort((a, b) => (b.quality || 0) - (a.quality || 0));
          else if (input.sort === 'name') skills.sort((a, b) => a.name.localeCompare(b.name));
          return { skills: skills.slice(0, input.limit || 50), total: skillsetIndex.getStatus().totalCount };
        },
      },

      auto_skill_status: {
        description: 'Show skillset index status, term profile, and learning engine stats.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          if (!skillsetIndex) return { error: 'Not initialized' };
          return {
            index: skillsetIndex.getStatus(),
            contextWindow: contextWindow ? contextWindow.getWindowStats() : null,
            profile: contextInjector ? contextInjector.getStats() : null,
            learning: learningEngine ? {
              patterns: learningEngine.getPatterns(5),
              toolStats: learningEngine.getToolStats().slice(0, 10),
              suggestions: learningEngine.getSuggestions(),
            } : null,
          };
        },
      },

      auto_skill_suggest: {
        description: 'Get skill suggestions for current context (message + tools). Returns ranked skill names with scores.',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Current user message' },
            tools: { type: 'array', items: { type: 'string' }, description: 'Recently used tool names' },
            limit: { type: 'number', description: 'Max suggestions (default 5)', default: 5 },
          },
        },
        handler: async (input) => {
          if (!skillsetIndex) return { error: 'Skillset index not initialized' };
          const suggestions = findRelevantSkills(input.message || '', input.tools || [], input.limit || 5);
          return {
            suggestions,
            contextProfile: {
              terms: extractTerms(input.message || ''),
              tools: input.tools || [],
            },
          };
        },
      },

      auto_skill_learn: {
        description: 'Show learning engine status: observed patterns, frequently used tools, and suggestions.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          return {
            enabled: config.enabled,
            patterns: learningEngine ? learningEngine.getPatterns(20) : [],
            toolStats: learningEngine ? learningEngine.getToolStats() : [],
            suggestions: learningEngine ? learningEngine.getSuggestions() : [],
            contextWindowSize: contextWindow ? contextWindow.getWindowStats().totalSkills : 0,
          };
        },
      },

      auto_skill_info: {
        description: 'Get detailed information about a specific skill by name or slug.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Skill name or slug (partial match)' },
          },
          required: ['name'],
        },
        handler: async (input) => {
          if (!skillsetIndex) return { error: 'Skillset index not initialized' };
          const results = skillsetIndex.search(input.name, 5);
          const match = results.find(r =>
            r.slug === input.name.toLowerCase() || r.name.toLowerCase() === input.name.toLowerCase()
          ) || results[0];
          if (!match) return { error: `Skill "${input.name}" not found` };
          const allSkills = skillsetIndex.getAll();
          const full = allSkills.find(s => s.slug === match.slug);
          return { ...match, categories: full?.categories || [] };
        },
      },

      auto_skill_create: {
        description: 'Create or update a SKILL.md file. Validates name, description, and body before writing. Returns the file path.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Skill name (lowercase-hyphenated, max 64 chars)' },
            description: { type: 'string', description: 'One-line "Use when..." description (20-200 chars)' },
            body: { type: 'string', description: 'Full markdown body starting with # Heading' },
            projectDir: { type: 'string', description: 'Project directory for project-local skill (optional)' },
            targetDir: { type: 'string', description: 'Override target directory (optional)' },
            categories: { type: 'array', items: { type: 'string' }, description: 'Category tags (optional)' },
          },
          required: ['name', 'description', 'body'],
        },
        handler: async (input) => {
          try {
            const { createSkill } = await import('./skill-creator.mjs');
            const result = await createSkill({
              name: input.name,
              description: input.description,
              body: input.body,
              projectDir: input.projectDir || directory,
              targetDir: input.targetDir,
              categories: input.categories,
            });
            // Add to index if successful
            if (result.success && skillsetIndex) {
              const { parseSkill } = await import('./skill-engine.mjs');
              const parsed = await parseSkill(result.path);
              if (parsed) {
                await skillsetIndex.add({ ...parsed, path: result.path });
              }
            }
            return result;
          } catch (err) {
            return { success: false, error: err.message };
          }
        },
      },

      auto_skill_import: {
        description: 'Import skills from a GitHub repo or web URL. Pass repoUrl for GitHub scanning, or url for direct web fetch.',
        inputSchema: {
          type: 'object',
          properties: {
            repoUrl: { type: 'string', description: 'GitHub repo URL to scan for skills' },
            url: { type: 'string', description: 'Web URL to a SKILL.md or documentation page' },
            query: { type: 'string', description: 'GitHub search query for repos with skills' },
            discoverOnly: { type: 'boolean', description: 'Only list, do not import (default false)', default: false },
            targetDir: { type: 'string', description: 'Override target import directory (optional)' },
          },
        },
        handler: async (input) => {
          try {
            if (input.repoUrl || input.query) {
              const { sourceFromGitHub } = await import('./sourcing/github.mjs');
              const result = await sourceFromGitHub({
                repoUrl: input.repoUrl,
                query: input.query,
                targetDir: input.targetDir,
                discoverOnly: input.discoverOnly,
              });
              // Rebuild index if imports happened
              if (result.imported?.length > 0 && skillsetIndex) {
                await skillsetIndex.rebuild();
              }
              return result;
            }
            if (input.url) {
              const { sourceFromWeb } = await import('./sourcing/web.mjs');
              const result = await sourceFromWeb({
                url: input.url,
                targetDir: input.targetDir,
                discoverOnly: input.discoverOnly,
              });
              if (result.imported?.length > 0 && skillsetIndex) {
                await skillsetIndex.rebuild();
              }
              return result;
            }
            return { success: false, error: 'Provide repoUrl, url, or query' };
          } catch (err) {
            return { success: false, error: err.message };
          }
        },
      },

    auto_skill_subagent: {
      description: 'Manage and invoke skill-based subagent tools. Use "invoke" to call a skill by slug, "list" to see available skill-tools, "refresh" to regenerate after index changes, "stats" for engine summary.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['invoke', 'list', 'refresh', 'stats'], description: 'Action to perform' },
          skill: { type: 'string', description: 'Skill slug for invoke action (e.g. react-expert)' },
          format: { type: 'string', enum: ['full', 'body', 'description'], description: 'Output format for invoke', default: 'full' },
          query: { type: 'string', description: 'Search query for list action (optional filter)' },
          limit: { type: 'number', description: 'Max results for list action (default 20)', default: 20 },
        },
        required: ['action'],
      },
      handler: async (input) => {
        if (!subagentToolEngine) return { error: 'Subagent tool engine not initialized yet' };
        return await subagentToolEngine.handler(input);
      },
    },
  };

  // ── Lifecycle hooks ────────────────────────────────────
  return {
    tool: tools,

    'tool.execute.before': async (input) => {
      if (!config.enabled) return;
      if (learningEngine) {
        try {
          learningEngine.observeToolUsage({
            tool: input?.tool || 'unknown',
            description: input?.description || '',
            sessionID: input?.sessionID,
          });
        } catch { /* non-critical */ }
      }
      if (contextInjector) {
        try {
          contextInjector.addSignal(input?.tool || '', 'tool', 0.8);
          contextInjector.addSignal(input?.description || '', 'tool', 0.5);
        } catch { /* non-critical */ }
      }
    },

    'chat.message': async (input) => {
      if (!config.enabled) return;
      const text = typeof input === 'string' ? input : input?.text || '';
      if (!text) return;

      if (learningEngine) {
        try { learningEngine.observeMessage(text); } catch { /* non-critical */ }
      }
      if (contextInjector) {
        try { contextInjector.addSignal(text, 'message', 1.0); } catch { /* non-critical */ }
      }
    },

    'chat.after': async (input, output) => {
      if (!config.enabled || !learningEngine) return;
      // After each assistant response, periodically persist
      try { learningEngine.persist(); } catch { /* non-critical */ }
      if (contextInjector) {
        try { contextInjector.persist(); } catch { /* non-critical */ }
      }
    },
  };
}

export { PLUGIN_NAME, PLUGIN_VERSION };
