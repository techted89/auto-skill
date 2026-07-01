import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseSkill } from "./skill-engine.js";
import { readJSON, writeJSON, getSkillsDir, getLearnDBPath, resolveDataDir, ensureDir } from "./lifecycle.js";

/**
 * Scan a skills directory and return all registered skills.
 *
 * @param {string} skillsDir - Directory to scan
 * @returns {Promise<Array<{name: string, description: string, path: string}>>}
 */
export async function scanSkills(skillsDir) {
  if (!existsSync(skillsDir)) return [];

  const entries = await readdir(skillsDir, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFilePath = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillFilePath)) continue;

    const parsed = await parseSkill(skillFilePath);
    if (parsed) {
      results.push({ ...parsed, path: skillFilePath });
    }
  }

  return results;
}

/**
 * Find a skill by name (exact or partial match).
 *
 * @param {string} name - Skill name to find
 * @param {Array<{name: string}>} skills - List of skills
 * @returns {{name: string, description: string, path: string} | undefined}
 */
export function findSkill(name, skills) {
  const lower = name.toLowerCase();
  return skills.find(
    (s) => s.name.toLowerCase() === lower || s.name.toLowerCase().includes(lower)
  );
}

/**
 * The learning database stores patterns extracted from interactions.
 */
export async function loadLearnDB(dataDir) {
  const dbPath = join(dataDir, "learn-db.json");
  const data = await readJSON(dbPath);
  return data || { patterns: [], skills: [], lastUpdated: null };
}

export async function saveLearnDB(dataDir, db) {
  db.lastUpdated = new Date().toISOString();
  await ensureDir(dataDir);
  await writeJSON(join(dataDir, "learn-db.json"), db);
}

/**
 * Skill usage tracker.
 * Records which skills were used, how often, and with what context.
 */
export class SkillUsageTracker {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.dbPath = join(dataDir, "usage.json");
    this._cache = null;
  }

  async _load() {
    if (this._cache) return this._cache;
    const data = await readJSON(this.dbPath);
    this._cache = data || { skills: {}, total: 0 };
    return this._cache;
  }

  async _save() {
    await ensureDir(this.dataDir);
    await writeJSON(this.dbPath, this._cache);
  }

  async recordUse(skillName, context = {}) {
    const db = await this._load();
    if (!db.skills[skillName]) {
      db.skills[skillName] = { count: 0, contexts: [] };
    }
    db.skills[skillName].count++;
    db.total++;
    if (Object.keys(context).length > 0) {
      db.skills[skillName].contexts.push({
        timestamp: new Date().toISOString(),
        ...context,
      });
      // Keep last 20 contexts
      if (db.skills[skillName].contexts.length > 20) {
        db.skills[skillName].contexts = db.skills[skillName].contexts.slice(-20);
      }
    }
    await this._save();
  }

  async getTopSkills(limit = 5) {
    const db = await this._load();
    return Object.entries(db.skills)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, limit)
      .map(([name, data]) => ({ name, ...data }));
  }
}
