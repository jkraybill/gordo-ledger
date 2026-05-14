/**
 * Core types for gordo-memory MCP server
 */

export interface MemoryConfig {
  enabled: boolean;
  provider: 'openai' | 'ollama' | 'local';
  model: string;
  threshold: number;
  indexPath: string;
  autoIndex: boolean;
  openaiApiKey?: string;
  ollamaUrl?: string;
  hierarchicalBoost?: {
    session?: number;   // Default: 2.0
    issue?: number;     // Default: 1.5
    commit?: number;    // Default: 1.2
    docs?: number;      // Default: 1.0
    code?: number;      // Default: 0.5
  };
  // Fix #139: Selective indexing controls
  indexDocs?: boolean;  // Default: true - Index documentation files (.md, .txt, etc.)
  indexCode?: boolean;  // Default: false - Index code files (.ts, .js, .py, etc.)
  indexPatterns?: {
    include?: string[]; // Glob patterns to include (e.g., ["docs/**/*.md"])
    exclude?: string[]; // Glob patterns to exclude (e.g., ["node_modules/**"])
  };
}

export interface SessionEntry {
  id: string;              // e.g., "Session_01", "issue-123", "commit-abc1234"
  contentType?: 'session' | 'issue' | 'commit' | 'code' | 'docs';  // For hierarchical weighting (#138)
  date: string;            // ISO date
  content: string;         // Full session content
  summary?: string;        // Brief summary
  patterns?: string[];     // Identified patterns
  issues?: string[];       // Related issue numbers
  signals?: SessionSignals;
  metadata?: Record<string, any>;  // Additional metadata (issue state, commit hash, etc.)
}

export interface SessionSignals {
  success: boolean;        // ✓
  failed: boolean;         // ✗
  warning: boolean;        // ⚠
  ledTo: boolean;          // →
  mixed: boolean;          // ±
  bigChange: boolean;      // Δ
}

export interface SearchResult {
  sessionId: string;
  similarity: number;      // 0-1
  content: string;         // Truncated by default to avoid MCP token limits
  contentTruncated: boolean; // True if content was truncated
  summary?: string;
  date: string;
  rank: number;
}

export interface SearchOptions {
  query: string;
  limit?: number;
  threshold?: number;
  includeFullContent?: boolean;  // Return full content (default: false, returns truncated)
  maxContentLength?: number;     // Max chars per result (default: 500)
  dateRange?: {
    start: string;
    end: string;
  };
  includePatterns?: string[];
  excludePatterns?: string[];
}

export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
}

export interface VectorStore {
  initialize(path: string): Promise<void>;
  addDocument(id: string, embedding: number[], metadata: any): Promise<void>;
  addDocuments(documents: Array<{ id: string; embedding: number[]; metadata: any }>): Promise<void>;
  search(queryEmbedding: number[], limit: number, threshold?: number): Promise<SearchResult[]>;
  getDocument(id: string): Promise<any | null>;
  deleteDocument(id: string): Promise<void>;
  clear(): Promise<void>;
}

export interface JournalParser {
  parseJournalFile(filePath: string): Promise<SessionEntry[]>;
  parseHierarchicalStructure(sessionsDir: string): Promise<SessionEntry[]>;
  detectJournalType(path: string): Promise<'flat' | 'hierarchical'>;
}
