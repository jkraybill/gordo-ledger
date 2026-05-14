/**
 * Parser for GitHub issues and git commits
 * Handles synced markdown files from github-issues/ and git-commits/ directories
 * Part of Five-Layer Memory (sessions + issues + commits + docs + code)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { SessionEntry } from '../types.js';

const ISSUE_PATTERN = /^# Issue #(\d+): (.+)$/m;
const ISSUE_METADATA_PATTERN = /\*\*State:\*\* (\w+)\n\*\*Created:\*\* ([\d-]+)\n\*\*Updated:\*\* ([\d-]+)\n\*\*Labels:\*\* (.+)\n\*\*URL:\*\* (.+)/;

const COMMIT_PATTERN = /^# Commit ([a-f0-9]+): (.+)$/m;
const COMMIT_METADATA_PATTERN = /\*\*Hash:\*\* ([a-f0-9]+)\n\*\*Author:\*\* (.+)\n\*\*Date:\*\* ([\d-]+)/;

export interface IssueCommitParserOptions {
  includeClosedIssues?: boolean;
}

/**
 * Parse all GitHub issues from synced markdown files
 */
export async function parseGitHubIssues(
  issuesDir: string,
  options: IssueCommitParserOptions = {}
): Promise<SessionEntry[]> {
  const { includeClosedIssues = true } = options;
  const entries: SessionEntry[] = [];

  try {
    const files = await fs.readdir(issuesDir);
    const issueFiles = files.filter(f => f.startsWith('issue-') && f.endsWith('.md'));

    for (const file of issueFiles) {
      const filePath = path.join(issuesDir, file);
      const content = await fs.readFile(filePath, 'utf-8');

      // Extract issue number and title
      const titleMatch = content.match(ISSUE_PATTERN);
      if (!titleMatch) continue;

      const [_, issueNumber, title] = titleMatch;

      // Extract metadata
      const metadataMatch = content.match(ISSUE_METADATA_PATTERN);
      if (!metadataMatch) continue;

      const [__, state, created, updated, labels, url] = metadataMatch;

      // Skip closed issues if option set
      if (!includeClosedIssues && state.toUpperCase() === 'CLOSED') {
        continue;
      }

      // Extract description (everything after metadata separator)
      const descriptionStart = content.indexOf('## Description');
      const description = descriptionStart >= 0
        ? content.substring(descriptionStart)
        : content;

      // Create SessionEntry for issue
      entries.push({
        id: `issue-${issueNumber}`,
        contentType: 'issue',
        date: created,
        summary: `Issue #${issueNumber}: ${title} (${state})`,
        content: description,
        metadata: {
          issueNumber: parseInt(issueNumber),
          state,
          labels: labels === 'none' ? [] : labels.split(', '),
          url,
          created,
          updated
        }
      });
    }
  } catch (error) {
    // Directory doesn't exist or path is not a directory - return empty array
    if ((error as any).code === 'ENOENT' || (error as any).code === 'ENOTDIR') {
      return [];
    }
    throw error;
  }

  return entries;
}

/**
 * Parse all git commits from synced markdown files
 */
export async function parseGitCommits(
  commitsDir: string
): Promise<SessionEntry[]> {
  const entries: SessionEntry[] = [];

  try {
    const files = await fs.readdir(commitsDir);
    const commitFiles = files.filter(f => f.startsWith('commit-') && f.endsWith('.md'));

    for (const file of commitFiles) {
      const filePath = path.join(commitsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');

      // Extract commit hash and title
      const titleMatch = content.match(COMMIT_PATTERN);
      if (!titleMatch) continue;

      const [_, hashShort, title] = titleMatch;

      // Extract metadata
      const metadataMatch = content.match(COMMIT_METADATA_PATTERN);
      if (!metadataMatch) continue;

      const [__, hashFull, author, date] = metadataMatch;

      // Extract message (everything between ## Message and ## Files Changed or end)
      const messageStart = content.indexOf('## Message');
      const filesChangedStart = content.indexOf('## Files Changed');
      const message = messageStart >= 0
        ? content.substring(
            messageStart,
            filesChangedStart >= 0 ? filesChangedStart : undefined
          )
        : content;

      // Create SessionEntry for commit
      entries.push({
        id: `commit-${hashShort}`,
        contentType: 'commit',
        date,
        summary: `Commit ${hashShort}: ${title}`,
        content: message,
        metadata: {
          hash: hashFull,
          hashShort,
          author,
          date
        }
      });
    }
  } catch (error) {
    // Directory doesn't exist or path is not a directory - return empty array
    if ((error as any).code === 'ENOENT' || (error as any).code === 'ENOTDIR') {
      return [];
    }
    throw error;
  }

  return entries;
}

/**
 * Parse both issues and commits (Five-Layer Memory)
 */
export async function parseIssuesAndCommits(
  repoPath: string,
  options: IssueCommitParserOptions = {}
): Promise<SessionEntry[]> {
  const issuesDir = path.join(repoPath, 'github-issues');
  const commitsDir = path.join(repoPath, 'git-commits');

  const [issues, commits] = await Promise.all([
    parseGitHubIssues(issuesDir, options),
    parseGitCommits(commitsDir)
  ]);

  return [...issues, ...commits];
}
