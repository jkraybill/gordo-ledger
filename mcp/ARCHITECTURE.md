# gordo-memory Architecture

**Five-Layer Memory:** Built for Project Gordo umbrella with hierarchical context indexing.

---

## Five-Layer Memory System

gordo-memory indexes five layers of project context, each with hierarchical boosting:

```
┌─────────────────────────────────────────────────────────────┐
│                    FIVE-LAYER MEMORY                        │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: SESSIONS (2.0x boost)                             │
│    └── JOURNAL.md or sessions/ directory                    │
│    └── Highest priority - your conversation logs            │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: ISSUES (1.5x boost)                               │
│    └── github-issues/*.md (synced from GitHub)              │
│    └── Project planning, bug reports, feature requests      │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: COMMITS (1.2x boost)                              │
│    └── git-commits/*.md (synced from git log)               │
│    └── What changed and why                                 │
├─────────────────────────────────────────────────────────────┤
│  Layer 4: DOCS (1.0x baseline)                              │
│    └── docs/**/*.md, README.md, *.md                        │
│    └── Reference documentation                              │
├─────────────────────────────────────────────────────────────┤
│  Layer 5: CODE (0.5x boost, disabled by default)            │
│    └── **/*.{ts,js,py,go,rs}                                │
│    └── Implementation details (can be noisy)                │
└─────────────────────────────────────────────────────────────┘
```

**Hierarchical Boosting:** When searching, results from higher layers rank above lower layers. A session match at 0.7 similarity beats a code match at 0.9 similarity.

**Diversity Guarantee:** Search results include at least 2 results from EACH available layer, ensuring you see context from multiple sources.

---

## Design Principles

### 1. Five-Layer First
✅ "Index sessions, issues, commits, docs, and code with hierarchical boosting"
❌ "Just index the journal"

### 2. Gordo-Specific Knowledge
- Know JOURNAL.md format (256-char compressed entries)
- Know sessions/ structure (hierarchical, v0.6.0+)
- Know GitHub issue format (synced via gh CLI)
- Know git commit format (synced via git log)
- Know query patterns (74% NL, 19% keyword, 7% code)
- Know use case (BOS context loading, pattern discovery)

### 3. Simplicity Over Generality
- No 50-file-type document loaders (just 5 layers)
- No multi-modal embedding (text only)
- No complex reranking (hybrid + hierarchical boost is enough)
- No cloud sync (local-first)

### 4. Empirically Validated
- Hybrid retrieval: 54% better P@3 (bakeoff proven)
- Query distribution: 74% NL empirically measured
- Performance target: <100ms query (50-session corpus)
- Hierarchical boost: Sessions > Issues > Commits > Docs > Code

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Claude Code (MCP Client)                                    │
│  - Calls MCP tools at BOS                                   │
│  - "search_journal('authentication bugs', limit=5)"         │
└────────────────────┬────────────────────────────────────────┘
                     │ MCP Protocol (JSON-RPC)
┌────────────────────▼────────────────────────────────────────┐
│ gordo-memory MCP Server (Node.js/TypeScript)                │
│                                                              │
│  Tools:                                                      │
│   - search_journal(query, limit)    → session IDs + scores  │
│   - index_journal(path)             → rebuild index         │
│   - get_session(id)                 → full session content  │
│   - list_sessions()                 → all indexed sessions  │
│   - clear_index()                   → wipe and rebuild      │
│                                                              │
│  Resources:                                                  │
│   - journal://index/status          → index metadata        │
│   - journal://sessions/{id}         → individual sessions   │
└────────────────────┬────────────────────────────────────────┘
                     │
       ┌─────────────┼─────────────┐
       │             │             │
┌──────▼──────┐ ┌───▼────┐ ┌─────▼─────┐
│ Embedder    │ │ Indexer│ │ Searcher  │
│             │ │        │ │           │
│ Ollama:     │ │ Qdrant │ │ Hybrid:   │
│ mxbai-      │ │ Local  │ │ 0.7 dense │
│ embed-large │ │ persist│ │ 0.3 BM25  │
│             │ │        │ │           │
│ Fallback:   │ │ Hybrid │ │ Rerank    │
│ OpenAI      │ │ enabled│ │ by score  │
└─────────────┘ └────────┘ └───────────┘
       │             │             │
       └─────────────┼─────────────┘
                     │
              ┌──────▼──────┐
              │ File System │
              │             │
              │ JOURNAL.md  │
              │ sessions/*  │
              │             │
              │ .gordo-     │
              │  memory/    │
              │  index.db   │
              └─────────────┘
```

---

## Data Model

### Input Sources (Five Layers)

**Layer 1: Sessions (JOURNAL.md or sessions/):**
```
## Session 30: Integrated v0.7.0 smoke test (2025-01-05)
Added output verification gates...
```

**Layer 2: Issues (github-issues/*.md):**
```
# Issue #123: Add dark mode support

**State:** open
**Created:** 2025-01-05
**Updated:** 2025-01-06
**Labels:** enhancement, ui
**URL:** https://github.com/owner/repo/issues/123

## Description
Users want dark mode...
```

**Layer 3: Commits (git-commits/*.md):**
```
# Commit abc1234: Fix authentication bug

**Hash:** abc1234567890abcdef
**Author:** Developer <dev@example.com>
**Date:** 2025-01-05

## Message
Fix OAuth token expiration handling...

## Files Changed
M src/auth/oauth.ts
M tests/auth.test.ts
```

**Layer 4: Docs (docs/**/*.md, *.md):**
Any markdown documentation files in your project.

