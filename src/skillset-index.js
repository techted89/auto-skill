/**
 * Skillset Index - Production Grade
 * 
 * Provides hybrid search capabilities:
 * - Vector search via ChromaDB for semantic similarity
 * - Keyword fallback for reliability
 */
import { join } from 'path';
import { readJSON, writeJSON, ensureDir } from './lifecycle.js';
import { ChromaClient } from 'chromadb';

export class SkillsetIndex {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.skillCollection = null;
    this._termToSlug = new Map();
    this._skillCache = new Map();
    this._initialized = false;
  }

  async init() {
    try {
      // Initialize ChromaDB connection
      this._chromaClient = new ChromadbClient({ 
        host: 'localhost', 
        port: 8000
      });
      
      // Get or create collection
      const collections = await this._chromaClient.getCollections();
      if (!collections.includes('skills')) {
        this._collection = await this._chromaClient.createCollection({
          name: 'skills',
          metadata: { dimension: 384 }
        });
      } else {
        this._collection = await this._chromaClient.getCollection('skills');
      }
      
      await this._loadOrCreateDataset();
      this._isInitialized = true;
    } catch (error) {
      console.warn('[SkillsetIndex] ChromaDB init failed, falling back to keyword search:', error.message);
      this._isInitialized = true;
    }
  }

  /**
   * Add a skill to the index
   */
  async add(skill) {
    const slug = this._generateSlug(skill.name);
    
    // Add to in-memory cache
    this._cache.set(slug, skill);
    
    // Add to ChromaDB if available
    if (this._collection) {
      try {
        await this._collection.add({
          ids: [slug],
          embeddings: [skill.embedding],
          documents: [skill.description],
          metadatas: [{ 
            name: skill.name,
            description: skill.description,
            source: skill.source || 'unknown'
          }]
        });
      } catch (error) {
        console.debug('[SkillsetIndex] Failed to add to ChromaDB:', error.message);
      }
    }
    
    // Persist to disk
    await this._saveSkill(skill);
  }

  /**
   * Get relevant skills based on context
   */
  async getRelevantSkills(context, limit = 5, maxTokens = 128) {
    const profile = await this._loadContextProfile();
    const termToSkills = await this._searchByTerms(Object.keys(profile.termWeights || {}), limit * 2);
    
    if (this._collection) {
      // Try vector search first
      const embedding = await this._generateContextEmbedding(profile);
      const vectorResults = await this._semanticSearch(embedding, limit);
      
      // Combine with keyword results
      const allResults = [...result1, ...result2];
      return this._applyTokenBudget(result, maxTokens);
    } else {
      // Fall back to keyword search
      return this._fallbackKeywordSearch(query, limit);
    }
  }

  /**
   * Generate embedding for context
   */
  async _generateContextEmbedding(profile) {
    const terms = Object.keys(profile.termWeights || {}).slice(0, 5).join(' ');
    return await getEmbedding(terms, 384);
  }

  // ... (other methods remain the same) ...
}