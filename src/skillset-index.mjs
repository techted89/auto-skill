/**
 * Skillset Index — term-based skill search index with TF-IDF scoring.
 *
 * Pure JSON implementation (no ChromaDB, no external services).
 * Supports ranked search, category filtering, and flat + folder-based
 * skill directory layouts.
 *
 * The index is persisted as JSON so agents can read it directly.
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseSkill, parseSkillContent, slugify } from './skill-engine.mjs';

export class SkillsetIndex {
  /**
   * @param {string} dataDir - Directory for index JSON
   * @param {Object} [options]
   * @param {string[]} [options.skillDirs] - Directories to scan
   * @param {boolean} [options.autoRebuild=false] - Rebuild on init
   */
  constructor(dataDir, options = {}) {
    this.dataDir = dataDir;
    this.skillDirs = options.skillDirs || [];
    this.autoRebuild = options.autoRebuild || false;
    this.indexPath = join(dataDir, 'skillset-index.json');

    /** @type {Map<string, Object>} slug → skill */
    this.skills = new Map();
    /** @type {Map<string, Map<string, number>>} term → {slug: frequency} */
    this.termIndex = new Map();
    this.totalCount = 0;
    this.lastBuilt = null;
    this._qualityCache = new Map();
  }

  async init() {
    if (this.autoRebuild && this.skillDirs.length > 0) {
      await this.rebuild();
      return;
    }
    try {
      const loaded = await this._loadFromDisk();
      if (loaded && loaded.skills && loaded.skills.length > 0) {
        this._hydrate(loaded);
      } else if (this.skillDirs.length > 0) {
        await this.rebuild();
      }
    } catch {
      if (this.skillDirs.length > 0) await this.rebuild();
    }
  }

  /** Rebuild index from scratch. */
  async rebuild() {
    this.skills.clear();
    this.termIndex.clear();
    this._qualityCache.clear();

    const allSkills = [];
    for (const dir of this.skillDirs) {
      const found = await this._scanDirectory(dir);
      allSkills.push(...found);
    }

    // Deduplicate by slug
    const unique = new Map();
    for (const skill of allSkills) {
      unique.set(skill.slug, skill);
    }

    for (const skill of unique.values()) {
      this._indexSkill(skill);
    }

    this.totalCount = this.skills.size;
    this.lastBuilt = new Date().toISOString();
    await this._saveToDisk();
  }

  /** Add a single skill to the index. */
  async add(skill) {
    if (!skill || !skill.name || !skill.slug) return;
    if (this.skills.has(skill.slug)) return;
    this._indexSkill(skill);
    this.totalCount = this.skills.size;
    this.lastBuilt = new Date().toISOString();
    await this._saveToDisk();
  }

  /** Merge multiple skills (no-op for existing). */
  async merge(skills) {
    let changed = false;
    for (const skill of skills) {
      if (!skill || !skill.name) continue;
      const slug = skill.slug || slugify(skill.name);
      if (!this.skills.has(slug)) {
        this._indexSkill({ ...skill, slug });
        changed = true;
      }
    }
    if (changed) {
      this.totalCount = this.skills.size;
      this.lastBuilt = new Date().toISOString();
      await this._saveToDisk();
    }
  }

  /** Build index from array of skill objects (replaces all). */
  async build(skills) {
    this.skills.clear();
    this.termIndex.clear();
    this._qualityCache.clear();
    for (const skill of skills) {
      if (!skill || !skill.name) continue;
      const slug = skill.slug || slugify(skill.name);
      this._indexSkill({ ...skill, slug });
    }
    this.totalCount = this.skills.size;
    this.lastBuilt = new Date().toISOString();
    await this._saveToDisk();
  }

  /**
   * Search skills by query with ranked relevance.
   *
   * @param {string} query - Search query
   * @param {number} [limit=10] - Max results
   * @param {Object} [options]
   * @param {string[]} [options.categories] - Filter by category
   * @param {number} [options.minScore=0.1] - Min score threshold
   * @returns {Array<Object>}
   */
  search(query, limit = 10, options = {}) {
    const { categories, minScore = 0.1 } = options || {};
    if (!query || this.totalCount === 0) return [];

    const terms = query.toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 1);
    if (terms.length === 0) return [];

    const scores = new Map(); // slug → score

    for (const [slug, skill] of this.skills) {
      // Category pre-filter
      if (categories && categories.length > 0) {
        const skillCats = skill.categories || [];
        if (!categories.some(c => skillCats.includes(c))) continue;
      }

      let score = 0;

      for (const term of terms) {
        // Direct name match (highest weight)
        if (skill.name.toLowerCase() === term) score += 3.0;
        else if (skill.name.toLowerCase().includes(term)) score += 2.0;

        // Description match
        if (skill.description && skill.description.toLowerCase().includes(term)) {
          score += 1.5;
        }

        // TF-IDF term index match
        const posting = this.termIndex.get(term);
        if (posting && posting.has(slug)) {
          const tf = posting.get(slug);
          const idf = Math.log((this.totalCount + 1) / (posting.size + 1)) + 1;
          score += tf * idf * 1.0;
        }

        // Keyword match
        if (skill.keywords && skill.keywords.some(kw => kw.includes(term))) {
          score += 1.0;
        }
      }

      // Quality score bonus
      score += this._getQualityScore(skill) * 0.3;

      if (score > minScore) {
        scores.set(slug, score);
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([slug, score]) => {
        const skill = this.skills.get(slug);
        return {
          slug,
          name: skill.name,
          description: skill.description || '',
          score: Math.min(score, 10),
          category: (skill.categories || [])[0] || 'uncategorized',
          categories: skill.categories || [],
          path: skill.path || '',
        };
      });
  }

  /** Get relevant skills for a context (message + tools). */
  getRelevantSkills(context, limit = 5) {
    const query = (context.message || context.query || '').slice(0, 500);
    const tools = Array.isArray(context.tools) ? context.tools : [];
    return this.search([query, ...tools].filter(Boolean).join(' '), limit);
  }

  /** Get a single skill by slug. */
  getBySlug(slug) {
    return this.skills.get(slug) || null;
  }

  /** Get all indexed skills. */
  getAll() {
    return Array.from(this.skills.values()).map(s => ({
      slug: s.slug,
      name: s.name,
      description: s.description || '',
      category: (s.categories || [])[0] || 'uncategorized',
      categories: s.categories || [],
      quality: this._getQualityScore(s),
      path: s.path || '',
    }));
  }

  /** Get index metadata. */
  getStatus() {
    return {
      totalCount: this.totalCount,
      lastBuilt: this.lastBuilt,
      indexVersion: 2,
      termCount: this.termIndex.size,
      location: this.indexPath,
    };
  }

  // ─── Private ────────────────────────────────────────────

  _indexSkill(skill) {
    this.skills.set(skill.slug, skill);

    const searchText = [
      skill.name || '',
      skill.description || '',
      skill.body || '',
      ...(skill.keywords || []),
    ].join(' ').toLowerCase();

    const tokens = searchText.split(/[^a-z0-9]+/).filter(t => t.length > 1);
    const termFreq = new Map();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }
    for (const [term, freq] of termFreq) {
      if (!this.termIndex.has(term)) this.termIndex.set(term, new Map());
      this.termIndex.get(term).set(skill.slug, freq);
    }

    if (!skill.categories) skill.categories = this._detectCategories(skill);
    if (!skill.keywords) skill.keywords = this._extractKeywords(skill);
  }

  _extractKeywords(skill) {
    const keywords = new Set();
    for (const part of (skill.name || '').split(/[-_]/)) {
      if (part.length > 2) keywords.add(part);
    }
    const descTriggers = (skill.description || '').toLowerCase()
      .match(/\b(react|vue|angular|node|python|go|rust|docker|k8s|api|test|debug|deploy|build|design|architect|security|data|mobile|game|godot|opencode)\b/g);
    if (descTriggers) descTriggers.forEach(t => keywords.add(t));
    return Array.from(keywords);
  }

  _detectCategories(skill) {
    const text = `${skill.name} ${skill.description || ''} ${skill.body || ''}`.toLowerCase();
    const categories = {
      frontend: ['react', 'vue', 'angular', 'svelte', 'css', 'html', 'ui', 'component', 'frontend', 'web'],
      backend: ['backend', 'api', 'rest', 'graphql', 'server', 'microservice', 'database', 'sql'],
      devops: ['devops', 'ci/cd', 'deploy', 'kubernetes', 'docker', 'terraform', 'infra'],
      testing: ['test', 'testing', 'qa', 'coverage', 'e2e', 'unit test', 'playwright', 'vitest'],
      security: ['security', 'audit', 'vulnerability', 'threat', 'encryption', 'auth'],
      debugging: ['debug', 'error', 'trace', 'log', 'exception', 'fix', 'diagnose'],
      architecture: ['architecture', 'design pattern', 'system design', 'scalability'],
      data: ['data', 'pipeline', 'etl', 'analytics', 'ml', 'ai', 'machine learning'],
      mobile: ['mobile', 'ios', 'android', 'react native', 'flutter', 'swift'],
      godot: ['godot', 'gdscript', '2d', '3d', 'game', 'sprite', 'animation'],
      workflow: ['workflow', 'orchestration', 'automation', 'pipeline', 'ci'],
      meta: ['opencode', 'skill', 'plugin', 'agent', 'config'],
    };
    const matched = [];
    for (const [cat, keywords] of Object.entries(categories)) {
      if (keywords.some(kw => text.includes(kw))) matched.push(cat);
    }
    return matched.length > 0 ? matched : ['uncategorized'];
  }

  _getQualityScore(skill) {
    if (this._qualityCache.has(skill.slug)) return this._qualityCache.get(skill.slug);
    let score = 0.5;
    if (skill.name && skill.name.length >= 8) score += 0.1;
    if (skill.name && !skill.name.includes('auto-')) score += 0.1;
    if (skill.description && skill.description.length >= 40) score += 0.1;
    if (skill.description && /^[A-Z]/.test(skill.description)) score += 0.1;
    if (skill.body) {
      if (skill.body.length >= 300) score += 0.1;
      if (skill.body.length >= 800) score += 0.1;
      const codeBlocks = (skill.body.match(/```[\s\S]*?```/g) || []);
      if (codeBlocks.length >= 2) score += 0.1;
      const headings = (skill.body.match(/^#+\s+/gm) || []);
      if (headings.length >= 3) score += 0.1;
      if (headings.length >= 6) score += 0.1;
    }
    score = Math.min(score, 1.0);
    this._qualityCache.set(skill.slug, score);
    return score;
  }

  async _scanDirectory(dirPath) {
    if (!existsSync(dirPath)) return [];
    const skills = [];
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Folder-based: dir/skill-name/SKILL.md
          const skillMdPath = join(dirPath, entry.name, 'SKILL.md');
          try {
            const parsed = await parseSkill(skillMdPath);
            if (parsed) {
              skills.push({ ...parsed, path: skillMdPath, categories: [], keywords: [] });
            }
          } catch { /* skip */ }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // Flat: dir/skill-name.md
          const filePath = join(dirPath, entry.name);
          try {
            const raw = await readFile(filePath, 'utf-8');
            const parsed = parseSkillContent(raw, filePath);
            if (parsed) {
              skills.push({ ...parsed, path: filePath, categories: [], keywords: [] });
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* skip unreadable */ }
    return skills;
  }

  async _loadFromDisk() {
    const raw = await readFile(this.indexPath, 'utf-8');
    return JSON.parse(raw);
  }

  async _saveToDisk() {
    const data = {
      version: 2,
      totalCount: this.totalCount,
      lastBuilt: this.lastBuilt,
      termIndex: Array.from(this.termIndex.entries()).map(([term, postings]) => [
        term,
        Array.from(postings.entries()),
      ]),
      skills: Array.from(this.skills.values()).map(s => ({
        slug: s.slug,
        name: s.name,
        description: s.description || '',
        categories: s.categories || [],
        keywords: s.keywords || [],
        path: s.path || '',
        bodyLength: (s.body || '').length,
      })),
    };
    try {
      await mkdir(dirname(this.indexPath), { recursive: true });
      await writeFile(this.indexPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[SkillsetIndex] Save failed:', err.message);
    }
  }

  _hydrate(data) {
    this.totalCount = data.totalCount || 0;
    this.lastBuilt = data.lastBuilt || null;
    this.termIndex = new Map(
      (data.termIndex || []).map(([term, postings]) => [term, new Map(postings)])
    );
    for (const skill of (data.skills || [])) {
      this.skills.set(skill.slug, skill);
    }
  }
}

export default SkillsetIndex;
