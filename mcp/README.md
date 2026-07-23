# gordo-ledger MCP: Semantic Memory Search Server

**Six-Layer Memory** for Project Gordo umbrella - semantic search across sessions, memory, issues, commits, docs, and code.

*Migrated to standalone repository S240. CLI commands and index directory (.gordo-memory/) unchanged for backwards compatibility.*

## Six-Layer Memory Architecture

The MCP server indexes **six layers** of project context, each with hierarchical boosting:

| Layer | Source | Boost | Description |
|-------|--------|-------|-------------|
| **1. Sessions** | `sessions/*.md` or `JOURNAL.md` | 2.0x | Your conversation logs (highest priority) |
| **2. Memory** | `auto-memory/*.md` | 2.0x | Graduated learnings (feedback, user, project, refs) |
| **3. Issues** | `github-issues/*.md` | 1.5x | GitHub issues (project planning) |
| **4. Commits** | `git-commits/*.md` | 1.2x | Git history (what changed and why) |
| **5. Docs** | `docs/**/*.md`, `*.md` | 1.0x | Documentation (reference material) |
| **6. Code** | `**/*.{ts,js,py,go,rs}` | 1.0x | Source code (intent-boosted) |

**Quick Start - Enable Full 6-Layer Memory:**
```bash
# Sync all layers and reindex
./scripts/sync-memory.sh --all

# Or step by step:
./scripts/sync-issues.sh      # Sync GitHub issues
./scripts/sync-commits.sh     # Sync git commits
gordo-memory index --full     # Reindex everything
```

## Features

- **Six-Layer Memory**: Sessions > Memory > Issues > Commits > Docs > Code (hierarchical boosting)
- **Dynamic Hybrid Search**: Adaptive weighting based on query length (v0.8.0+)
  - Single-word queries (≤2 words): **0.3 dense + 0.7 BM25** (favor keyword matching)
  - Multi-word queries (>2 words): **0.7 dense + 0.3 BM25** (favor semantic matching)
  - Result: 54% better P@3 than pure vector, excellent single-word query support
