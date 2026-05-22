/**
 * Conversation Extractor Integration
 *
 * Wraps the Python EverMemOS-based extraction pipeline to transform
 * raw session content into structured episodes and atomic facts.
 *
 * This implements Option C from gordo-ledger#4: use EverMemOS extraction
 * pipeline, store results in Ledger's existing infrastructure.
 *
 * v2.1: Parallel batch processing + retry logic + incremental support
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { SessionEntry } from '../types.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Use v2 extractor with Gordo-optimized prompts and structured output
const EXTRACTOR_PATH = path.join(
  process.env.HOME || '/home/jk',
  'gordo-ledger/src/extraction/extract_v2.py'
);

// v2 extraction result structure
interface ExtractionResultV2 {
  episode: {
    summary: string;
    decisions: string[];
    actions: string[];
    patterns: string[];
    topics: string[];
  };
  facts: {
    who: string[];
    what: string[];
    decisions: string[];
    references: {
      sessions: string[];
      issues: string[];
      commits: string[];
      files: string[];
    };
    handoff: string[];
  };
  metadata: {
    session_id: string | null;
    session_number: number | null;
    duration_mentioned: string | null;
    wwgd_max_level: string | null;
    extracted_at: string;
    extractor_version: string;
  };
  formatted_content: string;
}

// Keep old interface for backwards compatibility
interface ExtractionResult {
  episode: {
    title: string;
    content: string;
  };
  atomic_facts: {
    time: string;
    facts: string[];
  };
  metadata: {
    session_id: string | null;
    extracted_at: string;
    extractor_version: string;
  };
}

// Cache for incremental extraction - maps content hash to extraction result
interface ExtractionCache {
  version: string;
  entries: Record<string, { hash: string; extractedAt: string }>;
}

// Statistics for extraction runs
export interface ExtractionStats {
  total: number;
  extracted: number;
  failed: number;
  skipped: number;
  durationMs: number;
  itemsPerMinute: number;
}

function getContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

function loadExtractionCache(repoPath: string): ExtractionCache {
  const cachePath = path.join(repoPath, '.gordo-memory', 'extraction-cache.json');
  try {
    if (fs.existsSync(cachePath)) {
      return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    }
  } catch (e) {
    // Cache corrupted, start fresh
  }
  return { version: '2.1.0', entries: {} };
}

function saveExtractionCache(repoPath: string, cache: ExtractionCache): void {
  const cachePath = path.join(repoPath, '.gordo-memory', 'extraction-cache.json');
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Call the Python v2 extractor for a single session (single attempt).
 */
function extractSessionOnce(
  text: string,
  timestamp: string,
  sessionId?: string
): Promise<ExtractionResultV2 | null> {
  return new Promise((resolve) => {
    const input = JSON.stringify({
      text,
      timestamp,
      session_id: sessionId,
    });

    const proc = spawn('python3', [EXTRACTOR_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`Extraction failed for ${sessionId}: ${stderr}`);
        resolve(null);
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve(result);
      } catch (e) {
        console.error(`Failed to parse extraction result for ${sessionId}: ${e}`);
        resolve(null);
      }
    });

    proc.on('error', (err) => {
      console.error(`Failed to spawn extractor: ${err}`);
      resolve(null);
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}

/**
 * Call the Python v2 extractor with retry logic.
 */
async function extractSession(
  text: string,
  timestamp: string,
  sessionId?: string
): Promise<ExtractionResultV2 | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await extractSessionOnce(text, timestamp, sessionId);
    if (result) {
      return result;
    }
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }
  console.error(`Extraction failed after ${MAX_RETRIES} retries for ${sessionId}`);
  return null;
}

/**
 * Transform v2 extracted content into a SessionEntry for indexing.
 * Uses pre-formatted content optimized for search with:
 * - Concise summary
 * - Categorized decisions/actions/patterns
 * - Cross-references
 */
function extractionToEntry(
  original: SessionEntry,
  extraction: ExtractionResultV2
): SessionEntry {
  // Combine formatted summary WITH original content for fact retrieval
  // Fix: summaries alone lose specific facts (S18 benchmark: 50%→40%)
  const content = `${extraction.formatted_content}\n\n---\n## Original Content\n${original.content}`;

  // Build summary from episode
  const summary = extraction.episode.summary || `Session ${extraction.metadata.session_number} summary`;

  // Merge extracted issues with original
  const extractedIssues = (extraction.facts.references?.issues || []).map(i => `#${i}`);
  const allIssues = [...new Set([...(original.issues || []), ...extractedIssues])];

  return {
    id: `${original.id}_extracted`,
    contentType: 'conversation' as any,
    date: original.date,
    content,
    summary,
    patterns: [...(original.patterns || []), ...(extraction.episode.patterns || [])],
    issues: allIssues,
    signals: original.signals,
    metadata: {
      ...original.metadata,
      sourceSessionId: original.id,
      sessionNumber: extraction.metadata.session_number,
      wwgdMaxLevel: extraction.metadata.wwgd_max_level,
      extractedAt: extraction.metadata.extracted_at,
      extractorVersion: extraction.metadata.extractor_version,
      topics: extraction.episode.topics,
      decisionCount: extraction.episode.decisions?.length || 0,
      actionCount: extraction.episode.actions?.length || 0,
      referencedSessions: extraction.facts.references?.sessions || [],
    },
  };
}

