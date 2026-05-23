/**
 * Core memory manager v2 - orchestrates embeddings, HNSW indexer, and journal parsing
 * Uses Session 33-34 TDD implementations (47/47 tests passing)
 */

import type {
  MemoryConfig,
  SessionEntry,
  SearchOptions,
  SearchResult,
} from './types.js';
import { createJournalParser } from './parser/journal-parser-v2.js';
import { parseGenericFiles, setJournalParsingFailed } from './parser/generic-file-parser.js';
import { parseIssuesAndCommits } from './parser/issue-commit-parser.js';
import { extractConversations, isExtractionAvailable } from './parser/conversation-extractor.js';
import { createEmbeddingProvider, type EmbeddingConfig } from './embeddings/provider.js';
import { rerank, isRerankerAvailable } from './reranker.js';
import { createHNSWIndexer, type HNSWConfig } from './indexer/hnsw-indexer.js';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

// Mirrors the per-document hash computed by the indexer's extractMetadata.
// Used by incremental indexing to detect whether a document's content changed
// since it was last indexed. Must use the same algorithm + input as the
// indexer to compare correctly.
function computeContentHash(content: string): string {
  return createHash('sha256').update(content || '').digest('hex');
}

// Git-aware incremental indexing helpers (S337 fix)
interface ChangedCategories {
  sessions: boolean;   // SESSION_LOG.md, GORDO_JOURNAL.md, JOURNAL.md, or sessions/ dir
  issues: boolean;     // .gordo-memory/github-issues/*
  commits: boolean;    // .gordo-memory/git-commits/*
  docsCode: boolean;   // Any other files that might be docs/code
  changedFiles: string[];  // For selective docs/code parsing
}

function getLastIndexedCommit(indexPath: string): string | null {
  const markerPath = path.join(indexPath, 'last-indexed-commit');
  try {
    return fsSync.readFileSync(markerPath, 'utf-8').trim();
  } catch {
    return null;
  }
}

function saveLastIndexedCommit(indexPath: string, commit: string): void {
  const markerPath = path.join(indexPath, 'last-indexed-commit');
  fsSync.writeFileSync(markerPath, commit);
}