- **Embedded Mode**: No Docker required - works immediately after \`npm install\`
- **Multiple Embedding Providers**: Ollama (Mixedbread, **recommended**) or OpenAI
- **Knowledge Graph**: Relationship mapping (depends_on, relates_to, follows_from, fixes)
- **Individual Session Files**: Supports `sessions/*.md` (recommended) and legacy `JOURNAL.md`
- **Zero Server Management**: hnswlib-node embedded mode (vs Qdrant server)
- **Fast**: <100ms p95 search latency

## Prerequisites

**Required:**
- **Node.js 18+** and **npm 9+**
- **Ollama running locally** (recommended, free) OR **OpenAI API key** (paid, fallback)

**Install Ollama (recommended):**
\`\`\`bash
# Linux/WSL
curl https://ollama.ai/install.sh | sh

# macOS
brew install ollama

# Windows
# Download from https://ollama.com/download

# Pull Mixedbread embedding model (1024 dimensions, best empirical results)
ollama pull mxbai-embed-large:latest

# Verify Ollama is running
ollama list  # Should show mxbai-embed-large
\`\`\`

**OpenAI Alternative:**
\`\`\`bash
export OPENAI_API_KEY="sk-..."  # If using OpenAI instead
\`\`\`

## Installation

**From gordo-ledger repository:**

\`\`\`bash
# Clone gordo-ledger
cd ~
git clone https://github.com/jkraybill/gordo-ledger.git
cd gordo-ledger/mcp

# Install dependencies
npm install

# Build TypeScript → JavaScript
npm run build

# Verify installation
npm test

# Make CLI globally available (optional)
npm link
\`\`\`

**Post-install verification:**
\`\`\`bash
# Check CLI works
node ~/gordo-ledger/mcp/dist/cli.js --help

# Initialize memory index in your project
cd ~/your-gordo-project
node ~/gordo-ledger/mcp/dist/cli.js init

# Expected output:
# ✓ Index initialized at .gordo-memory/
\`\`\`

## Usage

### As MCP Server (Claude Code)

**Prerequisites:**
- Node.js 18+ installed (`node --version`)
- gordo-ledger MCP built (`npm run build` in gordo-ledger/mcp/)
- Ollama with mxbai-embed-large (or OpenAI API key)

#### Manual Setup

**Step 1: Create Project MCP Configuration**

Create **`.mcp.json`** in your **project root directory**.

**Concrete example (Linux user "alice"):**
```json
{
  "mcpServers": {
    "gordo-ledger": {
      "command": "/usr/bin/node",
      "args": ["/home/alice/gordo-ledger/mcp/dist/index.js"],
      "env": {
        "NODE_PATH": "/home/alice/gordo-ledger/mcp/node_modules"
      }
    }
  }
}
```

**Concrete example (NVM user "bob"):**
```json
{
  "mcpServers": {
    "gordo-ledger": {
      "command": "/home/bob/.nvm/versions/node/v20.19.0/bin/node",
      "args": ["/home/bob/gordo-ledger/mcp/dist/index.js"],
      "env": {
        "NODE_PATH": "/home/bob/gordo-ledger/mcp/node_modules"
      }
    }
  }
}
```

**⚠️ IMPORTANT:**
- Config file location: **`.mcp.json`** in **project root** (NOT `~/.claude/mcp-config.json`)
- Use **absolute paths** (expand `~` to full home directory path)
- Find your paths with: `which node` and `realpath ~/gordo-ledger`

**For NVM users:** Find your node path with `which node`. It will show something like `/home/username/.nvm/versions/node/v20.19.0/bin/node` - use that exact path

**Using OpenAI instead of Ollama:**

Add `OPENAI_API_KEY` to env:
\`\`\`json
{
  "mcpServers": {
    "gordo-ledger": {
      "command": "node",
      "args": ["/home/youruser/gordo-ledger/mcp/dist/index.js"],
      "env": {
        "NODE_PATH": "/home/youruser/gordo-ledger/mcp/node_modules",
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
\`\`\`

**Step 2: Restart Claude Code**

**⚠️ REQUIRED:** Close and reopen Claude Code **completely** to load the MCP server. Without restart, tools won't appear.

**Step 3: Verify MCP is loaded**

In Claude Code, verify gordo-memory tools are available:
- MCP tools should appear in the tool list
- Try: "What MCP tools do you have?" - should list gordo-memory tools

**MCP Tools Available:**
- `search` - Semantic search across journal sessions (hybrid vector + BM25)
- `index` - Index or reindex journal sessions
- `get_session` - Retrieve specific session by ID
- `stats` - Get memory index statistics
- `graph_query` - Knowledge graph relationship queries

**Troubleshooting:**

If MCP tools don't appear after restart:

1. **Check config file location:**
   \`\`\`bash
   ls .mcp.json  # Must be in project root, not ~/.claude/
   \`\`\`

2. **Verify JSON syntax:**
   \`\`\`bash
   cat .mcp.json | python3 -m json.tool  # Should parse without errors
   \`\`\`

3. **Check node path (for NVM users):**
   \`\`\`bash
   which node  # If shows .nvm/, use full path in config
   \`\`\`

4. **Verify dist/index.js exists:**
   \`\`\`bash
   ls ~/gordo-ledger/mcp/dist/index.js
   # If missing: cd ~/gordo-ledger/mcp && npm run build
   \`\`\`

5. **Test MCP server directly:**
   \`\`\`bash
   node ~/gordo-ledger/mcp/dist/index.js
   # Should output: "Gordo Memory MCP server running on stdio"
   # Press Ctrl+C to exit
   \`\`\`

6. **Try full Claude Code restart:**
   - Quit Claude Code completely (check no background processes)
   - Restart Claude Code
   - Wait 10-15 seconds for MCP servers to load

### As CLI Tool

**Basic workflow:**
\`\`\`bash
# 1. Initialize memory index in your project
cd ~/your-gordo-project
gordo-memory init
# ✓ Index initialized at .gordo-memory/

# 2. Index your journal sessions
gordo-memory index
# Indexed 15 sessions in 2.3s

# 3. Search semantically
gordo-memory search "OAuth authentication bugs" --limit 3
# Session_07 (similarity: 0.68) - Fix OAuth token expiration bug
# Session_12 (similarity: 0.61) - Implement OAuth 2.0 flow
# Session_15 (similarity: 0.55) - Debug authentication middleware

# 4. Query knowledge graph relationships
gordo-memory graph-query --session Session_15 --type dependencies
# Session_12 (depends_on) - OAuth foundation
# Session_07 (fixes) - Token expiration issue
\`\`\`

**CLI Options:**
\`\`\`bash
# Specify provider/model explicitly
gordo-memory init --provider ollama --model mxbai-embed-large

# Adjust search threshold (0-1, default: 0.5)
gordo-memory search "testing patterns" -t 0.3  # More permissive
gordo-memory search "exact query" -t 0.7      # More strict

# View detailed statistics
gordo-memory stats
# Memory Index Statistics:
#   Total sessions: 42
#   Provider: ollama
#   Model: mxbai-embed-large
#   Threshold: 0.5 (default)
#   Index size: 2.4 MB
\`\`\`

## Available MCP Tools

When using gordo-memory as an MCP server with Claude Code, you have access to these tools:

### Semantic Memory Tools

**`search` - Semantic search across journal sessions**
- **Parameters:**
  - `query` (required): Natural language search query
  - `limit` (optional, default: 5): Maximum number of results
  - `threshold` (optional, default: 0.5): Similarity threshold 0-1
- **Example:** `search` with query="OAuth authentication bugs"

**`index` - Index or reindex journal sessions**
- **Parameters:**
  - `incremental` (optional, default: true): Only index new sessions
  - `reindex` (optional, default: false): Force full reindex
- **Example:** `index` with reindex=true

**`get_session` - Retrieve a specific session by ID**
- **Parameters:**
  - `sessionId` (required): Session ID (e.g., "Session_01")
- **Example:** `get_session` with sessionId="Session_15"

**`stats` - Get memory index statistics**
- **Parameters:** None
- **Returns:** Total sessions, provider, model, threshold, index size

### Knowledge Graph Tools (v0.7.0+)

**`build_graph` - Build knowledge graph from journal sessions**
- **Parameters:**
  - `reindex` (optional, default: false): Force rebuild of entire graph
- **Extracts:** depends_on, relates_to, follows_from, fixes relationships

**`query_patterns` - Find sessions with a specific pattern**
- **Parameters:**
  - `pattern` (required): Pattern name (e.g., "oauth", "database", "deployment")
- **Example:** `query_patterns` with pattern="authentication"

**`find_path` - Find relationship path between two sessions**
- **Parameters:**
  - `fromSessionId` (required): Start session ID
  - `toSessionId` (required): End session ID
- **Example:** `find_path` from="Session_01" to="Session_15"

**`query_dependencies` - Get sessions that a given session depends on**
- **Parameters:**
  - `sessionId` (required): Session ID to analyze
- **Returns:** Direct and transitive dependencies with depth information

### Domain Memory Tools (v0.8.0+)

**`list_domains` - List available domain memory banks**
- **Parameters:** None
- **Returns:** Array of domain names from memory-bank/ directory
- **Example response:**
  \`\`\`json
  {
    "domains": ["authentication", "database", "deployment"],
    "count": 3,
    "path": "/path/to/memory-bank"
  }
  \`\`\`

**`get_domain_files` - Get all files in a specific domain**
- **Parameters:**
  - `domain` (required): Domain name (e.g., "authentication")
- **Returns:** Array of files in that domain
- **Example response:**
  \`\`\`json
  {
    "domain": "authentication",
    "files": [
      { "name": "oauth-patterns.md", "path": "authentication/oauth-patterns.md" },
      { "name": "jwt-implementation.md", "path": "authentication/jwt-implementation.md" }
    ],
    "count": 2,
    "path": "/path/to/memory-bank/authentication"
  }
  \`\`\`

**`sync_memory_bank` - Auto-extract patterns from journal and sync to memory-bank/**
- **Parameters:**
  - `limit` (optional): Number of recent sessions to analyze (default: 10)
- **Returns:** Sync results with domains created and patterns written
- **What it does:** Analyzes recent journal sessions using LLM to identify technical domains and patterns, then automatically creates/updates memory-bank/ directory structure with domain-organized knowledge files
- **Example response:**
  \`\`\`json
  {
    "success": true,
    "analyzed": 10,
    "domains": ["authentication", "database", "testing"],
    "domainsCreated": 2,
    "patternsWritten": 5,
    "domainsUpdated": ["authentication", "database", "testing"],
    "errors": [],
    "message": "Analyzed 10 sessions, extracted 3 domains, wrote 5 patterns"
  }
  \`\`\`
- **Use case:** Run this periodically (e.g., every 10-20 sessions) to consolidate recurring patterns from your chronological journal into topic-based reference docs

**Domain Memory Usage:**

Domain memory supplements chronological JOURNAL.md with topic-based organization:
- **JOURNAL.md** = chronological (WHEN things happened)
- **memory-bank/** = topic-based (WHAT you learned about each domain)

To use domain memory:
1. **Automatic (recommended):** Run `sync_memory_bank` to automatically extract and organize patterns from your journal sessions
2. **Manual:** Create `memory-bank/` directory and organize knowledge by domain manually
3. Use `list_domains` to see available domains
4. Use `get_domain_files` to browse files in a domain
5. Use existing `search` tool to search within domain files

**Workflow example:**
1. Work on your project, document in JOURNAL.md
2. After every 10-20 sessions, run `sync_memory_bank` to extract patterns
3. Browse extracted patterns with `list_domains` and `get_domain_files`
4. Manually refine/enhance the generated patterns as needed
5. Search both journal (chronological) and memory-bank (topical) as needed

See [templates/memory-bank/](../../templates/memory-bank/) for structure and examples.

**📚 Comprehensive Guide:** See [docs/DOMAIN_MEMORY.md](../../docs/DOMAIN_MEMORY.md) for complete documentation including:
- Architecture (chronological vs topic-based memory)
- LLM extraction process details
- Maturity levels (draft/validated/production)
- File structure and metadata
- Use cases and best practices
- Troubleshooting common issues
- Real-world examples

## Configuration

gordo-memory reads configuration from your project's \`config.json\`:

\`\`\`json
{
  "memory": {
    "semantic": {
      "enabled": true,
      "provider": "ollama",
      "model": "mxbai-embed-large",
      "threshold": 0.5,
      "indexPath": ".gordo-memory",
      "autoIndex": true,
      "indexDocs": true,
      "indexCode": false,
      "indexPatterns": {
        "include": ["docs/**/*.md", "*.md"],
        "exclude": ["node_modules/**", ".git/**"]
      },
      "hierarchicalBoost": {
        "session": 2.0,
        "issue": 1.5,
        "commit": 1.2,
        "docs": 1.0,
        "code": 0.5
      }
    }
  }
}
\`\`\`

### Session Storage: Individual Files (Recommended)

**Why individual session files?**
- Each session is an optimal embedding chunk (vs splitting a giant file)
- Git history is clean (new file per session, no merge conflicts)
- Past sessions are immutable
- Easy to archive old sessions

**Structure:**
```
sessions/
├── Session_01.md    # # Session 1: Framework Setup
├── Session_02.md    # # Session 2: First Feature
├── ...
└── Session_45.md    # # Session 45: Latest Work
```

**Migrating from JOURNAL.md?** See [MIGRATION.md](MIGRATION.md) for step-by-step guide.

### Five-Layer Memory Setup

**1. Sync GitHub Issues (Layer 2):**
\`\`\`bash
# Auto-detects repo from git remote
./scripts/sync-issues.sh

# Or specify repo explicitly
./scripts/sync-issues.sh --repo owner/repo --limit 200 --include-closed
\`\`\`

**2. Sync Git Commits (Layer 3):**
\`\`\`bash
# Sync last 100 commits
./scripts/sync-commits.sh

# Or with options
./scripts/sync-commits.sh --limit 200 --since 2025-01-01
\`\`\`

**3. Enable Docs Indexing (Layer 4):**
Set \`indexDocs: true\` in config.json (enabled by default).

**4. Enable Code Indexing (Layer 5, optional):**
Set \`indexCode: true\` in config.json. Note: Can be noisy for large codebases.

**5. Full Sync (All Layers):**
\`\`\`bash
./scripts/sync-memory.sh --all
\`\`\`

### Auto-Sync Hook Setup

**⚠️ IMPORTANT: Use post-commit, NOT pre-commit!**

The sync must run *after* the commit exists, otherwise the current commit won't be indexed.

**Create `.git/hooks/post-commit`:**
```bash
#!/bin/bash
# gordo-memory: Auto-sync after each commit

