/**
 * Learning Engine — observes interaction patterns and generates skills.
 *
 * Watches for:
 * 1. Tool repetition: same tool used repeatedly → suggests skill
 * 2. Question patterns: user asks "how to X" repeatedly
 * 3. Technology mentions: recurring tech/tool keywords → focused skill
 * 4. Debug signals: frequent error/fix patterns
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/** Technology keywords for detection */
const TECH_KEYWORDS = [
  'react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'sveltekit',
  'node', 'deno', 'bun', 'python', 'rust', 'go', 'java', 'kotlin',
  'swift', 'flutter', 'react native', 'expo',
  'docker', 'kubernetes', 'k8s', 'aws', 'gcp', 'azure', 'terraform',
  'postgres', 'mysql', 'mongodb', 'redis', 'sqlite',
  'graphql', 'rest', 'grpc', 'trpc',
  'jest', 'vitest', 'playwright', 'cypress', 'pytest',
  'tailwind', 'shadcn', 'prisma', 'drizzle', 'typeorm',
  'godot', 'unity', 'unreal',
  'opencode', 'llm', 'ai', 'mcp',
];

export class LearningEngine {
  /**
   * @param {string} dataDir - Directory for persistence
   * @param {Object} [options]
   * @param {number} [options.minRepetitions=3] - Min tool repeats before suggesting
   * @param {number} [options.maxPatterns=100] - Max stored patterns
   */
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.minRepetitions = options.minRepetitions || 3;
    this.maxPatterns = options.maxPatterns || 100;

    /** @type {Array<Object>} */
    this.patterns = [];
    /** @type {Map<string, Object>} */
    this.toolPatterns = new Map();
    /** @type {Map<string, number>} */
    this.termFrequencies = new Map();

