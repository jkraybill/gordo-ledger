// Tests for RelationshipExtractor - LLM-powered relationship detection
// Part of gordo-memory MCP Server v0.7.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RelationshipExtractor } from '../src/graph/extractor.js';
import { mockOllama } from './helpers/llm-mocks.js';

describe('RelationshipExtractor', () => {
  let unmockOllama: () => void;

  beforeEach(() => {
    // Mock Ollama for fast tests (integration tests use real LLM)
    unmockOllama = mockOllama();
  });

  afterEach(() => {
    unmockOllama();
  });
  // Sample session content for testing
  const sampleSession = `# OAuth Bug Fix

**Date:** 2025-01-15

Fixed critical OAuth token refresh bug discovered in Session_12. This session builds on the authentication framework from Session_8.

## Context

Session_12 identified that OAuth tokens were not being refreshed properly, causing users to be logged out unexpectedly.

## Changes

1. Fixed token refresh logic
2. Added retry mechanism
3. Improved error handling

## Decisions

We decided to switch from custom token storage to Redis for better reliability. This is expected to reduce token refresh failures by 90%.

## Patterns

- OAuth authentication
- Bug fixing
- Error handling

## Outcomes

- Bug fixed
- Performance improved
- Documentation updated
`;

  describe('Constructor', () => {
    it('should create extractor with OpenAI provider', () => {
      const extractor = new RelationshipExtractor({
        provider: 'openai',
        apiKey: 'test-key'
      });

      expect(extractor).toBeDefined();
    });

    it('should create extractor with Ollama provider', () => {
      const extractor = new RelationshipExtractor({
        provider: 'ollama',
        ollamaUrl: 'http://localhost:11434'
      });

      expect(extractor).toBeDefined();
    });

    it('should create extractor with OpenRouter provider', () => {
      const extractor = new RelationshipExtractor({
        provider: 'openrouter',
        apiKey: 'test-key'
      });

      expect(extractor).toBeDefined();
    });

    it('should throw error if OpenRouter provider without API key', () => {
      expect(() => {
        new RelationshipExtractor({
          provider: 'openrouter'
        });
      }).toThrow(/API key/i);
    });

    it('should throw error if OpenAI provider without API key', () => {
      expect(() => {
        new RelationshipExtractor({
          provider: 'openai'
        });
      }).toThrow(/API key/i);
    });

    it('should set default temperature', () => {
      const extractor = new RelationshipExtractor({
        provider: 'ollama'
      });

      expect(extractor).toBeDefined();
      // Temperature defaults to 0.1 (checked internally)
    });

    it('should allow custom temperature', () => {
      const extractor = new RelationshipExtractor({
        provider: 'ollama',
        temperature: 0.5
      });

      expect(extractor).toBeDefined();
    });
  });

  describe('extractSessionMetadata()', () => {
    it('should extract title from markdown heading', () => {
      const extractor = new RelationshipExtractor({ provider: 'ollama' });
      const metadata = extractor.extractSessionMetadata(sampleSession, '15');

      expect(metadata.title).toBe('OAuth Bug Fix');
    });

    it('should extract date from content', () => {
      const extractor = new RelationshipExtractor({ provider: 'ollama' });
      const metadata = extractor.extractSessionMetadata(sampleSession, '15');

      expect(metadata.date).toBe('2025-01-15');
    });

    it('should extract summary (first paragraph)', () => {
      const extractor = new RelationshipExtractor({ provider: 'ollama' });
      const metadata = extractor.extractSessionMetadata(sampleSession, '15');

      expect(metadata.summary).toContain('Fixed critical OAuth');
      expect(metadata.summary).toContain('Session_12');
    });

    it('should handle content without date', () => {
      const content = `# Test Session\n\nSome content here.`;
      const extractor = new RelationshipExtractor({ provider: 'ollama' });
      const metadata = extractor.extractSessionMetadata(content, '1');

      expect(metadata.date).toMatch(/\d{4}-\d{2}-\d{2}/); // ISO date format
    });

    it('should handle content without title', () => {
      const content = `Some content without heading.`;
      const extractor = new RelationshipExtractor({ provider: 'ollama' });
      const metadata = extractor.extractSessionMetadata(content, '1');

      expect(metadata.title).toBe('Session 1');
    });

    it('should truncate long summaries', () => {
      const longContent = `# Test\n\n${'a'.repeat(300)}`;
      const extractor = new RelationshipExtractor({ provider: 'ollama' });
      const metadata = extractor.extractSessionMetadata(longContent, '1');

      expect(metadata.summary!.length).toBeLessThanOrEqual(200);
      expect(metadata.summary).toMatch(/\.\.\.$/); // Ends with ...
    });

    it('should set session type and created timestamp', () => {
      const extractor = new RelationshipExtractor({ provider: 'ollama' });
      const metadata = extractor.extractSessionMetadata(sampleSession, '15');

      expect(metadata.type).toBe('session');
      expect(metadata.id).toBe('session_15');
      expect(metadata.created).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO timestamp
    });

    it('should initialize empty outcomes and patterns arrays', () => {
      const extractor = new RelationshipExtractor({ provider: 'ollama' });
      const metadata = extractor.extractSessionMetadata(sampleSession, '15');

      expect(metadata.outcomes).toEqual([]);
      expect(metadata.patterns).toEqual([]);
    });
  });

  describe('extract() - Integration Tests', () => {
    // Note: These tests require actual LLM access (OpenAI API or Ollama running)
    // They're marked as integration tests and may be skipped in CI without LLM setup

    it.skip('should extract dependencies using OpenAI', async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.log('Skipping: OPENAI_API_KEY not set');
        return;
      }

      const extractor = new RelationshipExtractor({
        provider: 'openai',
        apiKey
      });

      const extraction = await extractor.extract(sampleSession, 'session_15');

      expect(extraction.dependencies).toBeDefined();
      expect(Array.isArray(extraction.dependencies)).toBe(true);
      // Should detect dependency on session_12 and session_8
      expect(extraction.dependencies.length).toBeGreaterThan(0);
    }, 30000);

    it.skip('should extract resolutions using OpenAI', async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.log('Skipping: OPENAI_API_KEY not set');
        return;
      }

      const extractor = new RelationshipExtractor({
        provider: 'openai',
        apiKey
      });

      const extraction = await extractor.extract(sampleSession, 'session_15');

      expect(extraction.resolutions).toBeDefined();
      // Should detect resolution of bug from session_12
      expect(extraction.resolutions.length).toBeGreaterThan(0);
    }, 30000);

    it.skip('should extract patterns using OpenAI', async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.log('Skipping: OPENAI_API_KEY not set');
        return;
      }

      const extractor = new RelationshipExtractor({
        provider: 'openai',
        apiKey
      });

      const extraction = await extractor.extract(sampleSession, 'session_15');

      expect(extraction.patterns).toBeDefined();
      // Should detect oauth, bug_fixing patterns
      expect(extraction.patterns.length).toBeGreaterThan(0);
      expect(extraction.patterns.some(p => p.pattern.toLowerCase().includes('oauth'))).toBe(true);
    }, 30000);

    it.skip('should extract decisions using OpenAI', async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.log('Skipping: OPENAI_API_KEY not set');
        return;
      }

      const extractor = new RelationshipExtractor({
        provider: 'openai',
        apiKey
      });

      const extraction = await extractor.extract(sampleSession, 'session_15');

      expect(extraction.decisions).toBeDefined();
      // Should detect Redis decision
      expect(extraction.decisions.length).toBeGreaterThan(0);
      expect(extraction.decisions.some(d => d.decision.toLowerCase().includes('redis'))).toBe(true);
    }, 30000);

    it.skip('should extract outcomes using OpenAI', async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.log('Skipping: OPENAI_API_KEY not set');
        return;
      }

      const extractor = new RelationshipExtractor({
        provider: 'openai',
        apiKey
      });

      const extraction = await extractor.extract(sampleSession, 'session_15');

      expect(extraction.outcomes).toBeDefined();
      // Should detect bug_fixed, performance_improved, etc.
      expect(extraction.outcomes.length).toBeGreaterThan(0);
    }, 30000);

    it.skip('should handle extraction errors gracefully', async () => {
      const extractor = new RelationshipExtractor({
        provider: 'openai',
        apiKey: 'invalid-key'
      });

      const extraction = await extractor.extract(sampleSession, 'session_15');

      // Should return empty extraction on error
      expect(extraction.dependencies).toEqual([]);
      expect(extraction.resolutions).toEqual([]);
      expect(extraction.patterns).toEqual([]);
      expect(extraction.decisions).toEqual([]);
      expect(extraction.outcomes).toEqual([]);
    });

    it.skip('should use Ollama for extraction', async () => {
      const extractor = new RelationshipExtractor({
        provider: 'ollama',
        model: 'llama3.2',
        ollamaUrl: 'http://localhost:11434'
      });

      const extraction = await extractor.extract(sampleSession, 'session_15');

      expect(extraction.dependencies).toBeDefined();
      expect(extraction.patterns).toBeDefined();
      expect(extraction.decisions).toBeDefined();
    }, 60000);

    it.skip('should respect custom model for OpenAI', async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.log('Skipping: OPENAI_API_KEY not set');
        return;
      }

      const extractor = new RelationshipExtractor({
        provider: 'openai',
        apiKey,
        model: 'gpt-4o-mini'
      });

      const extraction = await extractor.extract(sampleSession, 'session_15');

      expect(extraction).toBeDefined();
    }, 30000);

    it.skip('should respect custom model for Ollama', async () => {
      const extractor = new RelationshipExtractor({
        provider: 'ollama',
        model: 'llama3.2',
        ollamaUrl: 'http://localhost:11434'
      });

      const extraction = await extractor.extract(sampleSession, 'session_15');

      expect(extraction).toBeDefined();
    }, 60000);

    it.skip('should use low temperature for consistent extraction', async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        console.log('Skipping: OPENAI_API_KEY not set');
        return;
      }

      const extractor = new RelationshipExtractor({
        provider: 'openai',
        apiKey,
        temperature: 0.1
      });

      const extraction1 = await extractor.extract(sampleSession, 'session_15');
      const extraction2 = await extractor.extract(sampleSession, 'session_15');

      // Results should be very similar (not identical due to LLM non-determinism)
      expect(extraction1.patterns.length).toBeGreaterThan(0);
      expect(extraction2.patterns.length).toBeGreaterThan(0);
    }, 60000);
  });

  describe('JSON Parsing', () => {
    it('should handle markdown-wrapped JSON responses', () => {
      const extractor = new RelationshipExtractor({ provider: 'ollama' });

      const markdownResponse = '```json\n{"dependencies": [], "resolutions": [], "patterns": [], "decisions": [], "outcomes": []}\n```';

      // Access private method for testing via type assertion
      const result = (extractor as any).parseExtraction(markdownResponse);

      expect(result.dependencies).toEqual([]);
      expect(result.patterns).toEqual([]);
    });

    it('should handle plain JSON responses', () => {
      const extractor = new RelationshipExtractor({ provider: 'ollama' });

      const plainResponse = '{"dependencies": [], "resolutions": [], "patterns": [], "decisions": [], "outcomes": []}';

      const result = (extractor as any).parseExtraction(plainResponse);

      expect(result.dependencies).toEqual([]);
    });

    it('should handle malformed JSON gracefully', () => {
      const extractor = new RelationshipExtractor({ provider: 'ollama' });

      const malformedResponse = '{not valid json';

      const result = (extractor as any).parseExtraction(malformedResponse);

      // Should return empty extraction
      expect(result.dependencies).toEqual([]);
      expect(result.resolutions).toEqual([]);
    });

    it('should validate array types', () => {
      const extractor = new RelationshipExtractor({ provider: 'ollama' });

      const invalidResponse = '{"dependencies": "not an array", "resolutions": [], "patterns": [], "decisions": [], "outcomes": []}';

      const result = (extractor as any).parseExtraction(invalidResponse);

      // Should convert non-arrays to empty arrays
      expect(result.dependencies).toEqual([]);
      expect(result.resolutions).toEqual([]);
    });
  });
});
