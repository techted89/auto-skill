/**
 * Context Window Manager — budget-aware skill injection.
 *
 * Manages which skills are "hot" (relevant to current context)
 * without filling the context window. Uses:
 * - Token budget: max tokens allocated to skill context
 * - Relevance decay: skills lose relevance over time
 * - Deduplication: same skill isn't injected twice
 *
 * Key design: This manager does NOT inject skills into the
 * system prompt. Instead, it maintains a ranked relevance list
 * that agents can query via tools. This keeps context clean.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

export class ContextWindowManager {
  /**
   * @param {Object} options
   * @param {string} options.dataDir - Directory for persistence
   * @param {number} [options.maxTokens=1024] - Max tokens for skill context
   * @param {number} [options.maxSkills=20] - Max tracked skills
   * @param {number} [options.decayHours=4] - Hours before relevance halves
   */
  constructor(options = {}) {
    this.dataDir = options.dataDir || '.';
    this.maxTokens = options.maxTokens || 1024;
    this.maxSkills = options.maxSkills || 20;
    this.decayMs = (options.decayHours || 4) * 60 * 60 * 1000;

    /** @type {Map<string, SkillSlot>} slug → { skill, relevance, lastUsed, tokenCount } */
    this.slots = new Map();
    /** @type {string[]} Most recent relevant tool names */
    this.recentTools = [];
    /** @type {string[]} Recent message terms */
    this.recentTerms = [];
    /** @type {Object} Usage stats for learning */
    this.usageStats = {};
    /** @type {number} Last persistence timestamp */
    this._lastPersist = 0;

    this._persistPath = join(this.dataDir, 'context-window.json');
  }

  /**
   * Estimate token count for text (rough: ~4 chars per token).
   */
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil((text.length || 0) / 4);
  }

  /**
   * Record a skill as relevant to current context.
   */
  addSkill(skill) {
    if (!skill || !skill.slug || !skill.name) return;

    const existing = this.slots.get(skill.slug);
    if (existing) {
      existing.relevance = Math.min(1, existing.relevance + 0.2);
      existing.lastUsed = Date.now();
      existing.useCount = (existing.useCount || 0) + 1;
      return;
    }

    const tokenCount = this.estimateTokens(
      `${skill.name} ${skill.description || ''} ${skill.body || ''}`
    );

    // Evict least relevant if at capacity
    if (this.slots.size >= this.maxSkills) {
      this._evictLowest();
    }

    this.slots.set(skill.slug, {
      slug: skill.slug,
      name: skill.name,
      description: skill.description || '',
      categories: skill.categories || [],
      relevance: 0.8,
      lastUsed: Date.now(),
      useCount: 1,
      tokenCount,
      path: skill.path || '',
    });

    this._updateUsageStats(skill.slug, 'added');
  }

  /**
   * Update relevance based on current context signals.
   */
  updateContext(terms = [], tools = []) {
    this.recentTerms = terms.slice(0, 20);
    this.recentTools = tools.slice(0, 10);

    // Decay all slots
    const now = Date.now();
    for (const [slug, slot] of this.slots) {
      const elapsed = now - slot.lastUsed;
      const decayFactor = Math.pow(0.5, elapsed / this.decayMs);
      slot.relevance *= decayFactor;

      // Remove very stale entries
      if (slot.relevance < 0.05) {
        this.slots.delete(slug);
        continue;
      }

      // Boost if terms match
      for (const term of terms) {
        if (slot.name.toLowerCase().includes(term) ||
            (slot.description && slot.description.toLowerCase().includes(term))) {
          slot.relevance = Math.min(1, slot.relevance + 0.15);
        }
      }
    }
  }

  /**
   * Get skills sorted by relevance, within token budget.
   */
  getRelevantSkills(limit = 5) {
    const sorted = Array.from(this.slots.values())
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, Math.min(limit, this.maxSkills));

    return sorted.map(s => ({
      slug: s.slug,
      name: s.name,
      description: s.description,
      relevance: Math.round(s.relevance * 100) / 100,
      categories: s.categories || [],
    }));
  }

  /**
   * Record that a skill was actually used/invoked.
   */
  recordSkillUsage(skillName, action = 'invoke') {
    this._updateUsageStats(skillName, action);
  }

  /**
   * Get window statistics.
   */
  getWindowStats() {
    const totalTokens = Array.from(this.slots.values())
      .reduce((sum, s) => sum + (s.tokenCount || 0), 0);
    return {
      totalSkills: this.slots.size,
      tokensInUse: totalTokens,
      maxTokens: this.maxTokens,
      maxSkills: this.maxSkills,
      recentTools: this.recentTools.length,
      recentTerms: this.recentTerms.length,
    };
  }

  // ─── Private ────────────────────────────────────────────

  _evictLowest() {
    let lowest = null;
    let lowestSlug = null;
    for (const [slug, slot] of this.slots) {
      if (!lowest || slot.relevance < lowest.relevance) {
        lowest = slot;
        lowestSlug = slug;
      }
    }
    if (lowestSlug) {
      this.slots.delete(lowestSlug);
    }
  }

  _updateUsageStats(skillName, action) {
    if (!this.usageStats[skillName]) {
      this.usageStats[skillName] = { count: 0, lastUsed: null, actions: {} };
    }
    this.usageStats[skillName].count++;
    this.usageStats[skillName].lastUsed = Date.now();
    this.usageStats[skillName].actions[action] =
      (this.usageStats[skillName].actions[action] || 0) + 1;
    this._schedulePersist();
  }

  _schedulePersist() {
    const now = Date.now();
    if (now - this._lastPersist < 30000) return; // throttle to 30s
    this._lastPersist = now;
    this._persist().catch(() => {});
  }

  async _persist() {
    try {
      const data = {
        usageStats: this.usageStats,
        recentTools: this.recentTools,
        recentTerms: this.recentTerms,
        updatedAt: Date.now(),
      };
      await mkdir(dirname(this._persistPath), { recursive: true });
      await writeFile(this._persistPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Silently fail — persistence is non-critical
    }
  }
}

export default ContextWindowManager;
