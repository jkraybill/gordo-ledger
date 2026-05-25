// Generic File Parser - Index any text files, not just journals
// Part of gordo-ledger MCP Server v0.7.0+

import * as fs from 'fs/promises';
import * as path from 'path';
import type { SessionEntry, MemoryConfig } from '../types.js';
import { minimatch } from 'minimatch';
import {
  extractCodeFacts,
  extractionToIndexableText,
  isExtractionAvailable as isCodeExtractionAvailable,
  type CodeExtractorConfig,
} from './code-extractor.js';

/**
 * File extensions to index (text files only)
 */
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.js', '.tsx', '.jsx',
  '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
  '.sh', '.bash', '.zsh', '.fish',
  '.html', '.css', '.scss', '.sass', '.less',
  '.xml', '.svg', '.sql', '.graphql',
  '.r', '.rb', '.php', '.pl', '.lua', '.vim',
  '.dockerfile', '.gitignore', '.env.example'
]);

/**
 * Documentation file extensions (Fix #139)
 */
const DOC_EXTENSIONS = new Set([
  '.md', '.txt', '.rst', '.adoc', '.org'
]);

/**
 * Code file extensions (Fix #139)
 */
const CODE_EXTENSIONS = new Set([
  '.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs',
  '.java', '.c', '.cpp', '.h', '.hpp', '.sh', '.bash',
  '.zsh', '.fish', '.r', '.rb', '.php', '.pl', '.lua',
  '.vim', '.html', '.css', '.scss', '.sass', '.less',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.sql', '.graphql'
]);

/**
 * Semantic chunking configuration
 * S346: Chunk markdown by headers instead of fixed lines
 */
const SEMANTIC_CHUNK_CONFIG = {
  minChunkSize: 50,      // Minimum chars to create a chunk (avoid tiny fragments)
  maxChunkSize: 15000,   // Max chars before falling back to line-based splitting
  headerPattern: /^## /m // Split at level-2 headers
};

/**
 * Chunk markdown content by ## headers (S346)
 * Returns array of {id: string, content: string, summary: string} chunks
 * Falls back to null if no headers found or content is small enough for single chunk
 */
function chunkMarkdownByHeaders(
  content: string,
  relativePath: string,
  basename: string
): Array<{id: string; content: string; summary: string}> | null {
  const { minChunkSize, maxChunkSize, headerPattern } = SEMANTIC_CHUNK_CONFIG;

  // Don't chunk if content is small
  if (content.length <= maxChunkSize) {
    return null; // Use single-entry path
  }

  // Split at ## headers
  const parts = content.split(headerPattern);
  if (parts.length <= 1) {
    return null; // No headers found, fall back to line-based
  }

  const chunks: Array<{id: string; content: string; summary: string}> = [];

  // First part is content before first ## (preamble)
  if (parts[0].trim().length >= minChunkSize) {
    chunks.push({
      id: `${relativePath}:preamble`,
      content: parts[0].trim(),
      summary: `${basename} (preamble)`
    });
  }

  // Remaining parts start with header text
  for (let i = 1; i < parts.length; i++) {
    const part = '## ' + parts[i]; // Restore the ## prefix
    if (part.trim().length < minChunkSize) continue;

    // Extract header text for summary
    const headerMatch = part.match(/^## ([^\n]+)/);
    const headerText = headerMatch ? headerMatch[1].trim() : `section ${i}`;

    // Create semantic ID from header
    const semanticId = headerText
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);

    chunks.push({
      id: `${relativePath}:${semanticId || `section-${i}`}`,
      content: part.trim(),
      summary: `${basename}: ${headerText}`
    });
  }

  // If chunking produced only 1 chunk, return null to use single-entry path
  if (chunks.length <= 1) {
    return null;
  }

  return chunks;
}