# Sync latest commits (including the one we just made)
./scripts/sync-commits.sh --limit 20 2>/dev/null || true

# Reindex (MCP server auto-reloads from disk)
/path/to/gordo-memory/dist/cli.js index --incremental 2>/dev/null || true
```

**Make it executable:**
```bash
chmod +x .git/hooks/post-commit
```

**Why not pre-commit?**
Pre-commit runs *before* the commit is created. `sync-commits.sh` syncs HEAD, but in pre-commit, HEAD is still the previous commit. Your current commit won't be indexed until the *next* commit.

**Alternative: Pre-commit for non-commit layers**

If you want to use pre-commit for other layers (issues, docs), that's fine:
```yaml
repos:
  - repo: local
    hooks:
      - id: gordo-memory-sync-issues
        name: gordo-memory sync issues
        entry: bash -c './scripts/sync-issues.sh 2>/dev/null || true'
        language: system
        pass_filenames: false
        always_run: true
```

Just keep commit syncing in post-commit.

**Configuration Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable semantic memory |
| `provider` | string | `"ollama"` | Embedding provider: `"ollama"` or `"openai"` |
| `model` | string | `"mxbai-embed-large"` | Embedding model (provider-specific) |
| `threshold` | number | `0.5` | Similarity threshold 0-1 (empirically validated) |
| `indexPath` | string | `".gordo-memory"` | Vector store path (git-ignored) |
| `autoIndex` | boolean | `true` | Auto-index after each session |

**Providers:**
- **`ollama`** (recommended) - Free, local, private, Mixedbread model (100% accuracy in Session 43 bakeoff)
  - Requires: Ollama running locally
  - Model: `mxbai-embed-large:latest` (1024 dimensions)
- **`openai`** - Paid, cloud, fallback option
  - Requires: `OPENAI_API_KEY` environment variable
  - Model: `text-embedding-3-small` (1536 dimensions)

## Tuning Search Threshold

The similarity threshold controls how closely results must match your query (0-1 scale, cosine similarity).

**Recommendations by strictness:**
- **Higher (0.7-1.0)**: Strict matching, fewer but more relevant results
- **Medium (0.4-0.6)**: Balanced (recommended starting point, catches 50-65% similarity matches)
- **Lower (0.0-0.3)**: Permissive, more results but may include less relevant

**Default: 0.5** (empirically validated in Session 43)

**Adjust per-query:**
```bash
gordo-memory search "your query" -t 0.3   # More permissive
gordo-memory search "exact query" -t 0.7  # More strict
```

**Adjust globally in config.json:**
```json
{
  "memory": {
    "semantic": {
      "threshold": 0.4
    }
  }
}
```

**When to adjust:**
- **Too few results:** Lower threshold (try 0.3)
- **Too many irrelevant results:** Raise threshold (try 0.7)
- **Single-word queries:** Lower threshold (single words less semantically rich)
- **Multi-word semantic queries:** Default works well

## Architecture

### CLI vs MCP Server (Important!)

gordo-memory has **two entry points** that share the same disk-persisted index:

```
┌─────────────────┐     ┌─────────────────┐
│   CLI (cli.js)  │     │ MCP Server      │
│   - Runs once   │     │ - Long-running  │
│   - Exits after │     │ - Stays in mem  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │    ┌───────────┐      │
         └───►│   Disk    │◄─────┘
              │ .gordo-   │
              │  memory/  │
              └───────────┘
