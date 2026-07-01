import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateSkill } from "./skill-engine.js";
import { loadLearnDB, saveLearnDB, scanSkills } from "./skill-registry.js";
import { slugify, getSkillsDir, resolveDataDir, titleToSkillName } from "./lifecycle.js";

/**
 * Patterns that suggest a reusable skill would be valuable.
 * These are regex patterns tested against user messages and tool names.
 */
const PATTERN_SIGNALS = [
  // User asks how to do something repeatedly
  { type: "question", regex: /\bhow (do|can|to)\b/i, weight: 1 },
  { type: "tutorial", regex: /\b(guide|tutorial|walkthrough)\b/i, weight: 1 },
  // User refers to a specific technology
  { type: "tech", regex: /\b(react|vue|angular|next\.?js?|nuxt|svelte)\b/i, weight: 1 },
  { type: "tech", regex: /\b(docker|kubernetes|k8s|aws|gcp|azure)\b/i, weight: 1 },
  { type: "tech", regex: /\b(python|javascript|typescript|rust|go)\b/i, weight: 1 },
  // User is configuring something
  { type: "config", regex: /\b(setup|install|configure|initialize)\b/i, weight: 1 },
  // Debugging patterns
  { type: "debug", regex: /\b(error|bug|fail|issue|problem|not working)\b/i, weight: 2 },
  // Pattern: same tool used multiple times
  { type: "tool_repeat", regex: null, weight: 1 },
];

/**
 * Auto-learn engine.
 * Observes interactions and builds skills from recurring patterns.
 */
export class LearningEngine {
  constructor(client, dataDir) {
    this.client = client;
    this.dataDir = dataDir;
    this.patternCache = new Map(); // toolName -> count
  }

  /**
   * Initialize the learning engine, loading previous state.
   */
  async initialize() {
    const db = await loadLearnDB(this.dataDir);
    this.db = db;
    return db;
  }

  /**
   * Observe a chat message and extract potential learning signals.
   *
   * @param {Object} input - chat.message input
   * @param {Object} output - chat.message output
   */
  async observeMessage(input, output) {
    if (!output.message || !output.message.text) return;

    const text = output.message.text;
    const signals = this._detectSignals(text);

    if (signals.length === 0) return;

    await this._storeObservation({
      type: "message",
      text: text.slice(0, 500),
      signals,
      timestamp: new Date().toISOString(),
      sessionID: input.sessionID,
    });

    // Check if we have enough signal density to generate a skill
    await this._evaluateSkillCreation();
  }

  /**
   * Observe a tool execution.
   *
   * @param {Object} input - tool.execute.before input
   */
  async observeToolUsage(input) {
    const toolName = input.tool;
    const count = (this.patternCache.get(toolName) || 0) + 1;
    this.patternCache.set(toolName, count);

    // If a tool is used 3+ times, record the pattern
    if (count >= 3 && count <= 5) {
      await this._storeObservation({
        type: "tool_repeat",
        tool: toolName,
        count,
        timestamp: new Date().toISOString(),
        sessionID: input.sessionID,
      });

      await this._evaluateSkillCreation();
    }
  }

  /**
   * Generate a skill from stored patterns.
   *
   * @param {Object} pattern - The pattern to convert to a skill
   * @returns {Promise<{name: string, path: string}>}
   */
  async generateSkillFromPattern(pattern) {
    const skillsDir = getSkillsDir();
    const name = this._suggestSkillName(pattern);
    const description = this._suggestDescription(pattern);
    const body = this._buildSkillBody(pattern);

    const result = await generateSkill(skillsDir, name, description, body);
    return result;
  }

  /**
   * Apply the learning engine's knowledge: returns suggested skill
   * for a given tool name or message content.
   *
   * @param {string} context - Tool name or message text
   * @returns {Promise<{matched: boolean, skill?: Object}>}
   */
  async suggestSkill(context) {
    const db = await loadLearnDB(this.dataDir);
    if (!db.skills || db.skills.length === 0) return { matched: false };

    const lower = context.toLowerCase();

    // Check if any generated skill matches
    for (const skill of db.skills) {
      if (lower.includes(skill.name.toLowerCase())) {
        return { matched: true, skill };
      }
    }

    return { matched: false };
  }

