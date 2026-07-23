# Migration Guide: Single Journal → Individual Session Files

**For repos set up before gordo-ledger, or using single JOURNAL.md**

## Why Migrate?

| Single File (JOURNAL.md) | Individual Files (sessions/) |
|--------------------------|------------------------------|
| Grows unbounded | Each session ~500-2000 lines, always fits context |
| Must chunk for indexing | Each file IS the chunk, optimal for semantic search |
| Noisy git diffs (all sessions in one file) | Clean adds, no merge conflicts |
| Past entries could be edited | Past sessions are frozen/immutable |
| Hard to prune old sessions | Trivial to archive/delete |

**The key insight:** gordo-ledger exists so you DON'T read the whole journal. You search. Individual files are optimal search targets.

## Migration Steps

### Step 1: Create directories

```bash
mkdir -p sessions archive
```

### Step 2: Split existing journal into session files

**Option A: Automated (if journal follows standard format)**

```bash
# From your project root
cd ~/your-gordo-project

# Parse and split JOURNAL.md
python3 << 'EOF'
import re
from pathlib import Path

journal = Path('JOURNAL.md').read_text()

# Match sessions in format: ## Session N: Title (YYYY-MM-DD) or ## Session N: Title
pattern = r'## Session (\d+): ([^\n]+?)(?:\s*\((\d{4}-\d{2}-\d{2})\))?\s*\n(.*?)(?=## Session \d+:|$)'
matches = re.findall(pattern, journal, re.DOTALL)

sessions_dir = Path('sessions')
sessions_dir.mkdir(exist_ok=True)

for num, title, date, content in matches:
    filename = f"Session_{int(num):02d}.md"

    # Build session file
    session_content = f"# Session {num}: {title}\n"
    if date:
        session_content += f"**Date:** {date}\n\n"
    session_content += content.strip() + "\n"

    (sessions_dir / filename).write_text(session_content)
    print(f"Created {filename}")

print(f"\nMigrated {len(matches)} sessions to sessions/")
EOF
```

**Option B: Manual (for non-standard formats)**

Create each session file manually:

```bash
# Example session file: sessions/Session_01.md
cat > sessions/Session_01.md << 'EOF'
# Session 1: Framework Setup
**Date:** 2024-12-01

Framework init. Gordo Framework adapted for trading.

**Files:** CONSTITUTION, TRUST_PROTOCOL, COLLABORATION

**Pattern:** High-medium intensity fits trading project well.
EOF
```

### Step 3: Archive the old journal

```bash
mv JOURNAL.md archive/
mv GORDO_JOURNAL_LOG.md archive/ 2>/dev/null || true
```

### Step 4: Update config.json

```json
{
  "journal": {
    "format": "individual",
    "directory": "sessions",
    "pattern": "Session_*.md",
    "bosLoadLastN": 5,
    "note": "Migrated from single JOURNAL.md to individual session files"
  }
}
```

### Step 5: Reindex gordo-ledger

```bash
# Full reindex to pick up new session files
./scripts/sync-ledger.sh --all

# Or manually
gordo-ledger index --full
```

### Step 6: Verify migration

```bash
# Check session count
gordo-ledger stats
# Should show: totalIndexedDocuments: XX (matching your session count)

# Test search
gordo-ledger search "your recent topic"
# Should return relevant sessions
```

### Step 7: Update docs

Update your project's framework files to reflect the new session format:

**SESSION_END.md:**
```markdown
3. **Create session file:**
   - Create `sessions/Session_XX.md` (next number)
   - Format: `# Session XX: Title` + Date, summary, tests, commit, pattern
   - Pre-commit hook auto-indexes to gordo-ledger
```

**CLAUDE.md:**
```markdown
**Session files:** `sessions/Session_XX.md` - One file per session, immutable after creation.
```

## Session File Format

Each session file should follow this structure:

```markdown
# Session N: Title
**Date:** YYYY-MM-DD

[Summary of what was accomplished]

**Tests:** X/X
**Commit:** abc1234

**Pattern:** [Key insight or lesson learned]

**Next:** [Optional: what to work on next]
```

### Required Elements
- `# Session N: Title` - Level 1 header with session number
- Summary content

### Optional Elements
- `**Date:**` - When the session occurred
- `**Tests:**` - Test count
- `**Commit:**` - Git commit hash
- `**Pattern:**` - Key insight for future reference
- `**Next:**` - Suggested next steps

## Session Numbering

Use zero-padded numbers for proper sorting:

```
sessions/
├── Session_01.md
├── Session_02.md
├── ...
├── Session_09.md
├── Session_10.md
├── Session_11.md
```

## Pre-commit Hook for Auto-sync

The standard pre-commit hook already handles individual session files:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: local
    hooks:
      - id: gordo-ledger-index
        name: gordo-ledger index
        entry: bash -c 'gordo-ledger index --incremental 2>/dev/null || true'
        language: system
        pass_filenames: false
        always_run: true
```

## Rollback (if needed)

If you need to revert to single-file format:

```bash
# Restore from archive
mv archive/JOURNAL.md .

# Update config.json
# Change "format": "individual" to "format": "flat"
# Change "directory": "sessions" to "file": "JOURNAL.md"

# Reindex
gordo-ledger index --full
```

## Troubleshooting

**"No sessions found" after migration**
- Verify session files exist: `ls sessions/`
- Check file format: must have `# Session N:` header
- Reindex: `gordo-ledger index --full`

**Session count mismatch**
- Parser looks for `# Session N:` pattern
- Ensure each file has exactly one session
- Check for duplicate session numbers

**Search returns old JOURNAL.md content**
- Archive directory should be excluded from indexing
- Check `config.json` indexPatterns.exclude includes `archive/**`
- Force reindex: `gordo-ledger index --full`

## Example Migration (polymarket project)

```bash
# Before: 45 sessions in JOURNAL.md (~17KB)
# After: 45 individual files in sessions/ (~500 bytes each)

$ ls sessions/ | wc -l
45

$ gordo-ledger stats
{
  "totalIndexedDocuments": 179,  # 45 sessions + issues + commits + docs
  "indexPath": ".gordo-ledger",
  "provider": "ollama"
}

$ gordo-ledger search "kelly sizing"
# Returns: Session_26 (Monte Carlo param optimization)
```

<!-- Last reviewed: 2026-07-23 14:50 AEST by Gordo -->
