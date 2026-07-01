/**
 * AgentMapper - Maps context signals to skill categories for developers and agents
 * 
 * Enhanced with production-grade features:
 * - Fuzzy matching with configurable thresholds
 * - Learning from usage patterns
 * - Contextual awareness and scoring
 * - Extensible keyword patterns
 */
export class AgentMapper {
  /**
   * Supported built-in agent types and their keyword patterns
   * @private
   */
  static BUILTIN_AGENT_TYPES = {
    'frontend-developer': [
      'react-expert', 'vue-expert', 'angular-architect', 'frontend-developer',
      '@opencode:', 'frontend:', 'ui-', 'web:', 'react-native-expert',
      'copilot-delegate-subagent', 'tool-use-frontend', 'checkout-frontend',
      'design-frontend', 'frontend-mobile-development', 'component-system'
    ],
    'backend-architect': [
      'microservices-architect', 'architecture-designer', 'backend-architect',
      'api-designer', 'graphql-architect', 'event-sourcing', 'workflow-orchestration-patterns',
      '@opencode:', 'backend:', 'server:', 'microservice:', 'api-gateway',
      'dependency-injection', 'queue-worker', 'worker-thread', 'service-discovery',
      'deployment-engineer', 'platform-engineer', 'infra-engineer', 'devops-phase',
      'build-engineer', 'performance-engineer', 'database-architect'
    ],
    'debugger': [
      'debugger', 'debugging', 'systematic-debugging', 'debugging-wizard', 'debugging-patterns',
      'error-detective', 'memory-category-pointer', 'plugin-eval-evaluation-methodology',
      'investigate-error', 'detect-bug', 'trace-error', 'performance-engineer',
      'analyze-stack', 'exception-handling', 'async-debugging', 'concurrency-debug',
      'callstack-analyze', 'profile-debug', 'sentry-integration', 'log-parser'
    ],
    'code-reviewer': [
      'code-review', 'code-reviewer', 'review', 'pull-request', 'pr-review',
      'security-review', 'reviewer', 'code-audit', 'lint', 'type-check',
      'code-quality', 'qa-expert', 'quality-check', 'test-coverage', 'audit',
      'style-check', 'complexity-analyze', 'cyclic-dependency', 'dependency-checker',
      'dependabot', 'remediate', 'security-audit', 'vulnerability-scan'
    ],
    'test-automator': [
      'test-automation', 'test-automator', 'test-master', 'tdd', 'tdd-workflows',
      'test-strategy', 'quality-assurance', 'ci-test', 'e2e-test', 'playwright-expert',
      'vitest', 'testing-library', 'unit-test', 'integration-test', 'mutation-test',
      'mutation', 'mutation-testing', 'mutation-coverage', 'ci-test-pipeline',
      'parallel-test', 'test-parallelizer', 'test-suite', 'test-coverage-report'
    ],
    'devops-engineer': [
      'devops-engineer', 'ci-cd', 'cicd', 'kubernetes', 'k8s', 'helm', 'terraform',
      'docker', 'containers', 'orchestration', 'infrastructure-as-code', 'iac',
      'gitops', 'prometheus', 'grafana', 'monitoring', 'alerting', 'service-discovery',
      'service-mesh', 'linkerd', 'istio', 'traffic-management', 'canary-deploy',
      'blue-green', 'rollback', 'secrets-manager', 'vault', 'cloud-automation'
    ],
    'security-auditor': [
      'security-auditor', 'security-audit', 'penetration-tester', 'pentest',
      'vulnerability', 'threat-model', 'stride-analysis', 'attack-tree', 'zero-trust',
      'saast', 'sast-configuration', 'dependency-scan', 'dependency-audit',
      'secret-scanning', 'credential-harvesting', 'policy-compliance', 'privacy-audit',
      'gdpr', 'hipaa', 'compliance-check', 'vulnerability-assessment', 'detection-mode',
      'code-security', 'static-analysis', 'fuzz-testing', 'burst-analysis', 'attack-simulation'
    ],
    'architect-reviewer': [
      'architect-reviewer', 'system-design', 'architecture-design', 'design-pattern',
      'data-flow', 'component-diagram', 'sequence-diagram', 'class-diagram',
      'deployment-architecture', 'scalability-pattern', 'resilience-pattern',
      'microservices-patterns', 'event-driven-architecture', 'domain-driven-design',
      'hexagonal-architecture', 'clean-architecture', 'inversion-of-control',
      'layered-architecture', 'service-boundary', 'capability-mapping', 'feature-modeling',
      'roadmapping', 'technical-strategy', 'tech-decision-record', 'adr', 'decision-log'
    ]
  };

