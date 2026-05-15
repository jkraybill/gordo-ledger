# Memory Protocol Audit Log — Schema Definition

**Version:** 0.1
**Status:** Draft

---

## Overview

The audit log is an append-only, hash-chained record of all memory operations. It serves as:
- Tamper-evident history of all changes
- Debugging tool for memory behavior
- Human-auditable record without AI mediation

## File Format

JSONL (JSON Lines) — one JSON object per line, append-only.

**Location:** `.gordo-memory/audit.jsonl`

## Entry Schema

```json
{
  "timestamp": "2026-05-14T15:30:00.000Z",
  "sequence": 42,
  "operation": "PROMOTE",
  "tier_from": "WORKING",
  "tier_to": "CORE",
  "memory_id": "C-042",
  "actor": "memory-controller",
  "reason": "Session-end consolidation, salience threshold met",
  "diff": {
    "salience_score": [0.68, 0.82],
    "tier": ["WORKING", "CORE"]
  },
  "source_session": "S232",
  "source_type": "stated",
  "confidence": 0.95,
  "prev_hash": "sha256:abc123...",
  "hash": "sha256:def456..."
}
```

## Field Definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `timestamp` | ISO 8601 | Yes | When operation occurred |
| `sequence` | integer | Yes | Monotonic sequence number |
| `operation` | enum | Yes | ADD, UPDATE, SUPERSEDE, PROMOTE, DEMOTE, FLAG_CONTRADICTION, RATIFY |
| `tier_from` | enum | No | Source tier (for moves) |
| `tier_to` | enum | No | Destination tier (for moves) |
| `memory_id` | string | Yes | ID of affected memory |
| `actor` | string | Yes | Who/what performed operation |
| `reason` | string | Yes | Why operation was performed |
| `diff` | object | No | Changed fields with [old, new] values |
| `source_session` | string | Yes | Session where operation originated |
| `source_type` | enum | No | stated, inferred, external, system |
| `confidence` | float | No | Confidence score if applicable |
| `prev_hash` | string | Yes | Hash of previous entry (chain) |
| `hash` | string | Yes | Hash of this entry |

## Operations

| Operation | Description |
|-----------|-------------|
| ADD | New memory created |
| UPDATE | Existing memory augmented |
| SUPERSEDE | Memory replaced (old marked superseded) |
| PROMOTE | Memory moved to higher tier |
| DEMOTE | Memory moved to lower tier |
| FLAG_CONTRADICTION | Contradiction detected |
| RATIFY | DECISIONS entry ratified via Seal |

## Hash Chain

Each entry's hash is computed from:
```
input = JSON.stringify({
  timestamp,
  sequence,
  operation,
  memory_id,
  actor,
  reason,
  prev_hash
})
hash = SHA-256(input)
```

**Genesis entry:** `prev_hash = "genesis"`

**Verification:** Walk chain from end, verify each hash matches. Any mismatch indicates tampering.

## Retention

- **Never deleted** — append-only by design
- **Separate from memory decay** — audit log persists even if memories are superseded
- **Size management:** Compress old entries (gzip) after 90 days, retain indefinitely

## Access

- Human can read directly (JSON is human-parseable)
- No AI mediation required for inspection
- CLI tool: `gordo-memory audit [--since DATE] [--operation OP] [--memory-id ID]`

## Integrity Alerts

Trigger alert on:
- Hash chain verification failure
- Sequence number gap
- Timestamp ordering violation
- Missing required fields

---

*Schema v0.1 — S232 2026-05-14*
