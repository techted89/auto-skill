/**
 * Skill Validator — validates SKILL.md content against OpenCode's strict requirements.
 *
 * OpenCode requires exactly `name` and `description` in YAML frontmatter.
 * The name must be lowercase-hyphenated, ≤64 chars, matching the folder name.
 * The description must be a clear "Use when..." or action-oriented sentence.
 */

const NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MIN_DESC_LENGTH = 20;
const MAX_DESC_LENGTH = 200;

/**
 * Validate a skill's name.
 */
export function validateName(name) {
  if (!name || typeof name !== 'string') {
    return { valid: false, reason: 'Skill name is required' };
  }
  if (!NAME_REGEX.test(name)) {
    return { valid: false, reason: `Skill name "${name}" must be lowercase hyphen-separated, max 64 chars, starting with alphanumeric` };
  }
  return { valid: true };
}

/**
 * Validate a skill's description.
 */
export function validateDescription(description) {
  if (!description || typeof description !== 'string') {
    return { valid: false, reason: 'Skill description is required' };
  }
  const trimmed = description.trim();
  if (trimmed.length < MIN_DESC_LENGTH) {
    return { valid: false, reason: `Description too short (${trimmed.length} chars, min ${MIN_DESC_LENGTH})` };
  }
  if (trimmed.length > MAX_DESC_LENGTH) {
    return { valid: false, reason: `Description too long (${trimmed.length} chars, max ${MAX_DESC_LENGTH})` };
  }
  return { valid: true };
}

/**
 * Validate a skill's body (markdown content).
 */
export function validateBody(body) {
  if (!body || typeof body !== 'string') {
    return { valid: false, reason: 'Skill body is required' };
  }
  const trimmed = body.trim();
  if (trimmed.length < 50) {
    return { valid: false, reason: `Skill body too short (${trimmed.length} chars, min 50)` };
  }
  // Must have at least one heading
  if (!/^#\s+/m.test(trimmed)) {
    return { valid: false, reason: 'Skill body must contain at least one Markdown heading' };
  }
  return { valid: true };
}

/**
 * Full skill validation.
 */
export function validateSkill(name, description, body) {
  const nameResult = validateName(name);
  if (!nameResult.valid) return nameResult;

  const descResult = validateDescription(description);
  if (!descResult.valid) return descResult;

  const bodyResult = validateBody(body);
  if (!bodyResult.valid) return bodyResult;

  return { valid: true };
}

/**
 * Score a skill's quality (0-100) for ranking.
 */
export function scoreQuality(name, description, body) {
  let score = 50;

  // Name quality
  if (name && name.length >= 8) score += 5;
  if (name && !name.includes('auto-') && !name.includes('web-') && !name.includes('github-')) score += 5;

  // Description quality
  if (description && description.length >= 40) score += 5;
  if (description && /^[A-Z]/.test(description)) score += 5;
  if (description && /(use|when|for|build|debug|test|create|implement|configure|design)/i.test(description)) score += 5;

  // Body quality
  if (body) {
    const bodyTrimmed = body.trim();
    if (bodyTrimmed.length >= 200) score += 5;
    if (bodyTrimmed.length >= 500) score += 5;
    const codeBlocks = (bodyTrimmed.match(/```[\s\S]*?```/g) || []);
    if (codeBlocks.length >= 1) score += 5;
    if (codeBlocks.length >= 3) score += 5;
    if (bodyTrimmed.includes('- [ ]') || bodyTrimmed.includes('- [x]')) score += 5; // checklists
    if ((bodyTrimmed.match(/^##\s+/gm) || []).length >= 3) score += 5; // multiple sections
    if ((bodyTrimmed.match(/^#+\s+/gm) || []).length >= 4) score += 5; // good structure
  }

  return Math.min(score, 100);
}

/**
 * Categorize a skill based on content analysis.
 */
export function categorizeSkill(name, description, body) {
  const text = `${name} ${description} ${body || ''}`.toLowerCase();

  const categories = {
    'frontend': ['react', 'vue', 'angular', 'svelte', 'css', 'html', 'ui', 'component', 'frontend'],
    'backend': ['backend', 'api', 'rest', 'graphql', 'server', 'microservice', 'database'],
    'devops': ['devops', 'ci/cd', 'deploy', 'kubernetes', 'docker', 'terraform', 'infrastructure'],
    'testing': ['test', 'testing', 'qa', 'coverage', 'e2e', 'unit test', 'playwright', 'vitest'],
    'security': ['security', 'audit', 'vulnerability', 'threat', 'encryption', 'auth'],
    'debugging': ['debug', 'error', 'trace', 'log', 'exception', 'crash', 'fix'],
    'architecture': ['architecture', 'design pattern', 'system design', 'scalability'],
    'data': ['data', 'pipeline', 'etl', 'database', 'analytics', 'ml', 'ai'],
    'mobile': ['mobile', 'ios', 'android', 'react native', 'flutter', 'swift'],
    'godot': ['godot', 'gdscript', '2d', '3d', 'game', 'sprite', 'animation'],
  };

  const matched = [];
  for (const [cat, keywords] of Object.entries(categories)) {
    if (keywords.some(kw => text.includes(kw))) {
      matched.push(cat);
    }
  }
  return matched.length > 0 ? matched : ['uncategorized'];
}
