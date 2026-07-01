const SkillValidator = {
  validateSkill(skill) {
    // 1. Basic validation
    if (!skill.name || !skill.description || !skill.content) {
      throw new Error('Skill missing required fields: name, description, content');
    }

    // 2. Format checks
    if (!/^[a-zA-Z0-9-]+$/.test(skill.name)) {
      throw new Error('Invalid skill name format');
    }

    // 3. Content structure check
    const contentLines = skill.content.split('\n');
    if (!contentLines.some(line => /^#/.test(line))) {
      throw new Error('Missing heading in skill content');
    }

    // 4. Code block detection
    const codeBlockPattern = /```[\s\S]*?```/g;
    if (!codeBlockPattern.test(skill.content)) {
      throw new Error('Missing code block in skill content');
    }
  },

  scoreQuality(skill) {
    let score = 50; // Base score

    // 1. Content completeness
    if (skill.content.length > 500) score += 15;
    if (skill.content.includes('\n\n')) score += 10; // Paragraph spacing

    // 2. Documentation quality
    if (skill.description.length > 20) score += 10;
    if (skill.content.includes('## Documentation')) score += 5;

    // 3. Code quality
    const codeBlocks = skill.content.match(/```[\s\S]*?```/g);
    if (codeBlocks && codeBlocks.length > 1) score += 10;

    // 4. Technical accuracy
    if (skill.content.includes('best practices')) score += 5;

    return Math.min(score, 100);
  },

  categorizeSkill(content) {
    const categoryMap = {
      'animation': ['animation', 'animator', 'blend tree'],
      'ui': ['UI', 'control', 'theme'],
      'physics': ['physics', 'collision', 'rigidbody'],
      'multiplayer': ['multiplayer', 'network'],
      'ai': ['AI', 'behavior', 'navigation']
    };

    for (const [category, keywords] of Object.entries(categoryMap)) {
      if (keywords.some(keyword => content.toLowerCase().includes(keyword.toLowerCase()))) {
        return category;
      }
    }

    return 'uncategorized';
  },

  extractTags(content) {
    const tagRegex = /#([a-zA-Z0-9_-]+)/g;
    const tags = [];
    let match;
    while ((match = tagRegex.exec(content)) !== null) {
      tags.push(match[1]);
    }
    return [...new Set(tags)]; // Remove duplicates
  },

  createVersion(skill) {
    const version = {
      version: skill.version || '1.0.0',
      content: skill.content,
      timestamp: new Date().toISOString()
    };
    if (!skill.versions) skill.versions = [];
    skill.versions.push(version);
    skill.version = (parseFloat(skill.version || '1.0') + 0.1).toString();
    return skill;
  },

  compareVersions(skillName, fromVersion, toVersion) {
    // This would require a skill storage mechanism, which we don't have in this module.
    // For now, we'll return a placeholder.
    return {
      fromVersion,
      toVersion,
      differences: ['Version comparison requires skill storage implementation']
    };
  },

  rollbackVersion(skillName, version) {
    // This would require a skill storage mechanism.
    return {
      skillName,
      version,
      message: 'Rollback requires skill storage implementation'
    };
  },

  getSkillHistory(skillName) {
    // This would require a skill storage mechanism.
    return {
      skillName,
      history: ['History retrieval requires skill storage implementation']
    };
  },

  normalizeCategories(categories) {
    const categoryMap = {
      'animation': 'animation-system',
      'ui': 'ui-design',
      'physics': 'physics-system',
      'multiplayer': 'multiplayer-basics',
      'ai': 'ai-navigation'
    };

    return categories.map(cat => categoryMap[cat] || cat);
  },

  getQualityThresholds() {
    return {
      excellent: 90,
      good: 75,
      satisfactory: 60,
      needsImprovement: 0
    };
  }
};

module.exports = SkillValidator;