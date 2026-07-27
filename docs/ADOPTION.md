# Adopting Gordo Ledger in a Spoke Project

**Quick reference for adding ledger to a new project under the umbrella.**

This guide assumes you have a hub (like `jk-gordo-workshop`) that manages spoke projects. For standalone use, see the main [README](../README.md).

---

## Fully Wired — The Definition

A spoke is **fully wired** when ALL seven hold (this list is canonical; scripts
and skills elsewhere reference it):

1. `config.json` has a `memory.semantic` block (enabled, ollama/mxbai)
2. `.gordo-memory/` index built and populated
3. `.gordo-memory/` is gitignored
4. post-commit auto-reindex hook installed (symlink to `~/gordo-home/tools/post-commit-reindex.sh`)
5. registered in the hub's `projects/linked.conf` (→ BOS spoke stats)
6. federated in the hub's `config.json` at `memory.semantic.federatedPaths` —
   **inside** `memory.semantic`; `loadConfig` silently drops top-level keys
   (workshop S126, `032d436`)
7. verified: `stats` shows docs > 0 AND a semantic search returns on-topic hits

**One command does all seven:**

```bash
~/gordo-ledger/scripts/wire-spoke.sh ~/your-project [--hub ~/your-hub] [--code] [--query "on-topic test"]
```

It's idempotent (safe to re-run), never commits, and prints the follow-up
commits it can't make for you. The manual steps below are the same procedure
unrolled, for understanding or partial repair.

---

## Prerequisites

- gordo-ledger built: `cd ~/gordo-ledger/mcp && npm install && npm run build`
- Ollama with mxbai-embed-large: `ollama pull mxbai-embed-large:latest`
- Hub with `projects/linked.conf` for spoke registry

---

## Quick Start (5 minutes)

### 1. Initialize the Ledger Index

```bash
cd ~/your-project
node ~/gordo-ledger/mcp/dist/cli.js init
```

Creates `.gordo-memory/` with empty index. Add to `.gitignore`:

```bash
echo ".gordo-memory/" >> .gitignore
```

### 2. Create config.json

```bash
cat > config.json << 'EOF'
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
      "indexCode": false
    }
  }
}
EOF
```

### 3. Run Initial Index

```bash
node ~/gordo-ledger/mcp/dist/cli.js index
```

### 4. Install Post-Commit Hook

Symlink to the canonical hook (this is what every wired spoke uses — verify
with `ls -la ~/jkbox/.git/hooks/post-commit`):

```bash
ln -sf ~/gordo-home/tools/post-commit-reindex.sh .git/hooks/post-commit
```

The hook self-guards: it exits silently unless the repo has `.gordo-memory/`,
only reindexes when indexable files changed, checks Ollama availability, and
runs in the background so commits aren't blocked. Update the central script
once and all spokes benefit.

> Historical note: this doc previously pointed at
> `~/gordo-home/tools/hooks/post-commit-ledger`, which does not exist.
> Corrected S127 (2026-07-21).

### 5. Register with Hub

Add to your hub's `projects/linked.conf`:

```bash
echo "/home/jk/your-project" >> ~/your-hub/projects/linked.conf
```

Update `projects/PROJECTS.md` with human-readable entry.

### 6. Commit Setup

```bash
git add config.json .gitignore
git commit -m "Add gordo-ledger integration"
```

---

## Verification

```bash
# Check index stats
node ~/gordo-ledger/mcp/dist/cli.js stats

# Test search
node ~/gordo-ledger/mcp/dist/cli.js search "your topic"

# From hub, check spoke appears in BOS
# (runs on next session start)
```

---

## MCP Access

Projects **don't need their own `.mcp.json`** if:
- Sessions are run from the project directory (ledger uses cwd)
- Or the hub's `.mcp.json` is loaded (Claude Code inherits)

The ledger MCP server uses `GORDO_REPO_PATH` or `process.cwd()` to find the index.

For explicit cross-repo access, use `federatedPaths` in config.json. It MUST
live **inside** `memory.semantic` — `loadConfig` silently drops unknown
top-level keys, so a top-level `federatedPaths` is ignored without error
(workshop S126 debugging, commit `032d436`):

```json
{
  "memory": {
    "semantic": {
      "enabled": true,
      "federatedPaths": [
        "~/home-server",
        "~/other-project"
      ]
    }
  }
}
```

Federation semantics (verified S127 2026-07-21; CLI updated backchannel S463, 2026-07-23):
- **MCP server**: federates automatically and picks up config edits **live** —
  it re-reads config.json on each federated call, no restart needed.
- **CLI**: bare `--federate` uses config `federatedPaths`; or pass explicit
  paths: `search "query" --federate ~/spoke-a,~/spoke-b`. Skipped repos warn
  on stderr; federated hits are labeled `[repo-basename]`.