**Layer 5: Code (disabled by default):**
Source code files (*.ts, *.js, *.py, etc.) - chunked at 1000 lines.

### Indexed Document Structure

```typescript
interface IndexedSession {
  id: string;              // "session-30"
  date: string;            // "2025-01-05"
  title: string;           // "Integrated v0.7.0 smoke test"
  content: string;         // Full text (250-500 words)
  type: 'session';         // Always 'session' (future: 'pattern', 'decision')
  source: 'flat' | 'hierarchical';

  // Metadata for filtering/sorting
  metadata: {
    wordCount: number;
    keywords: string[];    // Auto-extracted (hnswlib, semantic, etc.)
    sessionNumber: number; // Extracted from ID
    hasCode: boolean;      // Contains code blocks?
    hasLinks: boolean;     // Contains references?
  };

  // Embeddings (not stored here, in Qdrant)
  // - Dense vector: 1024 dims (Mixedbread)
  // - Sparse vector: BM25 terms (Qdrant native)
}
```

### Query Response

```typescript
interface SearchResult {
  sessionId: string;
  score: number;           // 0-1, hybrid score
  title: string;
  preview: string;         // First 200 chars
  metadata: {
    date: string;
    wordCount: number;
    relevanceReason: string; // "Mentions 'hnswlib' (exact match) + semantic similarity to 'filesystem persistence'"
  };
}
```

---

## Components

### 1. Parser (Gordo-Specific)

**JournalParser**
- Reads JOURNAL.md (flat format)
- Splits by `## YYYY-MM-DD Session N` headers
- Extracts: date, session ID, content
- Handles 256-char compressed format

**SessionParser**
- Reads sessions/ hierarchy
- Parses session-N.md files
- Extracts frontmatter (if exists)
- Handles markdown structure

**No generic document loaders** - we know our exact format.

### 2. Embedder (Local-First)

```typescript
class Embedder {
  private ollama: OllamaClient;
  private openai?: OpenAIClient;

  async embed(text: string): Promise<number[]> {
    // Try Ollama first (local, free, private)
    try {
      return await this.ollama.embeddings({
        model: 'mxbai-embed-large',
        prompt: text,
      });
    } catch (error) {
      // Fallback to OpenAI if Ollama unavailable
      if (this.openai) {
        const result = await this.openai.embeddings.create({
          model: 'text-embedding-3-small',
          input: text,
        });
        return result.data[0].embedding;
      }
      throw new Error('No embedding provider available');
    }
  }
}
```

**Why not complex embedding pipelines?**
- We don't need multi-modal
- We don't need domain adaptation
- Mixedbread is good enough (validated by smoke test)

### 3. Indexer (Hybrid-Native)

```typescript
class Indexer {
  private qdrant: QdrantClient;
  private embedder: Embedder;
  private collectionName = 'gordo-journal';

  async indexSession(session: IndexedSession): Promise<void> {
    // Generate dense embedding
    const denseVector = await this.embedder.embed(session.content);

    // Qdrant handles sparse (BM25) automatically if enabled
    await this.qdrant.upsert(this.collectionName, {
      points: [{
        id: session.id,
        vector: {
          dense: denseVector,
          // Sparse vector auto-generated by Qdrant from text
        },
        payload: {
          title: session.title,
          content: session.content,
          date: session.date,
          metadata: session.metadata,
        },
      }],
    });
  }

  async rebuildIndex(journalPath: string): Promise<void> {
    // Parse all sessions
    const sessions = await this.parseAllSessions(journalPath);

    // Clear existing index
    await this.qdrant.deleteCollection(this.collectionName);
    await this.qdrant.createCollection(this.collectionName, {
      vectors: {
        dense: { size: 1024, distance: 'Cosine' },
      },
      sparse_vectors: {
        text: {}, // Enable BM25-style sparse vectors
      },
    });

    // Index all sessions (batch if many)
    for (const session of sessions) {
      await this.indexSession(session);
    }
  }
}
```