/**
 * Directories to always skip (like .gitignore)
 */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.gordo-memory', 'dist', 'build',
  '.next', '.cache', 'coverage', '.nyc_output',
  '__pycache__', '.pytest_cache', '.venv', 'venv',
  'target', '.gradle', '.mvn',
  'github-issues', 'git-commits'
]);

/**
 * Track whether journal parsing succeeded (Fix F-004)
 * When false, JOURNAL.md is skipped by shouldIndexFile to avoid duplicate indexing.
 * When true, journal parsing returned 0 sessions, so JOURNAL.md should be indexed as a generic doc.
 */
let _journalParsingFailed = false;

export function setJournalParsingFailed(failed: boolean): void {
  _journalParsingFailed = failed;
}

/**
 * Check if file is binary (simple heuristic)
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const buffer = await fs.readFile(filePath);

    // Check first 8000 bytes for null bytes (common in binary files)
    const chunkSize = Math.min(8000, buffer.length);
    for (let i = 0; i < chunkSize; i++) {
      if (buffer[i] === 0) {
        return true;
      }
    }

    return false;
  } catch {
    return true; // If we can't read it, treat as binary
  }
}

/**
 * Check if file is an auto-memory file (S337)
 * Detects files in memory directories (Claude Code auto-memory, etc.)
 */
function isMemoryFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  // Match paths containing /memory/ directory or auto-memory symlink
  return /\/(auto-)?memory\//.test(normalized) ||
         normalized.includes('/.claude/') && normalized.includes('/memory/');
}

/**
 * Determine content type for a file (Fix #139)
 * S337: Added 'memory' type for auto-memory files
 */
function getFileContentType(filePath: string): 'docs' | 'code' | 'memory' | null {
  const ext = path.extname(filePath).toLowerCase();

  // S337: Memory files get their own content type for boosted ranking
  if (isMemoryFile(filePath) && DOC_EXTENSIONS.has(ext)) {
    return 'memory';
  }

  if (DOC_EXTENSIONS.has(ext)) {
    return 'docs';
  } else if (CODE_EXTENSIONS.has(ext)) {
    return 'code';
  }

  return null; // Unknown type, skip
}

/**
 * Check if file matches include/exclude patterns (Fix #139)
 */
function matchesPatterns(
  filePath: string,
  rootPath: string,
  config?: MemoryConfig
): boolean {
  if (!config?.indexPatterns) {
    return true; // No patterns = include all
  }

  const relativePath = path.relative(rootPath, filePath);

  // Check exclude patterns first (higher priority)
  if (config.indexPatterns.exclude) {
    for (const pattern of config.indexPatterns.exclude) {
      if (minimatch(relativePath, pattern)) {
        return false; // Excluded
      }
    }
  }

  // Check include patterns
  if (config.indexPatterns.include && config.indexPatterns.include.length > 0) {
    for (const pattern of config.indexPatterns.include) {
      if (minimatch(relativePath, pattern)) {
        return true; // Explicitly included
      }
    }
    return false; // Not in include list
  }

  return true; // No include patterns = include all (that aren't excluded)
}

/**
 * Check if file should be indexed (Fix #139)
 */
