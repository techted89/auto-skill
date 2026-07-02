/**
 * Auto Discovery - Production Grade
 * 
 * Intelligent skill discovery system that integrates GitHub and web sources,
 * with caching, rate limiting, and semantic filtering.
 */
import { readJSON, writeJSON, ensureDir } from './lifecycle.js';
import { SKILL_REPOS, SKILL_SEARCH_QUERIES } from './config.js';
import { fetchRepoContent, cleanupRepo } from './sourcing/github.js';
import { searchAndScrape } from './sourcing/web.js';
import { SkillsetIndex } from './skillset-index.js';
import { parseSkill, generateSkill } from './skill-engine.js';
import { join } from 'path';
import { readFile, readdir } from 'fs/promises';

export class AutoDiscovery {
  constructor(dataDir, skillsDir, config = {}) {
    this.dataDir = dataDir;
    this.skillsDir = skillsDir;
    this.config = {
      githubRateLimitMs: 60000,
      webRateLimitMs: 10000,
      minSkillContentLength: 500,
      maxSkillContentLength: 50000,
      syncIntervalHours: 6,
      repoSyncIntervalDays: 7,
      querySyncIntervalDays: 7,
      maxRetries: 3,
      retryDelayMs: 5000,
      enableAutoDiscovery: true,
      enablePeriodicSync: true,
      ...config
    };
    
    this.discoveryStatePath = join(dataDir, 'discovery-state.json');
    this.syncInterval = null;
    this.isRunning = false;
    this.lastGithubRequest = 0;
    this.lastWebRequest = 0;
    this.metrics = {
      totalDiscovered: 0,
      totalErrors: 0,
      lastSync: null,
      reposProcessed: 0,
      queriesProcessed: 0,
    };
    
    this.skillsetIndex = new SkillsetIndex(dataDir);
  }

  /**
   * Load or initialize discovery state
   */
  async loadState() {
    let state = {
      lastSync: null,
      processedRepos: [],
      processedQueries: [],
      discoveredSkills: [],
      errors: [],
      recommendedSkills: [],
    };
    
    try {
      const saved = await readJSON(this.discoveryStatePath);
      if (saved && typeof saved === 'object') {
        state = { ...state, ...saved };
      }
    } catch {
      // Fallback - no errors
    }
    
    return state;
  }

  /**
   * Rate limiting utility
   */
  async waitForRateLimit(type) {
    const now = Date.now();
    if (type === 'github') {
      const elapsed = now - this.lastGithubRequest;
      if (elapsed < this.config.githubRateLimitMs) {
        await new Promise(r => setTimeout(r, this.config.githubRateLimitMs - elapsed));
      }
      this.lastGithubRequest = Date.now();
    } else if (type === 'web') {
      const elapsed = now - this.lastWebRequest;
      if (elapsed < this.config.webRateLimitMs) {
        await new Promise(r => setTimeout(r, this.config.webRateLimitMs - elapsed));
      }
      this.lastWebRequest = Date.now();
    }
  }

