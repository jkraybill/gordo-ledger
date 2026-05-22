/**
 * Conversation Extractor Integration
 *
 * Wraps the Python EverMemOS-based extraction pipeline to transform
 * raw session content into structured episodes and atomic facts.
 *
 * This implements Option C from gordo-ledger#4: use EverMemOS extraction
 * pipeline, store results in Ledger's existing infrastructure.
 */

import { spawn } from 'child_process';
import path from 'path';
import type { SessionEntry } from '../types.js';

const EXTRACTOR_PATH = path.join(
  process.env.HOME || '/home/jk',
  'gordo-ledger/src/extraction/extract.py'
);

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

/**
 * Call the Python extractor for a single session.
 */
async function extractSession(
  text: string,
  timestamp: string,
  sessionId?: string
): Promise<ExtractionResult | null> {
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
 * Transform extracted content into a SessionEntry for indexing.
 * Creates a 'conversation' type entry with the episode narrative
 * and atomic facts combined for searchability.
 */
function extractionToEntry(
  original: SessionEntry,
  extraction: ExtractionResult
): SessionEntry {
  // Combine episode + facts into searchable content
  const factsText = extraction.atomic_facts.facts.length > 0
    ? '\n\nAtomic Facts:\n' + extraction.atomic_facts.facts.map(f => `- ${f}`).join('\n')
    : '';

  const content = `# ${extraction.episode.title}

${extraction.episode.content}
${factsText}`;

  return {
    id: `${original.id}_extracted`,
    contentType: 'conversation' as any, // New type
    date: original.date,
    content,
    summary: extraction.episode.title,
    patterns: original.patterns,
    issues: original.issues,
    signals: original.signals,
    metadata: {
      ...original.metadata,
      sourceSessionId: original.id,
      extractedAt: extraction.metadata.extracted_at,
      extractorVersion: extraction.metadata.extractor_version,
      atomicFactCount: extraction.atomic_facts.facts.length,
    },
  };
}

/**
 * Extract conversation content from session entries.
 * Returns new entries with contentType 'conversation' containing
 * structured episodes and atomic facts.
 *
 * Only processes entries with contentType 'session'.
 */
export async function extractConversations(
  sessions: SessionEntry[],
  onProgress?: (current: number, total: number, stage: string) => void
): Promise<SessionEntry[]> {
  const sessionEntries = sessions.filter(s => s.contentType === 'session');

  if (sessionEntries.length === 0) {
    return [];
  }

  const extracted: SessionEntry[] = [];
  let processed = 0;

  onProgress?.(0, sessionEntries.length, 'Extracting conversations...');

  for (const session of sessionEntries) {
    const result = await extractSession(
      session.content,
      `${session.date}T00:00:00Z`,
      session.id
    );

    if (result) {
      extracted.push(extractionToEntry(session, result));
    }

    processed++;
    if (processed % 5 === 0 || processed === sessionEntries.length) {
      onProgress?.(processed, sessionEntries.length, 'Extracting conversations...');
    }
  }

  return extracted;
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
