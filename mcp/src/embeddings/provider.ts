/**
 * Embedding Provider Implementation (Session 33 - TDD approach)
 * Supports Ollama (Mixedbread) + OpenAI with automatic fallback
 */

import { EmbeddingProvider } from '../types.js';

export interface EmbeddingConfig {
  type: 'ollama' | 'openai' | 'openrouter' | 'hybrid';
  model: string;
  ollamaUrl?: string;
  openaiApiKey?: string;
  openrouterApiKey?: string;
  primaryType?: 'ollama' | 'openai' | 'openrouter';
  fallbackType?: 'ollama' | 'openai' | 'openrouter';
}

// Model-specific context limits and dimensions
// 8192 tokens ≈ ~8000 chars with typical tokenization (conservative)
const MODEL_CONFIG: Record<string, { maxChars: number, dims: number }> = {
  'mxbai-embed-large': { maxChars: 1000, dims: 1024 },  // 512 tokens
  'nomic-embed-text': { maxChars: 4000, dims: 768 },    // Ollama reports 2048 tokens context
  'bge-m3': { maxChars: 8000, dims: 1024 },             // 8192 tokens
  'qwen3-embedding': { maxChars: 8000, dims: 4096 },    // 8192 tokens
};

const DEFAULT_CONFIG = { maxChars: 1000, dims: 1024 };

// S162 workshop: process-wide embedding cache, shared across provider
// instances. Federated search builds one MemoryManager per spoke and each
// embedded the SAME query string independently — 12 identical Ollama round
// trips for one hub search, which was the bulk of a 22s federated query (index
// loading was the smaller half). Same model + same text is deterministic, so a
// hit is exact, not an approximation. Bounded so a large index run can't grow
// it without limit.
const EMBED_CACHE_MAX = 128;
const embedCache = new Map<string, number[]>();

function cacheGet(key: string): number[] | undefined {
  const hit = embedCache.get(key);
  if (!hit) return undefined;
  // Refresh recency: delete + re-set moves it to the end of the insertion order.
  embedCache.delete(key);
  embedCache.set(key, hit);
  return hit.slice();
}

function cacheSet(key: string, vec: number[]): void {
  if (embedCache.size >= EMBED_CACHE_MAX) {
    const oldest = embedCache.keys().next().value;
    if (oldest !== undefined) embedCache.delete(oldest);
  }
  embedCache.set(key, vec.slice());
}

class OllamaEmbeddingProvider implements EmbeddingProvider {
  private config: { maxChars: number, dims: number };
  private headChars: number;
  private tailChars: number;

  constructor(
    private model: string,
    private baseUrl: string
  ) {
    // Get model-specific config or default
    this.config = MODEL_CONFIG[model] || DEFAULT_CONFIG;
    this.headChars = Math.floor(this.config.maxChars * 0.7);
    this.tailChars = Math.floor(this.config.maxChars * 0.3);
  }

  private truncateText(text: string): string {
    if (text.length <= this.config.maxChars) return text;
    // Smart truncation: keep head + tail to preserve both opening context and conclusions
    const head = text.substring(0, this.headChars);
    const tail = text.substring(text.length - this.tailChars);
    return head + ' [...] ' + tail;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const truncated = this.truncateText(text);
      const cacheKey = `ollama::${this.model}::${truncated}`;
      const cached = cacheGet(cacheKey);
      if (cached) return cached;
      const response = await fetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          input: truncated
        })
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(`Ollama API error: ${errorBody.error || response.statusText}`);
      }

      const data = await response.json() as { embeddings: number[][] };
      // Ollama returns { embeddings: [[...]] } for single input
      // For empty input, Ollama returns empty array - return zeros vector
      if (!data.embeddings || data.embeddings.length === 0) {
        return new Array(this.config.dims).fill(0);
      }
      cacheSet(cacheKey, data.embeddings[0]);
      return data.embeddings[0];
    } catch (error) {
      throw new Error(`Failed to generate Ollama embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Ollama doesn't have batch API, so we call individually
    const embeddings = await Promise.all(
      texts.map(text => this.generateEmbedding(text))
    );
    return embeddings;
  }
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private model: string,
    private apiKey: string,
    private baseUrl: string = 'https://api.openai.com/v1'
  ) {}

  async generateEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.generateEmbeddings([text]);
    return embeddings[0];
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          input: texts
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Embedding API error: ${JSON.stringify(error)}`);
      }

      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      return data.data.map(item => item.embedding);
    } catch (error) {
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

class HybridEmbeddingProvider implements EmbeddingProvider {
  private primary: EmbeddingProvider;
  private fallback: EmbeddingProvider;

  constructor(config: EmbeddingConfig) {
    if (!config.primaryType || !config.fallbackType) {
      throw new Error('Hybrid provider requires primaryType and fallbackType');
    }

    this.primary = this.createProvider(config.primaryType, config);
    this.fallback = this.createProvider(config.fallbackType, config);
  }

  private createProvider(type: 'ollama' | 'openai' | 'openrouter', config: EmbeddingConfig): EmbeddingProvider {
    if (type === 'ollama') {
      if (!config.ollamaUrl) {
        throw new Error('Ollama provider requires ollamaUrl');
      }
      return new OllamaEmbeddingProvider(config.model, config.ollamaUrl);
    } else if (type === 'openrouter') {
      const apiKey = config.openrouterApiKey || process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error('OpenRouter provider requires openrouterApiKey');
      }
      return new OpenAIEmbeddingProvider(config.model, apiKey, 'https://openrouter.ai/api/v1');
    } else {
      const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new Error('OpenAI provider requires openaiApiKey');
      }
      return new OpenAIEmbeddingProvider(config.model, apiKey);
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      return await this.primary.generateEmbedding(text);
    } catch (error) {
      console.warn(`Primary provider failed, falling back: ${error instanceof Error ? error.message : String(error)}`);
      return await this.fallback.generateEmbedding(text);
    }
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      return await this.primary.generateEmbeddings(texts);
    } catch (error) {
      console.warn(`Primary provider failed, falling back: ${error instanceof Error ? error.message : String(error)}`);
      return await this.fallback.generateEmbeddings(texts);
    }
  }
}

export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  // Validation
  if (!config.type) {
    throw new Error('Provider type is required');
  }

  if (!['ollama', 'openai', 'openrouter', 'hybrid'].includes(config.type)) {
    throw new Error(`Unsupported provider type: ${config.type}`);
  }

  if (config.type === 'ollama') {
    if (!config.ollamaUrl) {
      throw new Error('Ollama provider requires ollamaUrl');
    }
    return new OllamaEmbeddingProvider(config.model, config.ollamaUrl);
  }

  if (config.type === 'openai') {
    const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI provider requires openaiApiKey or OPENAI_API_KEY environment variable');
    }
    return new OpenAIEmbeddingProvider(config.model, apiKey);
  }

  if (config.type === 'openrouter') {
    const apiKey = config.openrouterApiKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OpenRouter provider requires openrouterApiKey or OPENROUTER_API_KEY environment variable');
    }
    // OpenRouter is API-compatible with OpenAI, just different base URL
    return new OpenAIEmbeddingProvider(config.model, apiKey, 'https://openrouter.ai/api/v1');
  }

  if (config.type === 'hybrid') {
    return new HybridEmbeddingProvider(config);
  }

  throw new Error(`Unsupported provider type: ${config.type}`);
}
