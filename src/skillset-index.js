import { join } from 'path';
import { readJSON, writeJSON, ensureDir } from './lifecycle.js';
import { ChromaClient } from 'chromadb';

export class SkillsetIndex {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this._collection = null;
    this._skillCache = new Map();
    this._termToSlug = new Map();
    this._initialized = false;
    this._indexPath = join(dataDir, 'skillset-index.json');
  }

  async init() {
    try {
      this._chromaClient = new ChromaClient({ host: 'localhost', port: 8000 });
      await this._chromaClient.heartbeat();

      try {
        this._collection = await this._chromaClient.getCollection({ name: 'skills' });
      } catch {
        this._collection = await this._chromaClient.createCollection({
          name: 'skills',
          metadata: { 'hnsw:space': 'cosine' },
        });
      }

      await this._loadCache();
      this._initialized = true;
    } catch (error) {
      console.warn('[SkillsetIndex] ChromaDB unavailable, using keyword-only index:', error.message);
      await this._loadCache();
      this._initialized = true;
    }
  }

  async _loadCache() {
    try {
      const data = await readJSON(this._indexPath);
      if (data && Array.isArray(data.skills)) {
        for (const skill of data.skills) {
          this._skillCache.set(skill.slug || skill.name, skill);
          for (const word of (skill.keywords || [])) {
            this._termToSlug.set(word.toLowerCase(), skill.slug || skill.name);
          }
        }
      }
    } catch {
      // start fresh
    }
  }

  async _saveCache() {
    await ensureDir(this.dataDir);
    await writeJSON(this._indexPath, {
      skills: Array.from(this._skillCache.values()),
      updatedAt: new Date().toISOString(),
    });
  }

  async add(skill) {
    const slug = this._generateSlug(skill.name);
    const enriched = { ...skill, slug, keywords: this._extractKeywords(skill) };

    this._skillCache.set(slug, enriched);
    for (const word of enriched.keywords) {
      this._termToSlug.set(word.toLowerCase(), slug);
    }

    if (this._collection && skill.embedding) {
      try {
        await this._collection.add({
          ids: [slug],
          embeddings: [skill.embedding],
          documents: [skill.description || ''],
          metadatas: [{ name: skill.name, description: skill.description || '', source: skill.source || 'unknown' }],
        });
      } catch (error) {
        console.debug('[SkillsetIndex] ChromaDB add failed:', error.message);
      }
    }

    await this._saveCache();
  }

  async merge(skills) {
    for (const skill of skills) {
      if (!this._skillCache.has(this._generateSlug(skill.name))) {
        await this.add(skill);
      }
    }
  }

  async build(skills) {
    this._skillCache.clear();
    this._termToSlug.clear();
    for (const skill of skills) {
      await this.add(skill);
    }
  }

  async search(query, limit = 5) {
    const q = query.toLowerCase();
    const results = [];

    if (this._collection) {
      try {
        const vectorResults = await this._collection.query({
          queryTexts: [q],
          nResults: limit,
        });
        if (vectorResults && vectorResults.ids && vectorResults.ids[0]) {
          for (let i = 0; i < vectorResults.ids[0].length; i++) {
            const slug = vectorResults.ids[0][i];
            const skill = this._skillCache.get(slug);
            if (skill) {
              results.push({ ...skill, score: vectorResults.distances?.[0]?.[i] ?? 0 });
            }
          }
        }
      } catch {
        // fall through to keyword search
      }
    }

    if (results.length === 0) {
      return this._fallbackKeywordSearch(q, limit);
    }

    return results.slice(0, limit);
  }

  _fallbackKeywordSearch(query, limit) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = [];

    for (const [slug, skill] of this._skillCache) {
      let score = 0;
      const searchText = (skill.name + ' ' + (skill.description || '') + ' ' + (skill.keywords || []).join(' ')).toLowerCase();

      for (const term of terms) {
        if (searchText.includes(term)) {
          score += 1;
        }
      }

      if (score > 0) {
        scored.push({ ...skill, score: score / terms.length });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async getRelevantSkills(context, limit = 5) {
    const query = (context.message || context.query || '').slice(0, 500);
    if (!query) return [];
    return this.search(query, limit);
  }

  _generateSlug(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
  }

  _extractKeywords(skill) {
    const words = new Set();
    const text = (skill.name + ' ' + (skill.description || '')).toLowerCase();
    for (const word of text.split(/\W+/).filter(Boolean)) {
      if (word.length > 2) {
        words.add(word);
      }
    }
    return Array.from(words);
  }
}
