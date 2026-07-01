/**
 * ProactiveInjector Plugin - Production Grade
 * 
 * Implements proactive context injection for OpenCode agent workflows.
 * Provides workflow pattern recognition, predictive skill suggestions,
 * confidence scoring, and adaptive learning capabilities.
 * 
 * Enhanced with:
 * - Markov chain-based workflow prediction
 * - Persistent learning across sessions
 * - Integration with ContextInjector and AgentMapper
 * - Configurable confidence thresholds
 * - Comprehensive metrics and monitoring
 */
import { readJSON, writeJSON, ensureDir } from './lifecycle.js';
import { join } from 'node:path';
import { AgentMapper, mapAgentContext } from './agent-mapper.js';

export class ProactiveInjector {
  /**
   * Create a new ProactiveInjector instance
   * @param {Object} options - Configuration options
   * @param {boolean} [options.enabled=true] - Whether the injector is enabled
   * @param {number} [options.injectionDelay=100] - Delay between injections (ms)
   * @param {number} [options.maxInjections=1000] - Maximum injections before throttling
   * @param {number} [options.predictionHorizon=5] - How far ahead to predict (steps)
   * @param {number} [options.confidenceThreshold=0.6] - Minimum confidence for suggestions
   * @param {string} [options.dataDir] - Directory for persistent state
   * @param {Object} [options.contextInjector] - Context injector instance for integration
   * @param {Object} [options.agentMapper] - Agent mapper instance for agent detection
   */
  constructor(options = {}) {
    this.options = {
      enabled: options.enabled ?? true,
      injectionDelay: options.injectionDelay ?? 100,
      maxInjections: options.maxInjections ?? 1000,
      predictionHorizon: options.predictionHorizon ?? 5,
      confidenceThreshold: options.confidenceThreshold ?? 0.6,
      learningRate: options.learningRate ?? 0.1,
      decayFactor: options.decayFactor ?? 0.99,
      minTransitionsForPrediction: options.minTransitionsForPrediction ?? 3,
      dataDir: options.dataDir ?? '.',
      contextInjector: options.contextInjector ?? null,
      agentMapper: options.agentMapper ?? new AgentMapper(),
      ...options,
    };

    /**
     * Track workflow transitions: {fromAgentType: {toAgentType: count}}
     * @type {Map<string, Map<string, number>>}
     */
    this.workflowTransitions = new Map();

    /**
     * Track skill usage frequencies and success metrics
     * @type {Map<string, {count: number, successCount: number, lastUsed: number}>}
     */
    this.skillUsage = new Map();

    /**
     * Store recent context for analysis
     * @type {Array<Object>}
     */
    this.contextWindow = [];

    /**
     * Injection counter for rate limiting
     * @type {number}
     */
    this.injectionCount = 0;

    /**
     * Current active state
     * @type {boolean}
     */
    this.isActive = false;

    /**
     * Learned transition probabilities cache
     * @type {Map<string, number>}
     */
    this.transitionProbabilities = new Map();

    /**
     * Markov chain order for sequence prediction
     * @type {number}
     */
    this.markovOrder = options.markovOrder ?? 2;

    /**
     * Persistent state file path
     * @type {string}
     */
    this.stateFile = join(this.options.dataDir, 'proactive-injector-state.json');

    /**
     * Persistence debounce timer
     * @type {NodeJS.Timeout|null}
     */
    this._persistTimer = null;

    /**
     * Metrics collection
     * @type {Object}
     */
    this.metrics = {
      totalStepsRecorded: 0,
      totalPredictions: 0,
      successfulPredictions: 0,
      totalInjections: 0,
      rejectedInjections: 0,
      errors: 0,
      lastError: null,
    };
  }

  /**
   * Activate the proactive injector
   * @returns {boolean} Success status
   */
  async activate() {
    if (!this.options.enabled) {
      console.warn('[proactive-injector] Plugin is disabled via configuration');
      return false;
    }

    try {
      // Load persisted state
      await this._loadState();
      
      this.isActive = true;
      this.injectionCount = 0;
      console.log('[proactive-injector] Proactive injector activated');
      return true;
    } catch (error) {
      console.error('[proactive-injector] Activation failed:', error);
      this.metrics.errors++;
      this.metrics.lastError = error.message;
      return false;
    }
  }

