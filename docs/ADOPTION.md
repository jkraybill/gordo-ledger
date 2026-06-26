# Adopting Gordo Ledger in a Spoke Project

**Quick reference for adding ledger to a new project under the umbrella.**

This guide assumes you have a hub (like `jk-gordo-workshop`) that manages spoke projects. For standalone use, see the main [README](../README.md).

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

**Option A: Symlink (preferred)**
```bash
ln -sf ~/gordo-home/tools/hooks/post-commit-ledger .git/hooks/post-commit
```

**Option B: Source wrapper**
```bash
mkdir -p .git/hooks
cat > .git/hooks/post-commit << 'EOF'
#!/bin/bash
# Gordo ledger auto-reindex on commit
source "/home/jk/gordo-home/tools/hooks/post-commit-ledger"
EOF
chmod +x .git/hooks/post-commit
```

Both patterns delegate to the centralized hook at `~/gordo-home/tools/hooks/post-commit-ledger`, so hub-level updates propagate to all spokes.

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

For explicit cross-repo access, use `federatedPaths` in config.json:

```json
{
  "federatedPaths": [
    "~/home-server",
    "~/other-project"
  ]
}
```

---

## Hub Integration Points

### BOS Spoke Stats

The hub's BOS skill reads `projects/linked.conf` and reports ledger freshness for each spoke:

```
| Spoke ledgers | home-server: 1720 docs (15d ago), jkbox: 217 docs (13d ago) |
```

This surfaces stale indexes (>7 days since last commit with indexable files).

### Centralized Hook

The hook at `~/gordo-home/tools/hooks/post-commit-ledger`:
- Uses `git-gordo` for identity partition
- Only indexes on meaningful file changes (md, ts, js, py, sql)
- Runs in background to not block commits

Update this central hook once, all spokes benefit.

---

## Troubleshooting

**Index not updating after commits:**
- Check hook is executable: `ls -la .git/hooks/post-commit`
- Check hook sources the right path
- Test manually: `source ~/gordo-home/tools/hooks/post-commit-ledger`

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

## Minimal vs Full Integration

**Minimal (this guide):**
- Local index only
- Post-commit auto-reindex
- Hub registration for BOS stats

**Full integration (optional):**
- `.claude/settings.json` with project-specific hooks
- Skills directory with project-specific commands
- Federation config for cross-repo search

Most spoke projects only need minimal integration.

---

*Part of [gordo-ledger](https://github.com/jkraybill/gordo-ledger) — semantic memory for Project Gordo.*
