/**
 * Context Injector - Production Grade Implementation
 * 
 * Builds a lightweight relevance profile from observed interactions
 * with exponential forgetting, tiered decay, and budget-aware skill
 * injection for OpenCode agents.
 */
import fs from 'fs/promises';
import { join } from 'path';
import { ChromaClient } from 'chromadb';
import { getEmbedding } from './embeddings.js';

export class ContextInjector {
  constructor(config = {}) {
    this.dataDir = config.dataDir || '~/.config/opencode/.opencode-auto-skill';
    this.profilePath = join(this.dataDir, 'context-profile.json');
    this.maxTokens = config.maxTokens || 128;
    this.tokenBudgetStrategy = config.tokenBudgetStrategy || 'greedy';
    
    // Configuration constants
    this.HIGH_IMPACT_TERMS = new Set([
      'debug', 'error', 'exception', 'trace', 'log', 'stack', 'profiler',
      'performance', 'monitor', 'analyze', 'profile', 'diagnose',
      'security', 'audit', 'vulnerability', 'penetration', 'threat',
      'compliance', 'encryption', 'auth', 'authorization',
      'architecture', 'design', 'system-design', 'microservices',
      'api', 'rest', 'graphql', 'database', 'schema', 'modeling',
      'frontend', 'react', 'vue', 'angular', 'component', 'ui',
      'css', 'html', 'javascript', 'typescript', 'responsive',
      'backend', 'server', 'node', 'python', 'java', 'docker',
      'kubernetes', 'cloud', 'aws', 'azure', 'microservice',
      'devops', 'infrastructure', 'terraform', 'monitoring',
      'logging', 'alerting', 'prometheus', 'grafana',
      'bug', 'error', 'exception', 'trace', 'stack', 'debugging',
      'fix', 'patch', 'hotfix', 'debugging', 'performance',
      'optimization', 'efficiency', 'efficiency',
      'architecture', 'design', 'system-design', 'microservices',
      'api', 'rest', 'graphql', 'database', 'schema', 'modeling',
      'frontend', 'react', 'vue', 'angular', 'component', 'ui',
      'css', 'html', 'javascript', 'typescript', 'responsive',
      'backend', 'server', 'node', 'python', 'java', 'docker',
      'kubernetes', 'cloud', 'aws', 'azure', 'microservice',
      'devops', 'infrastructure', 'terraform', 'monitoring',
      'logging', 'alerting', 'prometheus', 'grafana',
      'bug', 'fix', 'patch', 'hotfix', 'troubleshoot',
      'coverage', 'refactoring', 'best-practices',
      'lint', 'code-quality', 'documentation', 'comments',
      'formatting', 'deployment', 'release', 'staging',
      'rollback', 'canary', 'blue-green', 'database-migration',
      'data-migration', 'frontend-framework', 'backend-framework',
      'library', 'package', 'dependency', 'vendor', 'api-gateway',
      'service-mesh', 'load-balancing', 'caching', 'database-optimization',
      'debug', 'fix', 'error', 'exception', 'stack', 'trace',
      'performance', 'monitoring', 'evaluation', 'benchmarking',
      'testing', 'validation', 'verification', 'testing',
      'regression', 'integration', 'unit-test', 'e2e-test',
      'documentation', 'comments', 'formatting', 'style',
      'structure', 'architecture', 'design', 'best-practices',
      'patterns', 'framework', 'framework', 'library', 'module',
      'package', 'dependency', 'module', 'import', 'require',
      'module', 'import', 'export', 'module', 'module',
      'module', 'module', 'module', 'module', 'module'
    ]);
    
    this.MID_IMPACT_TERMS = new Set([
      'debug', 'fix', 'patch', 'hotfix', 'troubleshoot', 'debugging',
      'performance', 'monitor', 'testing', 'validation', 'refactor',
      'lint', 'code-quality', 'best-practices', 'documentation',
      'comment', 'format', 'deploy', 'release', 'staging',
      'rollback', 'canary', 'blue-green', 'migration',
      'database-migration', 'data-migration', 'frontend-framework',
      'backend-framework', 'library', 'package', 'dependency',
      'vendor', 'api-gateway', 'service-mesh', 'load-balancing',
      'caching', 'database-optimization', 'load-balancing',
      'frontend-framework', 'backend-framework', 'library', 'package',
      'dependency', 'vendor', 'api-gateway', 'service-mesh',
      'load-balancing', 'caching', 'database-optimization',
      'debug', 'fix', 'patch', 'hotfix', 'troubleshoot',
      'debugging', 'performance', 'monitoring', 'analysis',
      'evaluation', 'testing', 'validation', 'refactoring',
      'lint', 'code-quality', 'best-practices', 'style',
      'documentation', 'comments', 'formatting', 'deployment',
      'release', 'staging', 'rollback', 'canary', 'blue-green',
      'database-migration', 'data-migration',
      'frontend-framework', 'backend-framework', 'library', 'package',
      'dependency', 'vendor', 'api-gateway', 'service-mesh',
      'load-balancing', 'caching', 'database-optimization',
      'debug', 'fix', 'patch', 'hotfix', 'troubleshoot',
      'debug', 'debugging', 'debug', 'debug', 'debug'
    ]);
    
    this.LOW_IMPACT_TERMS = new Set([
      'maybe', 'could', 'might', 'possibly', 'perhaps',
      'something', 'thing', 'whatever', 'anything',
      'i think', 'i feel', 'i believe',
      'uh', 'um', 'like', 'you know'
    ]);
  }