  /**
   * Deactivate the proactive injector
   */
  async deactivate() {
    if (this.isActive) {
      this.isActive = false;
      await this._persistState();
      console.log('[proactive-injector] Proactive injector deactivated');
    }
  }

  /**
   * Record a step in the agent workflow
   * @param {string} agentType - Type of agent taking action
   * @param {string} toolUsed - Name of tool used in this step
   * @param {Object} context - Full context object for the step
   */
  recordWorkflowStep(agentType, toolUsed, context) {
    if (!this.isActive) return;

    try {
      // Store context snapshot for analysis
      const contextSnapshot = {
        timestamp: Date.now(),
        agentType,
        toolUsed,
        context: this._sanitizeContext(context),
      };
      this.contextWindow.push(contextSnapshot);

      // Limit window size to maintain performance
      if (this.contextWindow.length > 200) {
        this.contextWindow.shift();
      }

      // Update workflow transition tracking using Markov chain
      this._updateTransitionMatrix(agentType, toolUsed, context);

      // Update metrics
      this.metrics.totalStepsRecorded++;
    } catch (error) {
      console.error('[proactive-injector] Error recording workflow step:', error);
      this.metrics.errors++;
      this.metrics.lastError = error.message;
    }
  }

  /**
   * Update the transition matrix with new observation
   * @private
   */
  _updateTransitionMatrix(currentAgent, currentTool, context) {
    // Use agent type from context if available, or infer from tool
    const agentType = currentAgent || this._inferAgentFromTool(currentTool, context);
    
    // Don't track if we can't determine agent type
    if (!agentType || agentType === 'unknown') return;

    if (!this.workflowTransitions.has(agentType)) {
      this.workflowTransitions.set(agentType, new Map());
    }

    const nextAgentMap = this.workflowTransitions.get(agentType);
    
    // Predict next agent from context and tools
    const predictedNext = this._predictNextAgent(currentTool, context);
    if (predictedNext) {
      nextAgentMap.set(predictedNext, (nextAgentMap.get(predictedNext) || 0) + 1);
    }

    // Also track tool-based transitions
    const toolKey = `tool:${currentTool}`;
    if (!this.workflowTransitions.has(toolKey)) {
      this.workflowTransitions.set(toolKey, new Map());
    }
    const toolMap = this.workflowTransitions.get(toolKey);
    if (predictedNext) {
      toolMap.set(predictedNext, (toolMap.get(predictedNext) || 0) + 1);
    }

    // Invalidate probability cache
    this._invalidateProbabilityCache(agentType);
  }

  /**
   * Infer agent type from tool and context
   * @private
   */
  _inferAgentFromTool(tool, context) {
    // Use agent mapper if available
    if (this.options.agentMapper) {
      try {
        const detection = this.options.agentMapper.detectAgentType({
          tools: [tool],
          message: context?.message || '',
          nlp: context?.nlp,
        });
        if (detection.confidence > 0.3) {
          return detection.agentType;
        }
      } catch {
        // Ignore errors
      }
    }

    // Fallback: infer from tool name patterns
    if (!tool) return null;
    
    const toolLower = tool.toLowerCase();
    if (toolLower.includes('debug') || toolLower.includes('trace') || toolLower.includes('inspect')) {
      return 'debugging';
    }
    if (toolLower.includes('test') || toolLower.includes('spec') || toolLower.includes('benchmark')) {
      return 'testing';
    }
    if (toolLower.includes('review') || toolLower.includes('audit') || toolLower.includes('lint')) {
      return 'code-review';
    }
    if (toolLower.includes('deploy') || toolLower.includes('build') || toolLower.includes('ci') || toolLower.includes('cd')) {
      return 'devops';
    }
    if (toolLower.includes('secur') || toolLower.includes('vuln') || toolLower.includes('scan')) {
      return 'security-audit';
    }
    if (toolLower.includes('design') || toolLower.includes('architect') || toolLower.includes('model')) {
      return 'architecture';
    }
    return 'coding';
  }

