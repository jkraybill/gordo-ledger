#!/bin/bash
# sync-issue-commit-layers.sh — populate a spoke's ISSUE and COMMIT memory
# layers (five-layer memory: sessions + issues + commits + docs + code).
#
# Exports GitHub issues and git commits to the markdown formats
# issue-commit-parser expects (strict adjacent metadata lines), then runs a
# --full reindex. Issues are re-exported every run (they mutate); commit
# exports are immutable and skipped when present.
#
# Usage:
#   GH_BIN=gh-gordo scripts/sync-issue-commit-layers.sh <spoke-path>
#   GH_BIN=gh-jk    scripts/sync-issue-commit-layers.sh <spoke-path>
#
# GH_BIN: your identity-partition gh wrapper (rule 4: never hardcoded here).
# Git access is read-only log/diff-tree, via /usr/bin/git like wire-spoke.sh
# and the canonical post-commit hook.
#
# Why --full at the end: incremental indexing's change scan never consults
# github-issues/ and git-commits/ (conventionally gitignored), so fresh
# exports are invisible to it — gordo-ledger#17. Verified workshop S139.
#
# Keep both dirs gitignored in the spoke (regenerable artifacts, like the
# index itself). Created S139 workshop, 2026-07-27; generalized from
# mum-book tools/sync-ledger-sources.sh.
set -euo pipefail

GIT=/usr/bin/git
GH_BIN="${GH_BIN:-gh}"
LEDGER_CLI="${LEDGER_CLI:-$HOME/gordo-ledger/mcp/dist/cli.js}"

SPOKE="${1:-$($GIT rev-parse --show-toplevel 2>/dev/null || true)}"
[ -z "$SPOKE" ] && { echo "usage: GH_BIN=<gh-wrapper> sync-issue-commit-layers.sh <spoke-path>"; exit 1; }
SPOKE=$(readlink -f "$SPOKE")
cd "$SPOKE"
$GIT rev-parse --git-dir >/dev/null 2>&1 || { echo "✗ not a git repo: $SPOKE"; exit 1; }
command -v jq >/dev/null || { echo "✗ jq required"; exit 1; }

REPO="$($GIT remote get-url origin 2>/dev/null | sed 's/.*github.com[:\/]//; s/\.git$//')"

# The header has said "keep both dirs gitignored" since S139 and left it to the
# operator. Running this across 19 spokes (S163) left 19 repos with two
# untracked directories apiece — hundreds of regenerable commit exports, one
# `git add -A` away from being committed. An instruction that every caller must
# remember is a step the script should just take. wire-spoke.sh already does
# exactly this for .gordo-memory/.
for D in github-issues git-commits; do
  grep -qxF "$D/" .gitignore 2>/dev/null && continue
  printf '\n# gordo-ledger issue/commit layer (regenerable: sync-issue-commit-layers.sh)\n%s/\n' "$D" >> .gitignore
  echo "✓ gitignored $D/"
done

echo "── Issues${REPO:+ from $REPO}"
if [ -n "$REPO" ]; then
  mkdir -p github-issues
  "$GH_BIN" issue list --repo "$REPO" --state all --limit 1000 \
    --json number,title,body,state,labels,comments,createdAt,updatedAt,url |
  jq -c '.[]' | while read -r issue; do
    N="$(jq -r '.number' <<<"$issue")"
    jq -r '
      "# Issue #\(.number): \(.title)\n\n" +
      "**State:** \(.state)\n" +
      "**Created:** \(.createdAt | split("T")[0])\n" +
      "**Updated:** \(.updatedAt | split("T")[0])\n" +
      "**Labels:** \(if (.labels | length) == 0 then "none" else (.labels | map(.name) | join(", ")) end)\n" +
      "**URL:** \(.url)\n\n---\n\n## Description\n\n" +
      (.body // "No description provided.") + "\n" +
      (if (.comments | length) > 0
       then "\n## Comments\n\n" + (.comments | map(
         "### Comment by \(.author.login // "ghost") (\(.createdAt | split("T")[0]))\n\n\(.body)\n"
       ) | join("\n"))
       else "" end)
    ' <<<"$issue" > "github-issues/issue-$N.md"
  done
  echo "✓ $(ls github-issues/issue-*.md 2>/dev/null | wc -l) issue files"
else
  echo "  no github.com origin — skipping issue export"
fi

echo "── Commits"
mkdir -p git-commits
NEW=0
for H in $($GIT log --format=%H); do
  SHORT="$($GIT log -1 --format=%h "$H")"
  FILE="git-commits/commit-$SHORT.md"
  [ -f "$FILE" ] && continue
  SUBJECT="$($GIT log -1 --format=%s "$H")"
  AUTHOR="$($GIT log -1 --format='%an <%ae>' "$H")"
  DATE="$($GIT log -1 --format=%ai "$H" | cut -d' ' -f1)"
  BODY="$($GIT log -1 --format=%b "$H")"
  STAT="$($GIT diff-tree --no-commit-id --numstat -r --root "$H")"
  if [ -n "$STAT" ]; then FILES="$(wc -l <<<"$STAT")"; else FILES=0; fi
  INS="$(awk '$1!="-"{s+=$1} END{print s+0}' <<<"$STAT")"
  DEL="$(awk '$2!="-"{s+=$2} END{print s+0}' <<<"$STAT")"
  {
    printf '# Commit %s: %s\n\n' "$SHORT" "$SUBJECT"
    printf '**Hash:** %s\n**Author:** %s\n**Date:** %s\n\n---\n\n## Message\n\n%s\n' "$H" "$AUTHOR" "$DATE" "$SUBJECT"
    if [ -n "$BODY" ]; then printf '\n%s\n' "$BODY"; fi
    printf '\n---\n\n## Files Changed (%s files, +%s -%s)\n\n' "$FILES" "$INS" "$DEL"
    while read -r A D F; do
      [ -z "$F" ] && continue
      if [ "$A" = "-" ]; then
        printf -- '- %s (binary)\n' "$F"
      else
        printf -- '- %s (+%s -%s)\n' "$F" "$A" "$D"
      fi
    done <<<"$STAT"
  } > "$FILE"
  NEW=$((NEW+1))
done
echo "✓ $NEW new commit exports ($(ls git-commits/commit-*.md 2>/dev/null | wc -l) total)"

echo "── Reindex (--full; incremental is blind to these dirs, gordo-ledger#17)"
if [ -f "$LEDGER_CLI" ]; then
  node "$LEDGER_CLI" index -p "$SPOKE" --full
else
  echo "⚠ ledger CLI not found at $LEDGER_CLI — exported only, index manually"
fi
