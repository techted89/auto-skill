/**
 * Skill Creator — generates and validates SKILL.md files.
 *
 * Wraps `skill-engine.mjs` with:
 * - Validation before write
 * - Directory routing (project-local > global)
 * - Index update after write
 * - Supports both folder-based and flat skill layouts
 */

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { slugify, isValidSkillContent, assembleSkill } from './skill-engine.mjs';

/** Default skill output directories (in priority order) */
const DEFAULT_TARGET_DIRS = [
  join(process.env.HOME || '/root', '.config', 'opencode', 'skills'),
  join(process.env.HOME || '/root', '.claude', 'skills'),
  join(process.env.HOME || '/root', '.agents', 'skills'),
];

/**
 * Resolve the best target directory.
 * Prefers project-local over global.
 */
function resolveTargetDir(projectDir) {
  if (projectDir && existsSync(projectDir)) {
    const projectSkills = join(projectDir, '.opencode', 'skills');
    const parentDir = dirname(projectSkills);
    if (existsSync(parentDir)) return projectSkills;
  }
  for (const dir of DEFAULT_TARGET_DIRS) {
    const parent = dirname(dir);
    if (existsSync(parent)) return dir;
  }
  return DEFAULT_TARGET_DIRS[0];
}

/**
 * Create or update a skill.
 *
 * @param {Object} options
 * @param {string} options.name - Skill name (used for slug + filename)
 * @param {string} options.description - Short description (20-200 chars)
 * @param {string} options.body - Markdown body content
 * @param {string} [options.projectDir] - Project directory for local skills
 * @param {string} [options.targetDir] - Override target directory
 * @param {string[]} [options.categories] - Category tags (info only, not in frontmatter)
 * @returns {Promise<{ success: boolean, path?: string, error?: string }>}
 */
export async function createSkill(options) {
  const {
    name,
    description,
    body,
    projectDir,
    targetDir,
    categories,
  } = options || {};

  // ── Validate inputs ─────────────────────────────────────
  if (!name || typeof name !== 'string') {
    return { success: false, error: 'name is required (string)' };
  }
  if (!description || typeof description !== 'string') {
    return { success: false, error: 'description is required (string)' };
  }
  if (!body || typeof body !== 'string') {
    return { success: false, error: 'body is required (string)' };
  }

  // ── Validate name format ────────────────────────────────
  const NAME_REGEX = /^[a-z0-9][a-z0-9-]{0,63}$/;
  if (!NAME_REGEX.test(name)) {
    return {
      success: false,
      error: `Invalid name "${name}": must be lowercase-hyphenated, max 64 chars, starting with alphanumeric`,
    };
  }
  if (description.length < 20 || description.length > 200) {
    return { success: false, error: `Description must be 20-200 chars (got ${description.length})` };
  }

  // ── Assemble SKILL.md content ───────────────────────────
  const skillContent = assembleSkill(name, description, body);

  // ── Validate assembled content ──────────────────────────
  if (!isValidSkillContent(skillContent)) {
    return { success: false, error: 'Generated SKILL.md content failed validation — check frontmatter and body structure' };
  }

  // ── Determine path ──────────────────────────────────────
  const dir = targetDir || resolveTargetDir(projectDir);
  const slug = slugify(name);
  const skillPath = join(dir, `${slug}.md`);

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(skillPath, skillContent, 'utf-8');
    return { success: true, path: skillPath, slug };
  } catch (err) {
    return { success: false, error: `Write failed: ${err.message}` };
  }
}

/**
 * List all skills in configured directories.
 *
 * @param {Object} [options]
 * @param {string} [options.projectDir]
 * @returns {Promise<Array<{name: string, path: string, slug: string, description: string}>>}
 */
export async function listLocalSkills(options = {}) {
  const { projectDir } = options;
  const dirs = [];

  if (projectDir && existsSync(projectDir)) {
    dirs.push(join(projectDir, '.opencode', 'skills'));
  }
  for (const d of DEFAULT_TARGET_DIRS) {
    if (existsSync(dirname(d))) dirs.push(d);
  }

  const results = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const { readdir } = await import('node:fs/promises');
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Folder-based: dir/skill-name/SKILL.md
          const skillMdPath = join(dir, entry.name, 'SKILL.md');
          if (existsSync(skillMdPath)) {
            const content = await readFile(skillMdPath, 'utf-8');
            const nameMatch = content.match(/^name:\s*(.+)/m);
            const descMatch = content.match(/^description:\s*(.+)/m);
            results.push({
              name: nameMatch ? nameMatch[1].trim() : entry.name,
              slug: entry.name,
              path: skillMdPath,
              description: descMatch ? descMatch[1].trim() : '',
            });
          }
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          // Flat: dir/skill-name.md
          const filePath = join(dir, entry.name);
          const content = await readFile(filePath, 'utf-8');
          const nameMatch = content.match(/^name:\s*(.+)/m);
          const descMatch = content.match(/^description:\s*(.+)/m);
          const slug = entry.name.replace(/\.md$/, '');
          results.push({
            name: nameMatch ? nameMatch[1].trim() : slug,
            slug,
            path: filePath,
            description: descMatch ? descMatch[1].trim() : '',
          });
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  }

  return results;
}

export default createSkill;