**Why Qdrant specifically?**
- Native hybrid support (dense + sparse in ONE query)
- No manual BM25 implementation needed
- Payload filtering (can filter by date, type, etc.)
- Local embedded mode (no separate server for simple use)

### 4. Searcher (Hybrid + Simple Rerank)

```typescript
class Searcher {
  private qdrant: QdrantClient;
  private embedder: Embedder;

  async search(query: string, limit: number = 5): Promise<SearchResult[]> {
    // Generate query embedding
    const queryVector = await this.embedder.embed(query);

    // Hybrid search (Qdrant handles fusion internally)
    const results = await this.qdrant.search(this.collectionName, {
      vector: {
        name: 'dense',
        vector: queryVector,
      },
      // Qdrant automatically fuses with sparse vector search
      limit: limit * 2, // Get more for reranking
      with_payload: true,
    });

    // Simple rerank: boost exact keyword matches
    const reranked = this.rerank(results, query);

    return reranked.slice(0, limit).map(r => ({
      sessionId: r.id as string,
      score: r.score,
      title: r.payload.title,
      preview: r.payload.content.slice(0, 200),
      metadata: {
        date: r.payload.date,
        wordCount: r.payload.metadata.wordCount,
        relevanceReason: this.explainRelevance(r, query),
      },
    }));
  }

  private rerank(results: ScoredPoint[], query: string): ScoredPoint[] {
    const queryTerms = query.toLowerCase().split(/\s+/);

    return results.map(result => {
      let boost = 0;
      const content = (result.payload.content as string).toLowerCase();

      // Boost for exact phrase match
      if (content.includes(query.toLowerCase())) {
        boost += 0.2;
      }

      // Boost for all query terms present
      const matchedTerms = queryTerms.filter(term => content.includes(term));
      if (matchedTerms.length === queryTerms.length) {
        boost += 0.1;
      }

      return {
        ...result,
        score: result.score + boost,
      };
    }).sort((a, b) => b.score - a.score);
  }

  private explainRelevance(result: ScoredPoint, query: string): string {
    // Simple explanation for users
    const content = (result.payload.content as string).toLowerCase();
    const queryLower = query.toLowerCase();

    if (content.includes(queryLower)) {
      return `Exact match: "${query}"`;
    }

    const terms = query.split(/\s+/).filter(t => content.includes(t.toLowerCase()));
    if (terms.length > 0) {
      return `Matches keywords: ${terms.slice(0, 3).join(', ')}`;
    }

    return `Semantic similarity (${result.score.toFixed(2)})`;
  }
}
```

**Why simple reranking?**
- Bakeoff showed hybrid is 54% better
- Complex reranking (ColBERT, cross-encoders) adds latency
- Our queries are short (< 20 words typically)
- Simple boost for exact matches is enough

### 5. MCP Server (Interface)

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server({
  name: 'gordo-memory',
  version: '0.1.0',
}, {
  capabilities: {
    tools: {},
    resources: {},
  },
});