  /**
   * Retry mechanism with backoff
   */
  async withRetry(fn, retries = this.config.maxRetries, delay = this.config.retryDelayMs) {
    try {
      return await fn();
    } catch (err) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, delay));
        return this.withRetry(fn, retries - 1, delay * 2);
      }
      throw err;
    }
  }

  /**
   * Validate skill content against minimums
   */
  validateSkillContent(content, description, source) {
    const { minSkillContentLength, maxSkillContentLength } = this.config;
    
    if (!content || content.length < minSkillContentLength) {
      return { valid: false, reason: `Content too short (min ${minSkillContentLength} chars)` };
    }
    
    if (content.length > maxSkillContentLength) {
      return { valid: false, reason: `Content too long (max ${maxSkillContentLength} chars)` };
    }
    
    if (!description || description.length < 10) {
      return { valid: false, reason: 'Description too short' };
    }
    
    // Additional validation can be added here
    return { valid: true };
  }

  /**
   * Process GitHub repository for skills
   */
  async discoverFromGitHub(repoUrl, state) {
    await this.waitForRateLimit('github');
    
    return this.withRetry(async () => {
      try {
        const raw = await fetchRepoContent(repoUrl);
        const skillFiles = raw.files.filter(f => f.endsWith('SKILL.md') || f.endsWith('skill.md'));
        
        for (const filePath of skillFiles) {
          try {
            const content = await readFile(filePath, 'utf-8');
            const parsed = await parseSkill(filePath);
            
            if (parsed && parsed.name && parsed.body) {
              const skillName = `github-${this.slugifyRepo(repoUrl)}-${parsed.name}`;
              
              if (!(await this.isSkillKnown(skillName))) {
                const validation = this.validateSkillContent(parsed.body, parsed.description || '');
                if (!validation.valid) {
                  state.errors.push({
                    type: 'github',
                    source: repoUrl,
                    error: `Skill validation failed: ${validation.reason}`,
                    timestamp: new Date().toISOString()
                  });
                  continue;
                }
                
                // Generate and save the skill
                await generateSkill(this.skillsDir, skillName, parsed.description || '', parsed.body);
                state.discoveredSkills.push({
                  name: skillName,
                  source: repoUrl,
                  type: 'github',
                  file: filePath
                });
                this.metrics.totalDiscovered++;
                await this.skillsetIndex.merge([{name: skillName, description: parsed.description || ''}]);
              }
            }
          } catch (err) {
            state.errors.push({
              type: 'github',
              source: repoUrl,
              error: err.message,
              timestamp: new Date().toISOString()
            });
          }
        }
        
        // Handle full repo content fallback
        if (skillFiles.length === 0 && raw.content.length > 1000) {
          const fallbackSkillName = `github-${this.slugifyRepo(repoUrl)}-auto-discovered`;
          
          if (!(await this.isSkillKnown(fallbackSkillName))) {
            const validation = this.validateSkillContent(raw.content, `Auto-discovered from ${repoUrl}`);
            if (validation.valid) {
              const skillName = fallbackSkillName;
              await generateSkill(this.skillsDir, skillName, `Auto-discovered from ${repoUrl}`, raw.content);
              state.discoveredSkills.push({
                name: skillName,
                source: repoUrl,
                type: 'github',
                file: 'full-repo-content'
              });
              this.metrics.totalDiscovered++;
              await this.skillsetIndex.merge([{name: skillName, description: 'Auto-discovered from repository'}]);
            }
          }
        }
        
        state.processedRepos.push({
          repo: repoUrl,
          timestamp: new Date().toISOString(),
          skillsFound: skillFiles.length
        });
        this.metrics.reposProcessed++;
        
      } catch (err) {
        state.errors.push({
          type: 'github',
          source: repoUrl,
          error: `Repository processing failed: ${err.message}`,
          timestamp: new Date().toISOString()
        });
        this.metrics.totalErrors++;
      }
    });
  }

  /**
   * Process documentation search queries
   */
  async discoverFromWeb(query, state) {
    await this.waitForRateLimit('web');
    
    return this.withRetry(async () => {
      try {
        const pages = await searchAndScrape(query);
        if (!pages || pages.length === 0) {
          return;
        }
        
        for (const page of pages) {
          if (page.content.length < 500) continue;
          
          const skillName = `web-${slugify(query)}-${slugify(page.title).slice(0, 30)}`;
          
          if (!(await this.isSkillKnown(skillName))) {
            const validation = this.validateSkillContent(
              `Source: ${page.url}\\n\\n${page.content.slice(0, 10000)}`,
              `Web-discovered: ${page.title}`
            );
            
            if (!validation.valid) {
              state.errors.push({
                type: 'web',
                source: query,
                error: `Skill validation failed: ${validation.reason}`,
                timestamp: new Date().toISOString()
              });
              continue;
            }
            
            // Generate and save the skill
            await generateSkill(
              this.skillsDir,
              skillName,
              `Web-discovered: ${page.title}`,
              `Source: ${page.url}\\n\\n${page.content.slice(0, 10000)}`
            );
            
            state.discoveredSkills.push({
              name: skillName,
              source: 'web',
              query,
              url: page.url
            });
            this.metrics.totalDiscovered++;
            await this.skillsetIndex.merge([{name: skillName, description: 'Web-discovered skill'}]);
          }
        }
        
        state.processedQueries.push({
          query,
          timestamp: new Date().toISOString(),
          pagesFound: pages.length
        });
        this.metrics.queriesProcessed++;
        
      } catch (err) {
        state.errors.push({
          type: 'web',
          source: query,
          error: `Search processing failed: ${err.message}`,
          timestamp: new Date().toISOString()
        });
        this.metrics.totalErrors++;
      }
    });
  }

  /**
   * Execute discovery cycle
   */
  async runDiscovery() {
    if (this.isRunning) return;
    this.isRunning = true;
    
    try {
      const state = await this.loadState();
      const now = new Date();
      
      // Process GitHub repositories
      if ((!state.lastSync || 
           (now - new Date(state.lastSync)) > this.config.repoSyncIntervalDays * 24 * 60 * 60 * 1000) &&
          this.config.enableAutoDiscovery) {
        
        for (const repo of SKILL_REPOS) {
          const processed = state.processedRepos.find(p => p.repo === repo);
          if (!processed || 
              (now - new Date(processed.timestamp)) > this.config.repoSyncIntervalDays * 24 * 60 * 60 * 1000) {
            await this.discoverFromGitHub(repo, state);
          }
        }
        
        // Process search queries
        for (const query of SKILL_SEARCH_QUERIES) {
          const processed = state.processedQueries.find(p => p.query === query);
          if (!processed || 
              (now - new Date(processed.timestamp)) > this.config.querySyncIntervalDays * 24 * 60 * 60 * 1000) {
            await this.discoverFromWeb(query, state);
          }
        }
        
        // Update state
        if (state.errors.length > 0) {
          await this.handleDiscoveryErrors(state.errors);
        }
        
        // Rebuild index
        const skills = await this.getSkillList();
        await this.skillsetIndex.build(skills);
        state.lastSync = now.toISOString();
        this.metrics.lastSync = now.toISOString();
      }
      
      await this.saveState(state);
      this.metrics.lastSync = now.toISOString();
      
    } catch (err) {
      console.error('[AutoDiscovery] Discovery failed:', err);
      this.metrics.totalErrors++;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Handle and log discovery errors
   */
  async handleDiscoveryErrors(errors) {
    // Filter to keep only last 10 errors
    const trimErrors = [...errors].slice(-10);
    
    // Update metrics
    this.metrics.totalErrors += trimErrors.length;
    
    // Store errors in state for persistence
    // This would be done in saveState
  }

  /**
   * Check if a skill is already discovered/registered
   */
  async isSkillKnown(skillName) {
    // Check existing skills directory
    try {
      const files = await readdir(this.skillsDir);
      const existingSkills = files.filter(f => f.endsWith('.json') || f.endsWith('SKILL.md'));
      
      for (const file of existingSkills) {
        try {
          const content = await readFile(join(this.skillsDir, file), 'utf-8');
          const skills = await parseSkill(join(this.skillsDir, file));
          if (skills?.name?.toLowerCase() === skillName.toLowerCase()) {
            return true;
          }
        } catch {
          // Skip unparsable files
        }
      }
    } catch {
      // Directory doesn't exist yet
    }
    
    return false;
  }

  /**
   * Generate a slug from a repo URL
   */
  slugifyRepo(repoUrl) {
    const parts = repoUrl.split('/');
    const lastTwo = parts.slice(-2).join('-').replace(/[^a-z0-9-]+/g, '').slice(0, 20);
    return parts[parts.length - 1] || parts[parts.length - 2];
  }

  /**
   * List all skills in the skills directory
   */
  async getSkillList() {
    try {
      const files = await readdir(this.skillsDir);
      const skillFiles = files.filter(f => f.endsWith('.skill.md') || f.endsWith('.md'));
      const skills = [];

      for (const file of skillFiles) {
        try {
          const fullPath = join(this.skillsDir, file);
          const parsed = await parseSkill(fullPath);
          if (parsed) {
            skills.push({ ...parsed, source: 'discovered', file });
          }
        } catch {
          // skip unparseable files
        }
      }

      return skills;
    } catch {
      return [];
    }
  }

  /**
   * Get all discovered skills
   */
  async getDiscoveredSkills() {
    const skills = await this.getSkillList();
    return skills.map(s => ({
      name: s.name,
      description: s.description,
      source: s.source || 'discovered',
      parameters: s.parameters || {}
    }));
  }

  /**
   * Process auto-skill intent from chat or command
   */
  async processAutoSkillIntent(intentType, query, context) {
    if (intentType === 'discover') {
      const pages = await searchAndScrape(query);
      return { success: true, pages, intentType, query };
    }
    if (intentType === 'chat') {
      return { success: true, intentType, query, context };
    }
    return { success: false, error: `Unknown intent type: ${intentType}` };
  }

  /**
   * Get current metrics
   */
  async getStatus() {
    const state = await this.loadState();
    const now = new Date();
    const lastSync = state.lastSync ? new Date(state.lastSync) : null;
    const hoursSinceSync = lastSync ? (now - lastSync) / (1000 * 60 * 60) : Infinity;
    
    return {
      healthy: hoursSinceSync < 48 && this.metrics.totalErrors < 10,
      lastSync: state.lastSync,
      hoursSinceSync,
      metrics: { ...this.metrics },
      discoveredSkills: await this.getDiscoveredSkills(),
      recentErrors: state.errors.slice(-5)
    };
  }

  /**
   * Persist improved discovery state
   */
  async saveState(state) {
    try {
      await ensureDir(this.dataDir);
      await writeJSON(this.discoveryStatePath, state);
    } catch (err) {
      console.error('Failed to save discovery state:', err);
    }
  }
}

/* Additional utilities */
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
}

export default AutoDiscovery;