function getCurrentCommit(repoPath: string): string | null {
  try {
    // Use /usr/bin/git directly to bypass identity-partition hooks (read-only op)
    return execSync('/usr/bin/git rev-parse HEAD', { cwd: repoPath, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function getChangedFilesSince(repoPath: string, sinceCommit: string): string[] {
  try {
    // Use /usr/bin/git directly to bypass identity-partition hooks (read-only op)
    const output = execSync(`/usr/bin/git diff --name-only ${sinceCommit}..HEAD`, {
      cwd: repoPath,
      encoding: 'utf-8',
    });
    return output.split('\n').filter(f => f.trim());
  } catch {
    return [];
  }
}

function categorizeChanges(changedFiles: string[]): ChangedCategories {
  const result: ChangedCategories = {
    sessions: false,
    issues: false,
    commits: false,
    docsCode: false,
    changedFiles,
  };

  for (const file of changedFiles) {
    // Session files
    if (file === 'SESSION_LOG.md' || file === 'GORDO_JOURNAL.md' || file === 'JOURNAL.md' ||
        file.startsWith('sessions/')) {
      result.sessions = true;
    }
    // Issue files
    else if (file.startsWith('.gordo-memory/github-issues/')) {
      result.issues = true;
    }
    // Commit files
    else if (file.startsWith('.gordo-memory/git-commits/')) {
      result.commits = true;
    }
    // Everything else is potentially docs/code
    else if (!file.startsWith('.gordo-memory/')) {
      result.docsCode = true;
    }
  }

  return result;
}

export class MemoryManager {
  private config: MemoryConfig;
  private embedder: ReturnType<typeof createEmbeddingProvider>;
  private indexer: ReturnType<typeof createHNSWIndexer>;
  private parser: ReturnType<typeof createJournalParser>;
  private initialized: boolean = false;

  constructor(config: MemoryConfig) {
    this.config = config;

    // Initialize embedding provider
    const embeddingConfig: EmbeddingConfig = {
      type: config.provider as 'ollama' | 'openai',
      model: config.model,
      openaiApiKey: config.openaiApiKey,
      ollamaUrl: config.ollamaUrl || 'http://localhost:11434'
    };

    this.embedder = createEmbeddingProvider(embeddingConfig);

    // Initialize HNSW indexer
    const hnswConfig: HNSWConfig = {
      indexPath: config.indexPath,
      vectorSize: this.getVectorSize(config.model),
      maxElements: 10000,
      m: 16,
      efConstruction: 200
    };

    this.indexer = createHNSWIndexer(hnswConfig);

    // Initialize parser
    this.parser = createJournalParser();
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.indexer.initialize();
    this.initialized = true;
  }

  async indexRepository(
    repoPath: string,
    incremental: boolean = true,
    onProgress?: (current: number, total: number, stage: string) => void
  ): Promise<{ indexed: number; skipped: number }> {
    if (!this.initialized) {
      await this.initialize();
    }

    // S337 fix: Git-aware incremental indexing
    // Check what files changed since last index to avoid parsing unchanged content.
    let changedCategories: ChangedCategories | null = null;
    const currentCommit = getCurrentCommit(repoPath);

    if (incremental && currentCommit) {
      const lastCommit = getLastIndexedCommit(this.config.indexPath);
      // Only use git-aware optimization when commits differ.
      // When marker === HEAD, we're either in a pre-commit hook (HEAD hasn't moved)
      // or running after a failed prior index. Either way, fall through to
      // content-based comparison.
      if (lastCommit && lastCommit !== currentCommit) {
        const changedFiles = getChangedFilesSince(repoPath, lastCommit);
        if (changedFiles.length === 0) {
          // No files changed since last index - update marker and return
          onProgress?.(0, 0, 'No changes since last index');
          saveLastIndexedCommit(this.config.indexPath, currentCommit);
          return { indexed: 0, skipped: 0 };
        }
        changedCategories = categorizeChanges(changedFiles);
        const categories = [
          changedCategories.sessions && 'sessions',
          changedCategories.issues && 'issues',
          changedCategories.commits && 'commits',
          changedCategories.docsCode && 'docs/code',
        ].filter(Boolean).join(', ');
        onProgress?.(0, 0, `Changed: ${categories} (${changedFiles.length} files)`);
      }
    }

    // Auto-detect journal type and parse
    const journalType = await this.detectJournalType(repoPath);
    let sessions: SessionEntry[] = [];

    // Only parse sessions if changed (or if no git tracking / full reindex)
    if (!changedCategories || changedCategories.sessions) {
      onProgress?.(0, 0, 'Parsing journal...');

      if (journalType === 'hierarchical') {
        const sessionsDir = path.join(repoPath, 'sessions');
        sessions = await this.parser.parseHierarchicalStructure(sessionsDir);
      } else if (journalType === 'flat') {
        // Resolve the actual journal file. Order: GORDO_JOURNAL.md (Fix #136) →
        // SESSION_LOG.md (project-gordo-backchannel and adopters using flat session log) →
        // JOURNAL.md (legacy fallback).
        const candidates = [
          path.join(repoPath, 'GORDO_JOURNAL.md'),
          path.join(repoPath, 'SESSION_LOG.md'),
          path.join(repoPath, 'JOURNAL.md'),
        ];

        let journalFilePath = candidates[candidates.length - 1]; // default to JOURNAL.md
        for (const candidate of candidates) {
          try {
            await fs.access(candidate);
            journalFilePath = candidate;
            break;
          } catch {
            // try next
          }
        }

        sessions = await this.parser.parseJournalFile(journalFilePath);
      }
    }

    // Fix F-004: If journal exists but parsing returned 0 sessions,
    // allow generic file parser to index it as a document
    const journalSessionCount = sessions.filter(s => s.contentType === 'session').length;
    setJournalParsingFailed(journalType === 'flat' && journalSessionCount === 0);

    // Fix #137: Three-Layer Memory - also index GitHub issues and git commits
    // Only parse if changed (or if no git tracking / full reindex)
    if (!changedCategories || changedCategories.issues || changedCategories.commits) {
      onProgress?.(0, 0, 'Parsing issues and commits...');
      const issuesAndCommits = await parseIssuesAndCommits(repoPath);
      sessions = [...sessions, ...issuesAndCommits];
    }

    // Fix #142: Five-Layer Memory - index docs/code if enabled.
    // Outer-gate defaults match the per-file gate in generic-file-parser.ts:
    // indexDocs defaults to true (docs are useful and small), indexCode defaults
    // to false (opt-in due to volume/noise). Adopters without an explicit
    // config.json still get documentation indexing.
    const wantDocs = this.config.indexDocs ?? true;
    const wantCode = this.config.indexCode ?? false;
    if ((wantDocs || wantCode) && (!changedCategories || changedCategories.docsCode)) {
      onProgress?.(0, 0, 'Indexing documentation and code...');
      const genericFiles = await parseGenericFiles(repoPath, this.config);
      sessions = [...sessions, ...genericFiles];
    }

    // Fix #4: EverMemOS conversation extraction - extract episodes and atomic facts
    // from session content for improved conversational memory retrieval.
    // v2.2: Parallel batching + retry logic + incremental extraction cache.
    if (this.config.extractConversations) {
      const extractionAvailable = await isExtractionAvailable();
      if (extractionAvailable) {
        onProgress?.(0, 0, 'Extracting conversations...');
        const { entries: extracted, stats } = await extractConversations(sessions, onProgress, {
          batchSize: 15,
          incremental,
          repoPath,
          contentTypes: this.config.extractContentTypes || ['session', 'docs'],
        });
        sessions = [...sessions, ...extracted];
        if (stats.failed > 0) {
          console.warn(`Extraction: ${stats.failed} items failed after retries`);
        }
      } else {
        console.warn('Conversation extraction requested but Python dependencies not available');
      }
    }

    let indexed = 0;
    let skipped = 0;

    // Track which sessions need indexing
    const toIndex: SessionEntry[] = [];

    if (incremental) {
      // Check which sessions are already indexed AND whose content hasn't changed.
      // Content-equality compare propagates updates to existing entries (e.g., a
      // session entry that has had EOS narrative appended after the initial
      // open-marker index). For entries with a stored contentHash, compare hashes
      // (cheap). For legacy entries indexed before contentHash existed, fall back
      // to direct content compare so they don't all trigger spurious reindex on
      // the first post-upgrade run.
      //
      // S339 fix: Use getAllDocuments() once instead of N individual getDocument()
      // calls. Each getDocument() call does fs.stat() for staleness check, which
      // caused 336 file stats per commit (gordo-ledger#8).
      onProgress?.(0, sessions.length, 'Checking existing sessions...');

      // Build lookup map from all indexed documents (synchronous, no staleness checks)
      const allDocs = this.indexer.getAllDocuments();
      const docMap = new Map<string, { contentHash?: string; content: string }>();
      for (const doc of allDocs) {
        docMap.set(doc.id, {
          contentHash: doc.metadata.contentHash,
          content: doc.text,
        });
      }

      let checked = 0;
      let lastProgressTime = Date.now();
      for (const session of sessions) {
        const existing = docMap.get(session.id);
        if (!existing) {
          toIndex.push(session);
        } else {
          const contentMatches = existing.contentHash !== undefined
            ? existing.contentHash === computeContentHash(session.content)
            : existing.content === session.content;

          if (!contentMatches) {
            // Content changed. Delete + re-add (which also populates contentHash).
            await this.indexer.deleteDocument(session.id);
            toIndex.push(session);
          } else {
            skipped++;
          }
        }
        checked++;
        // Report every 10 items OR every 5 seconds
        const now = Date.now();
        if (checked % 10 === 0 || checked === sessions.length || now - lastProgressTime >= 5000) {
          onProgress?.(checked, sessions.length, 'Checking existing sessions...');
          lastProgressTime = now;
        }
      }

      // Prune orphaned entries (files that were moved or deleted from disk)
      // S339 fix: Only prune when doing a full parse (no changedCategories).
      // When git-aware optimization is active, we only parsed changed categories,
      // so we can't safely detect orphans in unparsed categories. Orphaned
      // documents will be caught on the next full reindex.
      if (!changedCategories) {
        const allIndexedDocs = this.indexer.getAllDocuments();
        const currentFileIds = new Set(sessions.map(s => s.id));
        let pruned = 0;

        for (const doc of allIndexedDocs) {
          if (!currentFileIds.has(doc.id)) {
            await this.indexer.deleteDocument(doc.id);
            pruned++;
          }
        }

        if (pruned > 0) {
          onProgress?.(pruned, pruned, `Pruned ${pruned} orphaned entries`);
        }
      }
    } else {
      // Full reindex
      toIndex.push(...sessions);
    }

    if (toIndex.length === 0) {
      // S337: Save commit marker even when nothing needed indexing
      if (currentCommit) {
        saveLastIndexedCommit(this.config.indexPath, currentCommit);
      }
      return { indexed, skipped };
    }

    // Generate embeddings with progress tracking
    onProgress?.(0, toIndex.length, 'Generating embeddings...');
    const texts = toIndex.map(s => this.prepareTextForEmbedding(s));

    // Process embeddings in chunks to show progress
    const embeddings: number[][] = [];
    const chunkSize = 10; // Process 10 at a time for progress feedback
    let lastProgressTime = Date.now();

    for (let i = 0; i < texts.length; i += chunkSize) {
      const chunk = texts.slice(i, i + chunkSize);
      const chunkEmbeddings = await this.embedder.generateEmbeddings(chunk);
      embeddings.push(...chunkEmbeddings);

      const processed = Math.min(i + chunkSize, texts.length);
      const now = Date.now();
      // Report every chunk OR every 5 seconds
      if (now - lastProgressTime >= 5000 || processed === texts.length) {
        onProgress?.(processed, toIndex.length, 'Generating embeddings...');
        lastProgressTime = now;
      } else if ((i + chunkSize) % 50 === 0) {
        // Also report every 50 items to show steady progress
        onProgress?.(processed, toIndex.length, 'Generating embeddings...');
      }
    }

    // Add to HNSW indexer (sessions and embeddings arrays separately)
    await this.indexer.addDocuments(toIndex, embeddings, (current, total, phase) => {
      onProgress?.(current, total, phase);
    });
    indexed = toIndex.length;

    // S337: Save commit marker after successful index
    if (currentCommit) {
      saveLastIndexedCommit(this.config.indexPath, currentCommit);
    }

    return { indexed, skipped };
  }

  async search(options: SearchOptions): Promise<SearchResult[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Generate embedding for query
    const queryEmbedding = await this.embedder.generateEmbedding(options.query);

    // Prepare filters for HNSW indexer
    const filters: any = {};

    if (options.dateRange) {
      filters.dateRange = options.dateRange;
    }

    // Search using hybrid search (0.7 dense + 0.3 BM25)
    const limit = options.limit || 5;
    const threshold = options.threshold || this.config.threshold;

    // Retrieve more candidates for reranking (3x limit, min 20)
    const retrieveLimit = Math.max(limit * 3, 20);

    let hnswResults = await this.indexer.hybridSearch(
      queryEmbedding,
      options.query, // queryText for BM25
      retrieveLimit,
      threshold,
      filters
    );

    // S338: Cross-encoder reranking for improved accuracy
    // Reranks top candidates using DeepInfra's Qwen3-Reranker-4B
    if (this.config.rerankerEnabled !== false && hnswResults.length > 1) {
      try {
        const reranked = await rerank(
          options.query,
          hnswResults.map(r => ({
            id: r.id,
            content: r.content,
            score: r.score,
            metadata: r.metadata,
          })),
          { enabled: true, topK: 20 }
        );

        // Update results with reranker scores
        hnswResults = reranked.map(r => ({
          id: r.id,
          content: r.content,
          score: r.score,
          similarity: r.score, // Use reranker score as similarity
          metadata: r.metadata,
        }));
      } catch (error) {
        // Reranker failed, continue with original results
        console.warn('Reranker error, using original ranking:', error);
      }
    }

    // Limit to requested number after reranking
    hnswResults = hnswResults.slice(0, limit);

    // Convert HNSW results to expected SearchResult format
    // Default: truncate content to avoid MCP token limits (Issue #126)
    const includeFullContent = options.includeFullContent ?? false;
    const maxLength = options.maxContentLength ?? 500;

    // Default hierarchical boost multipliers (prioritize extracted conversations and sessions)
    // S337: Added 'memory' type for auto-memory files (behavioral guidance, preferences)
    const defaultBoost = {
      conversation: 2.5,
      memory: 2.0,     // S337: Auto-memory files contain behavioral guidance
      session: 2.0,
      issue: 1.5,
      commit: 1.2,
      docs: 1.0,
      code: 0.5,
    };
    const boost = { ...defaultBoost, ...this.config.hierarchicalBoost };

    const results: SearchResult[] = hnswResults.map((result) => {
      const fullContent = result.content;
      const shouldTruncate = !includeFullContent && fullContent.length > maxLength;

      // Apply hierarchical boost based on content type
      const contentType = result.metadata.contentType as keyof typeof boost;
      const boostMultiplier = boost[contentType] ?? 1.0;
      const boostedSimilarity = Math.min(result.similarity * boostMultiplier, 1.0);

      return {
        sessionId: result.id,
        similarity: boostedSimilarity,
        content: shouldTruncate
          ? fullContent.substring(0, maxLength) + '...'
          : fullContent,
        contentTruncated: shouldTruncate,
        summary: result.metadata.summary,
        date: result.metadata.date,
        rank: 0, // Will be set after sorting
        contentType: result.metadata.contentType,
      };
    });

    // Re-sort by boosted similarity and assign ranks
    results.sort((a, b) => b.similarity - a.similarity);
    results.forEach((r, i) => r.rank = i + 1);

    // Apply additional pattern filters (if needed)
    let filtered = results;

    if (options.includePatterns && options.includePatterns.length > 0) {
      filtered = filtered.filter(r =>
        options.includePatterns!.some(pattern =>
          r.content.toLowerCase().includes(pattern.toLowerCase())
        )
      );
    }

    if (options.excludePatterns && options.excludePatterns.length > 0) {
      filtered = filtered.filter(r =>
        !options.excludePatterns!.some(pattern =>
          r.content.toLowerCase().includes(pattern.toLowerCase())
        )
      );
    }

    // Content type filtering
    if (options.contentTypes && options.contentTypes.length > 0) {
      filtered = filtered.filter(r =>
        options.contentTypes!.includes((r as any).contentType)
      );
    }

    return filtered;
  }

  async getSession(sessionId: string): Promise<SessionEntry | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    const doc = await this.indexer.getDocument(sessionId);
    if (!doc) return null;

    // The document already has SessionEntry fields, just return it
    return {
      id: doc.id,
      date: doc.date,
      content: doc.content,
      summary: doc.summary,
      patterns: doc.patterns,
      issues: doc.issues,
      signals: doc.signals
    };
  }

  async reindex(
    repoPath: string,
    onProgress?: (current: number, total: number, stage: string) => void
  ): Promise<{ indexed: number }> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Clear existing index
    onProgress?.(0, 0, 'Clearing existing index...');
    await this.indexer.clear();

    // Full reindex
    const result = await this.indexRepository(repoPath, false, onProgress);
    return { indexed: result.indexed };
  }

  async getStats(): Promise<{
    totalIndexedDocuments: number;
    indexPath: string;
    provider: string;
    layerCounts?: Record<string, number>;
    extractionCache?: { count: number; version: string };
    lastIndexedAt?: string;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    const baseStats = {
      totalIndexedDocuments: this.indexer.getCount(),
      indexPath: this.config.indexPath,
      provider: this.config.provider,
    };

    // Try to add layer counts from metadata
    try {
      const metadataPath = path.join(this.config.indexPath, 'metadata.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      const layerCounts: Record<string, number> = {};
      let lastIndexedAt = '';

      for (const doc of Object.values(metadata.documents || {}) as any[]) {
        const type = doc.contentType || 'unknown';
        layerCounts[type] = (layerCounts[type] || 0) + 1;
        if (doc.indexedAt && doc.indexedAt > lastIndexedAt) {
          lastIndexedAt = doc.indexedAt;
        }
      }

      Object.assign(baseStats, { layerCounts, lastIndexedAt: lastIndexedAt || undefined });
    } catch {
      // Metadata not available
    }

    // Try to add extraction cache info
    try {
      const cachePath = path.join(this.config.indexPath, 'extraction-cache.json');
      const cache = JSON.parse(await fs.readFile(cachePath, 'utf-8'));
      Object.assign(baseStats, {
        extractionCache: {
          count: Object.keys(cache.entries || {}).length,
          version: cache.version || 'unknown',
        },
      });
    } catch {
      // Cache not available
    }

    return baseStats;
  }

  async getAllSessions(): Promise<SessionEntry[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    // Get all documents from indexer
    const allDocuments = this.indexer.getAllDocuments();

    // Convert documents back to SessionEntry format
    return allDocuments.map(doc => ({
      id: doc.id,
      date: doc.metadata?.date || '',
      summary: doc.metadata?.summary || '',
      content: doc.text,
      patterns: doc.metadata?.patterns || [],
      issues: doc.metadata?.issues || [],
      signals: doc.metadata?.signals || []
    }));
  }

  private getVectorSize(model: string): number {
    // Map model names to their embedding dimensions
    const MODEL_DIMENSIONS: Record<string, number> = {
      // OpenAI models
      'text-embedding-3-large': 3072,
      'text-embedding-3-small': 1536,
      'text-embedding-ada-002': 1536,

      // Ollama models
      'mxbai-embed-large': 1024,
      'nomic-embed-text': 768,
    };

    // Normalize Ollama model names: strip tags (e.g., "mxbai-embed-large:latest" -> "mxbai-embed-large")
    const normalizedModel = model.split(':')[0];

    const dimensions = MODEL_DIMENSIONS[normalizedModel];
    if (!dimensions) {
      throw new Error(
        `Unknown embedding model: ${model}. ` +
        `Supported models: ${Object.keys(MODEL_DIMENSIONS).join(', ')}`
      );
    }

    return dimensions;
  }

  private async detectJournalType(repoPath: string): Promise<'flat' | 'hierarchical' | 'generic'> {
    // Check for hierarchical structure first
    const sessionsDir = path.join(repoPath, 'sessions');
    try {
      await fs.access(sessionsDir);
      const stats = await fs.stat(sessionsDir);
      if (stats.isDirectory()) {
        // Fix F-001: Only return 'hierarchical' if sessions/ contains actual session dirs
        // Match the same pattern as journal-parser-v2: startsWith('Session_')
        const entries = await fs.readdir(sessionsDir);
        const hasSessionDirs = entries.some(entry => entry.startsWith('Session_'));
        if (hasSessionDirs) {
          return 'hierarchical';
        }
        // Empty sessions/ dir — fall through to flat check
      }
    } catch {
      // Fall through to flat check
    }

    // Check for flat journal: GORDO_JOURNAL.md (Fix #136) → SESSION_LOG.md → JOURNAL.md.
    const flatCandidates = ['GORDO_JOURNAL.md', 'SESSION_LOG.md', 'JOURNAL.md'];
    for (const filename of flatCandidates) {
      try {
        await fs.access(path.join(repoPath, filename));
        return 'flat';
      } catch {
        // try next candidate
      }
    }
    // No structured journal found - use generic file indexing
    return 'generic';
  }

  private prepareTextForEmbedding(session: SessionEntry): string {
    // Combine multiple fields for richer semantic understanding
    const parts: string[] = [];

    if (session.summary) {
      parts.push(`Summary: ${session.summary}`);
    }

    if (session.patterns && session.patterns.length > 0) {
      parts.push(`Patterns: ${session.patterns.join(', ')}`);
    }

    if (session.issues && session.issues.length > 0) {
      parts.push(`Issues: ${session.issues.join(', ')}`);
    }

    // Add content (full or truncated)
    const contentPreview = session.content.substring(0, 2000);
    parts.push(contentPreview);

    return parts.join('\n\n');
  }
}
