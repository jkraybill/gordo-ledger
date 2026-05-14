#!/usr/bin/env bash
#
# sync-memory.sh - Sync all memory sources for Five-Layer Memory
# Master script that syncs issues, commits, and triggers reindexing
#
# Usage: ./sync-memory.sh [--issues] [--commits] [--docs] [--reindex] [--all]
#
# Five-Layer Memory:
#   1. Sessions  - Journal entries (JOURNAL.md or sessions/)
#   2. Issues    - GitHub issues (github-issues/)
#   3. Commits   - Git commits (git-commits/)
#   4. Docs      - Documentation files (*.md, *.txt in docs/, etc.)
#   5. Code      - Source code (*.ts, *.py, etc.) - disabled by default

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Defaults
SYNC_ISSUES=false
SYNC_COMMITS=false
SYNC_DOCS=false
REINDEX=false
ALL=false
ISSUE_LIMIT=100
COMMIT_LIMIT=100

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --issues)
            SYNC_ISSUES=true
            shift
            ;;
        --commits)
            SYNC_COMMITS=true
            shift
            ;;
        --docs)
            SYNC_DOCS=true
            shift
            ;;
        --reindex)
            REINDEX=true
            shift
            ;;
        --all)
            ALL=true
            shift
            ;;
        --issue-limit)
            ISSUE_LIMIT="$2"
            shift 2
            ;;
        --commit-limit)
            COMMIT_LIMIT="$2"
            shift 2
            ;;
        -h|--help)
            cat << EOF
sync-memory.sh - Sync all memory sources for Five-Layer Memory

Usage: $0 [options]

Options:
  --issues        Sync GitHub issues
  --commits       Sync git commits
  --docs          Enable docs indexing in config
  --reindex       Force full reindex after sync
  --all           Sync everything (issues + commits + reindex)
  --issue-limit N Maximum issues to sync (default: 100)
  --commit-limit N Maximum commits to sync (default: 100)

Five-Layer Memory Architecture:
  Layer 1: Sessions  - Your journal entries (highest priority in search)
  Layer 2: Issues    - GitHub issues (project planning context)
  Layer 3: Commits   - Git history (what changed and why)
  Layer 4: Docs      - Documentation files (reference material)
  Layer 5: Code      - Source code (implementation details)

Examples:
  # Sync everything and reindex
  $0 --all

  # Just sync issues
  $0 --issues

  # Sync commits from last month and reindex
  $0 --commits --reindex

  # Enable full 5-layer memory
  $0 --all --docs
EOF
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# If --all, enable everything
if [[ "$ALL" == "true" ]]; then
    SYNC_ISSUES=true
    SYNC_COMMITS=true
    REINDEX=true
fi

# If nothing specified, show help
if [[ "$SYNC_ISSUES" == "false" && "$SYNC_COMMITS" == "false" && "$SYNC_DOCS" == "false" && "$REINDEX" == "false" ]]; then
    echo "No options specified. Use --help for usage."
    echo ""
    echo "Quick start:"
    echo "  $0 --all       # Sync issues, commits, and reindex"
    echo "  $0 --issues    # Just sync GitHub issues"
    exit 0
fi

echo "========================================="
echo "  Five-Layer Memory Sync"
echo "========================================="
echo ""

# Sync GitHub issues
if [[ "$SYNC_ISSUES" == "true" ]]; then
    echo "Layer 2: Syncing GitHub issues..."
    if [[ -x "$SCRIPT_DIR/sync-issues.sh" ]]; then
        "$SCRIPT_DIR/sync-issues.sh" --limit "$ISSUE_LIMIT" --include-closed || {
            echo "Warning: Issue sync failed (gh CLI not configured?)"
        }
    else
        echo "Warning: sync-issues.sh not found or not executable"
    fi
    echo ""
fi

# Sync git commits
if [[ "$SYNC_COMMITS" == "true" ]]; then
    echo "Layer 3: Syncing git commits..."
    if [[ -x "$SCRIPT_DIR/sync-commits.sh" ]]; then
        "$SCRIPT_DIR/sync-commits.sh" --limit "$COMMIT_LIMIT" || {
            echo "Warning: Commit sync failed"
        }
    else
        echo "Warning: sync-commits.sh not found or not executable"
    fi
    echo ""
fi

# Enable docs indexing
if [[ "$SYNC_DOCS" == "true" ]]; then
    echo "Layer 4: Enabling docs indexing..."
    if [[ -f "config.json" ]]; then
        # Update config.json to enable indexDocs
        if command -v jq &> /dev/null; then
            jq '.memory.semantic.indexDocs = true' config.json > config.json.tmp && mv config.json.tmp config.json
            echo "  Updated config.json: indexDocs = true"
        else
            echo "  Warning: jq not installed. Please manually set indexDocs: true in config.json"
        fi
    else
        echo "  No config.json found. Using defaults (indexDocs = true)"
    fi
    echo ""
fi

# Reindex
if [[ "$REINDEX" == "true" ]]; then
    echo "Reindexing all layers..."
    if command -v gordo-memory &> /dev/null; then
        gordo-memory index --full
    elif [[ -f "$SCRIPT_DIR/../dist/cli.js" ]]; then
        node "$SCRIPT_DIR/../dist/cli.js" index --full
    else
        echo "Warning: gordo-memory CLI not found. Run manually:"
        echo "  gordo-memory index --full"
    fi
    echo ""
fi

echo "========================================="
echo "  Sync complete!"
echo "========================================="
echo ""
echo "Memory layers status:"
echo "  [1] Sessions  - From JOURNAL.md / sessions/"
if [[ "$SYNC_ISSUES" == "true" ]]; then
    echo "  [2] Issues    - Synced to github-issues/"
else
    echo "  [2] Issues    - Not synced (use --issues)"
fi
if [[ "$SYNC_COMMITS" == "true" ]]; then
    echo "  [3] Commits   - Synced to git-commits/"
else
    echo "  [3] Commits   - Not synced (use --commits)"
fi
if [[ "$SYNC_DOCS" == "true" ]]; then
    echo "  [4] Docs      - Enabled in config"
else
    echo "  [4] Docs      - Check config.json indexDocs setting"
fi
echo "  [5] Code      - Disabled by default (set indexCode: true to enable)"
