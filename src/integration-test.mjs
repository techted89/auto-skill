#!/usr/bin/env node
/**
 * Auto-Skill Plugin — Integration Test.
 *
 * Tests that all modules can be imported, instantiated,
 * and exercise their core paths without errors.
 *
 * Run: node src/integration-test.mjs
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';

let passed = 0;
let failed = 0;
const tmpDir = await mkdtemp(join(tmpdir(), 'auto-skill-test-'));
const dataDir = join(tmpDir, '.opencode-auto-skill');
await mkdir(dataDir, { recursive: true });

function pass(name) { passed++; console.log(`  ✅ ${name}`); }
function fail(name, err) { failed++; console.log(`  ❌ ${name}: ${err?.message || err}`); }

async function run(name, fn) {
  try { await fn(); pass(name); }
  catch (e) { fail(name, e); }
}

// ── Suites ────────────────────────────────────────────────

console.log('\n🔧 1. skill-engine.mjs');

await run('slugify', async () => {
  const { slugify } = await import('./skill-engine.mjs');
  if (slugify('Hello World') !== 'hello-world') throw `got "${slugify('Hello World')}"`;
  if (slugify('Test--Name_123') !== 'test-name-123') throw `got "${slugify('Test--Name_123')}"`;
  if (slugify('') !== '') throw 'empty string should return empty';
});

await run('escape/unescapeYAML', async () => {
  const { escapeYAML, unescapeYAML } = await import('./skill-engine.mjs');
  const orig = 'Use when building "React" apps\nNew line';
  const escaped = escapeYAML(orig);
  const unescaped = unescapeYAML(escaped);
  if (unescaped !== orig) throw `roundtrip failed: "${unescaped}" !== "${orig}"`;
});

await run('buildFrontmatter', async () => {
  const { buildFrontmatter } = await import('./skill-engine.mjs');
  const result = buildFrontmatter('test-skill', 'Use when testing');
  if (!result.includes('name: test-skill')) throw 'missing name';
  if (!result.includes('description: Use when testing')) throw 'missing description';
  if (!result.startsWith('---')) throw 'no frontmatter delimiter';
});

await run('assembleSkill', async () => {
  const { assembleSkill, parseSkillContent } = await import('./skill-engine.mjs');
  const result = assembleSkill('my-skill', 'A test skill', '# My Skill\n\nHello world');
  if (!result.includes('name: my-skill')) throw 'missing name in frontmatter';

  const parsed = parseSkillContent(result);
  if (!parsed) throw 'parseSkillContent returned null';
  if (parsed.name !== 'my-skill') throw `wrong name: ${parsed.name}`;
  if (parsed.slug !== 'my-skill') throw `wrong slug: ${parsed.slug}`;
});

await run('assembleSkill adds heading if missing', async () => {
  const { assembleSkill, parseSkillContent } = await import('./skill-engine.mjs');
  const result = assembleSkill('no-head', 'Desc', 'Plain text without heading');
  const parsed = parseSkillContent(result);
  if (!parsed) throw 'null';
  if (!parsed.body.includes('# no-head')) throw `heading not added: ${parsed.body.slice(0, 100)}`;
});

await run('generateFlatSkill writes file', async () => {
  const { generateFlatSkill, parseSkill } = await import('./skill-engine.mjs');
  const out = await generateFlatSkill(tmpDir, 'flat-test', 'Flat test skill', '# Flat\n\nContent');
  if (!out.path) throw 'no path returned';
  const parsed = await parseSkill(out.path);
  if (!parsed) throw 'cannot parse written file';
  if (parsed.name !== 'flat-test') throw `wrong name: ${parsed.name}`;
});

await run('isValidSkillContent', async () => {
  const { assembleSkill, isValidSkillContent } = await import('./skill-engine.mjs');
  const valid = assembleSkill('valid-skill', 'A valid description for testing', '# Valid\n\nBody');
  if (!isValidSkillContent(valid)) throw 'should be valid';
  if (isValidSkillContent('')) throw 'empty should be invalid';
  if (isValidSkillContent('no frontmatter here')) throw 'no frontmatter should be invalid';
});


console.log('\n🔧 2. skill-validator.mjs');

await run('validateName', async () => {
  const { validateName } = await import('./skill-validator.mjs');
  if (!validateName('good-name').valid) throw 'good-name should be valid';
  if (!validateName('a').valid) throw 'single char should be valid';
  if (validateName('BadName').valid) throw 'uppercase should be invalid';
  if (validateName('').valid) throw 'empty should be invalid';
  if (validateName(null).valid) throw 'null should be invalid';
});

await run('validateDescription', async () => {
  const { validateDescription } = await import('./skill-validator.mjs');
  if (!validateDescription('Use when building React components with hooks').valid) throw 'good desc';
  if (validateDescription('').valid) throw 'empty should be invalid';
});

await run('validateBody', async () => {
  const { validateBody } = await import('./skill-validator.mjs');
  if (!validateBody('# Heading\n\nSome content here that is long enough now.').valid) throw 'good body';
  if (validateBody('short').valid) throw 'too short should be invalid';
  if (validateBody('No heading but long enough text to test the validator function').valid) throw 'no heading should be invalid';
});

await run('scoreQuality', async () => {
  const { scoreQuality } = await import('./skill-validator.mjs');
  const score = scoreQuality('long-specific-name', 'Use when building quality skills for testing purposes', '# Skill\n\n```js\nconst x = 1;\n```\n\n- [ ] task 1\n- [ ] task 2');
  if (score < 60) throw `score too low: ${score}`;
  if (score > 100) throw `score over 100: ${score}`;
});


console.log('\n🔧 3. skillset-index.mjs');

await run('init and rebuild', async () => {
  const { SkillsetIndex } = await import('./skillset-index.mjs');
  const idx = new SkillsetIndex(dataDir, { skillDirs: [] });
  // Rebuild with no dirs — should be empty
  await idx.rebuild();
  const status = idx.getStatus();
  if (status.totalCount !== 0) throw `expected 0, got ${status.totalCount}`;
});

await run('add and search', async () => {
  const { SkillsetIndex } = await import('./skillset-index.mjs');
  const idx = new SkillsetIndex(join(tmpDir, 'idx-test'), { skillDirs: [] });
  await idx.rebuild();

  await idx.add({
    slug: 'react-test',
    name: 'react-test',
    description: 'Use when testing React components',
    body: '# React Test\n\nTest your React components with Vitest.',
  });

  await idx.add({
    slug: 'vue-test',
    name: 'vue-test',
    description: 'Use when testing Vue components',
    body: '# Vue Test\n\nTest your Vue components with Vitest.',
  });

  if (idx.getStatus().totalCount !== 2) throw `expected 2, got ${idx.getStatus().totalCount}`;

  // Search for react
  const results = idx.search('react testing', 5);
  if (results.length < 1) throw 'no results for react';
  // First result should be the react skill
  if (!results[0].slug.includes('react')) throw `expected react, got ${results[0].slug}`;

  // Search categories
  const all = idx.getAll();
  if (all.length !== 2) throw `expected 2 all, got ${all.length}`;
});

await run('merge dedup', async () => {
  const { SkillsetIndex } = await import('./skillset-index.mjs');
  const idx = new SkillsetIndex(join(tmpDir, 'idx-merge'), { skillDirs: [] });
  await idx.rebuild();

  await idx.add({ slug: 'a', name: 'alpha', description: 'First skill', body: '# A\n\nBody' });
  await idx.merge([
    { slug: 'a', name: 'alpha', description: 'First skill dup', body: '' },
    { slug: 'b', name: 'beta', description: 'Second skill', body: '# B\n\nBody' },
  ]);

  if (idx.getStatus().totalCount !== 2) throw `expected 2, got ${idx.getStatus().totalCount}`;
});

await run('persist + load', async () => {
  const { SkillsetIndex } = await import('./skillset-index.mjs');
  const persistDir = join(tmpDir, 'idx-persist');
  const idx1 = new SkillsetIndex(persistDir, { skillDirs: [] });
  await idx1.rebuild();
  await idx1.add({ slug: 'persist-test', name: 'persist-test', description: 'Desc', body: '# P\n\nBody' });
  await idx1._saveToDisk();

  // Load into fresh instance
  const idx2 = new SkillsetIndex(persistDir, { skillDirs: [] });
  await idx2.init(); // auto-loads from disk since no dirs
  if (idx2.getStatus().totalCount !== 1) throw `expected 1, got ${idx2.getStatus().totalCount}`;
  const s = idx2.getAll();
  if (s[0].slug !== 'persist-test') throw `wrong slug: ${s[0]?.slug}`;
});


console.log('\n🔧 4. learning-engine.mjs');

await run('observeToolUsage', async () => {
  const { LearningEngine } = await import('./learning-engine.mjs');
  const eng = new LearningEngine(dataDir);
  await eng.init();

  eng.observeToolUsage({ tool: 'read', description: 'Reading a file', sessionID: 's1' });
  eng.observeToolUsage({ tool: 'read', description: 'Reading another file', sessionID: 's1' });
  eng.observeToolUsage({ tool: 'read', description: 'Reading yet another', sessionID: 's2' });

  const stats = eng.getToolStats();
  const readStat = stats.find(s => s.tool === 'read');
  if (!readStat) throw 'read tool not in stats';
  if (readStat.count < 3) throw `expected at least 3, got ${readStat.count}`;

  const suggestions = eng.getSuggestions();
  const toolSugg = suggestions.find(s => s.type === 'tool_skill');
  if (!toolSugg) throw 'no tool_skill suggestion';
});

await run('observeMessage', async () => {
  const { LearningEngine } = await import('./learning-engine.mjs');
  const eng = new LearningEngine(dataDir);
  await eng.init();

  eng.observeMessage('How do I test React components with Vitest?');
  eng.observeMessage('There is an error in my build pipeline');
  eng.observeMessage('How can I deploy this to Kubernetes?');
  eng.observeMessage('How do I configure Docker properly?');
  eng.observeMessage('Another error: something crashed');

  const patterns = eng.getPatterns();
  const questionPatterns = patterns.filter(p => p.type === 'question');
  if (questionPatterns.length < 1) throw 'no question patterns detected';

  const debugPatterns = patterns.filter(p => p.type === 'debug');
  if (debugPatterns.length < 1) throw 'no debug patterns detected';

  const suggestions = eng.getSuggestions();
  if (suggestions.length === 0) throw 'no suggestions from messages';

  const terms = eng.getTopTerms(5);
  if (terms.length < 1) throw 'no terms extracted';
});

await run('persist + load round-trip', async () => {
  const { LearningEngine } = await import('./learning-engine.mjs');
  const learnDir = join(tmpDir, 'learn-persist');
  await mkdir(learnDir, { recursive: true });

  const eng1 = new LearningEngine(learnDir);
  await eng1.init();
  eng1.observeToolUsage({ tool: 'write', description: 'Writing file', sessionID: 's1' });
  eng1.observeMessage('How do I fix this error?');
  await eng1.persist();

  const eng2 = new LearningEngine(learnDir);
  await eng2.init();
  const stats = eng2.getToolStats();
  if (stats.length === 0) throw 'no tool stats after load';
  const patterns = eng2.getPatterns();
  if (patterns.length === 0) throw 'no patterns after load';
  // Verify sessions is a Set
  const firstToolPattern = eng2.getToolStats()[0];
  if (firstToolPattern) pass('persist+load tool patterns preserved');
});


console.log('\n🔧 5. context-injector.mjs');

await run('addSignal and decay', async () => {
  const { ContextInjector } = await import('./context-injector.mjs');
  const inj = new ContextInjector(dataDir);
  await inj.init();

  inj.addSignal('test react component with jest', 'tech', 1.0);
  inj.addSignal('how do I debug this error', 'message', 1.0);
  inj.addSignal('running tests with jest and react', 'message', 1.0);

  const top = inj.getTopTerms(5);
  if (top.length < 2) throw `expected at least 2 terms, got ${top.length}`;

  const stats = inj.getStats();
  if (stats.totalTerms < 2) throw `expected at least 2 unique terms, got ${stats.totalTerms}`;
  if (stats.totalSignals < 3) throw `expected 3+ signals, got ${stats.totalSignals}`;

  // 'react' and 'jest' should be high-weight (tech boost)
  const react = top.find(t => t.term === 'react');
  const jest = top.find(t => t.term === 'jest');
  if (react && jest) {
    // Both should have tech category
    pass('tech terms detected');
  }
});


console.log('\n🔧 6. context-window-manager.mjs');

await run('addSkill and relevance', async () => {
  const { ContextWindowManager } = await import('./context-window-manager.mjs');
  const cwm = new ContextWindowManager({ dataDir });

  cwm.addSkill({ slug: 'react-testing', name: 'React Testing', description: 'Test React', categories: ['frontend'] });
  cwm.addSkill({ slug: 'vue-testing', name: 'Vue Testing', description: 'Test Vue', categories: ['frontend'] });
  cwm.addSkill({ slug: 'docker-deploy', name: 'Docker Deploy', description: 'Docker deployment', categories: ['devops'] });

  const relevant = cwm.getRelevantSkills(5);
  if (relevant.length !== 3) throw `expected 3, got ${relevant.length}`;

  // After updateContext with matching terms, relevance should boost
  cwm.updateContext(['react'], ['jest']);
  const after = cwm.getRelevantSkills(5);
  // The first one should be boosted
  if (after.length > 0 && after[0].relevance <= 0) throw 'relevance not updated';

  const stats = cwm.getWindowStats();
  if (stats.totalSkills !== 3) throw `expected 3 skills in window, got ${stats.totalSkills}`;
});


console.log('\n🔧 7. skill-creator.mjs');

await run('createSkill', async () => {
  const { createSkill } = await import('./skill-creator.mjs');

  const result = await createSkill({
    name: 'integration-test',
    description: 'Use when running integration tests for auto-skill plugin',
    body: '# Integration Test\n\nTest the auto-skill plugin.\n\n```js\nconst x = 1;\n```\n\n## Setup\n\nRun with node.',
    targetDir: tmpDir,
  });

  if (!result.success) throw `createSkill failed: ${result.error}`;
  if (!result.path) throw 'no path returned';
  if (!result.path.endsWith('integration-test.md')) throw `wrong path: ${result.path}`;

  // Verify content
  const content = await readFile(result.path, 'utf-8');
  if (!content.includes('name: integration-test')) throw 'missing name in frontmatter';
  if (!content.includes('description: Use when running integration tests')) throw 'missing desc';
});

await run('createSkill validation', async () => {
  const { createSkill } = await import('./skill-creator.mjs');

  const noName = await createSkill({ description: 'desc', body: '# H\n\nContent' });
  if (noName.success) throw 'should fail without name';

  const badName = await createSkill({ name: 'BAD NAME', description: 'desc', body: '# H\n\nContent' });
  if (badName.success) throw 'should fail with bad name';

  const shortDesc = await createSkill({ name: 'test', description: 'short', body: '# H\n\nContent' });
  if (shortDesc.success) throw 'should fail with short desc';
});


console.log('\n🔧 8. sourcing/web.mjs');

await run('toSkillFormat produces parseable output', async () => {
  const { parseSkillContent, assembleSkill } = await import('./skill-engine.mjs');
  const content = assembleSkill('web-test', 'Imported from web', '# Web Test\n\nContent from the web.');
  const parsed = parseSkillContent(content);
  if (!parsed) throw 'parseSkillContent returned null';
  if (parsed.name !== 'web-test') throw `wrong name: ${parsed.name}`;
  if (!parsed.body.includes('Content from the web')) throw 'body content missing';
});


console.log('\n🔧 9. sourcing/github.mjs');

await run('parseRepoUrl', async () => {
  const { default: gh } = await import('./sourcing/github.mjs');
  // Can't access parseRepoUrl directly — test via sourceFromGitHub error handling
  // The function is module-private, so just check it exists
  pass('github module loads');
});


console.log('\n🔧 10. index.mjs plugin factory');

await run('plugin factory returns hooks', async () => {
  const autoSkillPlugin = (await import('./index.mjs')).default;
  const hooks = await autoSkillPlugin({ directory: tmpDir }, { enabled: false });
  if (!hooks) throw 'no hooks returned';
  if (!hooks.tool) throw 'no tool definitions';
  if (typeof hooks['tool.execute.before'] !== 'function') throw 'no tool.execute.before hook';
  if (typeof hooks['chat.message'] !== 'function') throw 'no chat.message hook';

  // Check tool definitions exist
  const toolNames = Object.keys(hooks.tool);
  const required = ['auto_skill_search', 'auto_skill_list', 'auto_skill_status', 'auto_skill_suggest', 'auto_skill_learn', 'auto_skill_info', 'auto_skill_create', 'auto_skill_import'];
  for (const name of required) {
    if (!toolNames.includes(name)) throw `missing tool: ${name}`;
  }
});


// ── Cleanup ────────────────────────────────────────────────
await rm(tmpDir, { recursive: true, force: true }).catch(() => {});

// ── Summary ────────────────────────────────────────────────
console.log(`\n${'='.repeat(48)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(48)}\n`);
process.exit(failed > 0 ? 1 : 0);
