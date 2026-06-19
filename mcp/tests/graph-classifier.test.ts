/**
 * Tests for Node Classifier
 * Part of gordo-ledger MCP Server v1.0.0-rc16
 */

import { describe, it, expect } from 'vitest';
import {
  classifyNode,
  classifyArtifactType,
  classifyNodes,
  getClassificationStats,
  ClassificationResult
} from '../src/graph/classifier.js';

describe('Node Classifier', () => {
  describe('classifyNode', () => {
    describe('Session nodes', () => {
      it('should classify Session_NNN as session with extraction', () => {
        const result = classifyNode('Session_001');
        expect(result.nodeType).toBe('session');
        expect(result.shouldExtractRelationships).toBe(true);
        expect(result.confidence).toBe('high');
      });

      it('should classify Session_433 as session', () => {
        const result = classifyNode('Session_433');
        expect(result.nodeType).toBe('session');
        expect(result.shouldExtractRelationships).toBe(true);
      });

      it('should classify SESSION_LOG chunks as session with extraction', () => {
        const result = classifyNode('SESSION_LOG.md:1001-2000');
        expect(result.nodeType).toBe('session');
        expect(result.shouldExtractRelationships).toBe(true);
        expect(result.confidence).toBe('high');
      });

      it('should classify SESSION_LOG.md:4001-5000 as session', () => {
        const result = classifyNode('SESSION_LOG.md:4001-5000');
        expect(result.nodeType).toBe('session');
        expect(result.shouldExtractRelationships).toBe(true);
      });
    });

    describe('Issue nodes', () => {
      it('should classify issue-123 as issue with extraction', () => {
        const result = classifyNode('issue-123');
        expect(result.nodeType).toBe('issue');
        expect(result.shouldExtractRelationships).toBe(true);
        expect(result.confidence).toBe('high');
      });

      it('should classify issue-1 as issue', () => {
        const result = classifyNode('issue-1');
        expect(result.nodeType).toBe('issue');
      });
    });

    describe('Commit nodes', () => {
      it('should classify commit-abc123 as commit without extraction', () => {
        const result = classifyNode('commit-abc123f');
        expect(result.nodeType).toBe('commit');
        expect(result.shouldExtractRelationships).toBe(false);
        expect(result.confidence).toBe('high');
      });

      it('should classify commit-465f385 as commit', () => {
        const result = classifyNode('commit-465f385');
        expect(result.nodeType).toBe('commit');
        expect(result.shouldExtractRelationships).toBe(false);
      });
    });

    describe('Pattern nodes', () => {
      it('should classify pattern_oauth as pattern without extraction', () => {
        const result = classifyNode('pattern_oauth');
        expect(result.nodeType).toBe('pattern');
        expect(result.shouldExtractRelationships).toBe(false);
      });

      it('should classify pattern_memory_curation as pattern', () => {
        const result = classifyNode('pattern_memory_curation');
        expect(result.nodeType).toBe('pattern');
      });
    });

    describe('Decision nodes', () => {
      it('should classify decision_Session_100_1 as decision without extraction', () => {
        const result = classifyNode('decision_Session_100_1');
        expect(result.nodeType).toBe('decision');
        expect(result.shouldExtractRelationships).toBe(false);
      });
    });

    describe('Artifact nodes (file paths)', () => {
      it('should classify .json files as artifact', () => {
        const result = classifyNode('config.json');
        expect(result.nodeType).toBe('artifact');
        expect(result.shouldExtractRelationships).toBe(false);
      });

      it('should classify .md files as artifact', () => {
        const result = classifyNode('CLAUDE.md');
        expect(result.nodeType).toBe('artifact');
        expect(result.shouldExtractRelationships).toBe(false);
      });

      it('should classify paths with directories as artifact', () => {
        const result = classifyNode('.claude/skills/seal-ratification/SKILL.md');
        expect(result.nodeType).toBe('artifact');
        expect(result.shouldExtractRelationships).toBe(false);
      });

      it('should classify code files as artifact', () => {
        const result = classifyNode('ledger/controller/memory-controller.js');
        expect(result.nodeType).toBe('artifact');
        expect(result.shouldExtractRelationships).toBe(false);
      });

      it('should classify attic files as artifact', () => {
        const result = classifyNode('attic/roundtable-artifacts/briefs/emotional/DATASET_EMOTIONAL_CHUNK_12_BRIEF.md');
        expect(result.nodeType).toBe('artifact');
        expect(result.shouldExtractRelationships).toBe(false);
      });
    });

    describe('Fallback behavior', () => {
      it('should classify unknown patterns as session with low confidence', () => {
        const result = classifyNode('unknown_thing');
        expect(result.nodeType).toBe('session');
        expect(result.confidence).toBe('low');
        expect(result.shouldExtractRelationships).toBe(true);
      });
    });
  });

  describe('classifyArtifactType', () => {
    it('should classify .json as config', () => {
      expect(classifyArtifactType('package.json')).toBe('config');
    });

    it('should classify .yaml as config', () => {
      expect(classifyArtifactType('roundtable.yaml')).toBe('config');
    });

    it('should classify .ts as code', () => {
      expect(classifyArtifactType('index.ts')).toBe('code');
    });

    it('should classify .js as code', () => {
      expect(classifyArtifactType('memory-controller.js')).toBe('code');
    });

    it('should classify .md as doc', () => {
      expect(classifyArtifactType('README.md')).toBe('doc');
    });

    it('should classify skills as skill', () => {
      expect(classifyArtifactType('.claude/skills/eos/SKILL.md')).toBe('skill');
    });

    it('should classify SKILL.md anywhere as skill', () => {
      expect(classifyArtifactType('some/path/SKILL.md')).toBe('skill');
    });

    it('should classify unknown extensions as other', () => {
      expect(classifyArtifactType('file.xyz')).toBe('other');
    });
  });

  describe('classifyNodes (batch)', () => {
    it('should classify multiple nodes', () => {
      const ids = ['Session_100', 'issue-42', 'config.json', 'commit-abc123'];
      const results = classifyNodes(ids);

      expect(results.size).toBe(4);
      expect(results.get('Session_100')?.nodeType).toBe('session');
      expect(results.get('issue-42')?.nodeType).toBe('issue');
      expect(results.get('config.json')?.nodeType).toBe('artifact');
      expect(results.get('commit-abc123')?.nodeType).toBe('commit');
    });
  });

  describe('getClassificationStats', () => {
    it('should compute accurate statistics', () => {
      const ids = [
        'Session_100', 'Session_200',  // 2 sessions, should extract
        'issue-1', 'issue-2',          // 2 issues, should extract
        'commit-abc', 'commit-def',    // 2 commits, no extract
        'config.json', 'README.md'     // 2 artifacts, no extract
      ];
      const results = classifyNodes(ids);
      const stats = getClassificationStats(results);

      expect(stats.byType.session).toBe(2);
      expect(stats.byType.issue).toBe(2);
      expect(stats.byType.commit).toBe(2);
      expect(stats.byType.artifact).toBe(2);
      expect(stats.shouldExtract).toBe(4); // sessions + issues
      expect(stats.byConfidence.high).toBe(8);
    });
  });

  describe('Real-world node IDs from current graph', () => {
    const realIds = [
      'Session_433',
      'SESSION_LOG.md:1001-2000',
      'issue-116',
      'commit-465f385',
      'pattern_seal_protocol_improvement',
      'decision_Session_258_1',
      '.claude/skills/seal-ratification/SKILL.md',
      'COMPLIANCE_KERNEL.md',
      'auto-memory/feedback_seal_placement_pattern.md',
      'ratification/record-033-content.md',
      'ledger/controller/memory-controller.js',
      'config.json'
    ];

    it('should correctly classify all real node IDs', () => {
      const results = classifyNodes(realIds);

      expect(results.get('Session_433')?.nodeType).toBe('session');
      expect(results.get('SESSION_LOG.md:1001-2000')?.nodeType).toBe('session');
      expect(results.get('issue-116')?.nodeType).toBe('issue');
      expect(results.get('commit-465f385')?.nodeType).toBe('commit');
      expect(results.get('pattern_seal_protocol_improvement')?.nodeType).toBe('pattern');
      expect(results.get('decision_Session_258_1')?.nodeType).toBe('decision');
      expect(results.get('.claude/skills/seal-ratification/SKILL.md')?.nodeType).toBe('artifact');
      expect(results.get('COMPLIANCE_KERNEL.md')?.nodeType).toBe('artifact');
      expect(results.get('auto-memory/feedback_seal_placement_pattern.md')?.nodeType).toBe('artifact');
      expect(results.get('ratification/record-033-content.md')?.nodeType).toBe('artifact');
      expect(results.get('ledger/controller/memory-controller.js')?.nodeType).toBe('artifact');
      expect(results.get('config.json')?.nodeType).toBe('artifact');
    });

    it('should mark only sessions and issues for extraction', () => {
      const results = classifyNodes(realIds);
      const stats = getClassificationStats(results);

      // Only Session_433, SESSION_LOG chunk, and issue-116 should extract
      expect(stats.shouldExtract).toBe(3);
    });
  });
});
