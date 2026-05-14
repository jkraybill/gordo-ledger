#!/usr/bin/env bash
#
# sync-commits.sh - Sync git commits to markdown files for gordo-memory indexing
# Part of Five-Layer Memory system
#
# Usage: ./sync-commits.sh [--output-dir DIR] [--limit N] [--since DATE] [--branch BRANCH]
#
# Creates git-commits/commit-HASH.md files in the expected format for issue-commit-parser.ts

set -euo pipefail

# Defaults
OUTPUT_DIR="git-commits"
LIMIT=100
SINCE=""
BRANCH="HEAD"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --limit)
            LIMIT="$2"
            shift 2
            ;;
        --since)
            SINCE="$2"
            shift 2
            ;;
        --branch)
            BRANCH="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--output-dir DIR] [--limit N] [--since DATE] [--branch BRANCH]"
            echo ""
            echo "Options:"
            echo "  --output-dir DIR    Output directory (default: git-commits)"
            echo "  --limit N           Maximum commits to sync (default: 100)"
            echo "  --since DATE        Only commits after this date (e.g., 2025-01-01)"
            echo "  --branch BRANCH     Branch to sync (default: HEAD)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check we're in a git repo
if ! git rev-parse --git-dir &> /dev/null; then
    echo "Error: Not in a git repository"
    exit 1
fi

echo "Syncing commits from $BRANCH..."

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Build git log command
GIT_ARGS=("log" "$BRANCH" "-n" "$LIMIT" "--format=%H")
if [[ -n "$SINCE" ]]; then
    GIT_ARGS+=("--since=$SINCE")
fi

# Get commit hashes
COMMITS=$(git "${GIT_ARGS[@]}")
COUNT=$(echo "$COMMITS" | grep -c . || echo 0)
echo "Found $COUNT commits"

# Process each commit
SYNCED=0
for HASH in $COMMITS; do
    # Get commit details
    HASH_SHORT=$(git log -1 --format="%h" "$HASH")
    AUTHOR=$(git log -1 --format="%an <%ae>" "$HASH")
    DATE=$(git log -1 --format="%ad" --date=short "$HASH")
    SUBJECT=$(git log -1 --format="%s" "$HASH")
    BODY=$(git log -1 --format="%b" "$HASH")

    # Get files changed
    FILES_CHANGED=$(git diff-tree --no-commit-id --name-status -r "$HASH" 2>/dev/null || echo "")

    # Create markdown file in expected format
    OUTPUT_FILE="$OUTPUT_DIR/commit-$HASH_SHORT.md"

    cat > "$OUTPUT_FILE" << EOF
# Commit $HASH_SHORT: $SUBJECT

**Hash:** $HASH
**Author:** $AUTHOR
**Date:** $DATE

## Message

$SUBJECT

$BODY

## Files Changed

\`\`\`
$FILES_CHANGED
\`\`\`
EOF

    SYNCED=$((SYNCED + 1))

    # Progress indicator (every 10 commits)
    if (( SYNCED % 10 == 0 )); then
        echo "  Synced $SYNCED commits..."
    fi
done

echo ""
echo "Synced $SYNCED commits to $OUTPUT_DIR/"
echo ""
echo "To index these commits, run:"
echo "  gordo-memory index --full"
