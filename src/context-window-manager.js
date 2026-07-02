class ContextWindowManager {
  constructor(config = {}) {
    this.maxTokens = config.maxTokens ?? 16000;
    this.skills = new Map();               // slug → {content, usage, timestamp}
    this.history = [];                     // recent messages for compression
    this.budget = config.budget ?? {history:0.2, skills:0.6, buffer:0.2};
    this.usageStats = {};
    this.saveUsageStats = config.persistence?.saveUsageStats;
  }

  estimateTokens(text) {
    // Approximate token count (~4 chars per token for English text)
    return Math.ceil((text || '').length / 4);
  }

  currentUsage() {
    let totalTokens = 0;
    for (const skill of this.skills.values()) {
      totalTokens += skill.tokens;
    }
    return totalTokens;
  }

  addSkill(skill) {
    const skillWithTokens = this.enhanceSkillWithTokens(skill);
    this.skills.set(skillWithTokens.slug, skillWithTokens);
    this.persistUsage(skill.slug, 'added');
    return skillWithTokens;
  }

  enhanceSkillWithTokens(skill) {
    const existing = this.skills.get(skill.slug);
    if (existing) {
      return existing;
    }
    
    const content = skill.description + '\n\n' + (skill.body || '');
    const tokens = this.estimateTokens(content);
    
    return {
      ...skill,
      slug: skill.slug || this.generateSlug(skill),
      tokens,
      timestamp: Date.now(),
      relevance: this.calculateRelevance(skill)
    };
  }

  calculateRelevance(skill) {
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

  pruneSkills(skills, budget) {
    const scoredSkills = [];
    for (const skill of skills) {
      const relevance = this.relevanceScore(skill);
      scoredSkills.push({skill, relevance});
    }
    
    scoredSkills.sort((a, b) => b.relevance - a.relevance);
    const keepCount = Math.min(Math.ceil(skills.length * budget), scoredSkills.length);
    return scoredSkills.slice(0, keepCount).map(item => item.skill);
  }

  relevanceScore(skill) {
    return skill.relevance || this.calculateRelevance(skill);
  }

  optimizeContext(skills, budget) {
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
      tokensInUse: () => this.currentUsage(),
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

  compressHistory(history, targetTokens) {
    let totalTokens = 0;
    const compressed = [];
    
    for (const item of [...history].reverse()) {
      const tokens = this.estimateTokens(JSON.stringify(item));
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