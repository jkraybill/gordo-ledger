#!/usr/bin/env bash
#
# sync-issues.sh - Sync GitHub issues to markdown files for gordo-memory indexing
# Part of Five-Layer Memory system
#
# Usage: ./sync-issues.sh [--repo OWNER/REPO] [--output-dir DIR] [--limit N] [--include-closed]
#
# Creates github-issues/issue-N.md files in the expected format for issue-commit-parser.ts

set -euo pipefail

# Defaults
REPO=""
OUTPUT_DIR="github-issues"
LIMIT=100
INCLUDE_CLOSED=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --repo)
            REPO="$2"
            shift 2
            ;;
        --output-dir)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        --limit)
            LIMIT="$2"
            shift 2
            ;;
        --include-closed)
            INCLUDE_CLOSED=true
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [--repo OWNER/REPO] [--output-dir DIR] [--limit N] [--include-closed]"
            echo ""
            echo "Options:"
            echo "  --repo OWNER/REPO   GitHub repository (default: auto-detect from git remote)"
            echo "  --output-dir DIR    Output directory (default: github-issues)"
            echo "  --limit N           Maximum issues to sync (default: 100)"
            echo "  --include-closed    Include closed issues (default: open only)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check for gh CLI
if ! command -v gh &> /dev/null; then
    echo "Error: gh CLI not found. Install from https://cli.github.com/"
    exit 1
fi

# Check gh auth
if ! gh auth status &> /dev/null; then
    echo "Error: Not authenticated with GitHub. Run: gh auth login"
    exit 1
fi

# Auto-detect repo if not specified
if [[ -z "$REPO" ]]; then
    REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || true)
    if [[ -z "$REPO" ]]; then
        echo "Error: Could not detect repository. Use --repo OWNER/REPO"
        exit 1
    fi
fi

echo "Syncing issues from $REPO..."

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Build state filter
STATE_FILTER="--state open"
if [[ "$INCLUDE_CLOSED" == "true" ]]; then
    STATE_FILTER="--state all"
fi

# Fetch issues
ISSUES=$(gh issue list --repo "$REPO" $STATE_FILTER --limit "$LIMIT" --json number,title,state,createdAt,updatedAt,labels,url,body)

# Count issues
COUNT=$(echo "$ISSUES" | jq 'length')
echo "Found $COUNT issues"

# Process each issue
echo "$ISSUES" | jq -c '.[]' | while read -r issue; do
    NUMBER=$(echo "$issue" | jq -r '.number')
    TITLE=$(echo "$issue" | jq -r '.title')
    STATE=$(echo "$issue" | jq -r '.state')
    CREATED=$(echo "$issue" | jq -r '.createdAt' | cut -d'T' -f1)
    UPDATED=$(echo "$issue" | jq -r '.updatedAt' | cut -d'T' -f1)
    URL=$(echo "$issue" | jq -r '.url')
    BODY=$(echo "$issue" | jq -r '.body // "No description provided."')

    # Extract labels as comma-separated string
    LABELS=$(echo "$issue" | jq -r '.labels | map(.name) | join(", ") // "none"')
    if [[ -z "$LABELS" ]]; then
        LABELS="none"
    fi

    # Create markdown file in expected format
    OUTPUT_FILE="$OUTPUT_DIR/issue-$NUMBER.md"

    cat > "$OUTPUT_FILE" << EOF
# Issue #$NUMBER: $TITLE

**State:** $STATE
**Created:** $CREATED
**Updated:** $UPDATED
**Labels:** $LABELS
**URL:** $URL

## Description

$BODY
EOF

    echo "  Synced issue #$NUMBER: $TITLE"
done

echo ""
echo "Synced $COUNT issues to $OUTPUT_DIR/"
echo ""
echo "To index these issues, run:"
echo "  gordo-memory index --full"