/**
 * Extract conversation content from session entries.
 * Returns new entries with contentType 'conversation' containing
 * structured episodes and atomic facts.
 *
 * Processes entries with contentType 'session' or 'docs' (for conversational content).
 * See issue #5 for future heuristic detection.
 *
 * v2.2: Parallel batch processing + retry logic + incremental extraction.
 */
export async function extractConversations(
  sessions: SessionEntry[],
  onProgress?: (current: number, total: number, stage: string) => void,
  options: {
    batchSize?: number;
    incremental?: boolean;
    repoPath?: string;
    contentTypes?: string[];
  } = {}
): Promise<{ entries: SessionEntry[]; stats: ExtractionStats }> {
  const {
    batchSize = 15,
    incremental = true,
    repoPath = process.cwd(),
    contentTypes = ['session', 'docs'],
  } = options;
  const startTime = Date.now();

  const sessionEntries = sessions.filter(s =>
    contentTypes.includes(s.contentType || '')
  );

  if (sessionEntries.length === 0) {
    return {
      entries: [],
      stats: { total: 0, extracted: 0, failed: 0, skipped: 0, durationMs: 0, itemsPerMinute: 0 }
    };
  }

  // Load extraction cache for incremental mode
  const cache = incremental ? loadExtractionCache(repoPath) : { version: '2.2.0', entries: {} };
  let skipped = 0;

  // Filter out already-extracted entries in incremental mode
  const toExtract = incremental
    ? sessionEntries.filter(s => {
        const hash = getContentHash(s.content);
        if (cache.entries[s.id]?.hash === hash) {
          skipped++;
          return false;
        }
        return true;
      })
    : sessionEntries;

  if (skipped > 0) {
    console.log(`Incremental: skipping ${skipped} already-extracted entries`);
  }

  if (toExtract.length === 0) {
    onProgress?.(sessionEntries.length, sessionEntries.length, 'All entries cached');
    const durationMs = Date.now() - startTime;
    return {
      entries: [],
      stats: { total: sessionEntries.length, extracted: 0, failed: 0, skipped, durationMs, itemsPerMinute: 0 }
    };
  }

  const extracted: SessionEntry[] = [];
  let processed = 0;
  let failed = 0;

  onProgress?.(0, toExtract.length, `Extracting (batch=${batchSize})...`);

  // Process in parallel batches
  for (let i = 0; i < toExtract.length; i += batchSize) {
    const batch = toExtract.slice(i, i + batchSize);

    // Run batch in parallel
    const results = await Promise.all(
      batch.map(session =>
        extractSession(
          session.content,
          `${session.date}T00:00:00Z`,
          session.id
        ).then(result => ({ session, result }))
      )
    );

    // Collect successful extractions and update cache
    for (const { session, result } of results) {
      if (result) {
        extracted.push(extractionToEntry(session, result));
        cache.entries[session.id] = {
          hash: getContentHash(session.content),
          extractedAt: new Date().toISOString(),
        };
      } else {
        failed++;
      }
      processed++;
    }

    onProgress?.(processed, toExtract.length, `Extracting (batch=${batchSize})...`);
  }

  // Save updated cache
  if (incremental && extracted.length > 0) {
    saveExtractionCache(repoPath, cache);
  }

  const durationMs = Date.now() - startTime;
  const itemsPerMinute = durationMs > 0 ? Math.round((processed / durationMs) * 60000) : 0;

  const stats: ExtractionStats = {
    total: sessionEntries.length,
    extracted: extracted.length,
    failed,
    skipped,
    durationMs,
    itemsPerMinute,
  };

  console.log(`Extraction complete: ${extracted.length} extracted, ${failed} failed, ${skipped} skipped (${itemsPerMinute}/min)`);

  return { entries: extracted, stats };
}

/**
 * Check if extraction is available (Python + dependencies installed).
 */
export async function isExtractionAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('python3', ['-c', 'import httpx; print("ok")'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.on('close', (code) => {
      resolve(code === 0);
    });

    proc.on('error', () => {
      resolve(false);
    });
  });
}