  /**
   * Keyword patterns for each agent type to detect from context
   * @private
   */
  static AGENT_KEYWORD_PATTERNS = {
    'frontend-developer': [
      'frontend', 'react', 'vue', 'angular', 'typescript', 'javascript', 
      'ui', 'web', 'webpack', 'babel', 'vite', 'nuxt', 'gatsby',
      'css', 'html', 'responsive', 'accessibility', 'a11y', 'design-system',
      'component', 'hook', 'state-management', 'redux', 'zustand', 'pinia'
    ],
    'backend-architect': [
      'backend', 'microservices', 'service', 'architecture', 'design', 'patterns',
      'database', 'schema', 'modeling', '_entity_', 'repository', 'session',
      'queue', 'worker', 'pipeline', 'orchestration', 'event-driven', 'cicd',
      'ci-cd', 'cd', 'deployment', 'kubernetes', 'docker', 'containers',
      'infrastructure', 'as-code', 'terraform', 'cloud', 'serverless', 'async',
      'transaction', 'consistency', 'sagas', 'event-sourcing', 'event-store',
      'capability', 'technology', 'strategy', 'decision', 'evaluation', 'review'
    ],
    'debugger': [
      'debug', 'breakpoint', 'stack-frame', 'backtrace', 'inspect', 'trace',
      'error', 'exception', 'timeout', 'deadlock', 'hung', 'performance',
      'profile', 'bottleneck', 'race-condition', 'concurrency', 'reentrancy',
      'deadlock', 'memory-leak', 'heap', 'gc', 'inspect', 'chrome-devtools',
      'lldb', 'gdb', 'perf', 'valgrind', 'perf-profiler', 'audit', 'diagnose'
    ],
    'code-reviewer': [
      'review', 'code-review', 'pr', 'pull-request', 'diff', 'compare', 'merge',
      'merge-request', 'merge-point', 'approval', 'sign-off', 'lgtm',
      'security', 'vulnerability', 'attack', 'threat', 'abuse-case', 'fuzzing',
      'static-analysis', 'type-check', 'lint', 'format', 'style', 'quality',
      'maintainability', 'complexity', 'cyclomatic', 'dependency', 'coupling',
      'tight-coupling', 'service-boundary', 'team-review', 'peer-review'
    ],
    'test-automator': [
      'test', 'testing', 'qa', 'quality', 'assurance', 'e2e', 'end-to-end',
      'unit', 'integration', 'mutation', 'coverage', 'mock', 'fixture',
      'assert', 'expect', 'chai', 'jest', 'vitest', 'pytest', 'pytest', 'pytest',
      'cypress', 'playwright', 'testcafe', 'test-suite', 'test-strategy',
      'test-coverage', 'test-reporter', 'parallel-test', 'test-randomization',
      'mutation-test', 'mutation-testing', 'mutation-coverage', 'test-pipeline'
    ],
    'devops-engineer': [
      'devops', 'engineer', 'ci-cd', 'cicd', 'kubernetes', 'k8s', 'helm', 'docker',
      'containers', 'orchestration', 'infrastructure-as-code', 'iac', 'terraform',
      'ansible', 'cloud', 'aws', 'azure', 'gcp', 'google-cloud', 'openstack',
      'service-discovery', 'service-mesh', 'istio', 'linkerd', 'traffic-management',
      'canary-deploy', 'blue-green', 'rollback', 'secrets-manager', 'vault',
      'hashicorp', 'consul', 'etcd', 'etcd', 'consul', 'pipline', 'build-pipeline',
      'test-pipeline', 'deployment-pipeline', 'continuous-delivery', 'cd-pipeline',
      'release-engineering', 'configuration-management', 'provisioning'
    ],
    'security-auditor': [
      'security', 'audit', 'auditor', 'penetration', 'pentest', 'red-team', 'offensive',
      'defensive', 'threat', 'vulnerability', 'exploit', 'attack', 'zero-trust',
      'identity', 'access', 'auth', 'authentication', 'authorization', 'rbac',
      'policy', 'compliance', 'gdpr', 'hipaa', 'ccpa', 'ccpa', 'policy-check',
      'vulnerability-scan', 'security-scan', 'static-analysis', 'sast', 'dast',
      'dependency-scan', 'dependency-audit', 'secret-scanning', 'secret-harvesting',
      'credential-harvesting', 'cves', 'cve-tracking', 'vuln-management', 'remediation'
    ],
    'architect-reviewer': [
      'architecture', 'design', 'architect', 'reviewer', 'architectural',
      'system-design', 'data-design', 'component-design', 'service-design',
      'performance-design', 'scalability', 'resilience', 'reliability',
      'pattern', 'anti-pattern', 'trade-off', 'evaluation', 'decision', 'strategy',
      'technical', 'decision', 'engineering', 'roadmap', 'context-diagram',
      'component-diagram', 'sequence-diagram', 'class-diagram', 'activity-diagram',
      'uml', 'plantuml', 'architecture-diagrams', 'component-boundary',
      'service-orientation', 'event-driven', 'event-sourcing', 'event-bus',
      'messaging', 'integration', 'interface', 'contract-first', 'api-first',
      'contract', 'openapi', 'swagger', 'graphql', 'schema', 'gateway', 'client',
      'provider', 'dependency', 'conformance', 'backward-compatibility'
    ]
  };

