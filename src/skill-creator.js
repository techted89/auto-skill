/**
 * Skill Creator - Auto-Skill Plugin
 * 
 * Converts various sources into standardized OpenCode skills
 * 
 * Handles GitHub repos, web docs, and manual descriptions
 */

import { writeFile, ensureDir } from './lifecycle.js';
import { validateSkillContent } from './skill-validator.js';
import { SkillRegistry } from './skill-registry.js';

/**
 * Create a skill from different sources
 * 
 * @param {Object} source - Source data (GitHub repo, URL, or manual description)
 * @param {string} source.type - 'github', 'web', or 'manual'
 * @returns {Promise<Object>} Created skill details
 */
export async function createSkillFromSource(source) {
  let content;
  let description;

  switch (source.type) {
    case 'github':
      // Extract content from GitHub repo
      content = await fetchGitHubContent(source.url);
      description = `From GitHub: ${source.repository}`;
      break;
    
    case 'web':
      // Extract content from web page
      const page = await fetchWebPage(source.url);
      content = extractMainContent(page.html);
      description = `Web source: ${source.url}`;
      break;
    
    case 'manual':
      content = source.content || '';
      description = source.description || 'Manual creation';
      break;
    
    default:
      throw new Error('Unsupported source type');
  }

  // Validate content
  const validation = validateSkillContent(content, description);
  if (!validation.valid) {
    throw new Error(`Validation failed: ${validation.reason}`);
  }

  // Generate skill name
  const skillName = generateSkillName(source.type, source.url || '');

  // Write skill files
  await ensureDir('/root/.config/opencode/plugins/auto-skill/skills');
  const skillPath = `/root/.config/opencode/plugins/auto-skill/skills/${skillName}`;

  // Write main SKILL.md - using escaped backticks
  const skillMdContent = '```md\n' + description + '\n\n### Usage\n' + content.slice(0, 2000) + '\n```';
  await writeFile(`${skillPath}/SKILL.md`, skillMdContent);

  // Write metadata.json
  await writeFile(`${skillPath}/metadata.json`, JSON.stringify({
    name: skillName,
    description,
    source: source.type,
    url: source.url || ''
  }));

  // Register skill
  await SkillRegistry.register(skillName);

  return {
    name: skillName,
    path: skillPath,
    description,
    sourceType: source.type
  };
}

/**
 * Generate skill name from source
 * 
 * @param {string} sourceType - 'github', 'web', or 'manual'
 * @param {string} sourceUrl - Optional URL
 * @returns {string}
 */
function generateSkillName(sourceType, sourceUrl) {
  let name;
  
  switch (sourceType) {
    case 'github':
      const repoParts = sourceUrl.split('/').slice(-2);
      name = `${repoParts[0]}-${repoParts[1]}`;
      break;
    
    case 'web':
      const urlParts = sourceUrl.split('/');
      name = `web-${urlParts[urlParts.length - 1].slice(0, 20)}`;
      break;
    
    case 'manual':
      name = `manual-skill-${Math.random().toString(36).substr(2, 9)}`;
      break;
    
    default:
      name = `auto-skill-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  return name.slice(0, 64);
}

/**
 * Lifecycle utilities - mock implementations
 */
async function fetchGitHubContent(url) { return ''; }
async function fetchWebPage(url) { return { html: '' }; }
function extractMainContent(html) { return ''; }

export default { createSkillFromSource };