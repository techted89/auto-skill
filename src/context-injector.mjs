/**
 * Context Injector — extracts clean term signals from interactions.
 *
 * Monitors tool usage and message content to build a term profile
 * with exponential forgetting. The profile is used by the skillset
 * index to rank relevant skills for current context.
 *
 * Key design:
 * - Pure-JSON term profile (no external deps)
 * - Exponential decay: terms lose weight over time
 * - Signals extracted from: tool names, descriptions, message text
 * - Duplicate terms are merged (unlike old .js version with 3x "error")
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

/** Stop words to filter out */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'by', 'with', 'from', 'as', 'is', 'was', 'be', 'are', 'were',
  'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'could', 'should', 'may', 'might', 'shall', 'can', 'need',
  'this', 'that', 'these', 'those', 'it', 'its', 'we', 'they', 'he',
  'she', 'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too', 'very',
  'just', 'about', 'above', 'after', 'again', 'all', 'also', 'any',
  'because', 'been', 'before', 'being', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'only', 'own', 'same', 'into',
  'over', 'under', 'up', 'out', 'off', 'down', 'here', 'there',
  'when', 'where', 'why', 'how', 'what', 'which', 'who', 'whom',
  'get', 'set', 'use', 'make', 'like', 'want', 'look', 'know',
  'think', 'take', 'come', 'go', 'see', 'find', 'give', 'tell',
  'using', 'used', 'based', 'shown', 'following', 'including',
  'without', 'within', 'through', 'during', 'before', 'after',
  'please', 'help', 'need', 'would', 'could', 'should',
]);

/** High-signal weight for technology/code terms */
const TECH_TERM_BOOST = 2.0;

/** Technology pattern hints */
const TECH_PATTERNS = [
  /^[a-z]+(?:js|ts|py|rb|rs|go)$/i,   // nodejs, nextjs, typescript
  /^[A-Z][a-z]+(?:Script|Query)$/,     // TypeScript, JavaScript
  /^@[a-z]+\//,                         // @scope/package
  /^[a-z]+-[a-z]+$/,                    // postgres, redis-cache
  /^\.[a-z]+$/,                         // .js, .ts, .py
  /^[a-z]+\d+$/,                        // react19, node18
];

export class ContextInjector {
  /**
   * @param {string} dataDir - Directory for persistence
   * @param {Object} [options]
   * @param {number} [options.decayHalfLife=3600000] - 1 hour in ms
   * @param {number} [options.maxTerms=500] - Max tracked terms
   * @param {number} [options.minTermLength=3] - Minimum term length
   */
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.decayHalfLife = options.decayHalfLife || 3600000; // 1 hour
    this.maxTerms = options.maxTerms || 500;
    this.minTermLength = options.minTermLength || 3;

    /** @type {Map<string, { weight: number, lastSeen: number, category: string }>} */
    this.terms = new Map();
    this.totalSignals = 0;
    this.lastDecay = Date.now();

