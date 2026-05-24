/**
 * Tests for temporal-reasoner.ts
 * S342: Temporal reasoning layer for time-aware queries
 */

import { describe, it, expect } from 'vitest';
import {
  detectTemporalIntent,
  applyTemporalReasoning,
  describeIntent,
  TemporalIntent,
} from '../src/temporal-reasoner.js';
import type { SearchResult } from '../src/types.js';

describe('detectTemporalIntent', () => {
  describe('first/earliest patterns', () => {
    it('detects "first" keyword', () => {
      const intent = detectTemporalIntent('What was the first decision about X?');
      expect(intent.type).toBe('first');
      expect(intent.sortOrder).toBe('asc');
      expect(intent.boostOld).toBe(true);
    });

    it('detects "earliest" keyword', () => {
      const intent = detectTemporalIntent('When is the earliest mention of Y?');
      expect(intent.type).toBe('first');
    });

    it('detects "when did X first" pattern', () => {
      const intent = detectTemporalIntent('When did physical hardware first get involved?');
      expect(intent.type).toBe('first');
    });

    it('detects "initial" keyword', () => {
      const intent = detectTemporalIntent('What was the initial design decision?');
      expect(intent.type).toBe('first');
    });

    it('detects "beginning" keyword', () => {
      const intent = detectTemporalIntent('What happened at the beginning of the project?');
      expect(intent.type).toBe('first');
    });
  });

  describe('last/recent patterns', () => {
    it('detects "most recent" phrase', () => {
      const intent = detectTemporalIntent('What is the most recent decision?');
      expect(intent.type).toBe('last');
      expect(intent.sortOrder).toBe('desc');
      expect(intent.boostRecent).toBe(true);
    });

    it('detects "latest" keyword', () => {
      const intent = detectTemporalIntent('What was the latest session about?');
      expect(intent.type).toBe('last');
    });

    it('detects "current" keyword', () => {
      const intent = detectTemporalIntent('What is the current status of X?');
      expect(intent.type).toBe('last');
    });
  });

  describe('sequence patterns', () => {
    it('detects "pick up" phrase', () => {
      const intent = detectTemporalIntent('What work needs to be picked up?');
      expect(intent.type).toBe('sequence');
      expect(intent.sortOrder).toBe('desc');
    });

    it('detects "interrupted" keyword', () => {
      const intent = detectTemporalIntent('What was interrupted last session?');
      expect(intent.type).toBe('sequence');
    });

    it('detects "incomplete" keyword', () => {
      const intent = detectTemporalIntent('What was left incomplete?');
      expect(intent.type).toBe('sequence');
    });

    it('detects "continue" keyword', () => {
      const intent = detectTemporalIntent('What should we continue working on?');
      expect(intent.type).toBe('sequence');
    });
  });

  describe('comparison patterns (should NOT trigger temporal reasoning)', () => {
    it('skips "before or after" comparison', () => {
      const intent = detectTemporalIntent('Did we run X before or after Y?');
      expect(intent.type).toBe('none');
      expect(intent.sortOrder).toBe('relevance');
    });

    it('skips "which came first" comparison', () => {
      const intent = detectTemporalIntent('Which came first, the chicken or the egg?');
      expect(intent.type).toBe('none');
    });
  });

  describe('no temporal intent', () => {
    it('returns none for neutral queries', () => {
      const intent = detectTemporalIntent('What is the architecture of the system?');
      expect(intent.type).toBe('none');
      expect(intent.sortOrder).toBe('relevance');
    });

    it('returns none for entity queries', () => {
      const intent = detectTemporalIntent('Who is responsible for X?');
      expect(intent.type).toBe('none');
    });
  });
});