- **Index layout note**: since formatVersion 3 (2026-07-23), `.gordo-memory/`
  holds `content.jsonl` beside `metadata.json` (document content, streamed).
  Both are covered by the standard `.gordo-memory/` gitignore entry.

---

## Hub Integration Points

### BOS Spoke Stats

The hub's BOS skill reads `projects/linked.conf` and reports ledger freshness for each spoke:

```
| Spoke ledgers | home-server: 1720 docs (15d ago), jkbox: 217 docs (13d ago) |
```

This surfaces stale indexes (>7 days since last commit with indexable files).

### Centralized Hook

The hook at `~/gordo-home/tools/post-commit-reindex.sh` (stale `hooks/post-commit-ledger` path corrected S463 — second surviving instance of the S127 doc bug):
- Uses `git-gordo` for identity partition
- Only indexes on meaningful file changes (md, ts, js, py, sql)
- Runs in background to not block commits

Update this central hook once, all spokes benefit.

---

## Troubleshooting

**Index not updating after commits:**
- Check hook symlink: `ls -la .git/hooks/post-commit` (should → `~/gordo-home/tools/post-commit-reindex.sh`)
- Check the reindex log: `tail ~/gordo-home/logs/ledger-reindex.log`
- Test manually: `cd <spoke> && node ~/gordo-ledger/mcp/dist/cli.js index --incremental`

**Search returns no results:**
- Verify index has docs: `node ~/gordo-ledger/mcp/dist/cli.js stats`
- Lower threshold: `--threshold 0.3`
- Check Ollama is running: `ollama list`

**Spoke not appearing in BOS:**
- Verify entry in `projects/linked.conf` (absolute path, no trailing slash)
- Verify `.gordo-memory/metadata.json` exists

---

## What Gets Indexed

| Content Type | Default | Notes |
|--------------|---------|-------|
| Markdown (*.md) | Yes | Docs, session logs, drafts |
| TypeScript/JavaScript | No | Set `indexCode: true` to enable |
| Python | No | Set `indexCode: true` to enable |
| SESSION_LOG.md | Yes | Session entries parsed as separate docs |

To index code (can be noisy for large codebases):

```json
{
  "memory": {
    "semantic": {
      "indexCode": true
    }
  }
}
```

---

## Five-Layer Completeness (Optional): Issue + Commit Layers

The parser natively understands two more layers beyond docs/sessions/code:
markdown exports in `github-issues/` and `git-commits/` become `issue` and
`commit` entries (see `mcp/src/parser/issue-commit-parser.ts` for the strict
formats). Populating them turns queries like "why did we reorganize X" into
cross-layer hits: the exact issue, the exact commit, the doc, and the session
that did it — all in one search.

**One command exports both and reindexes:**

```bash
GH_BIN=gh-gordo ~/gordo-ledger/scripts/sync-issue-commit-layers.sh ~/your-spoke
```

Issues are re-exported in full each run (they mutate); commit exports are
immutable and skipped when present. Pass your identity-partition gh wrapper
via `GH_BIN` (never hardcoded — partition rule 4). Keep both dirs gitignored:
they are regenerable artifacts, like the index itself.

**Two instrument gotchas, both found wiring the first five-layer spoke
(mum-book, workshop S139):**

1. **Incremental indexing is blind to these dirs** (gordo-ledger#17): the
   change scan never consults gitignored export dirs, so fresh exports are
   invisible to `--incremental`. The sync script forces `--full` for this
   reason. If issue/commit layers ever look stale: `index --full`.
2. **Layer-aware output breaks docs-only greps:** search trailers become
   `(docs: 2 | issue: 1)` instead of `(docs: 3)`. wire-spoke.sh's verify
   counted hits with a docs-only pattern and misreported zero (fixed —
   it now counts result lines). Audit any script parsing CLI search output.

Refresh cadence: after meaningful issue activity or a batch of commits —
typically at EOS for the spoke, or before a session that will lean on the
history. There is no hook for it; the post-commit reindex hook keeps docs
fresh but does NOT re-export issues/commits.

---

## Minimal vs Fully Wired

**Minimal:** local index + auto-reindex hook + hub registration. Enough for
searching from inside the spoke and BOS freshness stats.

**Fully wired** (see the definition at the top of this doc): minimal PLUS hub
federation and verification. This is the default expectation for active
spokes — federation is what lets the hub session (where most work starts)
reach the spoke's memory without cd-ing into it.

Beyond wiring, some spokes also carry `.claude/settings.json` hooks or a
skills directory — that's project tooling, not ledger wiring.

---

*Part of [gordo-ledger](https://github.com/jkraybill/gordo-ledger) — semantic memory for Project Gordo.*

<!-- Last reviewed: 2026-07-23 14:18 AEST by Gordo -->
