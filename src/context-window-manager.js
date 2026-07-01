import { encoding_for_model } from '@dqbd/tiktoken';

class ContextWindowManager {
  constructor(config = {}) {
    this.maxTokens = config.maxTokens ?? 16000;
    this.skills = new Map();               // slug → {content, usage, timestamp}
    this.history = [];                     // recent messages for compression
    this.budget = config.budget ?? {history:0.2, skills:0.6, buffer:0.2};
    this.usageStats = {};
    this.saveUsageStats = config.persistence?.saveUsageStats;
    
    // Initialize token estimator
    this._tokenizer = null;
  }

  async getTokenizer(model = 'gpt-4') {
    if (!this._tokenizer) {
      this._tokenizer = await encoding_for_model(model);
    }
    return this._tokenizer;
  }

  async estimateTokens(text) {
    const tokenizer = await this.getTokenizer();
    return tokenizer.encode(text).length;
  }

  async currentUsage() {
    let totalTokens = 0;
    for (const skill of this.skills.values()) {
      totalTokens += skill.tokens;
    }
    return totalTokens;
  }

  async addSkill(skill) {
    const skillWithTokens = await this.enhanceSkillWithTokens(skill);
    this.skills.set(skillWithTokens.slug, skillWithTokens);
    await this.persistUsage(skill.slug, 'added');
    return skillWithTokens;
  }

  async enhanceSkillWithTokens(skill) {
    const existing = this.skills.get(skill.slug);
    if (existing) {
      return existing; // Keep existing tokens
    }
    
    const content = skill.description + '\n\n' + (skill.body || '');
    const tokens = await this.estimateTokens(content);
    
    return {
      ...skill,
      slug: skill.slug || this.generateSlug(skill),
      tokens,
      timestamp: Date.now(),
      relevance: await this.calculateRelevance(skill)
    };
  }

  async calculateRelevance(skill) {
    let score = 0.5; // Base relevance
    
    if (this.usageStats && this.usageStats[skill.name]) {
      const stats = this.usageStats[skill.name];
      const countScore = Math.min(stats.count / 1000, 1) * 0.3;
      const recencyScore = stats.lastUsed ? (Date.now() - stats.lastUsed) / (1000 * 60 * 60 * 24 * 30) : 0;
      const recencyFactor = Math.max(0, 1 - recencyScore) * 0.2;
      
      score += countScore + recencyFactor;
    }
    
    return Math.min(score, 1);
  }

  generateSlug(skill) {
    return skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  async pruneSkills(skills, budget) {
    const scoredSkills = [];
    for (const skill of skills) {
      const relevance = await this.relevanceScore(skill);
      scoredSkills.push({skill, relevance});
    }
    
    // Sort by relevance (descending) and take top N
    scoredSkills.sort((a, b) => b.relevance - a.relevance);
    const keepCount = Math.min(Math.ceil(skills.length * budget), scoredSkills.length);
    return scoredSkills.slice(0, keepCount).map(item => item.skill);
  }

  async relevanceScore(skill) {
    return skill.relevance || await this.calculateRelevance(skill);
  }

  async optimizeContext(skills, budget) {
    return this.pruneSkills(skills, budget);
  }

  persistUsage(skillName, action) {
    if (!this.usageStats[skillName]) {
      this.usageStats[skillName] = {
        count: 0,
        lastUsed: null,
        actions: {},
        firstUsed: Date.now()
      };
    }
    
    this.usageStats[skillName].count++;
    this.usageStats[skillName].lastUsed = Date.now();
    this.usageStats[skillName].actions[action] = 
      (this.usageStats[skillName].actions[action] || 0) + 1;
    
    if (typeof this.saveUsageStats === 'function') {
      this.saveUsageStats().catch(console.error);
    }
  }

  recordSkillUsage(skillName, action = 'view') {
    return this.persistUsage(skillName, action);
  }

  getSkillUsageStats(skillName) {
    return this.usageStats[skillName] || null;
  }

  getWindowStats() {
    return {
      totalSkills: this.skills.size,
      tokensInUse: async () => this.currentUsage(),
      maxTokens: this.maxTokens,
      totalUsageStats: Object.keys(this.usageStats).length,
    };
  }

  get skillsList() {
    return Array.from(this.skills.values());
  }

  updateSkill(skill) {
    this.skills.set(skill.slug, skill);
  }

  removeSkill(slug) {
    this.skills.delete(slug);
    if (this.usageStats[slug]) {
      this.usageStats[slug].count--;
    }
  }

  async compressHistory(history, targetTokens) {
    const tokenEstimator = await this.getTokenizer();
    let totalTokens = 0;
    const compressed = [];
    
    for (const item of history.reverse()) {
      const tokens = await this.estimateTokens(JSON.stringify(item));
      if (totalTokens + tokens <= targetTokens) {
        compressed.push(item);
        totalTokens += tokens;
      } else {
        break;
      }
    }
    
    return compressed.reverse();
  }
}

export default ContextWindowManager;