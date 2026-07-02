/**
 * GitHub Sourcing — discovers and imports skills from GitHub repositories.
 *
 * Given a repo URL or search query, fetches SKILL.md files from
 * public GitHub repositories and imports them.
 *
 * Features:
 * - Rate limit detection (X-RateLimit-Remaining header)
 * - Pagination support for large directories
 * - Caches content from discover to avoid redundant fetches during import
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const DEFAULT_PER_PAGE = 30;

/**
 * Extract owner/repo from various GitHub URL formats.
 */
function parseRepoUrl(url) {
  if (!url) return null;
  const patterns = [
    /github\.com[:/]([^/]+)\/([^/#.]+)/,
    /^([^/]+)\/([^/]+)$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return { owner: m[1], repo: m[2].replace(/\.git$/, '') };
  }
  return null;
}

/**
 * Fetch with rate limit awareness.
 * Throws if rate limit is exhausted.
 */
async function fetchWithRateLimit(url, token = null) {
  const headers = { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'auto-skill-plugin' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });

  // Check rate limit headers
  const remaining = res.headers.get('X-RateLimit-Remaining');
  if (remaining !== null && parseInt(remaining, 10) === 0) {
    const resetEpoch = parseInt(res.headers.get('X-RateLimit-Reset') || '0', 10);
    const resetDate = new Date(resetEpoch * 1000);
    throw new Error(`GitHub API rate limit exhausted. Resets at ${resetDate.toISOString()}`);
  }

  if (!res.ok) {
    if (res.status === 403) throw new Error('GitHub API rate limit exceeded (403)');
    if (res.status === 404) throw new Error('Repository or path not found');
    if (res.status === 409) throw new Error('Repository is empty');
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  return res;
}

/**
 * Fetch directory contents from GitHub API, following pagination.
 */
async function fetchRepoContents(owner, repo, path = '', token = null) {
  const allItems = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?per_page=${DEFAULT_PER_PAGE}&page=${page}`;
    const res = await fetchWithRateLimit(url, token);

    // Check for pagination links
    const linkHeader = res.headers.get('Link');
    hasMore = linkHeader ? linkHeader.includes('rel="next"') : false;

    const items = await res.json();
    if (!Array.isArray(items)) {
      // Single file or error — return as single-element array if it's a file
      if (items.type === 'file') return [items];
      return allItems; // empty
    }

    allItems.push(...items);

    // Safety: don't fetch more than 5 pages
    if (page >= 5) break;
    page++;
  }

  return allItems;
}

/**
 * Search GitHub for repositories.
 */
async function searchRepos(query, token = null) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=10&sort=stars`;
  const res = await fetchWithRateLimit(url, token);
  const data = await res.json();
  return (data.items || []).map(item => ({
    name: item.full_name,
    description: item.description,
    stars: item.stargazers_count,
    url: item.html_url,
    defaultBranch: item.default_branch,
  }));
}

/**
 * Discover SKILL.md files in a GitHub repo.
 * Returns skills with their full content (no redundant fetch needed for import).
 */
async function discoverSkills(owner, repo, branch = 'main', token = null) {
  const searchPaths = [
    '.opencode/skills',
    '.claude/skills',
    '.agents/skills',
    'skills',
    'src/skills',
  ];

  const found = [];

  for (const skillPath of searchPaths) {
    try {
      const contents = await fetchRepoContents(owner, repo, skillPath, token);
      if (!Array.isArray(contents)) continue;

      for (const item of contents) {
        if (item.type === 'file' && item.name.endsWith('.md')) {
          // Fetch raw content
          const rawRes = await fetchWithRateLimit(item.download_url, token);
          const raw = await rawRes.text();
          const content = await rawRes.text();

          if (content.startsWith('---') || content.trim().startsWith('# ')) {
            found.push({
              name: item.name.replace(/\.md$/, ''),
              path: skillPath,
              repo: `${owner}/${repo}`,
              download_url: item.download_url,
              content, // Full content — no refetch needed for import
              size: item.size,
            });
          }
        }
      }
    } catch {
      // Path doesn't exist in this repo
    }
  }

  return found;
}

/**
 * Import a skill (uses already-fetched content — no redundant fetch).
 */
async function importSkill(skill, targetDir) {
  const name = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const destPath = join(targetDir, `${name}.md`);

  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, skill.content, 'utf-8');
  return { name, path: destPath, repo: skill.repo };
}

/**
 * Source skills from GitHub.
 *
 * @param {Object} options
 * @param {string} [options.query] - Search query for repos
 * @param {string} [options.repoUrl] - Specific repo URL
 * @param {string} [options.targetDir] - Where to import
 * @param {string} [options.githubToken] - GitHub API token
 * @param {boolean} [options.discoverOnly=false] - Only list, don't import
 * @returns {Promise<Object>}
 */
export async function sourceFromGitHub(options = {}) {
  const { query, repoUrl, targetDir, githubToken, discoverOnly } = options;
  const importDir = targetDir || join(process.env.HOME || '/root', '.config', 'opencode', 'skills');

  if (repoUrl) {
    const parsed = parseRepoUrl(repoUrl);
    if (!parsed) return { success: false, error: `Invalid repo URL: ${repoUrl}` };

    const skills = await discoverSkills(parsed.owner, parsed.repo, 'main', githubToken);

    if (discoverOnly) {
      return {
        success: true,
        repo: repoUrl,
        skills: skills.map(s => ({ name: s.name, path: s.path, size: s.size })),
        imported: [],
      };
    }

    const imported = [];
    for (const skill of skills) {
      try {
        const result = await importSkill(skill, importDir);
        imported.push(result);
      } catch (err) {
        imported.push({ name: skill.name, error: err.message });
      }
    }

    return { success: true, repo: repoUrl, skillsCount: skills.length, imported };
  }

  if (query) {
    const repos = await searchRepos(query, githubToken);
    const results = [];

    for (const repo of repos.slice(0, 3)) {
      const parsed = parseRepoUrl(repo.url);
      if (!parsed) continue;
      try {
        const skills = await discoverSkills(parsed.owner, parsed.repo, repo.defaultBranch, githubToken);
        results.push({
          repo: repo.name,
          stars: repo.stars,
          skills: skills.map(s => ({ name: s.name, path: s.path })),
        });
      } catch {
        // Skip
      }
    }

    return { success: true, repos, results };
  }

  return { success: false, error: 'Provide either query or repoUrl' };
}

export default sourceFromGitHub;
