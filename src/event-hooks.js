/**
 * Event Hooks - Production Grade
 * 
 * Hooks into OpenCode lifecycle events for seamless skill injection
 */
import { ProactiveInjector } from './proactive-injector.js';
import { SkillsetIndex } from './skillset-index.js';
import { AutoDiscovery } from './auto-discovery.js';
import { ContextInjector } from './context-injector.js';

export class EventHooks {
  constructor(config = {}) {
    this.injector = new ProactiveInjector(join(config.dataDir, 'context'));
    this.contextInjector = new ContextInjector(config.contextConfig);
    this.skillsetIndex = new SkillsetIndex(config.skillDir);
    this.autoDiscovery = new AutoDiscovery(config.autoDiscoveryDir);
  }
  
  async initialize() {
    // Initialize components
    await this._initializeComponents();
  }

  async _initializeComponents() {
    await Promise.all([
      this.injector.initialize(),
      this.skillsetIndex.init(),
      this.autoDiscovery.loadState()
    ]);
  }

  /**
   * Called before any tool execution in OpenCode workflow
   */
  async beforeExecute(context) {
    // Record the workflow step
    this.injector.recordWorkflowStep(
      context.agentType, 
      context.toolName, 
      { ...context, action: 'tool.execute' }
    );
    
    // Get proactive suggestions based on current context
    const suggestions = await this.injector.getProactiveSuggestions({
      ...context,
      terms: this.injector._extractTerms(context.message || '')
    });
    
    // Store suggestions for potential injection
    context._proactiveSuggestions = suggestions;
    
    return context;
  }

  /**
   * Called after tool execution completes
   */
  async afterExecute(context) {
    // Record the outcome
    const outcome = context.success ? 'success' : 'failure';
    this.injector.recordWorkflowStep(
      context.agentType,
      `${context.toolName}:${outcome}`,
      { ...context, outcome }
    );
    
    // If successful, learn from it
    if (context.success) {
      this.injector.learnFromSuccess({
        agentType: context.agentType,
        toolsUsed: [context.toolName],
        outcome,
        toolUsed: context.toolName,
      });
    }
    
    // Clear suggestions to prevent reuse
    delete context._proactiveSuggestions;
    
    return context;
  }

  /**
   * Process auto-skill intents from chat messages
   */
  async processAutoSkillIntent(intentType, query, context) {
    const result = await this.autoDiscovery.processAutoSkillIntent(
      intentType, 
      query, 
      context
    );
    
    // Log intent processing
    console.log(`[AutoSkill] Processed ${intentType}: ${query}`);
    
    return result;
  }

  /**
   * Get context-aware skill injections
   */
  async injectSuggestions(context) {
    const suggestions = await this.injector.getProactiveSuggestions(context);
    context._skillSuggestions = suggestions;
    return suggestions;
  }
}