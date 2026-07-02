/**
 * Embedding utilities for auto-skill plugin
 *
 * This module provides utilities for converting text to embeddings
 * for use in ChromaDB vector search. Uses sentence-transformers
 * ALL-MiniLM-L6-v2 model for generating embeddings.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import util from 'util';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execPromise = util.promisify(exec);

/**
 * Default model for text-to-embedding conversion
 * Using sentence-transformers/all-MiniLM-L6-v2
 * | Input Token Limit | Embedding Vector Dimension |
 * |--------------------|-----------------------------|
 * | 256 tokens         | 384 dim                     |
 */
const DEFAULT_MODEL_NAME = 'sentence-transformers/all-MiniLM-L6-v2';
const DEFAULT_MAX_TOKENS = 256;
let cachedModel = null;
let cachedQuantizedModel = null;

/**
 * Convert text to embedding vector using sentence-transformers
 *
 * @param {string} text - Text to embed
 * @param {number} maxTokens - Maximum tokens to process (default: 256)
 * @param {string} modelName - Model name (default: all-MiniLM-L6-v2)
 * @returns {Promise<Float32Array>} Array of 384 floats
 */
export async function getEmbedding(text, maxTokens = DEFAULT_MAX_TOKENS, modelName = DEFAULT_MODEL_NAME) {
  if (!text || typeof text !== 'string') {
    throw new Error('Text must be a non-empty string');
  }

  // Truncate if text is too long
  const tokens = text.split(' ');
  if (tokens.length > maxTokens) {
    text = tokens.slice(0, maxTokens).join(' ');
  }

  try {
    // Use python script for embedding generation
    const pythonScript = path.join(__dirname, 'python/embedding.py');
    const modelCache = path.join(__dirname, 'models', modelName.replaceAll('/', '-'));

    // Prepare args for Python script
    const args = JSON.stringify({
      text,
      modelPath: modelCache,
      device: 'cpu'
    });

    const { stdout } = await execPromise(
      `python3 ${pythonScript} ${args}`
    );

    const result = JSON.parse(stdout);
    return new Float32Array(result.embedding);
  } catch (error) {
    console.error('[Embeddings] Failed to generate embedding:', error.message);
    return new Float32Array(384).fill(0);
  }
}

/**
 * Batch convert multiple texts to embeddings
 */
export async function getEmbeddings(texts, maxTokens = DEFAULT_MAX_TOKENS) {
  if (!Array.isArray(texts)) {
    throw new Error('Expected array of texts');
  }

  const embeddings = [];
  for (const text of texts) {
    embeddings.push(await getEmbedding(text, maxTokens));
  }
  return embeddings;
}

/**
 * Check if a model is available locally or download it
 */
export async function ensureModelAvailable(modelName) {
  const modelCache = path.join(__dirname, 'models', modelName.replaceAll('/', '-'));
  if (await checkModelAvailable(modelCache)) {
    return true;
  }

  console.log(`[Embeddings] Downloading model: ${modelName}...`);
  const gitRepoUrl = `https://huggingface.co/${modelName.replaceAll('/', '/')}.git`;
  
  try {
    await execPromise(`git clone --depth 1 ${gitRepoUrl} "${modelCache}" --quiet`);
    console.log('[Embeddings] Model downloaded successfully');
    return true;
  } catch (error) {
    console.warn('[Embeddings] Failed to download model:', error.message);
    return false;
  }
}

async function checkModelAvailable(modelPath) {
  try {
    await fs.access(path.join(modelPath, 'config.json'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the dimension for a given model name
 */
export function getEmbeddingDimension(modelName = DEFAULT_MODEL_NAME) {
  const modelDimensions = {
    'sentence-transformers/all-MiniLM-L6-v2': 384,
    'sentence-transformers/all-mpnet-base-v2': 768,
    'sentence-transformers/paraphrase-MiniLM-L3-v2': 384,
    'sentence-transformers/distilbert-base-nli-mean-tokens': 768,
    'sentence-transformers/multi-qa-MiniLM-L6-cos-v1': 384,
    'sentence-transformers/distilbert-base-nli-stsb-large-steps': 768,
  };

  return modelDimensions[modelName] || 384;
}

export function getDefaultModelName() {
  return DEFAULT_MODEL_NAME;
}

export async function initEmbeddings() {
  try {
    await ensureModelAvailable(DEFAULT_MODEL_NAME);
    return true;
  } catch (error) {
    console.warn('[Embeddings] Initialization failed:', error.message);
    return false;
  }
}