  /**
   * Detect learning signals from message text.
   */
  _detectSignals(text) {
    const signals = [];
    for (const pattern of PATTERN_SIGNALS) {
      if (pattern.regex && pattern.regex.test(text)) {
        signals.push({ type: pattern.type, weight: pattern.weight });
      }
    }
    return signals;
  }

  /**
   * Store an observation in the learning database.
   */
  async _storeObservation(observation) {
    this.db.patterns.push(observation);

    // Keep only last 200 observations
    if (this.db.patterns.length > 200) {
      this.db.patterns = this.db.patterns.slice(-200);
    }

    await saveLearnDB(this.dataDir, this.db);
  }

  /**
   * Evaluate if accumulated signals warrant creating a new skill.
   */
  async _evaluateSkillCreation() {
    const recentPatterns = this.db.patterns.slice(-20);

    // Group by signal type and sum weights
    const signalMap = new Map();
    for (const p of recentPatterns) {
      for (const signal of p.signals || []) {
        const key = `${signal.type}:${p.type}`;
        signalMap.set(key, (signalMap.get(key) || 0) + signal.weight);
      }
    }

    // If any signal type has accumulated enough weight, create a skill
    let maxWeight = 0;
    let bestSignal = null;
    for (const [key, weight] of signalMap) {
      if (weight > maxWeight) {
        maxWeight = weight;
        bestSignal = key;
      }
    }

    // Threshold: 5+ total weight signal → create skill
    if (maxWeight >= 5 && bestSignal) {
      const [signalType] = bestSignal.split(":");

      // Find related patterns
      const relatedPatterns = recentPatterns.filter(
        (p) => (p.signals || []).some((s) => s.type === signalType)
      );

      const skill = await this.generateSkillFromPattern({
        type: signalType,
        patterns: relatedPatterns,
        weight: maxWeight,
      });

      // Record the generated skill
      this.db.skills.push({
        name: skill.name,
        signal: signalType,
        generatedAt: new Date().toISOString(),
        patternCount: relatedPatterns.length,
      });

      await saveLearnDB(this.dataDir, this.db);
    }
  }

  /**
   * Suggest a human-readable name for a generated skill.
   */
  _suggestSkillName(pattern) {
    if (pattern.type === "tool_repeat") {
      return `Using ${pattern.tool}`;
    }
    if (pattern.patterns && pattern.patterns.length > 0) {
      const last = pattern.patterns[pattern.patterns.length - 1];
      if (last.text) {
        const match = last.text.match(/\b(how (to|do|can) \w+[^.]*)/i);
        if (match) return match[1].slice(0, 60);
      }
    }
    return `Learned Pattern: ${pattern.type}`;
  }

  /**
   * Suggest a description for a generated skill.
   */
  _suggestDescription(pattern) {
    if (pattern.type === "tool_repeat") {
      return `Best practices and patterns for using the "${pattern.tool}" tool effectively`;
    }
    return `Auto-generated skill from recurring "${pattern.type}" interactions`;
  }

  /**
   * Build the markdown body for a generated skill.
   */
  _buildSkillBody(pattern) {
    const lines = [];

    lines.push(`## Overview\nAuto-generated from observed patterns.\n`);

    if (pattern.type === "tool_repeat") {
      lines.push(`## Usage Patterns\nThis skill covers recurring usage of \`${pattern.tool}\`.\n`);
    }

    if (pattern.patterns && pattern.patterns.length > 0) {
      lines.push(`## Observed Context\n`);
      lines.push(`Generated from ${pattern.patterns.length} observations across recent sessions.\n`);
      lines.push(`- Signal type: \`${pattern.type}\``);
      lines.push(`- Signal weight: ${pattern.weight}\n`);
    }

    lines.push(
      "## Notes\n",
      "- This skill was auto-generated by the learning engine.",
      "- Review and refine the content for accuracy.",
      "- Trigger keywords and patterns can be configured in the learning engine config.\n"
    );

    return lines.join("\n");
  }
}