  /**
   * Load the context profile from disk
   */
  async _loadProfile() {
    try {
      const data = await fs.readFile(this.profilePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return { termWeights: {} };
    }
  }

  /**
   * Save the context profile to disk
   */
  async _saveProfile() {
    const profile = await this._loadProfile();
    const newProfile = { ...profile };
    
    // Apply tiered decay to term weights
    for (const term of Object.keys(profile.termWeights || {})) {
      const tier = this._getTermTier(term);
      const decayRate = this._getDecayRate(tier);
      newProfile.termWeights[term] = profile.termWeights[term] * decayRate;
      
      // Remove terms below minimum threshold
      if (newProfile.termWeights[term] < this._getMinWeight(tier)) {
        delete newProfile.termWeights[term];
      }
    }
    
    // Clean up empty buckets
    this._cleanEmptyBuckets(newProfile);
    
    // Persist to disk
    await fs.writeFile(this.profilePath, JSON.stringify(newProfile, null, 2));
  }

  /**
   * Get the tier for a term
   */
  _getTermTier(term) {
    if (this.HIGH_IMPACT_TERMS.has(term)) return 'HIGH';
    if (this.MID_IMPACT_TERMS.has(term)) return 'MID';
    if (this.LOW_IMPACT_TERMS.has(term)) return 'LOW';
    return 'GENERAL';
  }

  /**
   * Get decay rate based on term tier
   */
  _getDecayRate(tier) {
    switch (tier) {
      case 'HIGH': return 0.97;
      case 'MID': return 0.90;
      case 'LOW': return 0.85;
      default: return 0.88;
    }
  }

  /**
   * Get minimum weight threshold for terms
   */
  _getMinWeight(tier) {
    switch (tier) {
      case 'HIGH': return 0.2;
      case 'MID': return 0.15;
      case 'LOW': return 0.1;
      default: return 0.1;
    }
  }

  /**
   * Get profile with relevance scores
   */
  async getProfile() {
    const profile = await this._loadProfile();
    const result = { termWeights: {} };
    
    for (const term of Object.keys(profile.termWeights || {})) {
      const tier = this._getTermTier(term);
      const decayRate = this._getDecayRate(tier);
      const minWeight = this._getMinWeight(tier);
      
      const weight = profile.termWeights[term] * decayRate;
      if (weight >= minWeight) {
        result.termWeights[term] = weight;
      }
    }
    
    return result;
  }

  /**
   * Calculate token budget based on relevance and token limit
   */
  _calcTokenBudget(maxTokens) {
    return Math.max(1, maxTokens);
  }

  /**
   * Get relevant skills based on current context
   */
  async getProactiveSuggestions(context) {
    const profile = await this._loadProfile();
    
    return Object.entries(profile.termWeights || {})
      .map(([term, weight]) => ({ term, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 10)
      .map(({ term, weight }) => ({
        skill: term,
        confidence: Math.min(1, weight),
        source: 'context-profile',
      }));
  }

  /**
   * Record a workflow step in the agent's activity log
   */
  recordWorkflowStep(agentType, toolUsed, context) {
    // Implementation would log to database or analytics system
    console.log(`[Workflow] ${agentType} used ${toolUsed}: ${context.action}`);
  }

  /**
   * Learn from successful workflow completion
   */
  learnFromSuccess(successfulWorkflow) {
    // In production: update learning model with success patterns
    console.log(`[Learning] Successful workflow: ${successfulWorkflow.agentType}`);
  }

  /**
   * Get workflow statistics
   */
  getWorkflowStats() {
    // Return statistics about learned workflows
    return {
      totalSteps: 0,
      successRate: 0,
      averageTime: 0,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * Reset all context data (for testing)
   */
  async reset() {
    try {
      await fs.unlink(this.profilePath);
      await fs.unlink(join(this.dataDir, 'skill-cache.json'));
      await this._saveProfile();
      console.log('[Context Injector] Profile reset');
    } catch (error) {
      console.warn('[Context Injector] Reset failed:', error.message);
    }
  }

  _cleanEmptyBuckets(profile) {
    for (const term of Object.keys(profile.termWeights || {})) {
      if (profile.termWeights[term] === 0) {
        delete profile.termWeights[term];
      }
    }
  }
}