function shouldIndexFile(
  filePath: string,
  rootPath: string,
  config?: MemoryConfig
): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath);

  // Skip journal files only if journal parsing succeeded (Fix #142 + Fix F-004)
  // If journal parsing returned 0 sessions, we should index the file as a generic doc.
  // SESSION_LOG.md added alongside JOURNAL.md / GORDO_JOURNAL.md to keep parity with
  // the flat-journal candidate list in memory-manager-v2.ts.
  if (basename === 'JOURNAL.md' || basename === 'GORDO_JOURNAL.md' || basename === 'SESSION_LOG.md') {
    if (!_journalParsingFailed) {
      return false;
    }
    // Journal parsing failed/returned 0 sessions — fall through to generic indexing
  }

  // Always skip SESSION_DETAIL.md — these are the per-session content files in
  // hierarchical sessions/ mode and are already indexed via parseHierarchicalStructure.
  // Indexing them again as generic docs would produce duplicate entries.
  if (basename === 'SESSION_DETAIL.md') {
    return false;
  }

  // Skip files without extensions or with non-text extensions
  if (!ext && !basename.startsWith('.')) {
    return false;
  }

  // Check if extension is in our text extensions list
  const isTextFile = TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(basename);
  if (!isTextFile) {
    return false;
  }

  // Determine content type
  const contentType = getFileContentType(filePath);
  if (!contentType) {
    return false; // Unknown type, skip
  }

  // Check selective indexing controls (Fix #139)
  const indexDocs = config?.indexDocs ?? true; // Default: true
  const indexCode = config?.indexCode ?? false; // Default: false

  if (contentType === 'docs' && !indexDocs) {
    return false; // Docs disabled
  }
  // S337: Memory files follow docs indexing (they're a specialized doc type)
  if (contentType === 'memory' && !indexDocs) {
    return false; // Memory disabled when docs disabled
  }
  if (contentType === 'code' && !indexCode) {
    return false; // Code disabled
  }

  // Check include/exclude patterns
  if (!matchesPatterns(filePath, rootPath, config)) {
    return false;
  }

  return true;
}

/**
 * Recursively discover all text files in a directory (Fix #139)
 */
export async function discoverFiles(
  rootPath: string,
  config?: MemoryConfig
): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // S337: Follow symlinks to determine actual type
        let isDir = entry.isDirectory();
        let isFile = entry.isFile();
        if (entry.isSymbolicLink()) {
          try {
            const targetStats = await fs.stat(fullPath);
            isDir = targetStats.isDirectory();
            isFile = targetStats.isFile();
          } catch {
            // Broken symlink - skip
            continue;
          }
        }

        if (isDir) {
          // Skip ignored directories
          if (IGNORED_DIRS.has(entry.name)) {
            continue;
          }
          await walk(fullPath);
        } else if (isFile) {
          // Check if file should be indexed
          if (shouldIndexFile(fullPath, rootPath, config)) {
            // Additional binary check for suspicious files
            const isBinary = await isBinaryFile(fullPath);
            if (!isBinary) {
              files.push(fullPath);
            }
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
      console.warn(`Warning: Cannot read directory ${dir}:`, error);
    }
  }

  const stats = await fs.stat(rootPath);

  if (stats.isFile()) {
    // Single file
    if (shouldIndexFile(rootPath, rootPath, config)) {
      const isBinary = await isBinaryFile(rootPath);
      if (!isBinary) {
        files.push(rootPath);
      }
    }
  } else if (stats.isDirectory()) {
    // Directory tree
    await walk(rootPath);
  }

  return files;
}

/**
 * Parse a single file into a SessionEntry (Fix #139)
 * Large files are chunked into multiple entries
 * Issue #9: Code files can use LLM extraction for semantic summaries
 */