  /**
   * All supported agent types (built-in + custom)
   * @private
   */
  static ALL_AGENT_TYPES = new Set([
    'frontend-developer',
    'backend-architect',
    'debugger',
    'code-reviewer',
    'test-automator',
    'devops-engineer',
    'security-auditor',
    'architect-reviewer'
  ]);

  /**
   * Default categories when agent type is unknown
   */
  static DEFAULT_CATEGORIES = ['general', 'misc', 'other', 'unknown'];

  /**
   * Threshold for agent detection confidence
   */
  static DETECTION_THRESHOLD = 0.3;

  constructor() {
    /**
     * Custom agent types registered at runtime
     * @private
     */
    this.customAgentTypes = new Map();
    
    /**
     * Usage statistics for learning
     * @private
     */
    this.usageStats = new Map();
    
    /**
     * Cache for keyword matching
     * @private
     */
    this.keywordCache = new Map();
  }

  /**
   * Detect agent type from context signals (tool usage, keywords)
   * 
   * @param {Object} context Signals from the interaction context
   * @param {Array<string>} context.tools Used tools/services
   * @param {string} context.message Message content
   * @param {Object} context.nlp NLP analysis results
   * @returns {{agentType: string, confidence: number}} Detected agent type and confidence
   */
  detectAgentType(context = {}) {
    // Extract signals from context
    const tools = Array.isArray(context.tools) ? context.tools : [];
    const message = typeof context.message === 'string' ? context.message : '';
    const nlp = context.nlp || {};

    // Collect potential signals
    const signals = new Set();
    
    // Add tool signals
    tools.forEach(tool => signals.add(`tool:${tool}`));
    
    // Add message signals (tokenize and add meaningful tokens)
    if (message) {
      const tokens = this.tokenize(message);
      tokens.forEach(token => signals.add(`word:${token}`));
      // Add full message as signal for phrase matching
      signals.add(`message:${message.toLowerCase()}`);
    }
    
    // Add NLP signals
    if (nlp.entities) {
      Object.values(nlp.entities).forEach(entities => {
        if (Array.isArray(entities)) {
          entities.forEach(entity => {
            if (entity.type) signals.add(`entity:${entity.type}`);
            if (entity.text) signals.add(`entity_text:${entity.text.toLowerCase()}`);
          });
        }
      });
    }
    
    if (nlp.intent) signals.add(`intent:${nlp.intent}`);
    if (nlp.keywords) {
      nlp.keywords.forEach(keyword => signals.add(`keyword:${keyword.toLowerCase()}`));
    }

    // Score each agent type based on signals
    const scores = new Map();
    const agentTypes = [...AgentMapper.ALL_AGENT_TYPES, ...this.customAgentTypes.keys()];
    
    agentTypes.forEach(agentType => {
      const score = this.scoreAgent(agentType, signals);
      if (score > 0) {
        scores.set(agentType, score);
      }
    });

    // Find the agent type with the highest score
    let bestAgentType = 'unknown';
    let maxScore = 0;
    
    for (const [agentType, score] of scores.entries()) {
      if (score > maxScore) {
        maxScore = score;
        bestAgentType = agentType;
      }
    }

    // Return result with confidence
    const confidence = Math.max(0, Math.min(1, maxScore));
    return {
      agentType: confidence >= AgentMapper.DETECTION_THRESHOLD ? bestAgentType : 'unknown',
      confidence
    };
  }