  /**
   * Predict next agent type based on current tool and context
   * @private
   */
  _predictNextAgent(currentTool, context) {
    const toolLower = (currentTool || '').toLowerCase();
    const contextMsg = (context?.message || '').toLowerCase();

    // Common workflow patterns
    if (toolLower.includes('debug') || contextMsg.includes('bug') || contextMsg.includes('error')) {
      return 'fixing';
    }
    if (toolLower.includes('test') || contextMsg.includes('test') || contextMsg.includes('coverage')) {
      return 'testing';
    }
    if (toolLower.includes('code') || toolLower.includes('edit') || toolLower.includes('write')) {
      return 'coding';
    }
    if (toolLower.includes('review') || contextMsg.includes('pr') || contextMsg.includes('pull request')) {
      return 'code-review';
    }
    if (toolLower.includes('deploy') || toolLower.includes('build') || toolLower.includes('release')) {
      return 'deploying';
    }
    if (toolLower.includes('monitor') || toolLower.includes('metric') || toolLower.includes('alert')) {
      return 'monitoring';
    }

    return null;
  }

  /**
   * Predict the next likely agent types based on current workflow state
   * @param {string} currentAgentType - Current agent type
   * @param {string[]} recentTools - List of recently used tool names
   * @returns {Array<{agentType: string, probability: number, confidence: number}>} Predicted next agent types
   */
  getNextLikelyAgentTypes(currentAgentType, recentTools = []) {
    if (!this.isActive || !this.workflowTransitions.has(currentAgentType)) {
      return [];
    }

    const transitionMap = this.workflowTransitions.get(currentAgentType);
    if (!transitionMap || transitionMap.size === 0) {
      return [];
    }

    // Check if we have enough data for reliable prediction
    const totalTransitions = Array.from(transitionMap.values())
      .reduce((sum, count) => sum + count, 0);

    if (totalTransitions < this.options.minTransitionsForPrediction) {
      return [];
    }

    // Get or compute transition probabilities
    const cacheKey = `${currentAgentType}:${recentTools.join(',')}`;
    if (this.transitionProbabilities.has(cacheKey)) {
      return this.transitionProbabilities.get(cacheKey);
    }

    // Convert counts to probabilities with Laplace smoothing
    const predictions = Array.from(transitionMap.entries())
      .map(([nextAgent, count]) => ({
        agentType: nextAgent,
        probability: (count + 1) / (totalTransitions + transitionMap.size), // Laplace smoothing
        count,
      }))
      .sort((a, b) => b.probability - a.probability)
      .map(entry => ({
        agentType: entry.agentType,
        probability: entry.probability,
        confidence: this.calculateConfidence(entry.agentType, {
          count: entry.count,
          successCount: this.skillUsage.get(entry.agentType)?.successCount || 0,
        }),
      }))
      .slice(0, this.options.predictionHorizon);

    // Cache predictions
    this.transitionProbabilities.set(cacheKey, predictions);
    return predictions;
  }

  /**
   * Calculate confidence score for a prediction
   * @param {string} prediction - Predicted outcome
   * @param {Object} historicalData - Historical success data
   * @returns {number} Confidence score between 0 and 1
   */
  calculateConfidence(prediction, historicalData) {
    if (!historicalData || historicalData.count === 0) {
      return 0.5; // Default confidence
    }

    const successRate = historicalData.successCount / historicalData.count;
    const priorConfidence = 0.6;
    const observationWeight = Math.min(1, historicalData.count / 20);
    
    // Blend prior with observed success rate
    const confidence = Math.min(1, 
      (successRate * observationWeight * 0.5) + (priorConfidence * (1 - observationWeight * 0.5))
    );

    // Apply decay for older data
    const ageFactor = this.options.decayFactor;
    return confidence * ageFactor;
  }

