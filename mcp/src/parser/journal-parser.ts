/**
 * Journal parser supporting both flat JOURNAL.md and hierarchical sessions/
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { JournalParser, SessionEntry, SessionSignals } from '../types.js';

export class GordoJournalParser implements JournalParser {

  async detectJournalType(basePath: string): Promise<'flat' | 'hierarchical'> {
    try {
      const sessionsDirPath = path.join(basePath, 'sessions');
      const journalFilePath = path.join(basePath, 'JOURNAL.md');

      const sessionsExists = await fs.stat(sessionsDirPath).then(() => true).catch(() => false);
      const journalExists = await fs.stat(journalFilePath).then(() => true).catch(() => false);

      if (sessionsExists) {
        return 'hierarchical';
      } else if (journalExists) {
        return 'flat';
      }

      throw new Error('No journal found at path');
    } catch (error) {
      throw new Error(`Failed to detect journal type: ${error}`);
    }
  }

  async parseJournalFile(filePath: string): Promise<SessionEntry[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.parseFlatJournal(content, filePath);
    } catch (error) {
      throw new Error(`Failed to parse journal file: ${error}`);
    }
  }

  async parseHierarchicalStructure(sessionsDir: string): Promise<SessionEntry[]> {
    try {
      const entries: SessionEntry[] = [];
      const sessionDirs = await fs.readdir(sessionsDir);

      for (const dirName of sessionDirs) {
        if (!dirName.startsWith('Session_')) continue;

        const sessionPath = path.join(sessionsDir, dirName);
        const detailPath = path.join(sessionPath, 'SESSION_DETAIL.md');

        try {
          const content = await fs.readFile(detailPath, 'utf-8');
          const sessionNum = dirName.replace('Session_', '').split('_')[0];
          const date = dirName.split('_').slice(1).join('-');

          entries.push(this.parseSessionContent(sessionNum, date, content));
        } catch {
          // Skip sessions without detail files
          continue;
        }
      }

      return entries.sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      throw new Error(`Failed to parse hierarchical structure: ${error}`);
    }
  }

  private parseFlatJournal(content: string, filePath: string): SessionEntry[] {
    const entries: SessionEntry[] = [];
    const lines = content.split('\n');

    let currentSession: Partial<SessionEntry> | null = null;
    let currentContent: string[] = [];

    for (const line of lines) {
      // Match session header: ## Session N (YYYY-MM-DD)
      const sessionMatch = line.match(/^##\s+Session\s+(\d+)\s+\(([^)]+)\)/);

      if (sessionMatch) {
        // Save previous session
        if (currentSession) {
          entries.push(this.finalizeSession(currentSession, currentContent.join('\n')));
        }

        // Start new session
        const [, sessionNum, date] = sessionMatch;
        currentSession = {
          id: `Session_${sessionNum.padStart(2, '0')}`,
          date,
        };
        currentContent = [];
      } else if (currentSession) {
        currentContent.push(line);
      }
    }

    // Don't forget the last session
    if (currentSession) {
      entries.push(this.finalizeSession(currentSession, currentContent.join('\n')));
    }

    return entries;
  }

  private parseSessionContent(sessionNum: string, date: string, content: string): SessionEntry {
    const signals = this.extractSignals(content);
    const patterns = this.extractPatterns(content);
    const issues = this.extractIssues(content);
    const summary = this.extractSummary(content);

    return {
      id: `Session_${sessionNum.padStart(2, '0')}`,
      date,
      content,
      summary,
      patterns,
      issues,
      signals,
    };
  }

  private finalizeSession(partial: Partial<SessionEntry>, content: string): SessionEntry {
    const signals = this.extractSignals(content);
    const patterns = this.extractPatterns(content);
    const issues = this.extractIssues(content);
    const summary = this.extractSummary(content);

    return {
      id: partial.id || 'Session_00',
      date: partial.date || new Date().toISOString().split('T')[0],
      content,
      summary,
      patterns,
      issues,
      signals,
    };
  }

  private extractSignals(content: string): SessionSignals {
    return {
      success: content.includes('✓'),
      failed: content.includes('✗'),
      warning: content.includes('⚠'),
      ledTo: content.includes('→'),
      mixed: content.includes('±'),
      bigChange: content.includes('Δ'),
    };
  }

  private extractPatterns(content: string): string[] {
    const patterns: string[] = [];

    // Look for "Pattern:" prefix
    const patternMatches = content.matchAll(/Pattern:\s*([^\n.]+)/gi);
    for (const match of patternMatches) {
      patterns.push(match[1].trim());
    }

    return [...new Set(patterns)]; // Remove duplicates
  }

  private extractIssues(content: string): string[] {
    const issues: string[] = [];

    // Look for #123 style issue references
    const issueMatches = content.matchAll(/#(\d+)/g);
    for (const match of issueMatches) {
      issues.push(match[1]);
    }

    return [...new Set(issues)]; // Remove duplicates
  }

  private extractSummary(content: string): string {
    // Take first 200 characters as summary
    const cleaned = content
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('#'))
      .join(' ')
      .trim();

    return cleaned.substring(0, 200) + (cleaned.length > 200 ? '...' : '');
  }
}
