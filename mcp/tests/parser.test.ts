/**
 * Parser Tests - TDD for gordo-memory parser
 * Tests BEFORE implementation (Session 33 production standards)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { JournalParser, SessionEntry } from '../src/types.js';
import { createJournalParser } from '../src/parser/journal-parser-v2.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('JournalParser', () => {
  let parser: JournalParser;

  beforeEach(() => {
    parser = createJournalParser();
  });

  describe('detectJournalType', () => {
    it('should detect flat journal from JOURNAL.md file', async () => {
      const journalPath = path.join(__dirname, 'fixtures', 'flat-journal.md');
      const type = await parser.detectJournalType(journalPath);
      expect(type).toBe('flat');
    });

    it('should detect hierarchical from sessions/ directory', async () => {
      const sessionsPath = path.join(__dirname, 'fixtures', 'sessions');
      const type = await parser.detectJournalType(sessionsPath);
      expect(type).toBe('hierarchical');
    });

    it('should throw error for non-existent path', async () => {
      await expect(parser.detectJournalType('/nonexistent/path')).rejects.toThrow();
    });
  });

  describe('parseJournalFile (flat format)', () => {
    it('should parse flat JOURNAL.md into session entries', async () => {
      const journalPath = path.join(__dirname, 'fixtures', 'flat-journal.md');
      const entries = await parser.parseJournalFile(journalPath);

      expect(entries).toHaveLength(3);
      expect(entries[0].id).toBe('Session_01');
      expect(entries[0].date).toBe('2025-01-01');
      expect(entries[0].content).toContain('Initial Setup');
    });

    it('should extract session signals from journal entries', async () => {
      const journalPath = path.join(__dirname, 'fixtures', 'flat-journal.md');
      const entries = await parser.parseJournalFile(journalPath);

      // Session 1: success signal (✓)
      expect(entries[0].signals?.success).toBe(true);
      expect(entries[0].signals?.failed).toBe(false);

      // Session 3: failed signal (✗)
      expect(entries[2].signals?.failed).toBe(true);
    });

    it('should extract issue numbers from journal entries', async () => {
      const journalPath = path.join(__dirname, 'fixtures', 'flat-journal.md');
      const entries = await parser.parseJournalFile(journalPath);

      expect(entries[0].issues).toContain('#1');
      expect(entries[1].issues).toContain('#5');
      expect(entries[2].issues).toContain('#12');
    });

    it('should extract patterns from journal entries', async () => {
      const journalPath = path.join(__dirname, 'fixtures', 'flat-journal.md');
      const entries = await parser.parseJournalFile(journalPath);

      expect(entries[0].patterns).toContain('TDD works');
      expect(entries[1].patterns).toContain('Hybrid retrieval essential');
    });

    it('should handle empty journal file', async () => {
      // Create empty fixture
      const emptyPath = path.join(__dirname, 'fixtures', 'empty-journal.md');
      const fs = await import('fs/promises');
      await fs.writeFile(emptyPath, '# Empty Journal\n');

      const entries = await parser.parseJournalFile(emptyPath);
      expect(entries).toHaveLength(0);

      // Cleanup
      await fs.unlink(emptyPath);
    });

    // SESSION_LOG.md form: title-less heading + optional date range.
    // Used by project-gordo-backchannel (and other adopters that keep a flat session log
    // without per-session titles). Pre-fix the parser regex required `## Session N: Title (date)`,
    // silently producing zero sessions for these journals.
    it('should parse title-less session headings (## Session N (date))', async () => {
      const journalPath = path.join(__dirname, 'fixtures', 'session-log.md');
      const entries = await parser.parseJournalFile(journalPath);

      expect(entries).toHaveLength(3);
      expect(entries[0].id).toBe('Session_03');
      expect(entries[0].date).toBe('2025-01-03');
      // Title-less form should fall back to "Session N" summary.
      expect(entries[0].summary).toBe('Session 3');
    });

    it('should parse date-range session headings (## Session N (start → end))', async () => {
      const journalPath = path.join(__dirname, 'fixtures', 'session-log.md');
      const entries = await parser.parseJournalFile(journalPath);

      // Multi-day session — date should be the start date.
      const s2 = entries.find(e => e.id === 'Session_02');
      expect(s2).toBeDefined();
      expect(s2!.date).toBe('2025-01-02');
      expect(s2!.content).toContain('Multi-day session');
    });
  });

  describe('parseHierarchicalStructure', () => {
    it('should parse sessions/ directory into session entries', async () => {
      const sessionsPath = path.join(__dirname, 'fixtures', 'sessions');
      const entries = await parser.parseHierarchicalStructure(sessionsPath);

      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('Session_01');
      expect(entries[0].date).toBe('2025-01-01');
    });

    it('should read SESSION_DETAIL.md from each session directory', async () => {
      const sessionsPath = path.join(__dirname, 'fixtures', 'sessions');
      const entries = await parser.parseHierarchicalStructure(sessionsPath);

      expect(entries[0].content).toContain('Initial Setup');
      expect(entries[1].content).toContain('Feature Implementation');
    });

    it('should extract summary from hierarchical sessions', async () => {
      const sessionsPath = path.join(__dirname, 'fixtures', 'sessions');
      const entries = await parser.parseHierarchicalStructure(sessionsPath);

      expect(entries[0].summary).toContain('Setup gordo-framework');
      expect(entries[1].summary).toContain('Add semantic search');
    });

    it('should handle missing SESSION_DETAIL.md gracefully', async () => {
      // Create session without SESSION_DETAIL.md
      const fs = await import('fs/promises');
      const testSessionPath = path.join(__dirname, 'fixtures', 'sessions', 'Session_99_2025-01-99');
      await fs.mkdir(testSessionPath, { recursive: true });

      const sessionsPath = path.join(__dirname, 'fixtures', 'sessions');
      const entries = await parser.parseHierarchicalStructure(sessionsPath);

      // Should skip session without SESSION_DETAIL.md
      expect(entries.every(e => e.id !== 'Session_99')).toBe(true);

      // Cleanup
      await fs.rm(testSessionPath, { recursive: true });
    });

    it('should sort sessions by date chronologically', async () => {
      const sessionsPath = path.join(__dirname, 'fixtures', 'sessions');
      const entries = await parser.parseHierarchicalStructure(sessionsPath);

      // Should be in date order
      expect(entries[0].date).toBe('2025-01-01');
      expect(entries[1].date).toBe('2025-01-02');
    });
  });

  describe('Integration: Auto-detect and parse', () => {
    it('should auto-detect and parse flat journal', async () => {
      const journalPath = path.join(__dirname, 'fixtures', 'flat-journal.md');
      const type = await parser.detectJournalType(journalPath);

      let entries: SessionEntry[];
      if (type === 'flat') {
        entries = await parser.parseJournalFile(journalPath);
      } else {
        throw new Error('Expected flat journal');
      }

      expect(entries).toHaveLength(3);
    });

    it('should auto-detect and parse hierarchical sessions', async () => {
      const sessionsPath = path.join(__dirname, 'fixtures', 'sessions');
      const type = await parser.detectJournalType(sessionsPath);

      let entries: SessionEntry[];
      if (type === 'hierarchical') {
        entries = await parser.parseHierarchicalStructure(sessionsPath);
      } else {
        throw new Error('Expected hierarchical sessions');
      }

      expect(entries).toHaveLength(2);
    });
  });
});
