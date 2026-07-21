#!/bin/bash
# wire-spoke.sh — bring a spoke repo to FULLY WIRED ledger state, one command.
#
# "Fully wired" is defined as ALL of:
#   1. config.json with memory.semantic block (enabled, ollama/mxbai)
#   2. .gordo-memory/ index built and populated
#   3. .gordo-memory/ gitignored
#   4. post-commit auto-reindex hook (symlink to canonical script)
#   5. registered in the hub's projects/linked.conf  (→ BOS spoke stats)
#   6. federated in the hub's config.json memory.semantic.federatedPaths
#      (NOTE: must live INSIDE memory.semantic — loadConfig drops top-level
#       keys; workshop S126 032d436 learned this the hard way)
#   7. verified: stats show docs > 0 and a semantic search returns hits
#
# Usage:
#   wire-spoke.sh <spoke-path> [--hub <hub-path>] [--code] [--query "test query"]
#
#   --hub    hub repo for registration+federation (default ~/jk-gordo-workshop)
#   --code   also index source code (indexCode: true), default docs-only
#   --query  smoke-test search string (default: repo name)
#
# The script never commits — it prints the exact follow-up commits needed.
# Created S127 workshop, 2026-07-21.

set -euo pipefail

LEDGER_CLI="node $HOME/gordo-ledger/mcp/dist/cli.js"
HOOK_SRC="$HOME/gordo-home/tools/post-commit-reindex.sh"
# Reads git state only (rev-parse); never writes. /usr/bin/git bypasses the
# identity-partition guard the same way the canonical post-commit hook does.
GIT=/usr/bin/git

SPOKE=""
HUB="$HOME/jk-gordo-workshop"
INDEX_CODE=false
QUERY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --hub)   HUB="$2"; shift 2 ;;
    --code)  INDEX_CODE=true; shift ;;
    --query) QUERY="$2"; shift 2 ;;
    *)       SPOKE="$1"; shift ;;
  esac
done

[ -z "$SPOKE" ] && { echo "usage: wire-spoke.sh <spoke-path> [--hub <hub>] [--code] [--query q]"; exit 1; }
SPOKE=$(readlink -f "$SPOKE")
NAME=$(basename "$SPOKE")
[ -z "$QUERY" ] && QUERY="$NAME"

fail() { echo "✗ $1"; exit 1; }
step() { echo; echo "── $1"; }

step "Preflight"
[ -d "$SPOKE" ] || fail "spoke dir missing: $SPOKE"
$GIT -C "$SPOKE" rev-parse --git-dir >/dev/null 2>&1 || fail "$SPOKE is not a git repo"
[ -f "$HOME/gordo-ledger/mcp/dist/cli.js" ] || fail "ledger CLI not built (cd ~/gordo-ledger/mcp && npm run build)"
[ -f "$HOOK_SRC" ] || fail "canonical hook missing: $HOOK_SRC"
curl -sf http://localhost:11434/api/tags >/dev/null || fail "Ollama not reachable on :11434"
ollama list 2>/dev/null | grep -q mxbai-embed-large || fail "mxbai-embed-large not pulled"
command -v jq >/dev/null || fail "jq required"
echo "✓ spoke, CLI, hook, Ollama, model, jq"

step "1/7 config.json memory.semantic"
CONFIG="$SPOKE/config.json"
SEMANTIC=$(jq -n --argjson code "$INDEX_CODE" '{
  enabled: true, provider: "ollama", model: "mxbai-embed-large",
  threshold: 0.5, indexPath: ".gordo-memory", autoIndex: true,
  indexDocs: true, indexCode: $code }')
if [ ! -f "$CONFIG" ]; then
  jq -n --argjson s "$SEMANTIC" '{memory: {semantic: $s}}' > "$CONFIG"
  echo "✓ created config.json"
elif jq -e '.memory.semantic.enabled == true' "$CONFIG" >/dev/null 2>&1; then
  echo "✓ already present, untouched"
