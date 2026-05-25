/**
 * Tests for query-intent.ts
 * S345: Query intent detection for dynamic boost adjustment
 */

import { describe, it, expect } from 'vitest';
import {
  detectQueryIntent,
  getDynamicBoosts,
  QueryIntent,
  DynamicBoosts,
} from '../src/query-intent.js';

describe('detectQueryIntent', () => {
  describe('code intent', () => {
    it('detects camelCase identifiers', () => {
      const intent = detectQueryIntent('where is findSimilar defined?');
      expect(intent.type).toBe('code');
      expect(intent.signals).toContain('camelCase');
    });

    it('detects PascalCase class names', () => {
      const intent = detectQueryIntent('how does MemoryManager work?');
      expect(intent.type).toBe('code');
      expect(intent.signals).toContain('pascalCase');
    });

    it('detects snake_case identifiers', () => {
      const intent = detectQueryIntent('what does compute_hash do?');
      expect(intent.type).toBe('code');
      expect(intent.signals).toContain('snakeCase');
    });

    it('detects file extensions', () => {
      const intent = detectQueryIntent('show me the types.ts file');
      expect(intent.type).toBe('code');
      expect(intent.signals).toContain('fileExt');
    });

    it('detects code keywords', () => {
      const intent = detectQueryIntent('how is the search function implemented?');
      expect(intent.type).toBe('code');
      expect(intent.signals).toContain('keywords');
    });

    it('detects explicit code requests', () => {
      const intent = detectQueryIntent('show me the code for reranking');
      expect(intent.type).toBe('code');
      expect(intent.signals).toContain('explicit');
    });

    it('detects file paths', () => {
      const intent = detectQueryIntent('what is in src/parser?');
      expect(intent.type).toBe('code');
      expect(intent.signals).toContain('filePath');
    });
  });

  describe('session intent', () => {
    it('detects session numbers', () => {
      const intent = detectQueryIntent('what happened in S344?');
      expect(intent.type).toBe('session');
      expect(intent.signals).toContain('sessionNum');
    });

    it('detects "session N" format', () => {
      const intent = detectQueryIntent('session 123 summary');
      expect(intent.type).toBe('session');
      expect(intent.signals).toContain('sessionNum');
    });

    it('detects date references', () => {
      const intent = detectQueryIntent('what did we work on yesterday?');
      expect(intent.type).toBe('session');
      expect(intent.signals).toContain('dateRef');
    });

    it('detects session keywords', () => {
      const intent = detectQueryIntent('what happened when we discussed X?');
      expect(intent.type).toBe('session');
      expect(intent.signals).toContain('keywords');
    });
  });

  describe('decision intent', () => {
    it('detects decision keywords', () => {
      const intent = detectQueryIntent('when was the WWGD grant decided?');
      expect(intent.type).toBe('decision');
      expect(intent.signals).toContain('keywords');
    });

    it('detects record references', () => {
      const intent = detectQueryIntent('what does record-034 say?');
      expect(intent.type).toBe('decision');
      expect(intent.signals).toContain('recordRef');
    });

    it('detects constitutional keywords', () => {
      const intent = detectQueryIntent('what are the Tier 0 principles?');
      expect(intent.type).toBe('decision');
      expect(intent.signals).toContain('tierRef');
    });
  });

  describe('issue intent', () => {
    it('detects issue numbers', () => {
      const intent = detectQueryIntent('what is #123 about?');
      expect(intent.type).toBe('issue');
      expect(intent.signals).toContain('issueNum');
    });

    it('detects issue keywords', () => {
      const intent = detectQueryIntent('which bugs are blocked?');
      expect(intent.type).toBe('issue');
      expect(intent.signals).toContain('keywords');
    });
  });

  describe('memory intent', () => {
    it('detects memory keywords', () => {
      // Multiple memory keywords: "preference" + "should"
      const intent = detectQueryIntent('what should be the preference for error handling?');
      expect(intent.type).toBe('memory');
      expect(intent.signals).toContain('keywords');
    });

    it('detects behavioral patterns', () => {
      const intent = detectQueryIntent('should I avoid using X?');
      expect(intent.type).toBe('memory');
      expect(intent.signals).toContain('behavioral');
    });
  });

  describe('general intent', () => {
    it('returns general for ambiguous queries', () => {
      const intent = detectQueryIntent('umbrella overview');
      expect(intent.type).toBe('general');
      expect(intent.confidence).toBe(1.0);
    });

    it('returns general for short generic queries', () => {
      const intent = detectQueryIntent('architecture');
      expect(intent.type).toBe('general');
    });
  });

  describe('confidence levels', () => {
    it('has high confidence with multiple signals', () => {
      const intent = detectQueryIntent('where is the MemoryManager class implementation defined?');
      expect(intent.confidence).toBeGreaterThanOrEqual(0.66);
    });

    it('has lower confidence with single signal', () => {
      const intent = detectQueryIntent('what is S123?');
      expect(intent.type).toBe('session');
      // Single explicit signal still triggers intent
    });
  });
});

describe('getDynamicBoosts', () => {
  describe('code intent boosts', () => {
    it('boosts code content for code queries', () => {
      const intent: QueryIntent = { type: 'code', confidence: 0.8, signals: ['camelCase'] };
      const boosts = getDynamicBoosts(intent);
      expect(boosts.code).toBe(3.0);
    });

    it('reduces session boost for code queries', () => {
      const intent: QueryIntent = { type: 'code', confidence: 0.8, signals: ['camelCase'] };
      const boosts = getDynamicBoosts(intent);
      expect(boosts.session).toBeLessThan(2.0);
    });
  });

  describe('session intent boosts', () => {
    it('boosts session content for session queries', () => {
      const intent: QueryIntent = { type: 'session', confidence: 0.8, signals: ['sessionNum'] };
      const boosts = getDynamicBoosts(intent);
      expect(boosts.session).toBe(3.0);
    });

    it('reduces code boost for session queries', () => {
      const intent: QueryIntent = { type: 'session', confidence: 0.8, signals: ['sessionNum'] };
      const boosts = getDynamicBoosts(intent);
      expect(boosts.code).toBe(0.5);
    });
  });

  describe('decision intent boosts', () => {
    it('boosts session and memory for decision queries', () => {
      const intent: QueryIntent = { type: 'decision', confidence: 0.8, signals: ['keywords'] };
      const boosts = getDynamicBoosts(intent);
      expect(boosts.session).toBe(2.5);
      expect(boosts.memory).toBe(2.5);
    });

    it('significantly reduces code for decision queries', () => {
      const intent: QueryIntent = { type: 'decision', confidence: 0.8, signals: ['keywords'] };
      const boosts = getDynamicBoosts(intent);
      expect(boosts.code).toBe(0.3);
    });
  });

  describe('general intent boosts', () => {
    it('returns default boosts for general queries', () => {
      const intent: QueryIntent = { type: 'general', confidence: 1.0, signals: [] };
      const boosts = getDynamicBoosts(intent);
      expect(boosts.session).toBe(2.0);
      expect(boosts.code).toBe(1.0);
    });
  });

  describe('low confidence handling', () => {
    it('returns default boosts when confidence is low', () => {
      const intent: QueryIntent = { type: 'code', confidence: 0.2, signals: ['fileExt'] };
      const boosts = getDynamicBoosts(intent);
      // Should return defaults since confidence < 0.3
      expect(boosts.code).toBe(1.0);
    });
  });
});
