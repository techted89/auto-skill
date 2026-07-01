/**
 * Auto-Skill Plugin - Main Entry Point
 * 
 * Provides proactive context injection for OpenCode agent workflows.
 * Automatically detects workflow patterns and injects relevant skills.
 */

import { ProactiveInjector } from './proactive-injector.js';
import { 
  createToolEventHandlers, 
  createChatEventHandlers,
  initializeEventIntegration 
} from './event-hooks.js';

/**
 * Plugin metadata
 */
const PLUGIN_INFO = {
  name: 'auto-skill',
  version: '1.1.0',
  description: 'Proactive context injection for OpenCode agent workflows',
  author: 'techted89',
  features: [
    'Workflow pattern recognition',
    'Predictive context injection',
    'Adaptive learning',
    'Confidence scoring',
  ],
};

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  enabled: true,
  injectionDelay: 100,
  maxInjections: 1000,
  predictionHorizon: 5,
  confidenceThreshold: 0.6,
};

/**
 * Plugin instance container
 */
let injector = null;
let opencodeRef = null;

/**
 * Activate the plugin
 * @param {Object} config - Plugin configuration
 * @param {Object} opencode - OpenCode runtime reference
 * @returns {boolean} Activation status
 */
export function activate(config = {}, opencode = null) {
  if (injector) {
    console.warn('[auto-skill] Plugin already active');
    return false;
  }

  // Merge configuration
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };
  
  // Create injector
  injector = new ProactiveInjector(mergedConfig);
  
  // Store opencode reference for event integration
  if (opencode) {
    opencodeRef = opencode;
    initializeEventIntegration(injector, opencode);
  }
  
  // Activate the injector
  const result = injector.activate();
  
  if (result) {
    console.log(`[${PLUGIN_INFO.name}] v${PLUGIN_INFO.version} activated`);
  }
  
  return result;
}

/**
 * Deactivate the plugin
 */
export function deactivate() {
  if (!injector) {
    console.warn('[auto-skill] Plugin not active');
    return;
  }

  injector.deactivate();
  injector = null;
  opencodeRef = null;
  console.log(`[${PLUGIN_INFO.name}] Deactivated`);
}

/**
 * Get plugin information
 * @returns {Object} Plugin metadata
 */
export function getPluginInfo() {
  return { ...PLUGIN_INFO };
}

/**
 * Get current statistics
 * @returns {Object} Runtime statistics
 */
export function getStats() {
  if (!injector) {
    return { error: 'Plugin not active' };
  }
  return injector.getWorkflowStats();
}

/**
 * Get proactive suggestions for current context
 * @param {Object} context - Context to analyze
 * @returns {Promise<Array>} Suggestions array
 */
export async function getSuggestions(context) {
  if (!injector) {
    throw new Error('[auto-skill] Plugin not active');
  }
  return injector.getProactiveSuggestions(context);
}

/**
 * Record a workflow step manually
 * @param {string} agentType - Agent type
 * @param {string} toolUsed - Tool name
 * @param {Object} context - Step context
 */
export function recordStep(agentType, toolUsed, context) {
  if (!injector) return;
  injector.recordWorkflowStep(agentType, toolUsed, context);
}

/**
 * Learn from a successful workflow
 * @param {Object} workflow - Workflow details
 */
export function learn(workflow) {
  if (!injector) return;
  injector.learnFromSuccess(workflow);
}

/**
 * Reset plugin state
 */
export function reset() {
  if (!injector) return;
  injector = new ProactiveInjector(DEFAULT_CONFIG);
  console.log(`[${PLUGIN_INFO.name}] State reset`);
}

// Export plugin interface
export default {
  activate,
  deactivate,
  getPluginInfo,
  getStats,
  getSuggestions,
  recordStep,
  learn,
  reset,
};