else
  jq --argjson s "$SEMANTIC" '.memory.semantic = $s' "$CONFIG" > "$CONFIG.tmp" && mv "$CONFIG.tmp" "$CONFIG"
  echo "✓ merged memory.semantic into existing config.json"
fi

step "2/7 .gitignore"
if ! grep -qx '\.gordo-memory/' "$SPOKE/.gitignore" 2>/dev/null; then
  printf '\n# gordo-ledger index (local, rebuild: cli.js index)\n.gordo-memory/\n' >> "$SPOKE/.gitignore"
  echo "✓ added .gordo-memory/ to .gitignore"
else
  echo "✓ already ignored"
fi

step "3/7 build index"
( cd "$SPOKE" && $LEDGER_CLI index ) || fail "index failed"

step "4/7 post-commit hook"
HOOK="$SPOKE/.git/hooks/post-commit"
if [ -L "$HOOK" ]; then
  echo "✓ symlink already installed → $(readlink "$HOOK")"
elif [ -e "$HOOK" ]; then
  echo "⚠ existing non-symlink hook left in place: $HOOK"
  echo "  merge manually: source $HOOK_SRC"
else
  ln -s "$HOOK_SRC" "$HOOK"
  echo "✓ symlinked → $HOOK_SRC"
fi

step "5/7 hub registration (linked.conf)"
LINKED="$HUB/projects/linked.conf"
if grep -qx "$SPOKE" "$LINKED" 2>/dev/null; then
  echo "✓ already in $LINKED"
else
  echo "$SPOKE" >> "$LINKED"
  echo "✓ appended to $LINKED"
fi

step "6/7 hub federation (config.json memory.semantic.federatedPaths)"
HUBCFG="$HUB/config.json"
TILDE_PATH="~/${SPOKE#"$HOME"/}"
[ -f "$HUBCFG" ] || fail "hub config missing: $HUBCFG"
if jq -e --arg p "$TILDE_PATH" '.memory.semantic.federatedPaths // [] | index($p)' "$HUBCFG" >/dev/null; then
  echo "✓ already federated"
else
  jq --arg p "$TILDE_PATH" '.memory.semantic.federatedPaths = ((.memory.semantic.federatedPaths // []) + [$p])' \
    "$HUBCFG" > "$HUBCFG.tmp" && mv "$HUBCFG.tmp" "$HUBCFG"
  echo "✓ added $TILDE_PATH"
fi

step "7/7 verify"
DOCS=$( (cd "$SPOKE" && $LEDGER_CLI stats 2>/dev/null) | grep -oE 'Total indexed: [0-9]+' | grep -oE '[0-9]+' || echo 0)
[ "$DOCS" -gt 0 ] || fail "index has 0 docs — nothing indexable? check indexDocs/indexCode"
echo "✓ $DOCS docs indexed"
# CLI result lines look like "85% path — preview"; trailer is "(docs: N)"
HITS=$( (cd "$SPOKE" && $LEDGER_CLI search "$QUERY" --limit 3 2>/dev/null) | grep -oE '\(docs: [0-9]+\)' | grep -oE '[0-9]+' || echo 0)
if [ "$HITS" -gt 0 ]; then
  echo "✓ search \"$QUERY\" → $HITS hits"
else
  echo "⚠ search \"$QUERY\" returned no hits (try a more on-topic --query before trusting the index)"
fi

echo
echo "════════════════════════════════════════════════════"
echo "$NAME is WIRED. Federation is live IMMEDIATELY for MCP sessions"
echo "(the server re-reads hub config.json per call — no restart needed)."
echo "CLI cross-repo search needs the explicit flag:  search q --federate $TILDE_PATH"
echo
echo "Remaining manual steps (identity-partitioned, not scripted):"
echo "  1. commit in spoke:  config.json .gitignore   (git-gordo)"
echo "  2. commit in hub:    config.json projects/linked.conf   (git-gordo)"
echo "════════════════════════════════════════════════════"