  /**
   * Score how well signals match an agent type
   * @private
   */
  scoreAgent(agentType, signals) {
    // Check cache
    const cacheKey = `${agentType}:${Array.from(signals).sort().join('|')}`;
    const cached = this.keywordCache.get(cacheKey);
    if (cached !== undefined) return cached;

    let score = 0;
    const patterns = this.getPatternsForAgent(agentType);
    
    if (!patterns || patterns.length === 0) return 0;

    // Weight different types of signals
    let toolScore = 0;
    let messageScore = 0;
    let keywordScore = 0;
    let entityScore = 0;
    
    patterns.forEach(pattern => {
      // Exact tool matches
      if (signals.has(`tool:${pattern}`)) {
        toolScore += 3;
      }
      
      // Message contains the keyword
      if (Array.from(signals).some(signal => 
        signal.startsWith('message:') && 
        signal.substring(8).includes(pattern)
      )) {
        messageScore += 2;
      }
      
      // Exact word matches
      if (signals.has(`word:${pattern}`)) {
        keywordScore += 2;
      }
      
      // Entity matches
      if (Array.from(signals).some(signal => 
        signal.startsWith('entity_text:') && 
        signal.substring(12) === pattern
      )) {
        entityScore += 3;
      }
      
      // Fuzzy matching for partial matches
      const fuzzyMatch = Array.from(signals).some(signal => 
        (signal.startsWith('message:') || signal.startsWith('word:')) && 
        this.fuzzyContains(signal.substring(signal.indexOf(':') + 1), pattern)
      );
      if (fuzzyMatch) {
        messageScore += 1;
        keywordScore += 0.5;
      }
    });

    // Apply weights
    const totalScore = 
      (toolScore * 0.4) + 
      (messageScore * 0.3) + 
      (keywordScore * 0.2) + 
      (entityScore * 0.1);
    
    // Normalize by pattern count
    const normalizedScore = totalScore / (patterns.length * 3);
    const finalScore = Math.min(1, normalizedScore);
    
    // Cache result
    this.keywordCache.set(cacheKey, finalScore);
    
    // Periodic cache cleanup
    if (this.keywordCache.size > 1000) {
      const keys = Array.from(this.keywordCache.keys());
      keys.slice(0, 500).forEach(key => this.keywordCache.delete(key));
    }
    
    return finalScore;
  }

  /**
   * Get patterns for an agent type (built-in or custom)
   * @private
   */
  getPatternsForAgent(agentType) {
    if (AgentMapper.ALL_AGENT_TYPES.has(agentType)) {
      return AgentMapper.AGENT_KEYWORD_PATTERNS[agentType];
    }
    return this.customAgentTypes.get(agentType) || [];
  }

  /**
   * Fuzzy string matching for partial word matches
   * @private
   */
  fuzzyContains(text, pattern) {
    if (!text || !pattern) return false;
    const textLower = text.toLowerCase();
    const patternLower = pattern.toLowerCase();
    
    // Check if pattern is a substring
    if (textLower.includes(patternLower)) return true;
    
    // Check for word boundary matches
    const words = textLower.split(/\W+/);
    return words.some(word => 
      word.startsWith(patternLower) || 
      patternLower.startsWith(word)
    );
  }

