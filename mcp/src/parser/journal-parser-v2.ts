/**
 * Journal Parser Implementation (Session 33 - TDD approach)
 * Parses both flat JOURNAL.md and hierarchical sessions/ directory
 */

import { JournalParser, SessionEntry, SessionSignals } from '../types.js';
import fs from 'fs/promises';
import path from 'path';

export function createJournalParser(): JournalParser {
  return {
    async detectJournalType(targetPath: string): Promise<'flat' | 'hierarchical'> {
      try {
        const stats = await fs.stat(targetPath);

        if (stats.isFile()) {
          // If it's a file, assume it's a flat journal
          return 'flat';
        } else if (stats.isDirectory()) {
          // If it's a directory, assume it's hierarchical sessions
          return 'hierarchical';
        }

        throw new Error(`Path ${targetPath} is neither file nor directory`);
      } catch (error) {
        throw new Error(`Failed to detect journal type: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async parseJournalFile(filePath: string): Promise<SessionEntry[]> {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const entries: SessionEntry[] = [];

        // Match either:
        //   ## Session N: Title (YYYY-MM-DD)             — original JOURNAL.md form
        //   ## Session N (YYYY-MM-DD)                    — title-less form (SESSION_LOG.md)
        //   ## Session N (YYYY-MM-DD → YYYY-MM-DD)       — date-range form (multi-day session)
        // Capture groups: 1=number, 2=title (optional), 3=start date.
        const sessionPattern = /^## Session (\d+)(?::\s*(.+?))?\s*\((\d{4}-\d{2}-\d{2})(?:\s*→\s*\d{4}-\d{2}-\d{2})?\)/;
        const lines = content.split('\n');

        let currentSession: Partial<SessionEntry> | null = null;
        let currentContent: string[] = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const match = line.match(sessionPattern);

          if (match) {
            // Save previous session if exists
            if (currentSession) {
              currentSession.content = currentContent.join('\n').trim();
              entries.push(currentSession as SessionEntry);
            }

            // Start new session
            const sessionNum = match[1].padStart(2, '0');
            const title = match[2]; // undefined for title-less form
            const date = match[3];

            currentSession = {
              id: `Session_${sessionNum}`,
              contentType: 'session',
              date,
              content: '',
              summary: title || `Session ${match[1]}`,
              patterns: [],
              issues: [],
              signals: {
                success: false,
                failed: false,
                warning: false,
                ledTo: false,
                mixed: false,
                bigChange: false
              }
            };
            currentContent = [line];
          } else if (currentSession) {
            currentContent.push(line);

            // Extract signals from compressed journal entries
            if (line.includes('✓')) currentSession.signals!.success = true;
            if (line.includes('✗')) currentSession.signals!.failed = true;
            if (line.includes('⚠')) currentSession.signals!.warning = true;
            if (line.includes('→')) currentSession.signals!.ledTo = true;
            if (line.includes('±')) currentSession.signals!.mixed = true;
            if (line.includes('Δ')) currentSession.signals!.bigChange = true;

            // Extract issue numbers (#N)
            const issueMatches = line.matchAll(/#(\d+)/g);
            for (const issueMatch of issueMatches) {
              const issueNum = `#${issueMatch[1]}`;
              if (!currentSession.issues!.includes(issueNum)) {
                currentSession.issues!.push(issueNum);
              }
            }

            // Extract patterns from "Pattern:" lines
            const patternMatch = line.match(/Pattern:\s*(.+)/);
            if (patternMatch) {
              currentSession.patterns!.push(patternMatch[1].replace(/\.$/, '').trim());
            }
          }
        }

        // Save last session
        if (currentSession) {
          currentSession.content = currentContent.join('\n').trim();
          entries.push(currentSession as SessionEntry);
        }

        return entries;
      } catch (error) {
        throw new Error(`Failed to parse journal file: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async parseHierarchicalStructure(sessionsDir: string): Promise<SessionEntry[]> {
      try {
        const dirEntries = await fs.readdir(sessionsDir, { withFileTypes: true });
        const entries: SessionEntry[] = [];

        // Find all Session_XX_YYYY-MM-DD directories
        const sessionDirs = dirEntries
          .filter(entry => entry.isDirectory() && entry.name.startsWith('Session_'))
          .map(entry => entry.name)
          .sort(); // Alphabetical sort gives chronological order

        for (const sessionDirName of sessionDirs) {
          const sessionPath = path.join(sessionsDir, sessionDirName);
          const detailPath = path.join(sessionPath, 'SESSION_DETAIL.md');

          // Skip if no SESSION_DETAIL.md
          try {
            await fs.access(detailPath);
          } catch {
            continue; // Skip this session
          }

          const content = await fs.readFile(detailPath, 'utf-8');

          // Extract session info from directory name: Session_XX_YYYY-MM-DD
          const match = sessionDirName.match(/Session_(\d+)_(\d{4}-\d{2}-\d{2})/);
          if (!match) continue;

          const sessionNum = match[1];
          const date = match[2];

          // Extract summary from "## Summary" section
          const summaryMatch = content.match(/## Summary\s*\n(.+?)(?=\n##|\n$)/s);
          const summary = summaryMatch ? summaryMatch[1].trim() : '';

          // Extract patterns, issues, signals from summary line (same as flat format)
          const signals: SessionSignals = {
            success: content.includes('✓'),
            failed: content.includes('✗'),
            warning: content.includes('⚠'),
            ledTo: content.includes('→'),
            mixed: content.includes('±'),
            bigChange: content.includes('Δ')
          };

          const issues: string[] = [];
          const issueMatches = content.matchAll(/#(\d+)/g);
          for (const issueMatch of issueMatches) {
            const issueNum = `#${issueMatch[1]}`;
            if (!issues.includes(issueNum)) {
              issues.push(issueNum);
            }
          }

          const patterns: string[] = [];
          const patternMatches = content.matchAll(/Pattern:\s*(.+)/g);
          for (const patternMatch of patternMatches) {
            patterns.push(patternMatch[1].replace(/\.$/, '').trim());
          }

          entries.push({
            id: `Session_${sessionNum}`,
            contentType: 'session',
            date,
            content,
            summary,
            patterns,
            issues,
            signals
          });
        }

        return entries;
      } catch (error) {
        throw new Error(`Failed to parse hierarchical structure: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
}
