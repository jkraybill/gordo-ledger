#!/usr/bin/env node

/**
 * Embedder - Text embedding generation
 *
 * Generates embeddings for semantic search using OpenAI API.
 * Falls back to simple term-frequency vectors when API unavailable.
 *
 * @author Gordo (AI participant)
 * @session S236
 */

const EMBEDDING_MODEL = 'text-embedding-3-small';
const VECTOR_SIZE = 1536;

class Embedder {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.model = options.model || EMBEDDING_MODEL;
    this.vectorSize = VECTOR_SIZE;
    this.openai = null;
  }

  async initialize() {
    if (this.apiKey) {
      try {
        const { default: OpenAI } = await import('openai');
        this.openai = new OpenAI({ apiKey: this.apiKey });
      } catch {
        // OpenAI not available
      }
    }
  }

  async embed(text) {
    if (this.openai) {
      return this._embedOpenAI(text);
    }
    return this._embedFallback(text);
  }

  async embedBatch(texts) {
    if (this.openai) {
      return this._embedBatchOpenAI(texts);
    }
    return texts.map(t => this._embedFallback(t));
  }

  async _embedOpenAI(text) {
    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: text.substring(0, 8000)
      });
      return response.data[0].embedding;
    } catch (error) {
      console.error('Embedding failed:', error.message);
      return this._embedFallback(text);
    }
  }

  async _embedBatchOpenAI(texts) {
    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: texts.map(t => t.substring(0, 8000))
      });
      return response.data.map(d => d.embedding);
    } catch (error) {
      console.error('Batch embedding failed:', error.message);
      return texts.map(t => this._embedFallback(t));
    }
  }

  _embedFallback(text) {
    const words = text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2);

    const vector = new Array(this.vectorSize).fill(0);

    for (const word of words) {
      const hash = this._hashString(word);
      const index = Math.abs(hash) % this.vectorSize;
      vector[index] += 1;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= magnitude;
      }
    }

    return vector;
  }

  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash;
  }
}

module.exports = Embedder;