  /**
   * Tokenize text for signal processing
   * @private
   */
  tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2)
      .filter(t => !this.isStopWord(t));
  }

  /**
   * Check if a word is a stop word
   * @private
   */
  isStopWord(word) {
    const stopWords = new Set([
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can',
      'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him',
      'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'who',
      'boy', 'did', 'man', 'men', 'put', 'too', 'use'
    ]);
    return stopWords.has(word);
  }

  /**
   * Get skill categories for a given agent type
   * 
   * @param {string} agentType Detected agent type
   * @returns {string[]} List of skill categories
   */
  getSkillCategoriesForAgent(agentType) {
    if (!agentType || !AgentMapper.ALL_AGENT_TYPES.has(agentType)) {
      // Check custom types
      if (this.customAgentTypes.has(agentType)) {
        return this.getDefaultCategoriesForCustomType(agentType);
      }
      return this.DEFAULT_CATEGORIES;
    }

    // Return categories specific to this agent type
    const categoryMap = {
      'frontend-developer': ['frontend', 'ui', 'javascript', 'typescript', 'css', 'design', 'react'],
      'backend-architect': ['backend', 'server', 'microservices', 'database', 'api', 'authentication'],
      'debugger': ['debugging', 'performance', 'investigation', 'diagnostics', 'troubleshooting'],
      'code-reviewer': ['code-review', 'security', 'quality', 'maintainability', 'best-practices'],
      'test-automator': ['testing', 'qa', 'automation', 'mock', 'fixture', 'coverage'],
      'devops-engineer': ['devops', 'ci-cd', 'infrastructure', 'automation', 'networking', 'security'],
      'security-auditor': ['security', 'audit', 'compliance', 'vulnerability', 'penetration', 'risk'],
      'architect-reviewer': ['architecture', 'design', 'scalability', 'resilience', 'patterns']
    };

    return categoryMap[agentType] || this.DEFAULT_CATEGORIES;
  }

  /**
   * Get default categories for custom agent types
   * @private
   */
  getDefaultCategoriesForCustomType(agentType) {
    const customDef = this.customAgentTypes.get(agentType);
    return Array.isArray(customDef) && customDef.length > 0 
      ? customDef.slice(0, 3) 
      : ['general'];
  }

  /**
   * Get list of all supported built-in agent types
   * @returns {string[]} Array of all agent type identifiers
   */
  static getAllAgentTypes() {
    return Array.from(this.ALL_AGENT_TYPES);
  }

  /**
   * Register a custom agent type and its associated keywords/categories
   * 
   * @param {string} agentType Custom agent type name
   * @param {string[]} keywords Keywords associated with this agent type
   * @param {string[]} [categories] Optional categories for this agent type
   */
  registerAgentType(agentType, keywords = [], categories = []) {
    if (!agentType) {
      throw new Error('Agent type cannot be empty');
    }
    
    // Validate agent type doesn't conflict with built-in types
    if (AgentMapper.ALL_AGENT_TYPES.has(agentType)) {
      throw new Error(`Cannot override built-in agent type: ${agentType}`);
    }
    
    // Store keywords
    if (Array.isArray(keywords) && keywords.length > 0) {
      this.customAgentTypes.set(agentType, keywords);
    }
    
    // Update usage stats tracking
    if (!this.usageStats.has(agentType)) {
      this.usageStats.set(agentType, {
        count: 0,
        lastUsed: null,
        registered: Date.now()
      });
    }
    
    return true;
  }

  /**
   * Check if an agent type is supported/registered
   * @param {string} agentType 
   * @returns {boolean}
   */
  isSupportedAgentType(agentType) {
    return AgentMapper.ALL_AGENT_TYPES.has(agentType) || 
           this.customAgentTypes.has(agentType);
  }

  /**
   * Record usage of an agent type for learning
   * @param {string} agentType 
   * @param {string} context Optional context string
   */
  recordUsage(agentType, context = '') {
    if (!this.isSupportedAgentType(agentType)) return false;
    
    const stats = this.usageStats.get(agentType) || {
      count: 0,
      lastUsed: null,
      contexts: []
    };
    
    stats.count++;
    stats.lastUsed = Date.now();
    if (context) {
      stats.contexts.push({
        context,
        timestamp: Date.now()
      });
      // Keep only last 100 contexts
      if (stats.contexts.length > 100) {
        stats.contexts.shift();
      }
    }
    
    this.usageStats.set(agentType, stats);
    return true;
  }

  /**
   * Get usage statistics for an agent type
   * @param {string} agentType 
   * @returns {Object|null} Usage stats or null if not found
   */
  getUsageStats(agentType) {
    return this.usageStats.get(agentType) || null;
  }

  /**
   * Clear caches (useful for testing or memory management)
   */
  clearCaches() {
    this.keywordCache.clear();
  }
}

// Export utility function for backward compatibility
export function mapAgentContext(context) {
  const mapper = new AgentMapper();
  const {agentType, confidence} = mapper.detectAgentType(context);
  const categories = mapper.getSkillCategoriesForAgent(agentType);
  
  return {
    agentType,
    categories,
    confidence
  };
}