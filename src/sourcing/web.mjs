/**
 * Web Sourcing — discovers and imports skills from the web.
 *
 * Supports:
 * - Direct SKILL.md URLs (copied verbatim)
 * - GitHub raw file URLs
 * - Documentation pages with structured content
 * - Known skill registries
 *
 * All output uses proper YAML frontmatter compatible with
 * OpenCode's SKILL.md format.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { slugify, assembleSkill, parseSkillContent } from '../skill-engine.mjs';

/** Known skill registries and their URL patterns */
const KNOWN_REGISTRIES = [
  {
    name: 'awesome-opencode',
    url: 'https://raw.githubusercontent.com/jamesbruner/awesome-opencode/main/README.md',
    type: 'registry',
  },
  {
    name: 'opencode-skills-registry',
    url: 'https://raw.githubusercontent.com/opencode-ai/skills-registry/main/registry.json',
    type: 'json',
  },
];

/**
 * Check if a URL points to a raw SKILL.md file.
 */
function looksLikeSkillFile(url) {
  return /SKILL\.md$/i.test(url) || /skills?\/[^/]+\.md$/i.test(url);
}

/**
 * Fetch content from a URL.
 */
async function fetchUrl(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'auto-skill-plugin' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.text();
}

/**
 * Extract a title/name from HTML content using multiple strategies.
 */
function extractTitleFromHtml(html) {
  // <h1> is best
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match) return h1Match[1].trim();

  // <title> fallback
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  if (titleMatch) {
    const title = titleMatch[1].trim();
    // Strip site name suffix like " — Site Name" or " | Site Name"
    return title.replace(/[—\-|]\s*[^—\-|]+$/, '').trim();
  }

  return null;
}

/**
 * Extract meaningful paragraphs from HTML, stripping tags.
 */
function extractBodyFromHtml(html) {
  const paragraphs = html.match(/<p[^>]*>([^<]+)<\/p>/gi) || [];
  const lines = paragraphs
    .map(p => p.replace(/<[^>]+>/g, '').trim())
    .filter(p => p.length > 20)       // Skip short/empty paragraphs
    .filter(p => !/^\s*$/.test(p))    // Skip whitespace-only
    .slice(0, 25);                     // Max 25 paragraphs

  if (lines.length === 0) {
    // Fallback: try div content
    const divs = html.match(/<div[^>]*>([\s\S]*?)<\/div>/gi) || [];
    for (const div of divs) {
      const text = div.replace(/<[^>]+>/g, '').trim();
      if (text.length > 100) return text.slice(0, 3000);
    }
    return 'Content extracted from web page.';
  }

  return lines.join('\n\n');
}

/**
 * Source skills from web URLs.
 *
 * @param {Object} options
 * @param {string} [options.url] - Direct URL to fetch
 * @param {string} [options.registry] - Registry name from KNOWN_REGISTRIES
 * @param {string} [options.targetDir] - Where to save skills
 * @param {boolean} [options.discoverOnly=false] - Only list, don't save
 * @returns {Promise<Object>}
 */
export async function sourceFromWeb(options = {}) {
  const { url, registry, targetDir, discoverOnly } = options;

  const importDir = targetDir || join(process.env.HOME || '/root', '.config', 'opencode', 'skills');

  if (url) {
    const content = await fetchUrl(url);
    const trimmed = content.trim();
    const isHtml = trimmed.startsWith('<!') || trimmed.startsWith('<html') ||
                   /<[a-z]+[^>]*>/i.test(trimmed.slice(0, 100));

    // Case 1: Already a SKILL.md with frontmatter — pass through
    const parsed = parseSkillContent(content);
    if (parsed) {
      if (discoverOnly) {
        return { success: true, source: url, type: 'skill_file', skill: parsed, preview: content.slice(0, 500) };
      }
      const destPath = join(importDir, `${parsed.slug}.md`);
      await mkdir(dirname(destPath), { recursive: true });
      await writeFile(destPath, content, 'utf-8');
      return { success: true, source: url, imported: [{ name: parsed.name, slug: parsed.slug, path: destPath }] };
    }

    // Case 2: Raw markdown without frontmatter — wrap it
    const firstLine = trimmed.split('\n')[0]?.replace(/^#+\s*/, '') || 'Imported Skill';
    const slug = slugify(firstLine);
    const skillContent = assembleSkill(slug, `Imported from ${url}`, trimmed.slice(0, 4000));

    if (discoverOnly) {
      return { success: true, source: url, type: 'markdown', preview: skillContent.slice(0, 500) };
    }

    const destPath = join(importDir, `${slug}.md`);
    await mkdir(dirname(destPath), { recursive: true });
    await writeFile(destPath, skillContent, 'utf-8');
    return { success: true, source: url, imported: [{ name: slug, path: destPath }] };
  }

  if (registry) {
    const registryInfo = KNOWN_REGISTRIES.find(r => r.name === registry);
    if (!registryInfo) {
      return {
        success: false,
        error: `Unknown registry: ${registry}. Known: ${KNOWN_REGISTRIES.map(r => r.name).join(', ')}`,
      };
    }

    const content = await fetchUrl(registryInfo.url);

    if (registryInfo.type === 'json') {
      const data = JSON.parse(content);
      return { success: true, registry: registryInfo.name, skills: data.skills || data };
    }

    // Markdown registry — extract skill links
    const linkMatches = content.matchAll(/\[([^\]]+)\]\(([^)]+\.md)\)/g);
    const skills = [];
    for (const m of linkMatches) {
      skills.push({ name: m[1], url: m[2] });
    }
    return { success: true, registry: registryInfo.name, skills };
  }

  return { success: false, error: 'Provide either url or registry' };
}

export default sourceFromWeb;