```

**How they coordinate:**
- Both read/write to `.gordo-memory/` (metadata.json + index.hnsw)
- CLI writes changes and exits
- MCP server auto-reloads when disk is newer (checks mtime before searches)

**This means:**
- You can run CLI `index` from hooks → MCP server sees changes automatically
- No need to restart MCP server after CLI indexing
- Changes are visible on next search (small reload latency)

**Components (47/47 tests passing):**
1. **Parser** (15 tests) - Extracts sessions from JOURNAL.md or sessions/
2. **Embedder** (13 tests) - Generates embeddings via Ollama or OpenAI
3. **Indexer** (19 tests) - Hybrid search with hnswlib-node + manual BM25
4. **MCP Wrapper** - Exposes search interface via MCP protocol

**Why hnswlib-node over Qdrant:**
- User experience > implementation complexity
- No Docker dependency (embedded mode)
- Self-contained (npm install → works)
- Local-first (matches framework philosophy)

**Manual BM25 Implementation:**
- Full Okapi BM25 (k1=1.5, b=0.75)
- IDF + document length normalization
- ~100 lines, well-tested
- One-time cost for permanent user benefit

## Performance

**Targets (from Session 32 bakeoff):**
- P@3 ≥0.60 (achieved: 0.567 baseline, 0.882 with hybrid)
- MRR ≥0.75 (achieved: 0.820)
- Latency <100ms p95 (search only, excluding embedding)

**Empirical Validation:**
- 74% natural language queries + 19% keyword queries
- Hybrid retrieval essential for framework query patterns
- 54% improvement in P@3 vs pure vector search

## Development

\`\`\`bash
# Install dependencies
npm install

# Build TypeScript → JavaScript
npm run build

# Run tests (requires Ollama for full test suite)
npm test

# Development mode (watch for changes)
npm run dev
\`\`\`

## Performance

### Expected Index Times

Initial indexing (first time, full index):

| Sessions | Approximate Time |
|----------|-----------------|
| 100 sessions | ~10 seconds |
| 500 sessions | ~30 seconds |
| 1000 sessions | ~1 minute |
| 1500+ sessions | ~2 minutes |

**Incremental updates:** <5 seconds (only processes new/changed content)

### Search Latency

- **First search:** 500ms-2s (index loading)
- **Subsequent searches:** <100ms (index cached)
- **P95 latency:** <100ms after warmup

### Memory Usage

- **Index size:** ~1MB per 100 sessions (approximate)
- **Runtime memory:** ~100-200MB during indexing, ~50MB during search

**Tip:** The progress bar during indexing shows real-time progress. If it appears stuck, check Ollama is running (embedding generation is the slowest step).

## Troubleshooting

### Common Issues

**"No results found" (even for relevant queries)**
- **Cause:** Threshold too high (default was 0.75 in older versions, now 0.5)
- **Fix:** Lower threshold: `gordo-memory search "query" -t 0.3`
- **Permanent fix:** Update `config.json` threshold to `0.5` or lower

**"Error: Ollama API error" / "ECONNREFUSED"**
- **Cause:** Ollama not running
- **Fix:**
  \`\`\`bash
  ollama serve  # Start Ollama
  ollama list   # Verify mxbai-embed-large is installed
  ollama pull mxbai-embed-large:latest  # If model missing
  \`\`\`
- **Alternative:** Switch to OpenAI provider in config.json

**"Error: Index not initialized"**
- **Cause:** `.gordo-memory/` directory doesn't exist
- **Fix:** Run `gordo-memory init` before searching/indexing
- **From MCP:** Use `index` tool to initialize automatically

**"No journal found" / "Indexed 0 sessions"**
- **Cause 1:** Session files missing
  - **Fix:** Create `sessions/Session_01.md` with `# Session 1: Title` header
  - **Legacy:** Or create `JOURNAL.md` with `## Session N:` sections
