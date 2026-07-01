/**
 * Skill Dependency Resolver - Production Grade
 * 
 * Resolves and manages skill dependencies for smart bundling.
 * Enhanced with semantic similarity scoring and caching.
 */

import { encoding_for_model } from '@dqbd/tiktoken';

class SkillDependencyResolver {
  constructor(config = {}) {
    this.config = {
      minConfidence: config.minConfidence ?? 0.3,
      maxDepsPerSkill: config.maxDepsPerSkill ?? 10,
      cacheTTL: config.cacheTTL ?? 3600000, // 1 hour
      ...config
    };
    
    this._dependencyCache = new Map();
    this._tokenizer = null;
  }

  async getTokenizer() {
    if (!this._tokenizer) {
      this._tokenizer = await encoding_for_model('gpt-4');
    }
    return this._tokenizer;
  }

  /**
   * Extract skill references from markdown text
   */
  extractSkillReferences(text) {
    const references = new Set();
    
    // Wiki-style links: [[Skill Name]]
    const wikiLinks = text.match(/\[\[([^\]]+)\]\]/g);
    if (wikiLinks) {
      wikiLinks.forEach(link => {
        const name = link.slice(2, -2).trim();
        if (name) references.add(name);
      });
    }
    
    // Bold patterns: **Skill Name**
    const boldNames = text.match(/\*\*([A-Z][a-zA-Z0-9\s-]+)\*\*/g);
    if (boldNames) {
      boldNames.forEach(name => {
        const clean = name.slice(2, -2).trim();
        if (clean.length > 3 && clean.length < 100) references.add(clean);
      });
    }
    
    // Code references: `skill-name`
    const codeRefs = text.match(/`([a-zA-Z0-9-]+)`/g);
    if (codeRefs) {
      codeRefs.forEach(ref => {
        const clean = ref.slice(1, -1).trim();
        if (clean.includes('-') || clean.length > 5) references.add(clean);
      });
    }
    
    return Array.from(references);
  }

  /**
   * Semantic similarity scoring between reference and target
   */
  async semanticMatch(reference, targetDescription) {
    const tokenizer = await this.getTokenizer();
    
    const refTokens = tokenizer.encode(reference.toLowerCase());
    const targetTokens = tokenizer.encode((targetDescription || '').toLowerCase());
    
    // Simple Jaccard similarity
    const refSet = new Set(refTokens);
    const targetSet = new Set(targetTokens);
    const intersection = [...refSet].filter(x => targetSet.has(x)).length;
    const union = new Set([...refSet, ...targetSet]).size;
    
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Resolve dependencies for a set of skills
   */
  async resolveDependencies(skills) {
    const graph = new Map();
    const skillsMap = new Map(skills.map(s => [s.name, s]));
    
    for (const skill of skills) {
      const deps = new Map();
      const refs = this.extractSkillReferences(skill.body || '');
      
      for (const ref of refs) {
        const target = skillsMap.get(ref) || 
                      skills.find(s => s.name.toLowerCase() === ref.toLowerCase());
        
        if (target && target.name !== skill.name) {
          const confidence = await this.calculateConfidence(ref, skill, target);
          deps.set(target.slug || target.name, {
            target: target.slug || target.name,
            type: 'requires',
            confidence
          });
        }
      }
      
      graph.set(skill.name, {
        dependencies: Array.from(deps.values()),
        dependents: []
      });
    }
    
    // Build reverse relationships
    for (const [name, node] of graph.entries()) {
      for (const dep of node.dependencies) {
        const depNode = graph.get(dep.target);
        if (depNode) {
          depNode.dependents.push({
            source: name,
            type: dep.type,
            confidence: dep.confidence
          });
        }
      }
    }
    
    return graph;
  }

  /**
   * Calculate confidence score for a dependency
   */
  async calculateConfidence(ref, sourceSkill, targetSkill) {
    // Check cache
    const cacheKey = `${sourceSkill.name}->${targetSkill.name}`;
    if (this._dependencyCache.has(cacheKey)) {
      return this._dependencyCache.get(cacheKey);
    }
    
    let confidence = this.config.minConfidence;
    
    // Explicit mentions
    const sourceBody = (sourceSkill.body || '').toLowerCase();
    const targetDesc = (targetSkill.description || '').toLowerCase();
    
    if (sourceBody.includes(`depends on ${ref.toLowerCase()}`)) confidence += 0.4;
    if (sourceBody.includes(`requires ${ref.toLowerCase()}`)) confidence += 0.3;
    if (sourceBody.includes(`prerequisite`)) confidence += 0.2;
    
    // Semantic similarity
    const semanticScore = await this.semanticMatch(ref, targetDesc);
    confidence += semanticScore * 0.3;
    
    const finalConfidence = Math.min(1, confidence);
    
    // Cache result
    this._dependencyCache.set(cacheKey, finalConfidence);
    setTimeout(() => this._dependencyCache.delete(cacheKey), this.config.cacheTTL);
    
    return finalConfidence;
  }

  /**
   * Detect circular dependencies
   */
  detectCircularDependencies(graph) {
    const cycles = [];
    const visited = new Set();
    const recStack = new Set();
    
    const dfs = (node, path) => {
      if (recStack.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart >= 0) {
          cycles.push(path.slice(cycleStart));
        }
        return;
      }
      
      if (visited.has(node)) return;
      
      visited.add(node);
      recStack.add(node);
      path.push(node);
      
      const deps = graph.get(node)?.dependencies || [];
      for (const dep of deps) {
        dfs(dep.target, [...path]);
      }
      
      recStack.delete(node);
      path.pop();
    };
    
    for (const node of graph.keys()) {
      dfs(node, []);
    }
    
    return cycles;
  }

  /**
   * Get transitive dependencies
   */
  async getTransitiveDependencies(graph, skillName) {
    const allDeps = new Set();
    const queue = [...(graph.get(skillName)?.dependencies || []).map(d => d.target)];
    const visited = new Set();
    
    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      
      const node = graph.get(current);
      if (node) {
        allDeps.add(current);
        for (const dep of node.dependencies) {
          if (!visited.has(dep.target)) {
            queue.push(dep.target);
          }
        }
      }
    }
    
    return Array.from(allDeps);
  }
}

export default SkillDependencyResolver;