describe('applyTemporalReasoning', () => {
  const createResult = (id: string, similarity: number, date: string): SearchResult => ({
    sessionId: id,
    similarity,
    content: `Content for ${id}`,
    contentTruncated: false,
    date,
    rank: 0,
  });

  describe('with "first" intent', () => {
    it('boosts earliest high-relevance result', () => {
      const results: SearchResult[] = [
        createResult('new', 0.8, '2026-05-20'),
        createResult('old', 0.7, '2026-01-01'),
        createResult('middle', 0.6, '2026-03-15'),
      ];

      const intent: TemporalIntent = { type: 'first', sortOrder: 'asc', boostOld: true };
      const processed = applyTemporalReasoning(results, intent);

      // Old should be boosted and move up in ranking
      const oldResult = processed.find(r => r.sessionId === 'old');
      expect(oldResult).toBeDefined();
      expect(oldResult!.similarity).toBeGreaterThan(0.7); // Should be boosted
    });

    it('does not boost low-relevance results', () => {
      const results: SearchResult[] = [
        createResult('new', 0.8, '2026-05-20'),
        createResult('old', 0.3, '2026-01-01'), // Low relevance
      ];

      const intent: TemporalIntent = { type: 'first', sortOrder: 'asc', boostOld: true };
      const processed = applyTemporalReasoning(results, intent);

      // Old should NOT be boosted (below 0.6 threshold)
      const oldResult = processed.find(r => r.sessionId === 'old');
      expect(oldResult!.similarity).toBe(0.3);
    });
  });

  describe('with "last" intent', () => {
    it('boosts latest high-relevance result', () => {
      const results: SearchResult[] = [
        createResult('old', 0.8, '2026-01-01'),
        createResult('new', 0.7, '2026-05-20'),
        createResult('middle', 0.6, '2026-03-15'),
      ];

      const intent: TemporalIntent = { type: 'last', sortOrder: 'desc', boostRecent: true };
      const processed = applyTemporalReasoning(results, intent);

      // New should be boosted
      const newResult = processed.find(r => r.sessionId === 'new');
      expect(newResult).toBeDefined();
      expect(newResult!.similarity).toBeGreaterThan(0.7);
    });
  });

  describe('with "sequence" intent', () => {
    it('boosts results with sequence markers', () => {
      const results: SearchResult[] = [
        { ...createResult('normal', 0.8, '2026-05-20'), content: 'Normal content' },
        { ...createResult('todo', 0.6, '2026-05-19'), content: 'This is pending work' },
        { ...createResult('handoff', 0.5, '2026-05-18'), content: 'Handoff to next session' },
      ];

      const intent: TemporalIntent = { type: 'sequence', sortOrder: 'desc', boostRecent: true };
      const processed = applyTemporalReasoning(results, intent);

      // Results with "pending" and "handoff" should be boosted
      const todoResult = processed.find(r => r.sessionId === 'todo');
      const handoffResult = processed.find(r => r.sessionId === 'handoff');

      expect(todoResult!.similarity).toBeGreaterThan(0.6);
      expect(handoffResult!.similarity).toBeGreaterThan(0.5);
    });

    it('does not boost low-relevance results even with markers', () => {
      const results: SearchResult[] = [
        { ...createResult('low', 0.2, '2026-05-20'), content: 'This is pending' },
      ];

      const intent: TemporalIntent = { type: 'sequence', sortOrder: 'desc', boostRecent: true };
      const processed = applyTemporalReasoning(results, intent);

      // Low relevance should not be boosted (below 0.4 threshold)
      expect(processed[0].similarity).toBe(0.2);
    });
  });

  describe('with "none" intent', () => {
    it('returns results unchanged', () => {
      const results: SearchResult[] = [
        createResult('a', 0.8, '2026-05-20'),
        createResult('b', 0.7, '2026-01-01'),
      ];

      const intent: TemporalIntent = { type: 'none', sortOrder: 'relevance' };
      const processed = applyTemporalReasoning(results, intent);

      expect(processed).toEqual(results);
    });
  });

  describe('rank assignment', () => {
    it('assigns sequential ranks after processing', () => {
      const results: SearchResult[] = [
        createResult('a', 0.8, '2026-05-20'),
        createResult('b', 0.7, '2026-01-01'),
        createResult('c', 0.6, '2026-03-15'),
      ];

      const intent: TemporalIntent = { type: 'first', sortOrder: 'asc', boostOld: true };
      const processed = applyTemporalReasoning(results, intent);

      expect(processed[0].rank).toBe(1);
      expect(processed[1].rank).toBe(2);
      expect(processed[2].rank).toBe(3);
    });
  });
});

describe('describeIntent', () => {
  it('describes "first" intent', () => {
    const intent: TemporalIntent = { type: 'first', sortOrder: 'asc' };
    expect(describeIntent(intent)).toContain('earliest');
  });

  it('describes "last" intent', () => {
    const intent: TemporalIntent = { type: 'last', sortOrder: 'desc' };
    expect(describeIntent(intent)).toContain('recent');
  });

  it('describes "sequence" intent', () => {
    const intent: TemporalIntent = { type: 'sequence', sortOrder: 'desc' };
    expect(describeIntent(intent)).toContain('continuity');
  });

  it('describes "none" intent', () => {
    const intent: TemporalIntent = { type: 'none', sortOrder: 'relevance' };
    expect(describeIntent(intent)).toContain('No temporal');
  });
});