export async function parseFile(
  filePath: string,
  rootPath: string,
  config?: MemoryConfig,
  extractorConfig?: Partial<CodeExtractorConfig>
): Promise<SessionEntry[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const stats = await fs.stat(filePath);
  const relativePath = path.relative(rootPath, filePath);

  // Extract basic metadata
  const ext = path.extname(filePath);
  const basename = path.basename(filePath);

  // Determine content type (Fix #139)
  const contentType = getFileContentType(filePath);

  // Issue #9: For code files with extraction enabled, use LLM-extracted summaries
  if (contentType === 'code' && config?.extractCodeFacts && extractorConfig) {
    const extraction = await extractCodeFacts(filePath, rootPath, extractorConfig);
    if (extraction) {
      const indexableContent = extractionToIndexableText(extraction);
      const entry: SessionEntry = {
        id: relativePath,
        contentType: 'code',
        date: stats.mtime.toISOString().split('T')[0],
        summary: extraction.summary || `Code: ${basename}`,
        content: indexableContent,
        patterns: extraction.patterns,
        issues: [],
        metadata: {
          language: extraction.language,
          functions: extraction.functions.length,
          classes: extraction.classes.length,
          constants: extraction.constants.length,
          apis: extraction.apis.length,
        },
        signals: {
          success: false,
          failed: false,
          warning: false,
          ledTo: false,
          mixed: false,
          bigChange: false
        }
      };
      return [entry];
    }
    // Extraction failed or returned null - fall through to raw content
  }

  // S346: Try semantic chunking for markdown files first
  const isMarkdown = ext.toLowerCase() === '.md';
  if (isMarkdown) {
    const semanticChunks = chunkMarkdownByHeaders(content, relativePath, basename);
    if (semanticChunks && semanticChunks.length > 0) {
      return semanticChunks.map(chunk => ({
        id: chunk.id,
        contentType: contentType || undefined,
        date: stats.mtime.toISOString().split('T')[0],
        summary: chunk.summary,
        content: chunk.content,
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
      }));
    }
  }

  // For small files (<1000 lines), create single entry
  const lines = content.split('\n');
  const CHUNK_SIZE = 1000; // lines per chunk

  if (lines.length <= CHUNK_SIZE) {
    // Single entry
    const entry: SessionEntry = {
      id: relativePath,
      contentType: contentType || undefined, // Fix #139: Set contentType
      date: stats.mtime.toISOString().split('T')[0],
      summary: `File: ${basename}`,
      content: content,
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

    return [entry];
  }

  // Large file - chunk it by lines (fallback for non-markdown or markdown without headers)
  const entries: SessionEntry[] = [];
  const numChunks = Math.ceil(lines.length / CHUNK_SIZE);

  for (let i = 0; i < numChunks; i++) {
    const startLine = i * CHUNK_SIZE;
    const endLine = Math.min((i + 1) * CHUNK_SIZE, lines.length);
    const chunkLines = lines.slice(startLine, endLine);
    const chunkContent = chunkLines.join('\n');

    const entry: SessionEntry = {
      id: `${relativePath}:${startLine + 1}-${endLine}`,
      contentType: contentType || undefined, // Fix #139: Set contentType
      date: stats.mtime.toISOString().split('T')[0],
      summary: `File: ${basename} (lines ${startLine + 1}-${endLine})`,
      content: chunkContent,
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

    entries.push(entry);
  }

  return entries;
}

/**
 * Parse all files in a directory into SessionEntries (Fix #139)
 * Issue #9: Supports LLM-based code extraction when extractCodeFacts is enabled
 */
export async function parseGenericFiles(
  rootPath: string,
  config?: MemoryConfig,
  onProgress?: (current: number, total: number, stage: string) => void
): Promise<SessionEntry[]> {
  const files = await discoverFiles(rootPath, config);
  const entries: SessionEntry[] = [];

  // Issue #9: Set up code extraction config if enabled
  let extractorConfig: Partial<CodeExtractorConfig> | undefined;
  if (config?.extractCodeFacts) {
    const available = await isCodeExtractionAvailable({
      model: config.codeExtractionModel || 'qwen2.5:3b',
    });
    if (available) {
      extractorConfig = {
        model: config.codeExtractionModel || 'qwen2.5:3b',
        cachePath: path.join(rootPath, '.gordo-memory', 'code-extracts'),
      };
      onProgress?.(0, files.length, 'Extracting code semantics...');
    } else {
      console.warn('Code extraction requested but model not available');
    }
  }

  let processed = 0;
  for (const file of files) {
    const fileEntries = await parseFile(file, rootPath, config, extractorConfig);
    entries.push(...fileEntries);
    processed++;
    if (extractorConfig && processed % 10 === 0) {
      onProgress?.(processed, files.length, 'Extracting code semantics...');
    }
  }

  return entries;
}

// Re-export for use in memory-manager
export { isCodeExtractionAvailable };