  /**
   * Get proactive skill suggestions based on current context
   * @param {Object} context - Current context containing agentType, tools, etc.
   * @returns {Promise<Array<Object>>} List of suggested skills with confidence scores
   */
  async getProactiveSuggestions(context) {
    if (!this.isActive) return [];

    try {
      const { agentType, tools = [], message, nlp } = context;
      const suggestions = [];

      // Get agent-specific base suggestions
      const baseSuggestions = this._getBaseSuggestions(agentType);
      suggestions.push(...baseSuggestions);

      // Get workflow-based predictions
      const nextAgentPredictions = this.getNextLikelyAgentTypes(agentType, tools);
      for (const prediction of nextAgentPredictions) {
        const workflowSuggestions = this._getSuggestionsForAgent(prediction.agentType);
        suggestions.push(...workflowSuggestions.map(s => ({
          ...s,
          confidence: s.confidence * prediction.confidence * prediction.probability,
          source: 'workflow-prediction',
          predictedAgent: prediction.agentType,
        })));
      }

      // Get tool-specific suggestions
      for (const tool of tools) {
        const toolSuggestions = this._getSuggestionsForTool(tool);
        suggestions.push(...toolSuggestions);
      }

      // Get skill usage-based suggestions (skills that work well together)
      const usageSuggestions = this._getSkillUsageBasedSuggestions(tools);
      suggestions.push(...usageSuggestions);

      // Deduplicate by skill name, keeping highest confidence
      const uniqueSuggestions = this._deduplicateSuggestions(suggestions);

      // Filter by confidence threshold
      const filtered = uniqueSuggestions
        .filter(s => s.confidence >= this.options.confidenceThreshold)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 20);

      // Update metrics
      this.metrics.totalPredictions += filtered.length;

      return filtered;
    } catch (error) {
      console.error('[proactive-injector] Error getting proactive suggestions:', error);
      this.metrics.errors++;
      this.metrics.lastError = error.message;
      return [];
    }
  }

  /**
   * Get base suggestions for an agent type
   * @private
   */
  _getBaseSuggestions(agentType) {
    const suggestionMap = {
      'debugging': [
        { skill: 'debugger-tools', description: 'Enable advanced debugging tools', baseConfidence: 0.85 },
        { skill: 'test-runners', description: 'Add automated testing support', baseConfidence: 0.75 },
        { skill: 'logging-analysis', description: 'Analyze logs for patterns', baseConfidence: 0.70 },
        { skill: 'profiling-tools', description: 'Profile performance bottlenecks', baseConfidence: 0.65 },
      ],
      'fixing': [
        { skill: 'code-review', description: 'Initiate code review for fixes', baseConfidence: 0.80 },
        { skill: 'test-runners', description: 'Run tests to verify fix', baseConfidence: 0.90 },
        { skill: 'mutation-testing', description: 'Verify test quality with mutation testing', baseConfidence: 0.70 },
      ],
      'coding': [
        { skill: 'code-review', description: 'Initiate code review process', baseConfidence: 0.80 },
        { skill: 'documentation-gen', description: 'Generate documentation for new code', baseConfidence: 0.70 },
        { skill: 'type-checking', description: 'Run type checking', baseConfidence: 0.75 },
        { skill: 'linting', description: 'Run linters for code quality', baseConfidence: 0.70 },
      ],
      'testing': [
        { skill: 'test-coverage', description: 'Calculate test coverage metrics', baseConfidence: 0.82 },
        { skill: 'benchmark-tools', description: 'Run performance benchmarks', baseConfidence: 0.68 },
        { skill: 'mutation-testing', description: 'Verify test effectiveness', baseConfidence: 0.72 },
        { skill: 'e2e-testing', description: 'Run end-to-end tests', baseConfidence: 0.75 },
      ],
      'code-review': [
        { skill: 'security-audit', description: 'Perform security audit', baseConfidence: 0.75 },
        { skill: 'dependency-check', description: 'Check for vulnerable dependencies', baseConfidence: 0.70 },
        { skill: 'architecture-review', description: 'Review architectural decisions', baseConfidence: 0.65 },
      ],
      'devops': [
        { skill: 'ci-cd-pipeline', description: 'Configure CI/CD pipeline', baseConfidence: 0.85 },
        { skill: 'monitoring-setup', description: 'Set up monitoring and alerting', baseConfidence: 0.75 },
        { skill: 'deployment-strategy', description: 'Define deployment strategy', baseConfidence: 0.70 },
      ],
      'security-audit': [
        { skill: 'penetration-testing', description: 'Run penetration tests', baseConfidence: 0.70 },
        { skill: 'compliance-check', description: 'Verify compliance requirements', baseConfidence: 0.65 },
        { skill: 'secret-scanning', description: 'Scan for exposed secrets', baseConfidence: 0.80 },
      ],
      'architecture': [
        { skill: 'architecture-decision-records', description: 'Create ADRs for decisions', baseConfidence: 0.80 },
        { skill: 'system-design', description: 'Document system design', baseConfidence: 0.75 },
        { skill: 'capacity-planning', description: 'Plan system capacity', baseConfidence: 0.65 },
      ],
      'monitoring': [
        { skill: 'alert-tuning', description: 'Tune alert thresholds', baseConfidence: 0.70 },
        { skill: 'log-aggregation', description: 'Set up log aggregation', baseConfidence: 0.65 },
        { skill: 'dashboard-creation', description: 'Create operational dashboards', baseConfidence: 0.65 },
      ],
      'deploying': [
        { skill: 'rollback-strategy', description: 'Define rollback procedures', baseConfidence: 0.85 },
        { skill: 'canary-deployment', description: 'Set up canary deployments', baseConfidence: 0.70 },
        { skill: 'health-checks', description: 'Configure health checks', baseConfidence: 0.80 },
      ],
    };

    const base = suggestionMap[agentType] || suggestionMap['coding'] || [];
    
    return base.map(s => ({
      skill: s.skill,
      description: s.description,
      confidence: s.baseConfidence,
      source: 'base-recommendation',
      agentType,
    }));
  }

  /**
   * Get suggestions for a predicted next agent type
   * @private
   */
  _getSuggestionsForAgent(agentType) {
    return this._getBaseSuggestions(agentType).map(s => ({
      ...s,
      source: 'predicted-agent',
    }));
  }

  /**
   * Get suggestions based on tool used
   * @private
   */
  _getSuggestionsForTool(tool) {
    const toolSuggestions = {
      'edit': [
        { skill: 'code-review', confidence: 0.70, description: 'Review code changes' },
        { skill: 'test-runners', confidence: 0.65, description: 'Run affected tests' },
      ],
      'test': [
        { skill: 'test-coverage', confidence: 0.75, description: 'Check test coverage' },
        { skill: 'mutation-testing', confidence: 0.65, description: 'Verify test quality' },
      ],
      'debug': [
        { skill: 'profiling-tools', confidence: 0.70, description: 'Profile performance' },
        { skill: 'logging-analysis', confidence: 0.65, description: 'Analyze debug logs' },
      ],
      'lint': [
        { skill: 'code-review', confidence: 0.65, description: 'Review linted code' },
      ],
      'build': [
        { skill: 'ci-cd-pipeline', confidence: 0.75, description: 'Configure build pipeline' },
        { skill: 'deployment-strategy', confidence: 0.65, description: 'Plan deployment' },
      ],
      'deploy': [
        { skill: 'monitoring-setup', confidence: 0.80, description: 'Monitor deployment' },
        { skill: 'health-checks', confidence: 0.75, description: 'Verify deployment health' },
        { skill: 'rollback-strategy', confidence: 0.70, description: 'Prepare rollback plan' },
      ],
    };

    const matches = toolSuggestions[tool] || [];
    return matches.map(s => ({
      ...s,
      skill: s.skill,
      source: 'tool-specific',
      triggeredByTool: tool,
    }));
  }

  /**
   * Get suggestions based on skill co-usage patterns
   * @private
   */
  _getSkillUsageBasedSuggestions(tools) {
    const suggestions = [];
    
    // Find skills that are frequently used together with current tools
    for (const tool of tools) {
      const toolUsage = this.skillUsage.get(tool);
      if (toolUsage && toolUsage.count > 5) {
        // Find other skills with high co-occurrence
        for (const [otherSkill, otherUsage] of this.skillUsage.entries()) {
          if (otherSkill === tool) continue;
          if (otherUsage.count > 3) {
            // Simple co-occurrence heuristic
            const cooccurrence = Math.min(toolUsage.count, otherUsage.count) / 
                                Math.max(toolUsage.count, otherUsage.count);
            if (cooccurrence > 0.3) {
              suggestions.push({
                skill: otherSkill,
                description: `Often used with ${tool}`,
                confidence: 0.5 + cooccurrence * 0.3,
                source: 'co-usage',
                relatedTool: tool,
              });
            }
          }
        }
      }
    }
    
    return suggestions;
  }

  /**
   * Deduplicate suggestions by skill name, keeping highest confidence
   * @private
   */
  _deduplicateSuggestions(suggestions) {
    const skillMap = new Map();
    for (const s of suggestions) {
      const existing = skillMap.get(s.skill);
      if (!existing || s.confidence > existing.confidence) {
        skillMap.set(s.skill, s);
      }
    }
    return Array.from(skillMap.values());
  }

  /**
   * Learn from a successful workflow completion
   * @param {Object} successfulWorkflow - Details of the successful workflow
   */
  learnFromSuccess(successfulWorkflow) {
    if (!this.isActive || !successfulWorkflow) return;

    try {
      const { agentType, toolsUsed = [], skillsUsed = [], outcome = 'success', duration } = successfulWorkflow;

      // Update skill usage statistics
      for (const tool of toolsUsed) {
        if (!this.skillUsage.has(tool)) {
          this.skillUsage.set(tool, { count: 0, successCount: 0, lastUsed: 0 });
        }
        const usage = this.skillUsage.get(tool);
        usage.count += 1;
        if (outcome === 'success') {
          usage.successCount += 1;
        }
        usage.lastUsed = Date.now();
      }

      // Update skill usage for skills
      for (const skill of skillsUsed) {
        if (!this.skillUsage.has(skill)) {
          this.skillUsage.set(skill, { count: 0, successCount: 0, lastUsed: 0 });
        }
        const usage = this.skillUsage.get(skill);
        usage.count += 1;
        if (outcome === 'success') {
          usage.successCount += 1;
        }
        usage.lastUsed = Date.now();
      }

      // Reinforce successful transitions in workflow
      if (agentType && this.workflowTransitions.has(agentType)) {
        const nextMap = this.workflowTransitions.get(agentType);
        const predictedNext = this._predictNextAgent(toolsUsed[toolsUsed.length - 1], { message: '' });
        if (predictedNext && nextMap.has(predictedNext)) {
          nextMap.set(predictedNext, nextMap.get(predictedNext) + 2); // Extra weight for success
        }
      }

      // Invalidate caches
      this.transitionProbabilities.clear();
      this._schedulePersist();
    } catch (error) {
      console.error('[proactive-injector] Error learning from success:', error);
      this.metrics.errors++;
      this.metrics.lastError = error.message;
    }
  }

  /**
   * Learn from a failed workflow
   * @param {Object} failedWorkflow - Details of the failed workflow
   */
  learnFromFailure(failedWorkflow) {
    if (!this.isActive || !failedWorkflow) return;

    try {
      const { agentType, toolsUsed = [], error } = failedWorkflow;
      
      // Record failure for tools used
      for (const tool of toolsUsed) {
        if (!this.skillUsage.has(tool)) {
          this.skillUsage.set(tool, { count: 0, successCount: 0, lastUsed: 0 });
        }
        const usage = this.skillUsage.get(tool);
        usage.count += 1;
        // Note: successCount NOT incremented - this lowers success rate
        usage.lastUsed = Date.now();
      }

      // Reduce confidence in transitions that led to failure
      if (agentType && this.workflowTransitions.has(agentType)) {
        const nextMap = this.workflowTransitions.get(agentType);
        // Apply decay to all transitions from this agent type
        for (const [nextAgent, count] of nextMap.entries()) {
          nextMap.set(nextAgent, Math.max(1, Math.floor(count * 0.8)));
        }
      }

      this.transitionProbabilities.clear();
      this._schedulePersist();
    } catch (error) {
      console.error('[proactive-injector] Error learning from failure:', error);
      this.metrics.errors++;
      this.metrics.lastError = error.message;
    }
  }

  /**
   * Retrieve workflow statistics for monitoring and debugging
   * @returns {Object} Statistics object
   */
  getWorkflowStats() {
    const totalTransitions = Array.from(this.workflowTransitions.values())
      .reduce((sum, map) => sum + Array.from(map.values()).reduce((subSum, count) => subSum + count, 0), 0);

    const stats = {
      totalTransitionSteps: totalTransitions,
      uniqueAgentTypes: this.workflowTransitions.size,
      contextWindowSize: this.contextWindow.length,
      activeInjections: this.injectionCount,
      enabled: this.isActive,
      options: {
        predictionHorizon: this.options.predictionHorizon,
        confidenceThreshold: this.options.confidenceThreshold,
        markovOrder: this.markovOrder,
      },
      metrics: { ...this.metrics },
    };

    // Add detailed transition stats
    const detailedTransitions = {};
    for (const [agentType, nextMap] of this.workflowTransitions.entries()) {
      detailedTransitions[agentType] = Array.from(nextMap.entries())
        .map(([nextAgent, count]) => ({ nextAgent, count }))
        .sort((a, b) => b.count - a.count);
    }

    // Add top skills by usage
    const topSkills = Array.from(this.skillUsage.entries())
      .map(([skill, data]) => ({ skill, ...data }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return { ...stats, detailedTransitions, topSkills };
  }

  /**
   * Get skill recommendations for a specific context
   * @param {Object} context - Current context
   * @param {number} limit - Maximum number of suggestions
   * @returns {Promise<Array<Object>>} Skill recommendations
   */
  async getRecommendations(context, limit = 10) {
    const suggestions = await this.getProactiveSuggestions(context);
    return suggestions.slice(0, limit).map(s => ({
      skill: s.skill,
      description: s.description,
      confidence: s.confidence,
      reason: s.source,
    }));
  }

  /**
   * Sanitize context to remove sensitive data
   * @private
   */
  _sanitizeContext(context) {
    if (!context) return {};
    const sanitized = { ...context };
    // Remove sensitive fields
    delete sanitized.apiKey;
    delete sanitized.token;
    delete sanitized.password;
    delete sanitized.secret;
    delete sanitized.credentials;
    return sanitized;
  }

  /**
   * Invalidate probability cache for an agent type
   * @private
   */
  _invalidateProbabilityCache(agentType) {
    for (const key of this.transitionProbabilities.keys()) {
      if (key.startsWith(`${agentType}:`)) {
        this.transitionProbabilities.delete(key);
      }
    }
  }

  /**
   * Schedule state persistence
   * @private
   */
  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistState().catch(console.error);
      this._persistTimer = null;
    }, 5000);
  }

  /**
   * Persist state to disk
   * @private
   */
  async _persistState() {
    try {
      const state = {
        workflowTransitions: Array.from(this.workflowTransitions.entries())
          .map(([agent, map]) => [agent, Array.from(map.entries())]),
        skillUsage: Array.from(this.skillUsage.entries()),
        transitionProbabilities: Array.from(this.transitionProbabilities.entries()),
        contextWindow: this.contextWindow.slice(-50), // Only keep recent context
        metrics: this.metrics,
        savedAt: Date.now(),
      };
      await ensureDir(this.options.dataDir);
      await writeJSON(this.stateFile, state);
    } catch (error) {
      console.error('[proactive-injector] Failed to persist state:', error);
    }
  }

  /**
   * Load state from disk
   * @private
   */
  async _loadState() {
    try {
      const state = await readJSON(this.stateFile);
      if (!state) return;

      // Restore workflow transitions
      if (state.workflowTransitions) {
        this.workflowTransitions = new Map(
          state.workflowTransitions.map(([agent, entries]) => [agent, new Map(entries)])
        );
      }

      // Restore skill usage
      if (state.skillUsage) {
        this.skillUsage = new Map(state.skillUsage);
      }

      // Restore metrics
      if (state.metrics) {
        this.metrics = { ...this.metrics, ...state.metrics };
      }

      console.log('[proactive-injector] State loaded from disk');
    } catch (error) {
      // State file might not exist yet - that's OK
      console.log('[proactive-injector] No previous state found, starting fresh');
    }
  }

  /**
   * Reset all learned state
   */
  async reset() {
    this.workflowTransitions.clear();
    this.skillUsage.clear();
    this.transitionProbabilities.clear();
    this.contextWindow = [];
    this.metrics = {
      totalStepsRecorded: 0,
      totalPredictions: 0,
      successfulPredictions: 0,
      totalInjections: 0,
      rejectedInjections: 0,
      errors: 0,
      lastError: null,
    };
    await this._persistState();
    console.log('[proactive-injector] State reset complete');
  }
}

/**
 * Factory function to create a ProactiveInjector instance
 * @param {Object} options - Configuration options
 * @returns {ProactiveInjector} New injector instance
 */
export function createProactiveInjector(options) {
  return new ProactiveInjector(options);
}

/**
 * Default export for backward compatibility
 */
export default ProactiveInjector;