    this.dbPath = join(dataDir, 'learn-db.json');
    this._loaded = false;
    this._persistTimer = null;
  }

  /**
   * Initialize from persisted state.
   */
  async init() {
    try {
      const raw = await readFile(this.dbPath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.patterns) this.patterns = data.patterns;
      if (data.termFrequencies) {
        this.termFrequencies = new Map(Object.entries(data.termFrequencies));
      }
      if (data.toolPatterns) {
        // toolPatterns are stored as [[tool, info], ...] arrays
        this.toolPatterns = new Map(
          (data.toolPatterns || []).map(([tool, info]) => {
            // Reconstruct sessions as a Set
            const sessions = Array.isArray(info.sessions)
              ? new Set(info.sessions)
              : (info.sessions instanceof Set ? info.sessions : new Set());
            return [tool, { ...info, sessions }];
          })
        );
      }
    } catch {
      // Fresh start
    }
    this._loaded = true;
  }

  /**
   * Observe a tool execution.
   */
  observeToolUsage(input) {
    const toolName = input?.tool || 'unknown';
    let existing = this.toolPatterns.get(toolName);
    if (!existing) {
      existing = { count: 0, sessions: new Set(), lastObserved: null, contexts: [] };
    }

    existing.count++;
    if (input.sessionID) existing.sessions.add(input.sessionID);
    existing.lastObserved = Date.now();

    if (input.description) {
      existing.contexts.push(input.description.slice(0, 200));
      if (existing.contexts.length > 5) existing.contexts.shift();
    }

    this.toolPatterns.set(toolName, existing);

    if (existing.count >= this.minRepetitions) {
      this._addPattern({
        type: 'tool_repeat',
        tool: toolName,
        count: existing.count,
        sessionCount: existing.sessions.size,
        contexts: [...existing.contexts],
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Observe a chat message for learning signals.
   */
  observeMessage(text) {
    if (!text) return;
    const lower = text.toLowerCase();

    // Extract terms
    const terms = lower.split(/[^a-z0-9+#]+/).filter(t => t.length > 2);
    for (const term of terms) {
      this.termFrequencies.set(term, (this.termFrequencies.get(term) || 0) + 1);
    }

    // Question patterns
    if (/\b(how (do|can|to|would)|what is|why does|when should)\b/i.test(text)) {
      const match = text.match(/\b(how (do|can|to|would) [^?.,]+)/i);
      if (match) {
        this._addPattern({
          type: 'question',
          text: match[1].slice(0, 120),
          terms: terms.slice(0, 10),
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Tech mentions
    const mentioned = TECH_KEYWORDS.filter(kw => lower.includes(kw));
    if (mentioned.length > 0) {
      this._addPattern({
        type: 'tech_mention',
        technologies: mentioned,
        terms: terms.slice(0, 10),
        timestamp: new Date().toISOString(),
      });
    }

    // Debug patterns
    if (/\b(error|bug|fail|crash|exception|not working|broken)\b/i.test(text)) {
      this._addPattern({
        type: 'debug',
        text: text.slice(0, 200),
        terms: terms.slice(0, 10),
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get suggested skill topics.
   */
  getSuggestions() {
    const suggestions = [];

    // Frequent tools
    for (const [tool, info] of this.toolPatterns) {
      if (info.count >= Math.max(this.minRepetitions, 3)) {
        suggestions.push({
          type: 'tool_skill',
          tool,
          reason: `Used ${info.count}x across ${info.sessions?.size || 1} session(s)`,
          score: Math.min(info.count / 10, 1),
          contexts: info.contexts?.slice(-3) || [],
        });
      }
    }

    // Recurring questions
    const questionPatterns = this.patterns.filter(p => p.type === 'question');
    if (questionPatterns.length >= 3) {
      suggestions.push({
        type: 'question_pattern',
        reason: `${questionPatterns.length} "how to" questions observed`,
        score: Math.min(questionPatterns.length / 10, 1),
        sampleQuestions: questionPatterns.slice(-3).map(p => p.text),
      });
    }

    // Frequent terms
    const highFreqTerms = Array.from(this.termFrequencies.entries())
      .filter(([, freq]) => freq >= 5)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    if (highFreqTerms.length >= 3) {
      suggestions.push({
        type: 'frequent_terms',
        terms: highFreqTerms.map(([t, f]) => ({ term: t, frequency: f })),
        reason: `${highFreqTerms.length} frequently mentioned terms`,
        score: Math.min(highFreqTerms.length / 15, 1),
      });
    }

    return suggestions.sort((a, b) => b.score - a.score);
  }

  /** Get tool usage stats. */
  getToolStats() {
    return Array.from(this.toolPatterns.entries())
      .map(([tool, info]) => ({
        tool,
        count: info.count,
        sessionCount: info.sessions?.size || 1,
        lastObserved: info.lastObserved ? new Date(info.lastObserved).toISOString() : null,
        contexts: info.contexts || [],
      }))
      .sort((a, b) => b.count - a.count);
  }

  /** Get stored patterns. */
  getPatterns(limit = 20) {
    return this.patterns.slice(-limit).reverse();
  }

  /** Get top terms by frequency. */
  getTopTerms(limit = 20) {
    return Array.from(this.termFrequencies.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([term, freq]) => ({ term, frequency: freq }));
  }

  /** Persist state. */
  async persist() {
    try {
      const data = {
        patterns: this.patterns.slice(-this.maxPatterns),
        termFrequencies: Object.fromEntries(this.termFrequencies),
        toolPatterns: Array.from(this.toolPatterns.entries()).map(([tool, info]) => [
          tool,
          { ...info, sessions: Array.from(info.sessions || []) },
        ]),
        lastUpdated: new Date().toISOString(),
      };
      await mkdir(dirname(this.dbPath), { recursive: true });
      await writeFile(this.dbPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Non-critical
    }
  }

  /** Reset. */
  async reset() {
    this.patterns = [];
    this.toolPatterns.clear();
    this.termFrequencies.clear();
    await this.persist();
  }

  // ─── Private ────────────────────────────────────────────

  _addPattern(pattern) {
    this.patterns.push(pattern);
    if (this.patterns.length > this.maxPatterns) {
      this.patterns = this.patterns.slice(-this.maxPatterns);
    }
    this._schedulePersist();
  }

  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this.persist().catch(() => {});
      this._persistTimer = null;
    }, 10000);
  }
}

export default LearningEngine;
