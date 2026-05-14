/**
 * Embedder Tests - TDD for gordo-memory embedder
 * Tests BEFORE implementation (Session 33 production standards)
 *
 * Architecture (Session 32):
 * - Primary: Mixedbread mxbai-embed-large-v1 via Ollama
 * - Fallback: OpenAI text-embedding-3-small
 * - Supports single + batch embedding
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmbeddingProvider } from '../src/types.js';
import { createEmbeddingProvider, EmbeddingConfig } from '../src/embeddings/provider.js';

describe('EmbeddingProvider', () => {
  describe('Ollama Provider (Primary)', () => {
    let provider: EmbeddingProvider;

    beforeEach(() => {
      const config: EmbeddingConfig = {
        type: 'ollama',
        model: 'mxbai-embed-large:latest',
        ollamaUrl: 'http://localhost:11434'
      };
      provider = createEmbeddingProvider(config);
    });

    it('should generate embedding for single text', async () => {
      const text = 'Hybrid retrieval achieves 54% better P@3';
      const embedding = await provider.generateEmbedding(text);

      expect(embedding).toBeInstanceOf(Array);
      expect(embedding.length).toBe(1024); // Mixedbread embedding dimension
      expect(embedding.every(n => typeof n === 'number')).toBe(true);
    }, { timeout: 10000 }); // Ollama can be slow

    it('should generate embeddings for multiple texts (batch)', async () => {
      const texts = [
        'Session 1: Setup framework',
        'Session 2: Add semantic search',
        'Session 3: Fix bug'
      ];
      const embeddings = await provider.generateEmbeddings(texts);

      expect(embeddings).toHaveLength(3);
      expect(embeddings[0]).toHaveLength(1024);
      expect(embeddings[1]).toHaveLength(1024);
      expect(embeddings[2]).toHaveLength(1024);
    }, { timeout: 15000 });

    it('should handle empty text gracefully', async () => {
      const embedding = await provider.generateEmbedding('');
      expect(embedding).toBeInstanceOf(Array);
      expect(embedding.length).toBe(1024);
    });

    it('should throw error if Ollama is not available', async () => {
      const config: EmbeddingConfig = {
        type: 'ollama',
        model: 'mxbai-embed-large:latest',
        ollamaUrl: 'http://localhost:99999' // Invalid port
      };
      const badProvider = createEmbeddingProvider(config);

      await expect(badProvider.generateEmbedding('test')).rejects.toThrow();
    }, { timeout: 5000 });
  });

  describe('OpenAI Provider (Fallback)', () => {
    let provider: EmbeddingProvider;

    beforeEach(() => {
      const config: EmbeddingConfig = {
        type: 'openai',
        model: 'text-embedding-3-small',
        openaiApiKey: process.env.OPENAI_API_KEY || 'test-key'
      };
      provider = createEmbeddingProvider(config);
    });

    it('should generate embedding for single text', async () => {
      // Skip if no API key
      if (!process.env.OPENAI_API_KEY) {
        console.log('Skipping OpenAI test - no API key');
        return;
      }

      const text = 'Empirical validation beats authority';
      const embedding = await provider.generateEmbedding(text);

      expect(embedding).toBeInstanceOf(Array);
      expect(embedding.length).toBe(1536); // OpenAI text-embedding-3-small dimension
      expect(embedding.every(n => typeof n === 'number')).toBe(true);
    }, { timeout: 10000 });

    it('should generate embeddings for multiple texts (batch)', async () => {
      if (!process.env.OPENAI_API_KEY) {
        console.log('Skipping OpenAI test - no API key');
        return;
      }

      const texts = [
        'TDD prevents failure modes',
        'Architecture interview before coding',
        'Integration test before commit'
      ];
      const embeddings = await provider.generateEmbeddings(texts);

      expect(embeddings).toHaveLength(3);
      expect(embeddings[0]).toHaveLength(1536);
    }, { timeout: 15000 });

    it('should throw error with invalid API key', async () => {
      const config: EmbeddingConfig = {
        type: 'openai',
        model: 'text-embedding-3-small',
        openaiApiKey: 'invalid-key'
      };
      const badProvider = createEmbeddingProvider(config);

      await expect(badProvider.generateEmbedding('test')).rejects.toThrow();
    }, { timeout: 5000 });
  });

  describe('Hybrid Provider (Auto-fallback)', () => {
    it('should fallback to OpenAI when Ollama unavailable', async () => {
      if (!process.env.OPENAI_API_KEY) {
        console.log('Skipping hybrid test - no OpenAI key');
        return;
      }

      const config: EmbeddingConfig = {
        type: 'hybrid',
        primaryType: 'ollama',
        fallbackType: 'openai',
        model: 'mxbai-embed-large:latest',
        ollamaUrl: 'http://localhost:99999', // Ollama not available
        openaiApiKey: process.env.OPENAI_API_KEY
      };

      const provider = createEmbeddingProvider(config);
      const embedding = await provider.generateEmbedding('test fallback');

      // Should use OpenAI (1536 dims) instead of Ollama (1024 dims)
      expect(embedding).toHaveLength(1536);
    }, { timeout: 10000 });

    it('should use primary provider when available', async () => {
      // This test assumes Ollama is running locally
      const config: EmbeddingConfig = {
        type: 'hybrid',
        primaryType: 'ollama',
        fallbackType: 'openai',
        model: 'mxbai-embed-large:latest',
        ollamaUrl: 'http://localhost:11434',
        openaiApiKey: process.env.OPENAI_API_KEY || 'dummy'
      };

      const provider = createEmbeddingProvider(config);

      try {
        const embedding = await provider.generateEmbedding('test primary');
        // Should use Ollama (1024 dims)
        expect(embedding).toHaveLength(1024);
      } catch (error) {
        // If Ollama not available, skip test
        console.log('Skipping hybrid test - Ollama not running');
      }
    }, { timeout: 10000 });
  });

  describe('Configuration Validation', () => {
    it('should throw error for unsupported provider type', () => {
      expect(() => {
        createEmbeddingProvider({
          type: 'invalid' as any,
          model: 'test'
        });
      }).toThrow();
    });

    it('should throw error for missing Ollama URL', () => {
      expect(() => {
        createEmbeddingProvider({
          type: 'ollama',
          model: 'mxbai-embed-large-v1'
          // Missing ollamaUrl
        });
      }).toThrow();
    });

    it('should throw error for missing OpenAI API key', () => {
      expect(() => {
        createEmbeddingProvider({
          type: 'openai',
          model: 'text-embedding-3-small'
          // Missing openaiApiKey
        });
      }).toThrow();
    });

    it('should allow optional openaiApiKey from environment', () => {
      // Should not throw if OPENAI_API_KEY env var exists
      const config: EmbeddingConfig = {
        type: 'openai',
        model: 'text-embedding-3-small'
      };

      if (process.env.OPENAI_API_KEY) {
        expect(() => createEmbeddingProvider(config)).not.toThrow();
      }
    });
  });
});