    this.profilePath = join(dataDir, 'context-profile.json');
  }

  /**
   * Initialize from persisted state.
   */
  async init() {
    try {
      const raw = await readFile(this.profilePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data.terms) {
        for (const [term, info] of Object.entries(data.terms)) {
          this.terms.set(term, info);
        }
      }
      this.totalSignals = data.totalSignals || 0;
      this.lastDecay = data.lastDecay || Date.now();
    } catch {
      // Fresh start
    }
  }

  /**
   * Feed interaction signals into the profile.
   */
  addSignal(text, category = 'message', boost = 1.0) {
    if (!text || typeof text !== 'string') return;

    const terms = this._extractTerms(text);
    const now = Date.now();

    for (const term of terms) {
      const existing = this.terms.get(term);
      const isTech = this._isTechTerm(term);
      const weight = (isTech ? boost * TECH_TERM_BOOST : boost);

      if (existing) {
        existing.weight += weight * 0.3; // Diminishing returns per occurrence
        existing.lastSeen = now;
        existing.category = this._bestCategory(existing.category, category);
      } else {
        this.terms.set(term, {
          weight: weight * 0.8, // Initial confidence
          lastSeen: now,
          category,
        });
      }
    }

    this.totalSignals++;

    // Apply gradual decay on signal (throttled)
    this._applyDecay();
    this._enforceMaxTerms();
  }

  /**
   * Get top terms by weight.
   */
  getTopTerms(limit = 20) {
    return Array.from(this.terms.entries())
      .sort((a, b) => b[1].weight - a[1].weight)
      .slice(0, limit)
      .map(([term, info]) => ({
        term,
        weight: Math.round(info.weight * 100) / 100,
        category: info.category,
        lastSeen: info.lastSeen,
      }));
  }

  /**
   * Get all terms above a threshold.
   */
  getTermsAbove(threshold = 0.3) {
    return Array.from(this.terms.entries())
      .filter(([, info]) => info.weight > threshold)
      .sort((a, b) => b[1].weight - a[1].weight)
      .map(([term, info]) => ({
        term,
        weight: Math.round(info.weight * 100) / 100,
        category: info.category,
      }));
  }

  /**
   * Get profile statistics.
   */
  getStats() {
    const now = Date.now();
    return {
      totalTerms: this.terms.size,
      totalSignals: this.totalSignals,
      activeTerms: this.getTermsAbove(0.3).length,
      lastDecay: this.lastDecay,
      age: now - this.lastDecay,
      topTerms: this.getTopTerms(10),
    };
  }

  /**
   * Reset profile.
   */
  async reset() {
    this.terms.clear();
    this.totalSignals = 0;
    this.lastDecay = Date.now();
    await this.persist();
  }

  /**
   * Persist state.
   */
  async persist() {
    try {
      const data = {
        terms: Object.fromEntries(this.terms),
        totalSignals: this.totalSignals,
        lastDecay: this.lastDecay,
        updatedAt: Date.now(),
      };
      await mkdir(dirname(this.profilePath), { recursive: true });
      await writeFile(this.profilePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Non-critical
    }
  }

  // ─── Private ────────────────────────────────────────────

  _extractTerms(text) {
    const terms = text
      .toLowerCase()
      .split(/[^a-z0-9+#@.]+/) // Split on non-alphanumeric (keep + # @ . for tech terms)
      .filter(t => t.length >= this.minTermLength && t.length < 40)
      .filter(t => !STOP_WORDS.has(t));

    return [...new Set(terms)]; // Deduplicate per signal
  }

  _isTechTerm(term) {
    return TECH_PATTERNS.some(p => p.test(term));
  }

  _bestCategory(existing, incoming) {
    if (!existing) return incoming;
    // 'tech' > 'tool' > 'message' priority
    const priority = { tech: 3, tool: 2, message: 1, unknown: 0 };
    return (priority[incoming] || 0) > (priority[existing] || 0) ? incoming : existing;
  }

  _applyDecay() {
    const now = Date.now();
    const elapsed = now - this.lastDecay;
    if (elapsed < this.decayHalfLife / 10) return; // Only decay every 6min

    const halflives = elapsed / this.decayHalfLife;
    const decayFactor = Math.pow(0.5, halflives);

    if (decayFactor < 0.99) {
      for (const [, info] of this.terms) {
        info.weight *= decayFactor;
      }
      this.lastDecay = now;
    }
  }

  _enforceMaxTerms() {
    if (this.terms.size <= this.maxTerms) return;

    // Remove lowest weight terms
    const sorted = Array.from(this.terms.entries()).sort((a, b) => a[1].weight - b[1].weight);
    const toRemove = this.terms.size - this.maxTerms;
    for (let i = 0; i < toRemove; i++) {
      this.terms.delete(sorted[i][0]);
    }
  }
}

export default ContextInjector;