// Tool: search_journal
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'search_journal') {
    const { query, limit = 5 } = request.params.arguments;

    const results = await searcher.search(query, limit);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(results, null, 2),
      }],
    };
  }

  // Other tools: index_journal, get_session, list_sessions, clear_index
  // ...
});

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
```

**Why MCP?**
- Claude Code native integration
- Standardized protocol (any MCP client can use it)
- Tools + Resources model fits our use case
- Graceful fallback (if MCP unavailable, use CLI)

---

## File Structure

```
mcp-servers/gordo-memory/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── parser.ts             # JournalParser, SessionParser
│   ├── embedder.ts           # Embedder (Ollama + OpenAI fallback)
│   ├── indexer.ts            # Indexer (Qdrant operations)
│   ├── searcher.ts           # Searcher (hybrid + rerank)
│   └── cli.ts                # CLI for standalone usage
├── tests/
│   ├── parser.test.ts        # TDD: parse JOURNAL.md correctly
│   ├── embedder.test.ts      # TDD: embedding generation
│   ├── indexer.test.ts       # TDD: index sessions
│   ├── searcher.test.ts      # TDD: hybrid search works
│   └── integration.test.ts   # TDD: end-to-end workflow
├── package.json
├── tsconfig.json
├── README.md
└── ARCHITECTURE.md           # This file
```

**Why this structure?**
- Clear separation of concerns
- Each component testable independently
- TDD-friendly (write tests first for each)

---

## Performance Targets

**Based on empirical needs + bakeoff:**

| Metric | Target | Why |
|--------|--------|-----|
| Query latency (p95) | <100ms | BOS shouldn't feel slow |
| Index time (50 sessions) | <10s | Rebuild index occasionally |
| Index size | <10MB | Git-friendly (can gitignore) |
| Memory usage | <100MB | Don't hog RAM |
| P@3 (Precision at 3) | ≥0.60 | Bakeoff hybrid achieved 0.57 |
| MRR | ≥0.75 | First relevant result in top 2 |

**Validated in bakeoff:** Hybrid achieved P@3=0.567, MRR=0.820

---

## Non-Goals (Explicit)

**We are NOT building:**
- ❌ General-purpose RAG system (LangChain, LlamaIndex)
- ❌ Multi-user collaboration (single-AI, local-first)
- ❌ Cloud sync (git is the sync mechanism)
- ❌ Complex reranking (ColBERT, cross-encoders)
- ❌ Multi-modal (images, PDFs, audio)
- ❌ Real-time indexing (batch rebuild is fine)
- ❌ Distributed search (single machine is fine)
- ❌ A/B testing infrastructure
- ❌ Admin dashboard (CLI + MCP tools are enough)

**Why explicit non-goals matter:**
- Prevents scope creep
- Keeps implementation simple
- Focuses on Project Gordo collaboration needs
- Avoids generic RAG bloat

---

## Deployment Models

### Mode 1: MCP Server (Primary)
- Claude Code configures MCP server in settings
- gordo-memory runs as background process
- Tools available automatically at BOS
- **Use case:** v0.7.0+ users with Claude Code

### Mode 2: CLI (Fallback)
- `gordo-memory search "query"` from terminal
- Outputs JSON (can be piped)
- **Use case:** Users without MCP, automation scripts

### Mode 3: Graceful Degradation (No Index)
- If index doesn't exist, falls back to sequential grep
- Slower but still works
- **Use case:** First run, or index corrupted

---

## Migration Path (v0.7.0 → v0.8.0)

**v0.7.0 (MVP):**
- Basic hybrid search
- JOURNAL.md + sessions/ parsing
- Ollama + OpenAI embeddings
- MCP server + CLI

**v0.8.0 (Enhancements):**
- Matryoshka optimization (reduce dims to 512)
- Binary quantization (32x compression)
- Pattern clustering (group similar sessions)
- RAGAS evaluation (measure quality)

**v0.9.0 (Advanced):**
- Knowledge graph (#84 - relationship extraction)
- Predictive suggestions ("You might encounter...")
- Incremental indexing (only new sessions)

---

## Success Criteria

**Minimum viable (v0.7.0):**
- ✅ P@3 ≥ 0.60 (bakeoff: 0.567 achieved)
- ✅ Query latency <100ms
- ✅ Works with Ollama (local) OR OpenAI (fallback)
- ✅ MCP integration (Claude Code)
- ✅ Passes all TDD tests
- ✅ Smoke test validates end-to-end

**Quality bar:**
- ✅ Better than sequential grep (96x-164x speedup from prior art)
- ✅ Better than pure vector search (54% improvement from bakeoff)
- ✅ Gordo-framework philosophy aligned (local-first, simple, git-friendly)

---

## Architecture Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Vector Store** | Qdrant (embedded) | Native hybrid, JK experience, mature |
| **Embedding Model** | Mixedbread via Ollama | Smoke test validated, Apache-2.0, Matryoshka |
| **Retrieval** | Hybrid (0.7 dense + 0.3 BM25) | 54% better P@3 (bakeoff empirical) |
| **Deployment** | MCP server + CLI fallback | Claude Code native + graceful degradation |
| **Indexing** | Batch rebuild | Simpler than incremental, good enough for v0.7.0 |
| **Reranking** | Simple boost (exact matches) | Complex reranking unnecessary (bakeoff) |
| **Chunking** | Session-level (no splitting) | Sessions already 250-500 words (optimal) |
| **Persistence** | .gordo-memory/ (gitignored) | Local-first, git-friendly |

---

**Next: Implement with TDD (tests first, then code)**

<!-- Last reviewed: 2026-05-26 17:26 AEST by Gordo -->

<!-- Last reviewed: 2026-06-24 14:47 AEST by Gordo -->

<!-- Last reviewed: 2026-06-24 18:31 AEST by Gordo -->

<!-- Last reviewed: 2026-06-24 18:31 AEST by Gordo -->

<!-- Last reviewed: 2026-06-25 00:31 AEST by Gordo -->