- **Cause 2:** Session format incorrect
  - **Individual files:** `# Session N: Title` (level-1 header)
  - **JOURNAL.md:** `## Session N: Title (YYYY-MM-DD)` (level-2 header)
- **Migrating?** See [MIGRATION.md](MIGRATION.md)

**"gordo-memory: command not found"**
- **Cause:** CLI not linked globally
- **Fix:**
  \`\`\`bash
  cd ~/gordo-ledger/mcp
  npm link  # Make gordo-memory globally available
  \`\`\`
- **Alternative:** Use full path: `~/gordo-ledger/mcp/dist/cli.js`

**"CLI says indexed but MCP search doesn't find it"**
- **Cause 1 (pre-v0.9.1):** MCP server cached stale index in memory
  - **Fix:** Update to v0.9.1+ (auto-reloads when disk is newer)
  - **Workaround:** Restart Claude Code to reload MCP server
- **Cause 2:** Using pre-commit hook instead of post-commit
  - **Fix:** Move sync to post-commit hook (see "Auto-Sync Hook Setup" above)
  - **Why:** Pre-commit runs before commit exists, so current commit isn't synced

**"New commits aren't being indexed"**
- **Cause:** Using pre-commit hook for commit syncing
- **Fix:** Use post-commit hook instead
- **Check:** `git log -1` should match what `gordo-memory search` can find
- **Debug:** Run `./scripts/sync-commits.sh --limit 5` manually and check output

**"Incremental index says 'indexed N' but stats unchanged"**
- **Cause:** MCP server has stale in-memory cache (pre-v0.9.1)
- **Fix:** Update to v0.9.1+ OR run full reindex via MCP: `index --reindex`
- **Verify:** `stats` should show updated count after reindex

**MCP server not loading in Claude Code**
- **Cause 1:** mcp-config.json in wrong location
  - **Linux/WSL:** `~/.claude/mcp-config.json`
  - **macOS:** `~/Library/Application Support/Claude/mcp-config.json`
  - **Windows:** `%APPDATA%\\Claude\\mcp-config.json`
- **Cause 2:** Claude Code not restarted
  - **Fix:** Close and reopen Claude Code completely
- **Cause 3:** Incorrect path to dist/index.js
  - **Fix:** Use absolute path, ensure `dist/index.js` exists after build

**"Unknown embedding model: mxbai-embed-large:latest"**
- **Cause:** Model tag normalization issue (fixed in Session 44)
- **Fix:** Update to latest gordo-ledger version
- **Workaround:** Use `mxbai-embed-large` (without `:latest` suffix)

**OpenAI tests failing**
- **Expected behavior:** 10 OpenAI tests skipped if no `OPENAI_API_KEY`
- **Not a problem:** 179/189 tests pass (10 skipped) = 100% pass rate

### Getting Help

**Check logs:**
\`\`\`bash
# MCP server logs (Claude Code)
# Look in Claude Code developer console (Help → Toggle Developer Tools)

# CLI logs
gordo-memory search "query" --verbose  # Detailed output
\`\`\`

**Report issues:**
- GitHub: https://github.com/jkraybill/gordo-ledger/issues
- Include: OS, Node version, error message, `gordo-memory stats` output

## License

MIT

## Credits

Built with TDD approach (Sessions 33-35):
- Session 33: Parser + Embedder (28/28 tests)
- Session 34: HNSW Indexer (19/19 tests, hnswlib-node embedded mode)
- Session 35: MCP Wrapper (integration complete)

<!-- Last reviewed: 2026-05-26 17:26 AEST by Gordo -->
